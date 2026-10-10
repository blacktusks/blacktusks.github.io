// Permission tests: every role does (and is refused) what the brief says,
// against real Postgres row-level security and the real server function.
import { createClient } from '@supabase/supabase-js';
import { start, discordStub } from '../dev/server.mjs';

const { url, anonKey } = await start();
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : (fail++, console.log('  FAIL', name, extra)); };
const client = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function login(username, password = 'TestPass123') {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email: `${username}@blacktusk.invalid`, password });
  if (error) throw new Error(`login ${username}: ${error.message}`);
  c.me = (await c.auth.getUser()).data.user.id;
  c.api = async (action, body = {}) => {
    const { data, error } = await c.functions.invoke('clan-api', { body: { action, ...body } });
    if (error) { let msg = error.message; try { msg = (await error.context.json()).error; } catch {} return { error: msg }; }
    return { data };
  };
  return c;
}
const guest = client();
const nick = await login('nick'), gorza = await login('gorza'), ugak = await login('ugak'),
  sharn = await login('sharn'), velyn = await login('velyn'), sheo = await login('sheo');

console.log('guests');
for (const t of ['profiles', 'announcements', 'mine_deals', 'expansion_stages', 'ore_markers', 'ledger_entries', 'changelog', 'app_settings', 'password_vault', 'audit_log']) {
  const { data, error } = await guest.from(t).select('*');
  ok(error || data.length === 0, `guest reads nothing from ${t}`, JSON.stringify(data)?.slice(0, 80));
}
ok((await guest.from('announcements').insert({ title: 'x' })).error, 'guest cannot post');

console.log('members list');
ok((await ugak.from('profiles').select('id, display_name, tags')).data.length === 6, 'a member sees all six members');
{ const r = await ugak.from('profiles').update({ tags: ['chieftain'] }).eq('id', ugak.me); ok(r.error, 'a member cannot edit their own tags directly'); }
ok((await ugak.from('profiles').select('tags').eq('id', ugak.me).single()).data.tags.join() === 'blooded', 'their tags are unchanged');
{
  const { data, error } = await ugak.rpc('update_my_profile', { p_display_name: 'Ugak the Bold', p_discord_name: 'ugak#1' });
  ok(!error && data.display_name === 'Ugak the Bold' && data.discord_name === 'ugak#1', 'a member renames themselves', error?.message);
  ok((await ugak.rpc('update_my_profile', { p_display_name: '   ' })).error, 'blank display name refused');
}

console.log('notice board');
const post = async (c, row) => (await c.from('announcements').insert(row).select().single());
ok((await post(ugak, { title: 'no' })).error, 'Blooded cannot post');
ok((await post(velyn, { title: 'no' })).error, 'Ally cannot post');
const a1 = (await post(sheo, { title: 'From the Daedra' })).data;
ok(a1?.id, 'Daedric can post');
const a2 = (await post(sharn, { title: 'For Ugak only', visibility: 'specific', audience: [ugak.me] })).data;
const a3 = (await post(gorza, { title: 'Chief draft', visibility: 'draft' })).data;
const a4 = (await post(nick, { title: 'Gone already', expires_at: new Date(Date.now() - 60000).toISOString() })).data;
const a5 = (await post(nick, { title: 'Up for an hour', expires_at: new Date(Date.now() + 3600000).toISOString() })).data;
ok(a2?.id && a3?.id && a4?.id && a5?.id, 'officers can post with audience, draft and timers');
const titles = async (c) => (await c.from('announcements').select('*')).data.map((r) => r.title).sort().join('|');
ok(await titles(ugak) === 'For Ugak only|From the Daedra|Up for an hour', 'Ugak sees public, targeted, unexpired', await titles(ugak));
ok(await titles(velyn) === 'From the Daedra|Up for an hour', 'Velyn does not see the targeted notice', await titles(velyn));
ok(await titles(gorza) === 'Chief draft|For Ugak only|From the Daedra|Gone already|Up for an hour', 'Chieftain sees own draft and expired ones', await titles(gorza));
ok(await titles(nick) === 'For Ugak only|From the Daedra|Gone already|Up for an hour', 'another officer does not see the chief draft', await titles(nick));
ok((await ugak.from('announcements').delete().eq('id', a1.id).select()).data.length === 0, 'a member cannot remove a notice');
ok((await gorza.from('announcements').delete().eq('id', a4.id).select()).data.length === 1, 'an officer removes an older notice');
ok((await sheo.from('announcements').update({ title: 'Edited' }).eq('id', a5.id).select()).data.length === 1, 'Daedric can edit a notice');
ok((await nick.from('announcements').delete().eq('id', a3.id).select()).data.length === 0, "an officer cannot remove another's private draft");

console.log('changelog');
ok((await gorza.from('changelog').insert({ title: 'nope' })).error, 'Chieftain cannot edit the change log');
ok(!(await nick.from('changelog').insert({ title: '0.1.1 fix', version: '0.1.1' })).error, 'Forgemaster can');
ok((await ugak.from('changelog').select('*')).data.length === 2, 'members read the change log');

console.log('mine deals');
ok((await sheo.from('mine_deals').insert({ author_id: sheo.me, title: 'no' })).error, 'Daedric cannot add mine deals');
const d1 = (await gorza.from('mine_deals').insert({ author_id: gorza.me, title: 'Iron for Riften', body: '40 ingots a week', visibility: 'specific', audience: [velyn.me] }).select().single()).data;
const d2 = (await nick.from('mine_deals').insert({ author_id: nick.me, title: 'Open terms' }).select().single()).data;
ok(d1?.id && d2?.id, 'officers add deals');
ok((await velyn.from('mine_deals').select('*')).data.length === 2, 'the named ally sees their deal');
ok((await ugak.from('mine_deals').select('*')).data.length === 1, 'others only see the open deal');
ok((await ugak.from('mine_deals').update({ title: 'x' }).eq('id', d2.id).select()).data.length === 0, 'members cannot edit deals');

console.log('expansion goals');
const res = (await ugak.from('expansion_resources').select('*')).data;
ok(res.length === 30 && res.every((r) => r.have === 0), 'all resources start at 0');
const sum = (n) => res.filter((r) => r.name === n && r.in_total).reduce((s, r) => s + r.goal, 0);
ok(sum('Gold') === 64500 && sum('Iron Ingots') === 2380 && sum('Steel Ingots') === 450 && sum('Corundum') === 700 && sum('Firewood') === 5150
  && sum('Leather Strips') === 420 && sum('Pelts (Any)') === 275 && sum('Silver Ingots') === 8, 'stage goals add up to the totals in the brief');
ok((await ugak.from('expansion_resources').update({ have: 5 }).eq('id', res[0].id).select()).data.length === 0, 'members cannot change progress');
ok((await sharn.from('expansion_resources').update({ have: 1200 }).eq('id', res[0].id).select()).data[0]?.have === 1200, 'Wise Woman updates progress');
ok((await sheo.from('expansion_stages').update({ title: 'x' }).eq('id', res[0].stage_id).select()).data.length === 0, 'Daedric cannot edit goals');

console.log('mining map');
const ping = async (c, row) => (await c.from('ore_markers').insert({ ore: 'iron', x: 1000, y: 2000, ...row }).select().single());
const m1 = (await ping(ugak, { status: 'approved' })).data;
ok(m1?.status === 'pending' && m1.created_by === ugak.me, "a member's ping is pending even if they ask for approved");
const m2 = (await ping(nick, { ore: 'ebony' })).data;
ok(m2?.status === 'approved' && m2.reviewed_by === nick.me, "a higher-up's marker skips approval");
ok((await velyn.from('ore_markers').select('*')).data.length === 1, 'others see only approved markers');
ok((await ugak.from('ore_markers').select('*')).data.length === 2, 'the pinger also sees their pending ping');
ok((await sheo.from('ore_markers').select('*')).data.length === 2, 'approvers see pending pings');
ok((await ugak.from('ore_markers').update({ status: 'approved' }).eq('id', m1.id).select()).data[0]?.status === 'pending', 'a member cannot approve their own ping');
ok((await velyn.from('ore_markers').update({ note: 'x' }).eq('id', m1.id).select()).data.length === 0, "a member cannot edit someone else's ping");
const ap = (await sheo.from('ore_markers').update({ status: 'approved' }).eq('id', m1.id).select()).data[0];
ok(ap?.status === 'approved' && ap.reviewed_by === sheo.me && ap.created_by === ugak.me, 'Daedric approves; reviewer recorded, author kept');
ok((await velyn.from('ore_markers').select('*')).data.length === 2, 'approved ping is now on everyone\'s map');
const m3 = (await ping(velyn, { ore: 'silver' })).data;
ok((await gorza.from('ore_markers').update({ status: 'rejected', review_note: 'Nothing there' }).eq('id', m3.id).select()).data[0]?.status === 'rejected', 'Chieftain denies a false ping');
ok((await ugak.from('ore_markers').select('*')).data.length === 2, 'denied ping stays off the map');
ok((await ugak.from('ore_markers').delete().eq('id', m2.id).select()).data.length === 0, 'a member cannot delete an approved marker');

console.log('pricing ledger');
ok((await ugak.from('ledger_entries').upsert({ item_key: 'skyrim.esm:05ACE4', price: 9 })).error, 'members cannot price items');
ok(!(await sheo.from('ledger_entries').upsert({ item_key: 'skyrim.esm:05ACE4', price: 12, tier: 1 })).error, 'Daedric can price items');
ok(!(await gorza.from('ledger_entries').upsert({ item_key: 'skyrim.esm:05ACE4', price: 14 })).error, 'Chieftain updates the same entry');
const le = (await ugak.from('ledger_entries').select('*')).data[0];
ok(le.price === 14 && le.tier === 1 && le.updated_by === gorza.me, 'members read the entry; editor recorded');
ok((await sheo.from('ledger_entries').upsert({ item_key: 'x', tier: 9 })).error, 'tier outside 1 to 5 refused');
{
  const blob = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' });
  ok((await ugak.storage.from('item-images').upload('iron.png', blob)).error, 'members cannot upload item images');
  ok(!(await sheo.storage.from('item-images').upload('iron.png', blob, { upsert: true })).error, 'Daedric uploads an item image');
  const pub = sheo.storage.from('item-images').getPublicUrl('iron.png').data.publicUrl;
  ok((await fetch(pub)).status === 200, 'the image is publicly readable');
}

console.log('accounts');
ok((await ugak.api('admin.create', { username: 'intruder', tags: [] })).error, 'a member cannot add accounts');
ok((await sheo.api('admin.create', { username: 'intruder', tags: [] })).error, 'Daedric cannot add accounts');
const made = await sharn.api('admin.create', { username: 'Morgash', display_name: 'Morgash the Young', tags: ['unblooded'] });
ok(made.data?.profile?.username === 'morgash' && made.data.password?.length >= 12, 'Wise Woman adds a member and receives a temporary password', made.error);
const morgash = await login('morgash', made.data.password);
ok((await morgash.rpc('my_profile')).data.must_change_password === true, 'new member is asked to change password');
ok((await sharn.api('admin.create', { username: 'morgash', tags: [] })).error?.includes('already in use'), 'duplicate sign-in name refused');
ok((await sharn.api('admin.create', { username: 'smith2', tags: ['forgemaster'] })).error, 'only a Forgemaster grants Forgemaster');
ok((await sharn.api('admin.update', { id: morgash.me, tags: ['chieftain'] })).error, 'only Chieftain/Forgemaster grants Chieftain');
ok((await sharn.api('admin.update', { id: morgash.me, tags: ['blooded', 'deceased'], display_name: 'Morgash' })).data?.profile?.tags.includes('deceased'), 'officer edits tags and name; Deceased tag works');
ok((await login('morgash', made.data.password)).me === morgash.me, 'a Deceased member can still sign in');
ok((await sharn.api('admin.update', { id: nick.me, display_name: 'Hacked' })).error, "an officer cannot edit a Forgemaster's account");
ok((await sharn.api('admin.reveal_password', { id: morgash.me })).error, 'officers cannot view passwords');
ok((await gorza.api('admin.set_password', { id: morgash.me })).error, 'Chieftain cannot set passwords');
ok((await nick.api('admin.reveal_password', { id: morgash.me })).data?.password === made.data.password, 'Forgemaster views the current password');
ok((await morgash.api('account.change_password', { current_password: 'wrong', new_password: 'MyOwnSecret9' })).error, 'wrong current password refused');
ok((await morgash.api('account.change_password', { current_password: made.data.password, new_password: 'short' })).error, 'short password refused');
ok((await morgash.api('account.change_password', { current_password: made.data.password, new_password: 'MyOwnSecret9' })).data?.ok, 'member changes their own password');
ok((await login('morgash', 'MyOwnSecret9')).me === morgash.me, 'new password signs in');
ok(await login('morgash', made.data.password).then(() => false, () => true), 'old password no longer works');
ok((await nick.api('admin.reveal_password', { id: morgash.me })).data?.password === 'MyOwnSecret9', 'Forgemaster sees the changed password');
ok((await nick.rpc('member_admin_list')).data.find((m) => m.id === morgash.me).must_change_password === false, 'change-password flag cleared');
const reset = await nick.api('admin.set_password', { id: morgash.me, password: 'ForgeReset2026' });
ok(reset.data?.password === 'ForgeReset2026' && (await login('morgash', 'ForgeReset2026')).me, 'Forgemaster resets a forgotten password');
ok((await ugak.from('password_vault').select('*')).data?.length === 0 || (await ugak.from('password_vault').select('*')).error, 'the vault is unreadable from the app');
ok((await nick.from('password_vault').select('*')).data?.length === 0 || (await nick.from('password_vault').select('*')).error, 'even the Forgemaster cannot read the vault table directly');
{
  const raw = (await (await import('../dev/server.mjs')).raw.query('select cipher from password_vault limit 1')).rows[0].cipher;
  ok(!raw.includes('ForgeReset') && raw.length > 30, 'vault rows are encrypted at rest');
}
ok((await nick.from('audit_log').select('*')).data.some((r) => r.action === 'password.revealed'), 'password views are logged');
ok(((await gorza.from('audit_log').select('*')).data ?? []).length === 0, 'only the Forgemaster reads the log');
ok((await sharn.api('admin.delete', { id: sharn.me })).error, 'cannot remove your own account');
ok((await sharn.api('admin.delete', { id: gorza.me })).error, 'an officer cannot remove the Chieftain');
ok((await gorza.api('admin.delete', { id: morgash.me })).data?.ok, 'Chieftain removes a member');
ok((await ugak.from('profiles').select('id')).data.length === 6, 'removed member is gone from the list');
ok(await login('morgash', 'ForgeReset2026').then(() => false, () => true), 'removed member cannot sign in');

console.log('hardening');
{ // nobody can rewrite who posted or who reviewed
  const n = (await sheo.from('announcements').insert({ title: 'Gold to the Daedra' }).select().single()).data;
  const forged = (await sheo.from('announcements').update({ author_id: gorza.me, title: 'Gold to the Daedra!' }).eq('id', n.id).select().single()).data;
  ok(forged.author_id === sheo.me && forged.updated_by === sheo.me, 'the author of a notice cannot be changed, and edits are stamped');
  const chief = (await gorza.from('announcements').insert({ title: 'Chief speaks' }).select().single()).data;
  const edited = (await sheo.from('announcements').update({ body: 'altered' }).eq('id', chief.id).select().single()).data;
  ok(edited.author_id === gorza.me && edited.updated_by === sheo.me, "editing another's notice leaves a trace");
  const deal = (await sharn.from('mine_deals').insert({ title: 'Deal' }).select().single()).data;
  ok((await sharn.from('mine_deals').update({ author_id: gorza.me }).eq('id', deal.id).select().single()).data.author_id === sharn.me, 'the author of a deal cannot be changed');
  const mk = (await nick.from('ore_markers').select('*').eq('status', 'approved').limit(1)).data[0];
  const forgedReview = (await sheo.from('ore_markers').update({ reviewed_by: gorza.me, review_note: 'Chief checked it' }).eq('id', mk.id).select().single()).data;
  ok(forgedReview.reviewed_by === mk.reviewed_by && forgedReview.review_note === mk.review_note, 'the reviewer of a marker cannot be forged');
}
{ // map pings: bad coordinates, floods and bait-and-switch
  ok((await ugak.from('ore_markers').insert({ ore: 'iron', x: 'NaN', y: 'NaN' })).error, 'NaN coordinates are refused');
  ok((await ugak.from('ore_markers').insert({ ore: 'iron', x: 9e9, y: 0 })).error, 'coordinates off the map are refused');
  ok((await ugak.from('ore_markers').insert({ ore: '<b>x</b>', x: 0, y: 0 })).error, 'odd ore names are refused');
  const many = Array.from({ length: 40 }, (_, i) => ({ ore: 'iron', x: i, y: i }));
  ok((await ugak.from('ore_markers').insert(many)).error, 'a member cannot flood the approval queue');
  const p = (await ugak.from('ore_markers').insert({ ore: 'iron', x: 500, y: 500, note: 'Real vein' }).select().single()).data;
  await ugak.from('ore_markers').update({ ore: 'ebony', note: 'Trap' }).eq('id', p.id);
  ok((await sheo.from('ore_markers').update({ status: 'approved' }).eq('id', p.id).eq('updated_at', p.updated_at).select()).data.length === 0, 'approving a ping that changed since it was viewed does nothing');
}
{ // members see names and tags, not sign-in names
  ok((await ugak.from('profiles').select('*')).error, 'members cannot read whole profile rows');
  const pub = (await ugak.from('profiles').select('id, display_name, tags, discord_name, created_at')).data;
  ok(pub.length === 6 && !('username' in pub[0]), 'the public columns are readable');
  ok((await ugak.from('profiles').select('username')).error, 'sign-in names are not readable by members');
  ok((await ugak.rpc('my_profile')).data.username === 'ugak', 'a member reads their own full profile');
  ok((await ugak.rpc('member_admin_list')).error, 'the full list is refused to non-officers');
  ok((await sheo.rpc('member_admin_list')).error, 'and to Daedric');
  ok((await sharn.rpc('member_admin_list')).data.length === 6, 'officers get the full list');
  ok((await ugak.rpc('update_my_profile', { p_display_name: 'gorza GRA-largash' })).error, "a member cannot take another member's display name");
  ok((await ugak.rpc('update_my_profile', { p_display_name: '\u200B\u200B' })).error, 'an invisible display name is refused');
  await gorza.rpc('update_my_profile', { p_display_name: 'Gorza gra-Largash', p_discord_name: 'gorza' });
  ok((await ugak.rpc('update_my_profile', { p_display_name: 'Ugak the Bold', p_discord_name: 'GORZA' })).error, "a member cannot claim another member's Discord name");
}
{ // hidden ledger entries are really hidden
  await sheo.from('ledger_entries').upsert({ item_key: 'skyrim.esm:0HIDDEN', hidden: true, acquire: 'officers only note' });
  ok(!(await ugak.from('ledger_entries').select('*')).data.some((e) => e.hidden), 'members do not receive hidden entries');
  ok((await ugak.rpc('hidden_item_keys')).data.includes('skyrim.esm:0HIDDEN'), 'members learn only which items to leave out');
  ok((await sheo.from('ledger_entries').upsert({ item_key: 'custom:bad', custom: { name: 123 } })).error, 'a malformed custom item is refused');
  ok(!(await sheo.from('ledger_entries').upsert({ item_key: 'custom:ok', custom: { name: 'Tusk Charm', cat: 'misc', type: 'Charm', value: 5, weight: 0.1 } })).error, 'a well-formed custom item is accepted');
}
{ // storage: pictures only
  const html = new Blob(['<script>alert(1)</script>'], { type: 'text/html' });
  ok((await sheo.storage.from('item-images').upload('x.html', html)).error, 'non-picture uploads are refused');
  ok((await sheo.storage.from('item-images').upload('big.png', new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'image/png' }))).error, 'oversized uploads are refused');
}
{ // accounts: gaps in the officer guard
  const victim = (await sharn.api('admin.create', { username: 'target', display_name: 'Target', tags: ['kinsmen'] })).data;
  ok(victim.password.startsWith('tusk-') && victim.password.length === 19, 'temporary passwords are long random codes', victim.password);
  const chosen = (await sharn.api('admin.create', { username: 'chosen', display_name: 'Chosen', tags: [], password: 'OfficerPicked1' })).data;
  ok(chosen.password !== 'OfficerPicked1', "an officer cannot choose a new member's password");
  ok((await sharn.api('admin.delete', { id: victim.profile.id })).data?.ok && (await sharn.api('admin.delete', { id: chosen.profile.id })).data?.ok, 'officer removes the members');
  ok((await sharn.api('admin.create', { username: 'target', display_name: 'Target Again', tags: [] })).error?.includes('removed member'), "an officer cannot reuse a removed member's sign-in name");
  const again = (await nick.api('admin.create', { username: 'target', display_name: 'Target Again', tags: [] })).data;
  ok(again?.profile, 'the Forgemaster can');
  await nick.api('admin.delete', { id: again.profile.id });
  ok((await sharn.api('admin.update', { id: gorza.me, display_name: 'Gorza the Coward' })).error, "an officer cannot edit the Chieftain's account");
  ok((await sharn.api('admin.update', { id: ugak.me, display_name: 'a\u0000b' })).error, 'control characters in names are refused');
  ok((await sharn.api('admin.reveal_password', { id: 'not-a-uuid' })).error, 'a malformed member id is refused');
  ok((await nick.api('admin.update', { id: ugak.me, username: 'ugak2' })).data?.profile?.username === 'ugak2', 'the Forgemaster renames a sign-in');
  ok((await login('ugak2')).me === ugak.me, 'the renamed sign-in works');
  ok((await nick.api('admin.update', { id: ugak.me, username: 'ugak' })).data?.profile?.username === 'ugak', 'and can be renamed back');
}
{ // a password changed behind the app's back cannot leave a stale copy
  const made2 = (await nick.api('admin.create', { username: 'sneak', display_name: 'Sneak', tags: ['blooded'] })).data;
  const sneak = await login('sneak', made2.password);
  await sneak.api('account.change_password', { current_password: made2.password, new_password: 'ThroughTheApp1' });
  ok((await nick.api('admin.reveal_password', { id: sneak.me })).data.password === 'ThroughTheApp1', 'the saved copy follows a change made through the app');
  const { raw: db } = await import('../dev/server.mjs');
  await db.query(`update auth.users set encrypted_password = 'changed-directly' where id = $1`, [sneak.me]);   // what auth.updateUser() does
  ok((await nick.api('admin.reveal_password', { id: sneak.me })).data.password === null, 'a change made outside the app drops the saved copy instead of leaving a wrong one');
  ok((await nick.rpc('member_admin_list')).data.find((m) => m.id === sneak.me).must_change_password === true, 'and the member is asked to set a password through the app');
  ok(await db.query(`update auth.users set email = 'other@blacktusk.invalid' where id = $1`, [sneak.me]).then(() => false, () => true), 'a member cannot rename their own sign-in');
  const va = (await nick.api('admin.create', { username: 'vaulta', display_name: 'Vault A', tags: [], password: 'short-one-1' })).data;
  const vb = (await nick.api('admin.create', { username: 'vaultb', display_name: 'Vault B', tags: [], password: 'a-much-longer-password-than-the-other-one-42' })).data;
  ok(va.password === 'short-one-1', 'the Forgemaster may choose a new member\'s password');
  const a = (await db.query(`select user_id, cipher from password_vault where user_id = any($1) order by user_id`, [`{${va.profile.id},${vb.profile.id}}`])).rows;
  ok(a.length === 2 && a[0].cipher.length === a[1].cipher.length && a[0].cipher.startsWith('v1:'), 'saved copies are all the same length whatever the password');
  await db.query(`update password_vault set cipher = $2 where user_id = $1`, [a[0].user_id, a[1].cipher]);
  ok((await nick.api('admin.reveal_password', { id: a[0].user_id })).error, "a copy moved onto another member's row will not open");
  await nick.api('admin.delete', { id: va.profile.id }); await nick.api('admin.delete', { id: vb.profile.id });
  await nick.api('admin.delete', { id: sneak.me });
}
ok((await guest.rpc('my_tags')).error && (await guest.rpc('hidden_item_keys')).error, "guests cannot call the app's functions");

console.log('settings and discord');
ok((await gorza.from('app_settings').upsert({ key: 'discord_guild_id', value: '1' })).error, 'only the Forgemaster changes settings');
ok((await ugak.api('discord.presence')).data?.configured === false, 'presence reports not configured');
ok(!(await nick.from('app_settings').upsert({ key: 'discord_guild_id', value: '123456789012345678' })).error, 'Forgemaster saves the Discord server id');
discordStub.body = { name: 'Black Tusks', presence_count: 2, members: [{ username: 'ugak#1', status: 'online', game: { name: 'The Elder Scrolls V: Skyrim Special Edition' } }, { username: 'Nick', status: 'idle' }] };
const pr = (await ugak.api('discord.presence')).data;
ok(pr?.ok && pr.members.length === 2 && pr.members[0].game.includes('Skyrim'), 'presence returns who is online and playing');
await nick.from('app_settings').upsert({ key: 'discord_guild_id', value: '223456789012345678' });
discordStub.status = 403;
ok((await ugak.api('discord.presence')).data?.reason?.includes('Server Widget'), 'a disabled widget is explained');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
