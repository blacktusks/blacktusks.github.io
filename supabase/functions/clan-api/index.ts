// Black Tusk Companion: the one server function behind the app.
//
// It does the things the browser must never be trusted with:
//   - account.change_password   a member changes their own password
//   - admin.create / update            officers manage the accounts of their own clan
//   - admin.delete                     a Chieftain removes members of their own clan
//                                      (the Forgemaster manages everyone's but can never be removed, and alone sets clan tags)
//   - admin.set_password / reveal_password   Forgemaster only
//   - discord.presence          reads the Server Widget of each clan's Discord
//
// Secrets it needs (Supabase > Edge Functions > Secrets):
//   VAULT_KEY            base64 of 32 random bytes; encrypts the password copies
//   LOGIN_EMAIL_DOMAIN   optional; must match VITE_LOGIN_EMAIL_DOMAIN in the app
// SUPABASE_URL and the API keys are provided by Supabase.
//
// Deploy with "Verify JWT" turned OFF. Every request is checked below against
// Supabase Auth, which works with both the old and the new style of API keys.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const env = (k: string): string => (globalThis as any).Deno?.env.get(k) ?? "";
// Supabase's current keys arrive as JSON ({"default": "sb_secret_..."}); older
// projects only have the plain legacy variables. Use the new ones when present.
const apiKey = (jsonVar: string, legacyVar: string): string => {
  try {
    const all = JSON.parse(env(jsonVar) || "{}");
    const key = all?.default ?? Object.values(all ?? {})[0];
    if (typeof key === "string" && key) return key;
  } catch { /* fall back to the legacy variable */ }
  return env(legacyVar);
};
const SECRET_KEY = () => apiKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const PUBLIC_KEY = () => apiKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const LOGIN_DOMAIN = () => env("LOGIN_EMAIL_DOMAIN") || "blacktusk.invalid";

const ALL_TAGS = ["chieftain", "right_tusk", "left_tusk", "wise_woman", "blooded", "blood_kin", "kinsmen",
  "unblooded", "ally", "forgemaster", "deceased"];
const CLANS = ["black_tusks", "scorned"];
const CLAN_NAME: Record<string, string> = { black_tusks: "The Black Tusks", scorned: "The Scorned" };
// Where each clan's Discord Server ID is kept in app_settings.
const GUILD_KEY: Record<string, string> = { black_tusks: "discord_guild_id", scorned: "discord_guild_id_scorned" };
const OFFICER = ["chieftain", "right_tusk", "left_tusk", "wise_woman", "forgemaster"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class Fail extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// ── password vault ──
// AES-256-GCM. The key never touches the database. Each copy is bound to its
// owner's id, so a row moved to another member will not decrypt, and padded to
// one length, so the stored size says nothing about the password.
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const PAD = 160;
async function vaultKey(): Promise<CryptoKey> {
  let bytes: Uint8Array;
  try { bytes = unb64(env("VAULT_KEY")); } catch { bytes = new Uint8Array(); }
  if (bytes.length !== 32) throw new Fail(500, "VAULT_KEY is missing or is not 32 bytes of base64. Set it in the function secrets.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(userId: string, text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const plain = new Uint8Array(PAD); plain[0] = data.length; plain.set(data, 1);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId) }, await vaultKey(), plain));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return "v1:" + b64(out);
}
async function unseal(userId: string, cipher: string): Promise<string> {
  if (!cipher.startsWith("v1:")) throw new Fail(500, "This saved password uses a format this function does not know.");
  const raw = unb64(cipher.slice(3));
  const plain = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: new TextEncoder().encode(userId) }, await vaultKey(), raw.slice(12)));
  return new TextDecoder().decode(plain.slice(1, 1 + plain[0]));
}

// ── helpers ──
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";     // no look-alikes
function tempPassword(): string {
  const r = crypto.getRandomValues(new Uint8Array(12));
  const group = (from: number) => [0, 1, 2, 3].map((i) => ALPHABET[r[from + i] % ALPHABET.length]).join("");
  return `tusk-${group(0)}-${group(4)}-${group(8)}`;
}
function checkPassword(p: unknown): string {
  if (typeof p !== "string" || p.length < 8) throw new Fail(400, "Passwords need at least 8 characters.");
  if (new TextEncoder().encode(p).length > 72) throw new Fail(400, "Passwords can be at most 72 characters.");
  return p;
}
// Sign-in names keep the capitals they are given ("Grug"). Signing in and
// uniqueness ignore case, so "grug" and "GRUG" are the same member.
function checkUsername(u: unknown): string {
  const s = String(u ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,23}$/.test(s)) {
    throw new Fail(400, "Sign-in names are 3 to 24 characters: letters, numbers, dot, dash or underscore.");
  }
  return s;
}
const emailFor = (username: string) => `${username.toLowerCase()}@${LOGIN_DOMAIN()}`;
/** The profile holding this sign-in name in any capitalisation, if there is one. */
async function holderOf(db: SupabaseClient, username: string): Promise<string | null> {
  const pattern = username.replace(/([\\_%])/g, "\\$1");          // _ and % are wildcards to "ilike"
  const { data, error } = await db.from("profiles").select("id").ilike("username", pattern).limit(1);
  if (error) throw new Fail(500, "Could not check that sign-in name.");
  return data?.[0]?.id ?? null;
}
function checkDisplayName(d: unknown): string {
  const s = String(d ?? "").trim();
  if (!s || s.length > 40 || !/[\p{L}\p{N}]/u.test(s) || /[\p{Cc}\u200B-\u200F\u2028-\u202F\u2060\uFEFF]/u.test(s)) {
    throw new Fail(400, "Display names are 1 to 40 visible characters and need at least one letter or number.");
  }
  return s;
}
function checkDiscord(d: unknown): string | null {
  const s = String(d ?? "").trim();
  if (!s) return null;
  if (s.length > 64 || /\p{Cc}/u.test(s)) throw new Fail(400, "Discord names can be at most 64 characters.");
  return s;
}
const SKILLS = ["one_handed", "two_handed", "dual_wielder", "bow", "armor", "shield", "cook", "alchemist", "blacksmith", "woodcutter",
  "tailor", "scholar", "miner", "first_aid", "lockpicking", "skinner", "harvester", "artifact_scavenger"];
// Up to three masteries, each a known skill at level 0 to 5, no skill twice. The database checks the same.
function checkMasteries(m: unknown): { skill: string; level: number }[] {
  if (!Array.isArray(m) || m.length > 3) throw new Fail(400, "Choose up to three masteries.");
  const seen = new Set<string>();
  return m.map((one) => {
    const skill = String((one as any)?.skill ?? ""), level = Number((one as any)?.level);
    if (!SKILLS.includes(skill) || !Number.isInteger(level) || level < 0 || level > 5 || seen.has(skill)) throw new Fail(400, "That list of masteries is not valid.");
    seen.add(skill);
    return { skill, level };
  });
}
function checkTags(t: unknown): string[] {
  if (!Array.isArray(t) || t.some((x) => typeof x !== "string")) throw new Fail(400, "Tags must be a list.");
  const tags = [...new Set(t as string[])];
  const bad = tags.filter((x) => !ALL_TAGS.includes(x));
  if (bad.length) throw new Fail(400, `Unknown tag: ${bad.join(", ").slice(0, 80)}`);
  return tags;
}
function checkClans(c: unknown): string[] {
  if (!Array.isArray(c) || c.some((x) => typeof x !== "string")) throw new Fail(400, "Clans must be a list.");
  const clans = [...new Set(c as string[])];
  if (clans.some((x) => !CLANS.includes(x))) throw new Fail(400, "Unknown clan.");
  if (!clans.length) throw new Fail(400, "Every member belongs to at least one clan.");
  return CLANS.filter((x) => clans.includes(x));
}
function checkId(id: unknown): string {
  const s = String(id ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new Fail(400, "That is not a member.");
  return s.toLowerCase();
}
const has = (tags: string[], ...want: string[]) => want.some((w) => tags.includes(w));

/** Turn a database refusal into something a person can act on. */
function explain(error: { code?: string; message: string }): Fail {
  if (error.code === "23505") {
    if (/display_name/.test(error.message)) return new Fail(409, "Another member already has that display name.");
    if (/discord_name/.test(error.message)) return new Fail(409, "That Discord name is already on another member's profile.");
    if (/username/.test(error.message)) return new Fail(409, "That sign-in name is already in use.");
  }
  if (error.code === "23514") return new Fail(400, "One of those values is not allowed. Check the names for odd characters.");
  return new Fail(400, error.message);
}
/** Every write is checked. A failed audit entry stops the action. */
async function audit(db: SupabaseClient, actor: string, action: string, target: string | null, detail: Record<string, unknown> = {}) {
  const { error } = await db.from("audit_log").insert({ actor, action, target, detail });
  if (error) throw new Fail(500, "Could not write the audit log, so nothing was done.");
}

type Me = { id: string; username: string; tags: string[]; clans?: string[] };
/** An officer manages the members of their own clan (and any member not yet in one). The Forgemaster manages everyone. */
const sharesClan = (me: Me, target: { clans?: string[] }) =>
  has(me.tags, "forgemaster") || !(target.clans ?? []).length || (target.clans ?? []).some((c) => (me.clans ?? []).includes(c));
// Who may hand out which tags, and whose accounts they may touch.
function guardAccount(me: Me, target: { id: string; tags: string[]; clans?: string[] } | null, after: string[]) {
  const before = target?.tags ?? [];
  const changed = (tag: string) => before.includes(tag) !== after.includes(tag);
  const self = target?.id === me.id;
  if (target && !self && !sharesClan(me, target)) {
    throw new Fail(403, "Officers manage the members of their own clan.");
  }
  // There is one Forgemaster, and the tag is never handed out or taken away. The database refuses it too.
  if (changed("forgemaster")) {
    throw new Fail(403, "There is only one Forgemaster. That tag cannot be given or taken.");
  }
  if (changed("chieftain") && !has(me.tags, "chieftain", "forgemaster")) {
    throw new Fail(403, "Only the Chieftain or a Forgemaster can give or take the Chieftain tag.");
  }
  if (before.includes("forgemaster") && !has(me.tags, "forgemaster") && !self) {
    throw new Fail(403, "Only a Forgemaster can change a Forgemaster's account.");
  }
  if (before.includes("chieftain") && !has(me.tags, "chieftain", "forgemaster") && !self) {
    throw new Fail(403, "Only the Chieftain or a Forgemaster can change the Chieftain's account.");
  }
}

/**
 * Change a password and its saved copy together. The new cipher is staged
 * first; a database trigger moves it into place in the same transaction that
 * changes the real password. If the change fails, nothing is left half done.
 */
async function setPassword(db: SupabaseClient, userId: string, password: string, mustChange: boolean) {
  const cipher = await seal(userId, password);
  const staged = await db.from("password_vault").upsert(
    { user_id: userId, next_cipher: cipher, next_must_change: mustChange, next_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (staged.error) throw new Fail(500, "Could not save the password copy, so the password was not changed.");
  const { error } = await db.auth.admin.updateUserById(userId, { password });
  if (error) {
    await db.from("password_vault").update({ next_cipher: null, next_must_change: null, next_at: null }).eq("user_id", userId);
    throw new Fail(400, error.message);
  }
}

const presenceCache = new Map<string, { at: number; body: any }>();

/** One clan Discord's Server Widget: who is online, and what they are playing. Kept for 45 seconds. */
async function widget(guild: string): Promise<any> {
  const hit = presenceCache.get(guild);
  if (hit && Date.now() - hit.at < 45_000) return hit.body;
  let out: any;
  try {
    const res = await fetch(`https://discord.com/api/guilds/${guild}/widget.json`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) {
      out = { ok: false, members: [],
        reason: res.status === 403 ? "The Server Widget is switched off in the Discord server settings." : `Discord answered ${res.status}. Check the Server ID.` };
    } else {
      const w = await res.json();
      const members = (Array.isArray(w.members) ? w.members : []).slice(0, 200)
        // What someone is playing arrives as "activity" today and arrived as "game" in older
        // answers. Discord's documentation promises neither, only the name and status.
        .map((m: any) => {
          const playing = m.activity?.name ?? m.game?.name;
          return { name: String(m.username ?? "").slice(0, 64), status: String(m.status ?? ""), game: playing ? String(playing).slice(0, 80) : null };
        });
      out = { ok: true, server: String(w.name ?? "").slice(0, 100), online: Number(w.presence_count) || members.length, members };
    }
  } catch {
    out = { ok: false, members: [], reason: "Discord did not answer. Try again in a minute." };
  }
  presenceCache.set(guild, { at: Date.now(), body: out });
  return out;
}

// ── request handling ──
async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") throw new Fail(405, "POST only.");

  const url = env("SUPABASE_URL");
  const db = createClient(url, SECRET_KEY(), { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await db.auth.getUser(token);
  if (whoErr || !who?.user) throw new Fail(401, "Sign in again.");
  const { data: meRow } = await db.from("profiles").select("*").eq("id", who.user.id).maybeSingle();
  if (!meRow) throw new Fail(403, "This account has no member profile.");
  const me = meRow as Me;

  let body: any;
  try { body = await req.json(); } catch { throw new Fail(400, "Send JSON."); }
  if (!body || typeof body !== "object") throw new Fail(400, "Send JSON.");
  const action = String(body.action ?? "");
  const target = async (id: unknown) => {
    const { data } = await db.from("profiles").select("*").eq("id", checkId(id)).maybeSingle();
    if (!data) throw new Fail(404, "That member no longer exists.");
    return data as Me & { display_name: string; discord_name: string | null };
  };

  switch (action) {
    case "account.change_password": {
      const next = checkPassword(body.new_password);
      const current = String(body.current_password ?? "");
      if (next === current) throw new Fail(400, "The new password is the same as the current one.");
      const anon = createClient(url, PUBLIC_KEY(), { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: bad } = await anon.auth.signInWithPassword({ email: who.user.email!, password: current });
      if (bad) throw new Fail(400, "The current password is not right.");
      // "local" ends only this throwaway session. The default would sign the
      // member out on every device.
      await anon.auth.signOut({ scope: "local" }).catch(() => undefined);
      await setPassword(db, me.id, next, false);
      await audit(db, me.id, "password.changed_own", me.id).catch(() => undefined);
      return json({ ok: true });
    }

    case "admin.create": {
      if (!has(me.tags, ...OFFICER)) throw new Fail(403, "Only clan officers can add members.");
      const username = checkUsername(body.username);
      const display_name = checkDisplayName(body.display_name || username);
      const discord_name = checkDiscord(body.discord_name);
      const tags = checkTags(body.tags ?? []);
      guardAccount(me, null, tags);
      // A new member joins the clan of the officer who adds them. An officer in both clans picks one of
      // theirs; the Forgemaster picks any.
      const smith = has(me.tags, "forgemaster");
      const mine = (me.clans ?? []).length ? me.clans! : ["black_tusks"];
      const clans = body.clans !== undefined ? checkClans(body.clans) : smith ? ["black_tusks"] : [mine[0]];
      if (!smith && clans.some((c) => !mine.includes(c))) throw new Fail(403, "Officers add members to their own clan.");
      // Only a Forgemaster may choose the password or reuse a removed member's sign-in name.
      const password = body.password && has(me.tags, "forgemaster") ? checkPassword(body.password) : tempPassword();
      if (await holderOf(db, username)) throw new Fail(409, `The sign-in name "${username}" is already in use.`);
      const { data: retired } = await db.from("retired_names").select("username").eq("username", username.toLowerCase()).maybeSingle();
      if (retired && !has(me.tags, "forgemaster")) {
        throw new Fail(403, `"${username}" belonged to a removed member. Pick another sign-in name, or ask a Forgemaster to reuse it.`);
      }
      await vaultKey();                                    // fail before creating anything if the key is missing
      const { data: made, error } = await db.auth.admin.createUser({
        email: emailFor(username), password, email_confirm: true, user_metadata: { username },
      });
      if (error || !made?.user) throw new Fail(400, error?.message ?? "Could not create the account.");
      const done = await db.rpc("admin_finish_create", {
        p_id: made.user.id, p_username: username, p_display_name: display_name, p_tags: tags, p_discord_name: discord_name,
        p_cipher: await seal(made.user.id, password), p_actor: me.id, p_clans: clans,
      });
      if (done.error) {
        const undo = await db.auth.admin.deleteUser(made.user.id);
        if (undo.error) console.error("orphaned sign-in left behind:", made.user.id, undo.error.message);
        throw explain(done.error);
      }
      return json({ profile: done.data, password });
    }

    case "admin.update": {
      if (!has(me.tags, ...OFFICER)) throw new Fail(403, "Only clan officers can edit members.");
      const t = await target(body.id);
      const tags = body.tags !== undefined ? checkTags(body.tags) : t.tags;
      guardAccount(me, t, tags);
      const patch: Record<string, unknown> = {};
      if (body.display_name !== undefined) patch.display_name = checkDisplayName(body.display_name);
      if (body.discord_name !== undefined) patch.discord_name = checkDiscord(body.discord_name);
      if (body.tags !== undefined) patch.tags = tags;
      if (body.masteries !== undefined) patch.masteries = checkMasteries(body.masteries);
      if (body.clans !== undefined) {
        const clans = checkClans(body.clans);
        const before = CLANS.filter((c) => (t.clans ?? []).includes(c));
        if (clans.join() !== before.join()) {
          if (!has(me.tags, "forgemaster")) throw new Fail(403, "Only the Forgemaster can change clan tags.");
          patch.clans = clans;
        }
      }
      const rename = body.username !== undefined && checkUsername(body.username) !== t.username ? checkUsername(body.username) : null;
      if (rename) {
        if (!has(me.tags, "forgemaster")) throw new Fail(403, "Only a Forgemaster can change a sign-in name.");
        const holder = await holderOf(db, rename);
        if (holder && holder !== t.id) throw new Fail(409, `The sign-in name "${rename}" is already in use.`);
        patch.username = rename;
      }
      if (!Object.keys(patch).length) return json({ profile: t });
      // The profile goes first: the database refuses a sign-in rename that does not match it.
      const { data: profile, error } = await db.from("profiles").update(patch).eq("id", t.id).select().single();
      if (error) throw explain(error);
      if (rename) {
        const moved = await db.auth.admin.updateUserById(t.id, { email: emailFor(rename), email_confirm: true, user_metadata: { username: rename } });
        if (moved.error) {
          await db.from("profiles").update({ username: t.username }).eq("id", t.id);
          throw new Fail(400, `The sign-in name could not be changed: ${moved.error.message}`);
        }
      }
      await audit(db, me.id, "member.updated", t.id, patch).catch(() => undefined);
      return json({ profile });
    }

    case "admin.delete": {
      // Only a Chieftain removes members, and only from their own clan. The Forgemaster can remove anyone but
      // themselves; nobody can remove the Forgemaster.
      if (!has(me.tags, "chieftain", "forgemaster")) throw new Fail(403, "Only a Chieftain can remove members.");
      const t = await target(body.id);
      if (t.id === me.id) throw new Fail(400, "You cannot remove your own account.");
      if (has(t.tags, "forgemaster")) throw new Fail(403, "The Forgemaster cannot be removed.");
      if (!sharesClan(me, t)) throw new Fail(403, "A Chieftain removes members of their own clan only.");
      await audit(db, me.id, "member.removed", t.id, { username: t.username, display_name: t.display_name });
      const kept = await db.from("retired_names").upsert({ username: t.username.toLowerCase(), removed_by: me.id, removed_at: new Date().toISOString() });
      if (kept.error) throw new Fail(500, "Could not record the removal, so nothing was removed.");
      const { error } = await db.auth.admin.deleteUser(t.id);
      if (error) throw new Fail(400, error.message);
      return json({ ok: true });
    }

    case "admin.set_password": {
      if (!has(me.tags, "forgemaster")) throw new Fail(403, "Only a Forgemaster can set another member's password.");
      const t = await target(body.id);
      const password = body.password ? checkPassword(body.password) : tempPassword();
      await audit(db, me.id, "password.set", t.id);
      await setPassword(db, t.id, password, true);
      return json({ password });
    }

    case "admin.reveal_password": {
      if (!has(me.tags, "forgemaster")) throw new Fail(403, "Only a Forgemaster can view passwords.");
      const t = await target(body.id);
      await audit(db, me.id, "password.revealed", t.id);     // no log entry, no password
      const { data: row, error } = await db.from("password_vault").select("cipher, updated_at").eq("user_id", t.id).maybeSingle();
      if (error) throw new Fail(500, "Could not read the saved copy.");
      if (!row?.cipher) return json({ password: null });
      let password: string;
      try { password = await unseal(t.id, row.cipher); }
      catch (e) { if (e instanceof Fail) throw e; throw new Fail(409, "The saved copy could not be opened. Set a new password for this member."); }
      return json({ password, updated_at: row.updated_at });
    }

    case "discord.presence": {
      // Each clan can link its own Discord. Who is online is the two lists together; someone in both
      // counts once, playing Skyrim if either says so.
      const { data: settings } = await db.from("app_settings").select("key, value").in("key", Object.values(GUILD_KEY));
      const servers: any[] = [];
      for (const clan of CLANS) {
        const raw = settings?.find((r: any) => r.key === GUILD_KEY[clan])?.value;
        const guild = String(raw ?? "").replace(/\D/g, "").slice(0, 22);
        if (!guild) { servers.push({ clan, name: CLAN_NAME[clan], configured: false }); continue; }
        servers.push({ clan, name: CLAN_NAME[clan], configured: true, ...(await widget(guild)) });
      }
      const live = servers.filter((x) => x.configured);
      const brief = servers.map(({ members, ...rest }) => rest);
      if (!live.length) return json({ configured: false, members: [], servers: brief });
      const seen = new Map<string, any>();
      for (const x of live) for (const m of x.members ?? []) {
        const key = m.name.trim().toLowerCase(); const was = seen.get(key);
        if (!was || (!was.game && m.game)) seen.set(key, m);
      }
      const ok = live.some((x) => x.ok);
      return json({
        configured: true, ok, members: [...seen.values()],
        server: live.filter((x) => x.ok).map((x) => x.server).join(" and "),
        online: live.reduce((n, x) => n + (Number(x.online) || 0), 0),
        ...(ok ? {} : { reason: live.map((x) => x.reason).find(Boolean) }),
        servers: brief,
      });
    }

    default:
      throw new Fail(400, "Unknown action.");
  }
}

export async function handler(req: Request): Promise<Response> {
  try {
    return await handle(req);
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Something went wrong on the server." }, 500);
  }
}

(globalThis as any).Deno?.serve(handler);
