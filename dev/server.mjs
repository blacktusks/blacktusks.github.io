// Local stand-in for a Supabase project, used only for development and the
// end-to-end tests. Real Postgres (PGlite) with the real migration and the
// real row-level-security rules; a small HTTP layer that speaks the parts of
// the Supabase REST, Auth, Storage and Functions APIs the app uses.
//
//   node dev/server.mjs            -> http://localhost:54321
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 54321);
const SECRET = 'dev-jwt-secret-not-for-production';
const LOGIN_DOMAIN = 'blacktusk.invalid';

// ── JWT ──
const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(claims) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(claims));
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const want = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  if (want !== s) return null;
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
const far = 4102444800;   // fixed, so the dev keys are the same on every start
export const ANON_KEY = sign({ role: 'anon', iss: 'dev', exp: far });
export const SERVICE_KEY = sign({ role: 'service_role', iss: 'dev', exp: far });

// ── database ──
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null,
    encrypted_password text not null, raw_user_meta_data jsonb not null default '{}',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role', true) $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
    name text, owner uuid, created_at timestamptz default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  grant all on all tables in schema storage to anon, authenticated, service_role;
  grant all on all tables in schema auth to service_role;
  -- A stock Supabase project hands every new table and function to anon and authenticated.
  -- The migration has to take that away again and grant only what the app uses.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);
for (const f of fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort()) {
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'));
}
// run the migration twice: it promises to be re-runnable
for (const f of fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort()) {
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'));
}

const hash = (p) => crypto.createHash('sha256').update('dev:' + p).digest('hex');
async function as(claims, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`,
      [claims?.sub || '', claims?.role || 'anon']);
    await tx.exec(`set local role ${['authenticated', 'service_role'].includes(claims?.role) ? claims.role : 'anon'}`);
    return fn(tx);
  });
}

export async function seedUser(username, display, tags, password = 'TestPass123') {
  const u = await db.query(`insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning id`,
    [`${username}@${LOGIN_DOMAIN}`, hash(password), JSON.stringify({ username })]);
  await db.query(`insert into public.profiles (id, username, display_name, tags, must_change_password) values ($1, $2, $3, $4, false)`,
    [u.rows[0].id, username, display, `{${tags.join(',')}}`]);
  return u.rows[0].id;
}

// ── HTTP plumbing ──
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': 'content-range' };
const send = (res, status, body, headers = {}) => {
  const isBuf = Buffer.isBuffer(body);
  const out = body === undefined ? '' : isBuf ? body : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...CORS, ...(isBuf || body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers });
  res.end(out);
};
const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
const q = (id) => '"' + String(id).replace(/"/g, '') + '"';

function pgError(e) {
  const code = e.code || 'XX000';
  const status = code === '42501' ? 403 : code === '23505' ? 409 : code === '28000' ? 401 : 400;
  return [status, { code, message: e.message, details: e.detail || null, hint: e.hint || null }];
}

// ── auth ──
// Sessions behave as they do on Supabase: an access token only counts with the
// Auth server while its session exists. Signing out (everywhere by default) and
// an admin password change both end the member's sessions.
const refreshTokens = new Map();           // refresh token -> { user, sid }
const sessions = new Map();                // session id -> user id
const endSessions = (userId, onlySid) => {
  for (const [sid, uid] of sessions) if (uid === userId && (!onlySid || sid === onlySid)) sessions.delete(sid);
  for (const [tok, v] of refreshTokens) if (v.user === userId && (!onlySid || v.sid === onlySid)) refreshTokens.delete(tok);
};
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.created_at,
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data, created_at: u.created_at, updated_at: u.updated_at });
function session(u, sid = crypto.randomUUID()) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  sessions.set(sid, u.id);
  const access_token = sign({ sub: u.id, role: 'authenticated', email: u.email, aud: 'authenticated', exp, session_id: sid });
  const refresh_token = crypto.randomBytes(16).toString('hex');
  refreshTokens.set(refresh_token, { user: u.id, sid });
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token, user: userJson(u) };
}
async function auth(req, res, url, body) {
  const p = url.pathname.replace('/auth/v1', '');
  const data = body.length ? JSON.parse(body.toString()) : {};
  if (p === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const r = await db.query(`select * from auth.users where email = $1`, [String(data.email || '').toLowerCase()]);
      const u = r.rows[0];
      if (!u || u.encrypted_password !== hash(data.password || '')) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(res, 200, session(u));
    }
    if (grant === 'refresh_token') {
      const held = refreshTokens.get(data.refresh_token);
      const r = held && sessions.has(held.sid) ? await db.query(`select * from auth.users where id = $1`, [held.user]) : { rows: [] };
      if (!r.rows[0]) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refreshTokens.delete(data.refresh_token);
      return send(res, 200, session(r.rows[0], held.sid));
    }
  }
  if (p === '/user' && req.method === 'GET') {
    const c = verify(bearer(req));
    const r = c?.sub ? await db.query(`select * from auth.users where id = $1`, [c.sub]) : { rows: [] };
    if (!r.rows[0]) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    if (c.session_id && !sessions.has(c.session_id)) return send(res, 403, { code: 403, error_code: 'session_not_found', msg: 'Session not found' });
    return send(res, 200, userJson(r.rows[0]));
  }
  if (p === '/logout') {
    const c = verify(bearer(req));
    if (c?.sub) {
      if (c.session_id && !sessions.has(c.session_id)) return send(res, 403, { code: 403, error_code: 'session_not_found', msg: 'Session not found' });
      endSessions(c.sub, url.searchParams.get('scope') === 'local' ? c.session_id : undefined);
    }
    return send(res, 204);
  }
  if (p.startsWith('/admin/users')) {
    if (verify(bearer(req))?.role !== 'service_role') return send(res, 401, { code: 401, error_code: 'not_admin', msg: 'User not allowed' });
    const id = p.split('/')[3];
    try {
      if (req.method === 'POST' && !id) {
        const r = await db.query(`insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning *`,
          [String(data.email).toLowerCase(), hash(data.password), JSON.stringify(data.user_metadata || {})]);
        return send(res, 200, userJson(r.rows[0]));
      }
      if (req.method === 'PUT' && id) {
        if (data.password !== undefined) {
          await db.query(`update auth.users set encrypted_password = $2, updated_at = now() where id = $1`, [id, hash(data.password)]);
          endSessions(id);                                   // Supabase signs the member out everywhere on a password change
        }
        if (data.email !== undefined) await db.query(`update auth.users set email = $2, updated_at = now() where id = $1`, [id, String(data.email).toLowerCase()]);
        if (data.user_metadata !== undefined) await db.query(`update auth.users set raw_user_meta_data = $2 where id = $1`, [id, JSON.stringify(data.user_metadata)]);
        const r = await db.query(`select * from auth.users where id = $1`, [id]);
        if (!r.rows[0]) return send(res, 404, { code: 404, error_code: 'user_not_found', msg: 'User not found' });
        return send(res, 200, userJson(r.rows[0]));
      }
      if (req.method === 'DELETE' && id) {
        endSessions(id);
        await db.query(`delete from auth.users where id = $1`, [id]);
        return send(res, 200, {});
      }
    } catch (e) {
      return send(res, 422, { code: 422, error_code: 'email_exists', msg: e.message });
    }
  }
  send(res, 404, { msg: 'auth route not emulated: ' + req.method + ' ' + p });
}

// ── REST ──
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };
// ?select=a,b  ->  "a", "b"   (anything else, including absent, means every column)
function pick(url, prefix = '') {
  const sel = (url.searchParams.get('select') || '*').replace(/\s/g, '');
  if (sel === '*' || !/^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/i.test(sel)) return prefix + '*';
  return sel.split(',').map((c) => prefix + q(c)).join(', ');
}
function where(url, params) {
  const parts = [];
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const dot = v.indexOf('.'); const op = v.slice(0, dot); const val = v.slice(dot + 1);
    if (OPS[op]) { params.push(val.replace(/\*/g, '%')); parts.push(`${q(k)} ${OPS[op]} $${params.length}`); }
    else if (op === 'is') parts.push(`${q(k)} is ${['null', 'true', 'false'].includes(val) ? val : 'null'}`);
    else if (op === 'in') {
      const list = val.slice(1, -1).split(',').map((s) => s.replace(/^"|"$/g, '')).filter((s) => s.length);
      params.push('{' + list.map((s) => '"' + s.replace(/"/g, '\\"') + '"').join(',') + '}');
      parts.push(`${q(k)} = any($${params.length})`);
    } else if (op === 'cs') { params.push(val); parts.push(`${q(k)} @> $${params.length}`); }
    else throw Object.assign(new Error(`filter ${op} is not emulated`), { code: 'PGRST100' });
  }
  return parts.length ? ' where ' + parts.join(' and ') : '';
}
async function rest(req, res, url, body) {
  const claims = verify(bearer(req)) || verify(req.headers.apikey);
  if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT invalid' });
  const p = url.pathname.replace('/rest/v1/', '');
  const prefer = String(req.headers.prefer || '');
  const wantObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
  const finish = (status, rows) => {
    if (wantObject) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
      return send(res, status, rows[0]);
    }
    send(res, status, rows);
  };
  try {
    if (p.startsWith('rpc/')) {
      const fn = p.slice(4); const args = body.length ? JSON.parse(body.toString()) : {};
      const keys = Object.keys(args);
      const sql = `select to_json(r) as j from public.${q(fn)}(${keys.map((k, i) => `${q(k)} => $${i + 1}`).join(', ')}) as r`;
      // Like PostgREST, hand each argument over in the shape its declared type expects.
      const meta = (await db.query(`select p.proretset as s, (select json_object_agg(a.n, format_type(a.t, null)) from unnest(p.proargnames, p.proargtypes::oid[]) as a(n, t)) as types
        from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace limit 1`, [fn])).rows[0] ?? { s: false, types: {} };
      const setof = meta.s;
      const lit = (v, type = '') => (v === null || v === undefined ? null
        : /^jsonb?$/.test(type) ? JSON.stringify(v)
        : Array.isArray(v) ? '{' + v.map((x) => (x === null ? 'NULL' : '"' + String(x).replace(/["\\]/g, '\\$&') + '"')).join(',') + '}' : v);
      const r = await as(claims, (tx) => tx.query(sql, keys.map((k) => lit(args[k], meta.types?.[k]))));
      return send(res, 200, setof ? r.rows.map((x) => x.j) : r.rows[0]?.j ?? null);
    }
    const table = `public.${q(p)}`; const params = [];
    if (req.method === 'GET') {
      let sql = `select ${pick(url)} from ${table}` + where(url, params);
      const order = url.searchParams.get('order');
      if (order) sql += ' order by ' + order.split(',').map((o) => { const [c, d, n] = o.split('.'); return `${q(c)} ${d === 'desc' ? 'desc' : 'asc'}${n === 'nullslast' ? ' nulls last' : n === 'nullsfirst' ? ' nulls first' : ''}`; }).join(', ');
      if (url.searchParams.get('limit')) sql += ` limit ${Number(url.searchParams.get('limit'))}`;
      if (url.searchParams.get('offset')) sql += ` offset ${Number(url.searchParams.get('offset'))}`;
      const r = await as(claims, (tx) => tx.query(`select coalesce(json_agg(_r), '[]'::json) as j from (${sql}) _r`, params));
      return finish(200, r.rows[0].j);
    }
    const ret = prefer.includes('return=representation');
    if (req.method === 'POST') {
      const data = JSON.parse(body.toString()); const rows = Array.isArray(data) ? data : [data];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      let sql = `insert into ${table} (${cols.map(q).join(', ')}) select ${cols.map(q).join(', ')} from json_populate_recordset(null::${table}, $1::json)`;
      if (prefer.includes('resolution=merge-duplicates')) {
        const key = url.searchParams.get('on_conflict') || (await db.query(
          `select string_agg(a.attname, ',') as k from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = $1::regclass and i.indisprimary`, [`public.${p}`])).rows[0].k;
        const upd = cols.filter((c) => !key.split(',').includes(c));
        sql += ` on conflict (${key.split(',').map(q).join(', ')}) do ` + (upd.length ? `update set ${upd.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}` : 'nothing');
      }
      const r = await as(claims, (tx) => tx.query(`with _r as (${sql} returning ${pick(url)}) select coalesce(json_agg(_r), '[]'::json) as j from _r`, [JSON.stringify(rows)]));
      return ret ? finish(201, r.rows[0].j) : send(res, 201);
    }
    if (req.method === 'PATCH') {
      const data = JSON.parse(body.toString()); const cols = Object.keys(data);
      params.push(JSON.stringify(data));
      const w = where(url, params);
      const sql = `update ${table} set ${cols.map((c) => `${q(c)} = _p.${q(c)}`).join(', ')} from json_populate_record(null::${table}, $1::json) _p` + w.replace(/"(\w+)" /g, `${table}."$1" `);
      const r = await as(claims, (tx) => tx.query(`with _r as (${sql} returning ${pick(url, table + '.')}) select coalesce(json_agg(_r), '[]'::json) as j from _r`, params));
      return ret ? finish(200, r.rows[0].j) : send(res, 204);
    }
    if (req.method === 'DELETE') {
      const w = where(url, params);
      if (!w) return send(res, 400, { code: '21000', message: 'DELETE requires a WHERE clause' });
      const r = await as(claims, (tx) => tx.query(`with _r as (delete from ${table}${w} returning ${pick(url)}) select coalesce(json_agg(_r), '[]'::json) as j from _r`, params));
      return ret ? finish(200, r.rows[0].j) : send(res, 204);
    }
    send(res, 405, { message: 'method not emulated' });
  } catch (e) {
    const [status, payload] = pgError(e);
    send(res, claims.role === 'anon' && status === 403 ? 401 : status, payload);
  }
}

// ── storage ──
const files = new Map();
async function storage(req, res, url, body) {
  const p = decodeURIComponent(url.pathname.replace('/storage/v1/object/', ''));
  if (req.method === 'GET' && p.startsWith('public/')) {
    const f = files.get(p.slice(7));
    return f ? send(res, 200, f.data, { 'Content-Type': f.type, 'Cache-Control': 'no-cache' }) : send(res, 404, { message: 'not found' });
  }
  const claims = verify(bearer(req));
  if (!claims) return send(res, 401, { message: 'unauthorized' });
  const [bucket, ...rest_] = p.split('/'); const name = rest_.join('/');
  try {
    if (req.method === 'POST' || req.method === 'PUT') {
      let data = body; let type = req.headers['content-type'] || 'application/octet-stream';
      const m = /boundary=(.+)$/.exec(type);
      if (m) {   // multipart: take the part that carries the file
        const sep = Buffer.from('--' + m[1]); let at = body.indexOf(sep);
        while (at !== -1) {
          const next = body.indexOf(sep, at + sep.length); if (next === -1) break;
          const headEnd = body.indexOf('\r\n\r\n', at); const head = body.slice(at, headEnd).toString();
          if (/filename=/i.test(head)) { data = body.slice(headEnd + 4, next - 2); type = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1] || 'application/octet-stream'; break; }
          at = next;
        }
      }
      const rule = (await db.query(`select file_size_limit, allowed_mime_types from storage.buckets where id = $1`, [bucket])).rows[0];
      if (!rule) return send(res, 404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
      if (rule.file_size_limit && data.length > Number(rule.file_size_limit)) return send(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      if (rule.allowed_mime_types && !rule.allowed_mime_types.includes(String(type).split(';')[0].trim())) return send(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
      const upsert = req.headers['x-upsert'] === 'true' || req.method === 'PUT';
      await as(claims, (tx) => tx.query(
        `insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid())` + (upsert ? ` on conflict (bucket_id, name) do update set owner = excluded.owner` : ''), [bucket, name]));
      files.set(`${bucket}/${name}`, { data, type });
      return send(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
    }
    if (req.method === 'DELETE') {
      const { prefixes = [] } = JSON.parse(body.toString() || '{}');
      const r = await as(claims, (tx) => tx.query(`delete from storage.objects where bucket_id = $1 and name = any($2) returning name`, [bucket, `{${prefixes.map((s) => `"${s}"`).join(',')}}`]));
      for (const row of r.rows) files.delete(`${bucket}/${row.name}`);
      return send(res, 200, r.rows);
    }
  } catch (e) {
    const denied = e.code === '42501';
    return send(res, denied ? 400 : e.code === '23505' ? 409 : 500, { statusCode: denied ? '403' : '500', error: denied ? 'Unauthorized' : 'Error', message: e.message });
  }
  send(res, 404, { message: 'storage route not emulated' });
}

// ── functions ──
const fnCache = new Map();
export const discordStub = { status: 200, body: { name: 'Black Tusks', presence_count: 0, members: [] } };
async function functions(req, res, url, body) {
  const name = url.pathname.replace('/functions/v1/', '');
  if (!fnCache.has(name)) {
    const out = path.join(ROOT, 'node_modules/.cache/dev-fn', name + '.mjs');
    await build({ entryPoints: [path.join(ROOT, 'supabase/functions', name, 'index.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'error',
      plugins: [{ name: 'npm-specifier', setup(b) { b.onResolve({ filter: /^npm:/ }, (a) => b.resolve(a.path.slice(4).replace(/@[\d^~.]+$/, ''), { resolveDir: ROOT, kind: a.kind })); } }] });
    fnCache.set(name, (await import(pathToFileURL(out).href + '?t=' + Date.now())).handler);
  }
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, String(v));
  const r = await fnCache.get(name)(new Request(`http://localhost:${PORT}${url.pathname}`, { method: req.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body }));
  send(res, r.status, Buffer.from(await r.arrayBuffer()), { 'Content-Type': r.headers.get('content-type') || 'application/json' });
}

// The function reads the real Discord widget; in tests it is answered locally.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const u = String(input?.url ?? input);
  if (u.startsWith('https://discord.com/api/guilds/')) return Promise.resolve(new Response(JSON.stringify(discordStub.body), { status: discordStub.status }));
  return realFetch(input, init);
};
globalThis.Deno = { env: { get: (k) => process.env[k] }, serve() {} };
process.env.SUPABASE_URL = `http://localhost:${PORT}`;
process.env.SUPABASE_ANON_KEY = ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
process.env.VAULT_KEY ||= crypto.randomBytes(32).toString('base64');
process.env.LOGIN_EMAIL_DOMAIN = LOGIN_DOMAIN;

export const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const body = await readBody(req);
  try {
    if (url.pathname.startsWith('/auth/v1/')) return await auth(req, res, url, body);
    if (url.pathname.startsWith('/rest/v1/')) return await rest(req, res, url, body);
    if (url.pathname.startsWith('/storage/v1/object/')) return await storage(req, res, url, body);
    if (url.pathname.startsWith('/functions/v1/')) return await functions(req, res, url, body);
    send(res, 404, { message: 'not emulated: ' + url.pathname });
  } catch (e) {
    console.error('dev server error', req.method, req.url, e);
    send(res, 500, { message: String(e?.message || e) });
  }
});

export const raw = db;
export async function start() {
  await seedUser('nick', 'Nick', ['right_tusk', 'forgemaster']);
  await seedUser('gorza', 'Gorza gra-Largash', ['chieftain']);
  await seedUser('ugak', 'Ugak', ['blooded']);
  await seedUser('sharn', 'Sharn', ['wise_woman']);
  await seedUser('velyn', 'Velyn of the Rift', ['ally']);
  await seedUser('yatul', 'Yatul', ['left_tusk']);
  await new Promise((ok) => server.listen(PORT, ok));
  return { url: `http://localhost:${PORT}`, anonKey: ANON_KEY, serviceKey: SERVICE_KEY };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const info = await start();
  console.log('dev backend on', info.url);
  console.log('VITE_SUPABASE_URL=' + info.url);
  console.log('VITE_SUPABASE_ANON_KEY=' + info.anonKey);
  console.log('accounts: nick, gorza, ugak, sharn, velyn, yatul   password: TestPass123');
}
