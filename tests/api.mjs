// Permission tests: every role does (and is refused) what the brief says,
// against real Postgres row-level security and the real server function.
import { createClient } from '@supabase/supabase-js';
import { start, discordStub, raw } from '../dev/server.mjs';

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
  sharn = await login('sharn'), velyn = await login('velyn'), yatul = await login('yatul');

console.log('guests');
for (const t of ['profiles', 'announcements', 'mine_deals', 'expansion_stages', 'ore_markers', 'ledger_entries', 'changelog', 'app_settings', 'password_vault', 'audit_log', 'role_notes']) {
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
const a1 = (await post(yatul, { title: 'From the Left Tusk' })).data;
ok(a1?.id, 'Left Tusk can post');
const a2 = (await post(sharn, { title: 'For Ugak only', visibility: 'specific', audience: [ugak.me] })).data;
const a3 = (await post(gorza, { title: 'Chief draft', visibility: 'draft' })).data;
const a4 = (await post(nick, { title: 'Gone already', expires_at: new Date(Date.now() - 60000).toISOString() })).data;
const a5 = (await post(nick, { title: 'Up for an hour', expires_at: new Date(Date.now() + 3600000).toISOString() })).data;
ok(a2?.id && a3?.id && a4?.id && a5?.id, 'officers can post with audience, draft and timers');
const titles = async (c) => (await c.from('announcements').select('*')).data.map((r) => r.title).sort().join('|');
ok(await titles(ugak) === 'For Ugak only|From the Left Tusk|Up for an hour', 'Ugak sees public, targeted, unexpired', await titles(ugak));
ok(await titles(velyn) === 'From the Left Tusk|Up for an hour', 'Velyn does not see the targeted notice', await titles(velyn));
ok(await titles(gorza) === 'Chief draft|For Ugak only|From the Left Tusk|Gone already|Up for an hour', 'Chieftain sees own draft and expired ones', await titles(gorza));
ok(await titles(nick) === 'For Ugak only|From the Left Tusk|Gone already|Up for an hour', 'another officer does not see the chief draft', await titles(nick));
ok((await ugak.from('announcements').delete().eq('id', a1.id).select()).data.length === 0, 'a member cannot remove a notice');
ok((await gorza.from('announcements').delete().eq('id', a4.id).select()).data.length === 1, 'an officer removes an older notice');
ok((await yatul.from('announcements').update({ title: 'Edited' }).eq('id', a5.id).select()).data.length === 1, 'Left Tusk can edit a notice');
ok((await nick.from('announcements').delete().eq('id', a3.id).select()).data.length === 0, "an officer cannot remove another's private draft");

console.log('changelog');
ok((await gorza.from('changelog').insert({ title: 'nope' })).error, 'Chieftain cannot edit the change log');
ok(!(await nick.from('changelog').insert({ title: '0.1.1 fix', version: '0.1.1' })).error, 'Forgemaster can');
ok((await ugak.from('changelog').select('*')).data.length === 2, 'members read the change log');

console.log('mine deals');
ok((await velyn.from('mine_deals').insert({ author_id: velyn.me, title: 'no' })).error, 'an Ally cannot add mine deals');
const d1 = (await gorza.from('mine_deals').insert({ author_id: gorza.me, title: 'Iron for Riften', body: '40 ingots a week', visibility: 'specific', audience: [velyn.me] }).select().single()).data;
const d2 = (await nick.from('mine_deals').insert({ author_id: nick.me, title: 'Open terms' }).select().single()).data;
ok(d1?.id && d2?.id, 'officers add deals');
ok((await velyn.from('mine_deals').select('*')).data.length === 2, 'the named ally sees their deal');
ok((await ugak.from('mine_deals').select('*')).data.length === 1, 'others only see the open deal');
ok((await ugak.from('mine_deals').update({ title: 'x' }).eq('id', d2.id).select()).data.length === 0, 'members cannot edit deals');

console.log('expansion goals');
const btStages = (await ugak.from('expansion_stages').select('id').eq('clan', 'black_tusks')).data.map((r) => r.id);
const res = (await ugak.from('expansion_resources').select('*').in('stage_id', btStages)).data;
ok(res.length === 30 && res.every((r) => r.have === 0), 'all resources start at 0');
const sum = (n) => res.filter((r) => r.name === n && r.in_total).reduce((s, r) => s + r.goal, 0);
ok(sum('Gold') === 64500 && sum('Iron Ingots') === 2380 && sum('Steel Ingots') === 450 && sum('Corundum') === 700 && sum('Firewood') === 5150
  && sum('Leather Strips') === 420 && sum('Pelts (Any)') === 275 && sum('Silver Ingots') === 8, 'stage goals add up to the totals in the brief');
ok((await ugak.from('expansion_resources').update({ have: 5 }).eq('id', res[0].id).select()).data.length === 0, 'members cannot change progress');
ok((await sharn.from('expansion_resources').update({ have: 1200 }).eq('id', res[0].id).select()).data[0]?.have === 1200, 'Wise Woman updates progress');
ok((await velyn.from('expansion_stages').update({ title: 'x' }).eq('id', res[0].stage_id).select()).data.length === 0, 'an Ally cannot edit goals');

console.log('mining map');
const ping = async (c, row) => (await c.from('ore_markers').insert({ ore: 'iron', x: 1000, y: 2000, ...row }).select().single());
const m1 = (await ping(ugak, { status: 'approved' })).data;
ok(m1?.status === 'pending' && m1.created_by === ugak.me, "a member's ping is pending even if they ask for approved");
const m2 = (await ping(nick, { ore: 'ebony' })).data;
ok(m2?.status === 'approved' && m2.reviewed_by === nick.me, "a higher-up's marker skips approval");
ok((await velyn.from('ore_markers').select('*')).data.length === 1, 'others see only approved markers');
ok((await ugak.from('ore_markers').select('*')).data.length === 2, 'the pinger also sees their pending ping');
ok((await yatul.from('ore_markers').select('*')).data.length === 2, 'approvers see pending pings');
ok((await ugak.from('ore_markers').update({ status: 'approved' }).eq('id', m1.id).select()).data[0]?.status === 'pending', 'a member cannot approve their own ping');
ok((await velyn.from('ore_markers').update({ note: 'x' }).eq('id', m1.id).select()).data.length === 0, "a member cannot edit someone else's ping");
const ap = (await yatul.from('ore_markers').update({ status: 'approved' }).eq('id', m1.id).select()).data[0];
ok(ap?.status === 'approved' && ap.reviewed_by === yatul.me && ap.created_by === ugak.me, 'Left Tusk approves; reviewer recorded, author kept');
ok((await velyn.from('ore_markers').select('*')).data.length === 2, 'approved ping is now on everyone\'s map');
const m3 = (await ping(velyn, { ore: 'silver' })).data;
ok((await gorza.from('ore_markers').update({ status: 'rejected', review_note: 'Nothing there' }).eq('id', m3.id).select()).data[0]?.status === 'rejected', 'Chieftain denies a false ping');
ok((await ugak.from('ore_markers').select('*')).data.length === 2, 'denied ping stays off the map');
ok((await ugak.from('ore_markers').delete().eq('id', m2.id).select()).data.length === 0, 'a member cannot delete an approved marker');

console.log('pricing ledger');
ok((await ugak.from('ledger_entries').upsert({ item_key: 'skyrim.esm:05ACE4', price: 9 })).error, 'members cannot price items');
ok(!(await yatul.from('ledger_entries').upsert({ item_key: 'skyrim.esm:05ACE4', price: 12, tier: 1 })).error, 'Left Tusk can price items');
ok(!(await gorza.from('ledger_entries').upsert({ item_key: 'skyrim.esm:05ACE4', price: 14 })).error, 'Chieftain updates the same entry');
const le = (await ugak.from('ledger_entries').select('*')).data[0];
ok(le.price === 14 && le.tier === 1 && le.updated_by === gorza.me, 'members read the entry; editor recorded');
ok((await yatul.from('ledger_entries').upsert({ item_key: 'x', tier: 9 })).error, 'tier outside 1 to 5 refused');
{
  const blob = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' });
  ok((await ugak.storage.from('item-images').upload('iron.png', blob)).error, 'members cannot upload item images');
  ok(!(await yatul.storage.from('item-images').upload('iron.png', blob, { upsert: true })).error, 'Left Tusk uploads an item image');
  const pub = yatul.storage.from('item-images').getPublicUrl('iron.png').data.publicUrl;
  ok((await fetch(pub)).status === 200, 'the image is publicly readable');
}

console.log('accounts');
ok((await ugak.api('admin.create', { username: 'intruder', tags: [] })).error, 'a member cannot add accounts');
ok((await velyn.api('admin.create', { username: 'intruder', tags: [] })).error, 'an Ally cannot add accounts');
const made = await sharn.api('admin.create', { username: 'Morgash', display_name: 'Morgash the Young', tags: ['unblooded'] });
ok(made.data?.profile?.username === 'Morgash' && made.data.password?.length >= 12, 'Wise Woman adds a member and receives a temporary password; the sign-in name keeps its capital', made.error);
const morgash = await login('morgash', made.data.password);
ok((await morgash.rpc('my_profile')).data.must_change_password === true, 'new member is asked to change password');
ok((await sharn.api('admin.create', { username: 'morgash', tags: [] })).error?.includes('already in use'), 'duplicate sign-in name refused');
ok((await sharn.api('admin.create', { username: 'MORGASH', tags: [] })).error?.includes('already in use'), 'the same sign-in name in other capitals is refused too');
ok((await sharn.api('admin.create', { username: 'M_rgash', tags: [] })).data?.profile?.username === 'M_rgash', 'an underscore in a new name is not read as a wildcard');
ok((await nick.api('admin.delete', { id: (await nick.rpc('member_admin_list')).data.find((m) => m.username === 'M_rgash').id })).data?.ok, 'and that member can be removed again');
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
{
  // A wrong guess must not disturb the member's other sessions.
  const phone = await login('morgash', made.data.password);
  await morgash.api('account.change_password', { current_password: 'wrong again', new_password: 'MyOwnSecret9' });
  ok((await phone.api('discord.presence')).data, 'a failed password change leaves other devices signed in');
  ok((await morgash.api('account.change_password', { current_password: made.data.password, new_password: 'MyOwnSecret9' })).data?.ok, 'member changes their own password');
  // Supabase ends every session on a password change. The app signs back in by itself (see the browser tests).
  ok((await morgash.api('discord.presence')).error === 'Sign in again.', 'the session that changed the password is ended by the Auth server');
  ok((await phone.api('discord.presence')).error === 'Sign in again.', 'and so is every other device');
  ok((await (await login('morgash', 'MyOwnSecret9')).api('discord.presence')).data, 'signing in with the new password works straight away');
}
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
ok((await sharn.api('admin.delete', { id: morgash.me })).error?.includes('Chieftain'), 'only a Chieftain removes members: not the Wise Woman');
ok((await yatul.api('admin.delete', { id: morgash.me })).error?.includes('Chieftain'), 'nor the Left Tusk');
ok((await gorza.api('admin.delete', { id: nick.me })).error?.includes('Forgemaster cannot be removed'), 'nobody removes the Forgemaster');
ok((await gorza.api('admin.delete', { id: morgash.me })).data?.ok, 'Chieftain removes a member');
ok((await ugak.from('profiles').select('id')).data.length === 6, 'removed member is gone from the list');
ok(await login('morgash', 'ForgeReset2026').then(() => false, () => true), 'removed member cannot sign in');

console.log('hardening');
{ // nobody can rewrite who posted or who reviewed
  const n = (await yatul.from('announcements').insert({ title: 'Gold to the Daedra' }).select().single()).data;
  const forged = (await yatul.from('announcements').update({ author_id: gorza.me, title: 'Gold to the Daedra!' }).eq('id', n.id).select().single()).data;
  ok(forged.author_id === yatul.me && forged.updated_by === yatul.me, 'the author of a notice cannot be changed, and edits are stamped');
  const chief = (await gorza.from('announcements').insert({ title: 'Chief speaks' }).select().single()).data;
  const edited = (await yatul.from('announcements').update({ body: 'altered' }).eq('id', chief.id).select().single()).data;
  ok(edited.author_id === gorza.me && edited.updated_by === yatul.me, "editing another's notice leaves a trace");
  const deal = (await sharn.from('mine_deals').insert({ title: 'Deal' }).select().single()).data;
  ok((await sharn.from('mine_deals').update({ author_id: gorza.me }).eq('id', deal.id).select().single()).data.author_id === sharn.me, 'the author of a deal cannot be changed');
  const mk = (await nick.from('ore_markers').select('*').eq('status', 'approved').limit(1)).data[0];
  const forgedReview = (await yatul.from('ore_markers').update({ reviewed_by: gorza.me, review_note: 'Chief checked it' }).eq('id', mk.id).select().single()).data;
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
  ok((await yatul.from('ore_markers').update({ status: 'approved' }).eq('id', p.id).eq('updated_at', p.updated_at).select()).data.length === 0, 'approving a ping that changed since it was viewed does nothing');
}
{ // members see names and tags, not sign-in names
  ok((await ugak.from('profiles').select('*')).error, 'members cannot read whole profile rows');
  const pub = (await ugak.from('profiles').select('id, display_name, tags, discord_name, created_at')).data;
  ok(pub.length === 6 && !('username' in pub[0]), 'the public columns are readable');
  ok((await ugak.from('profiles').select('username')).error, 'sign-in names are not readable by members');
  ok((await ugak.rpc('my_profile')).data.username === 'ugak', 'a member reads their own full profile');
  ok((await ugak.rpc('member_admin_list')).error, 'the full list is refused to non-officers');
  ok((await velyn.rpc('member_admin_list')).error, 'and to an Ally');
  ok((await sharn.rpc('member_admin_list')).data.length === 6, 'officers get the full list');
  ok((await ugak.rpc('update_my_profile', { p_display_name: 'gorza GRA-largash' })).error, "a member cannot take another member's display name");
  ok((await ugak.rpc('update_my_profile', { p_display_name: '\u200B\u200B' })).error, 'an invisible display name is refused');
  await gorza.rpc('update_my_profile', { p_display_name: 'Gorza gra-Largash', p_discord_name: 'gorza' });
  ok((await ugak.rpc('update_my_profile', { p_display_name: 'Ugak the Bold', p_discord_name: 'GORZA' })).error, "a member cannot claim another member's Discord name");
}
{ // hidden ledger entries are really hidden
  await yatul.from('ledger_entries').upsert({ item_key: 'skyrim.esm:0HIDDEN', hidden: true, acquire: 'officers only note' });
  ok(!(await ugak.from('ledger_entries').select('*')).data.some((e) => e.hidden), 'members do not receive hidden entries');
  ok((await ugak.rpc('hidden_item_keys')).data.includes('skyrim.esm:0HIDDEN'), 'members learn only which items to leave out');
  ok((await yatul.from('ledger_entries').upsert({ item_key: 'custom:bad', custom: { name: 123 } })).error, 'a malformed custom item is refused');
  ok(!(await yatul.from('ledger_entries').upsert({ item_key: 'custom:ok', custom: { name: 'Tusk Charm', cat: 'misc', type: 'Charm', value: 5, weight: 0.1 } })).error, 'a well-formed custom item is accepted');
}
{ // storage: pictures only
  const html = new Blob(['<script>alert(1)</script>'], { type: 'text/html' });
  ok((await yatul.storage.from('item-images').upload('x.html', html)).error, 'non-picture uploads are refused');
  ok((await yatul.storage.from('item-images').upload('big.png', new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'image/png' }))).error, 'oversized uploads are refused');
}
{ // accounts: gaps in the officer guard
  const victim = (await sharn.api('admin.create', { username: 'target', display_name: 'Target', tags: ['kinsmen'] })).data;
  ok(victim.password.startsWith('tusk-') && victim.password.length === 19, 'temporary passwords are long random codes', victim.password);
  const chosen = (await sharn.api('admin.create', { username: 'chosen', display_name: 'Chosen', tags: [], password: 'OfficerPicked1' })).data;
  ok(chosen.password !== 'OfficerPicked1', "an officer cannot choose a new member's password");
  ok((await gorza.api('admin.delete', { id: victim.profile.id })).data?.ok && (await nick.api('admin.delete', { id: chosen.profile.id })).data?.ok, 'the Chieftain and the Forgemaster remove members');
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
  ok((await nick.api('admin.update', { id: ugak.me, username: 'Ugak' })).data?.profile?.username === 'Ugak', 'the Forgemaster can change only the capitals of a sign-in name');
  ok((await login('ugak')).me === ugak.me, 'and the member still signs in the same way');
  ok((await nick.api('admin.update', { id: ugak.me, username: 'GORZA' })).error?.includes('already in use'), "a rename cannot take another member's name in different capitals");
  ok((await nick.api('admin.update', { id: ugak.me, username: 'ugak' })).data?.profile?.username === 'ugak', 'capitals restored');
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

console.log('member cards');
{
  const card = (c, over = {}) => c.rpc('update_my_card', { p_bio: 'Smith of Largashbur.', p_masteries: [{ skill: 'blacksmith', level: 5 }, { skill: 'miner', level: 2 }],
    p_timezone: 'America/New_York', p_availability: [0, 0, 0, 0, 4063232, 16776192, 0], ...over });
  const saved = await card(ugak);
  ok(!saved.error && saved.data.bio === 'Smith of Largashbur.' && saved.data.masteries.length === 2 && saved.data.availability[4] === 4063232, 'a member saves their own bio, masteries and hours', saved.error?.message);
  const seen = (await velyn.from('profiles').select('id, bio, masteries, timezone, availability').eq('id', ugak.me).single()).data;
  ok(seen?.bio === 'Smith of Largashbur.' && seen.masteries[0].skill === 'blacksmith' && seen.timezone === 'America/New_York', 'other members can read the card');
  ok((await guest.from('profiles').select('bio')).error || ((await guest.from('profiles').select('bio')).data ?? []).length === 0, 'guests cannot');
  ok((await card(ugak, { p_bio: 'x'.repeat(501) })).error, 'a bio over 500 characters is refused');
  ok(!(await card(ugak, { p_bio: 'x'.repeat(500) })).error, 'exactly 500 is accepted');
  ok((await card(ugak, { p_masteries: [{ skill: 'cook', level: 1 }, { skill: 'miner', level: 1 }, { skill: 'tailor', level: 1 }, { skill: 'shield', level: 1 }] })).error, 'a fourth mastery is refused');
  ok((await card(ugak, { p_masteries: [{ skill: 'dragon_rider', level: 1 }] })).error, 'an unknown mastery is refused');
  ok((await card(ugak, { p_masteries: [{ skill: 'cook', level: 6 }] })).error && (await card(ugak, { p_masteries: [{ skill: 'cook', level: -1 }] })).error
    && (await card(ugak, { p_masteries: [{ skill: 'cook', level: 2.5 }] })).error, 'levels outside 0 to 5 are refused');
  ok((await card(ugak, { p_masteries: [{ skill: 'cook', level: 1 }, { skill: 'cook', level: 3 }] })).error, 'the same mastery twice is refused');
  ok((await card(ugak, { p_masteries: [{ skill: 'cook', level: 1, shiny: true }] })).error && (await card(ugak, { p_masteries: { skill: 'cook', level: 1 } })).error, 'malformed masteries are refused');
  ok((await card(ugak, { p_availability: [0, 0, 0] })).error && (await card(ugak, { p_availability: [0, 0, 0, 0, 0, 0, 16777216] })).error
    && (await card(ugak, { p_availability: [0, 0, 0, 0, 0, 0, -1] })).error, 'hours that are not a week of 24-hour days are refused');
  ok((await card(ugak, { p_timezone: 'Mars/Olympus Mons; drop table' })).error, 'an odd time zone is refused');
  const cleared = await card(ugak, { p_bio: '  ', p_masteries: [], p_timezone: '', p_availability: null });
  ok(!cleared.error && cleared.data.bio === '' && cleared.data.masteries.length === 0 && cleared.data.timezone === null && cleared.data.availability === null, 'a card can be emptied again', cleared.error?.message);
  await card(ugak);
  const direct = await velyn.from('profiles').update({ bio: 'defaced' }).eq('id', ugak.me).select('id');
  ok(direct.error || direct.data.length === 0, "nobody can write another member's card");
  ok((await velyn.from('profiles').select('bio').eq('id', ugak.me).single()).data.bio === 'Smith of Largashbur.', 'and it is unchanged');
  ok((await ugak.rpc('my_profile')).data.tags.join() === 'blooded', 'saving a card never touches tags');
  ok((await guest.rpc('update_my_card', { p_bio: 'x', p_masteries: [], p_timezone: null, p_availability: null })).error, 'guests cannot save a card');

  // Officers may set another member's masteries (and nothing else on the card).
  const set = await sharn.api('admin.update', { id: ugak.me, masteries: [{ skill: 'two_handed', level: 4 }, { skill: 'cook', level: 0 }] });
  ok(set.data?.profile?.masteries?.length === 2 && set.data.profile.masteries[0].skill === 'two_handed' && set.data.profile.bio === 'Smith of Largashbur.',
    "an officer sets another member's masteries; the bio stays as the member wrote it", set.error);
  ok((await velyn.from('profiles').select('masteries').eq('id', ugak.me).single()).data.masteries[0].level === 4, 'and everyone sees the change');
  ok((await ugak.api('admin.update', { id: velyn.me, masteries: [{ skill: 'cook', level: 5 }] })).error?.includes('officers'), "a Blooded member cannot set someone else's masteries");
  ok((await velyn.api('admin.update', { id: ugak.me, masteries: [] })).error?.includes('officers'), 'nor can an Ally');
  ok((await sharn.api('admin.update', { id: nick.me, masteries: [{ skill: 'cook', level: 5 }] })).error, "an officer cannot set a Forgemaster's masteries");
  ok(!(await nick.api('admin.update', { id: gorza.me, masteries: [{ skill: 'armor', level: 5 }] })).error, "the Forgemaster can set the Chieftain's");
  for (const [bad, why] of [[[{ skill: 'cook', level: 6 }], 'a level over 5'], [[{ skill: 'dragon_rider', level: 1 }], 'an unknown skill'],
    [[{ skill: 'cook', level: 1 }, { skill: 'cook', level: 2 }], 'the same skill twice'], [[1, 2, 3, 4].map((n) => ({ skill: ['cook', 'miner', 'tailor', 'shield'][n - 1], level: 1 })), 'four masteries'], ['cook', 'something that is not a list']]) {
    ok((await sharn.api('admin.update', { id: ugak.me, masteries: bad })).error, `an officer is refused ${why}`);
  }
  ok((await velyn.from('profiles').select('masteries').eq('id', ugak.me).single()).data.masteries.length === 2, 'refused changes leave the masteries as they were');
  const untouched = await sharn.api('admin.update', { id: ugak.me, display_name: 'Ugak the Bold' });
  ok(untouched.data?.profile?.masteries?.length === 2, 'editing a name leaves masteries alone', untouched.error);
  const audit = await nick.from('audit_log').select('action, detail').eq('action', 'member.updated').order('at', { ascending: false }).limit(12);
  ok((audit.data ?? []).some((a) => JSON.stringify(a.detail ?? {}).includes('two_handed')), 'the change is written to the audit log', JSON.stringify(audit.data ?? audit.error).slice(0, 200));
  await card(ugak);
}

console.log('tag changes');
{
  // Tags are the officers' business. Every other rank is tried here, one by one.
  const pw = 'RolePass12345';
  const mk = async (username, tags) => {
    const r = await nick.api('admin.create', { username, display_name: username, tags, password: pw });
    if (r.error) throw new Error(`create ${username}: ${r.error}`);
    return login(username.toLowerCase(), pw);
  };
  const ranks = {
    'Blooded': ugak, 'Ally': velyn,
    'Blood-Kin': await mk('Kinna', ['blood_kin']), 'Kinsmen': await mk('Kinsor', ['kinsmen']),
    'Un-Blooded': await mk('Newblood', ['unblooded']), 'Deceased only': await mk('Ghost', ['deceased']),
    'no tags at all': await mk('Nobody', []),
  };
  const tagsOf = async (id) => (await nick.rpc('member_admin_list')).data.find((m) => m.id === id).tags.join();
  for (const [rank, c] of Object.entries(ranks)) {
    const mine = await tagsOf(c.me);
    ok((await c.api('admin.update', { id: c.me, tags: ['chieftain', 'forgemaster'] })).error?.includes('officers'), `${rank}: cannot change their own tags`);
    ok((await c.api('admin.update', { id: c.me, tags: ['blooded'] })).error?.includes('officers'), `${rank}: cannot give themselves even a plain tag`);
    ok((await c.api('admin.update', { id: gorza.me, tags: [] })).error?.includes('officers'), `${rank}: cannot change another member's tags`);
    ok((await c.api('admin.create', { username: 'made' + rank.replace(/[^a-z]/gi, ''), tags: ['chieftain'] })).error?.includes('officers'), `${rank}: cannot add a member`);
    ok((await c.api('admin.delete', { id: gorza.me })).error?.includes('Chieftain'), `${rank}: cannot remove a member`);
    const own = await c.from('profiles').update({ tags: ['chieftain'] }).eq('id', c.me).select('id');
    ok(own.error || own.data.length === 0, `${rank}: cannot write their own tags straight to the database`);
    const other = await c.from('profiles').update({ tags: [] }).eq('id', gorza.me).select('id');
    ok(other.error || other.data.length === 0, `${rank}: cannot write another member's tags straight to the database`);
    ok((await c.from('profiles').insert({ id: crypto.randomUUID(), username: 'ghostrow', display_name: 'Ghost Row', tags: ['chieftain'] })).error, `${rank}: cannot insert a profile`);
    ok((await c.rpc('member_admin_list')).error, `${rank}: cannot open the officers' member list`);
    ok(await tagsOf(c.me) === mine && await tagsOf(gorza.me) === 'chieftain', `${rank}: afterwards every tag is as it was`);
  }
  for (const rank of ['Blood-Kin', 'Kinsmen', 'Un-Blooded', 'Deceased only', 'no tags at all']) await nick.api('admin.delete', { id: ranks[rank].me });
}

console.log('settings and discord');
ok((await gorza.from('app_settings').upsert({ key: 'discord_guild_id', value: '1' })).error, 'only the Forgemaster changes settings');
ok((await ugak.api('discord.presence')).data?.configured === false, 'presence reports not configured');
ok(!(await nick.from('app_settings').upsert({ key: 'discord_guild_id', value: '123456789012345678' })).error, 'Forgemaster saves the Discord server id');
discordStub.body = { name: 'Black Tusks', presence_count: 2, members: [{ username: 'ugak#1', status: 'online', game: { name: 'The Elder Scrolls V: Skyrim Special Edition' } }, { username: 'Nick', status: 'idle' }] };
const pr = (await ugak.api('discord.presence')).data;
ok(pr?.ok && pr.members.length === 2 && pr.members[0].game.includes('Skyrim'), 'presence returns who is online and playing');
await nick.from('app_settings').upsert({ key: 'discord_guild_id', value: '323456789012345678' });      // a new id skips the 45 second cache
discordStub.body = { name: 'Black Tusks', presence_count: 1, members: [{ id: '0', username: 'Gorza', discriminator: '0000', avatar: null, status: 'online', activity: { name: 'The Elder Scrolls V: Skyrim Special Edition' } }] };
ok((await ugak.api('discord.presence')).data?.members?.[0]?.game?.includes('Skyrim'), "the game is read from Discord's current field name too");
await nick.from('app_settings').upsert({ key: 'discord_guild_id', value: '223456789012345678' });
discordStub.status = 403;
ok((await ugak.api('discord.presence')).data?.reason?.includes('Server Widget'), 'a disabled widget is explained');


console.log('0.2.5: the Daedric tag is retired');
{
  ok((await nick.api('admin.create', { username: 'Daedra1', tags: ['daedric'] })).error, 'the Daedric tag cannot be given to a new member');
  ok((await nick.api('admin.update', { id: ugak.me, tags: ['blooded', 'daedric'] })).error, 'nor to an existing one');
  let refused = false;
  try { await raw.query(`update public.profiles set tags = array['daedric'] where id = $1`, [ugak.me]); } catch { refused = true; }
  ok(refused, 'the database itself refuses the tag');
  ok((await nick.rpc('member_admin_list')).data.every((m) => !m.tags.includes('daedric')), 'nobody carries it');
  // what Daedric could do is now the officers' alone
  ok((await velyn.from('ledger_entries').upsert({ item_key: 'skyrim.esm:0NOPE', price: 1 })).error, 'a plain member still cannot price items');
}

console.log('0.2.5: the fallen');
{
  const born = await nick.api('admin.create', { username: 'Fallen1', display_name: 'Borgakh the Fallen', tags: ['blooded', 'deceased'], password: 'RolePass12345' });
  const ghost = (await nick.rpc('member_admin_list')).data.find((m) => m.id === born.data?.profile?.id);
  const ghostSelf = await login('fallen1', 'RolePass12345');
  ok(ghost && ghost.death_cause === '' && ghost.death_date === null && ghost.death_date_unknown === false, 'a newly Deceased member starts with no cause and an empty date', JSON.stringify(ghost)?.slice(0, 200));
  const rec = await sharn.rpc('set_death_record', { p_id: ghost.id, p_cause: '  Fell to a giant near Bleakwind Basin.  ', p_date: '2026-10-01', p_unknown: false });
  ok(rec.data?.death_cause === 'Fell to a giant near Bleakwind Basin.' && rec.data.death_date === '2026-10-01', 'an officer records the cause of death and the date of passing', rec.error?.message);
  const seen = (await velyn.from('profiles').select('death_cause, death_date, death_date_unknown').eq('id', ghost.id).single()).data;
  ok(seen?.death_date === '2026-10-01' && seen.death_cause.startsWith('Fell to a giant') && seen.death_date_unknown === false, 'every member reads it');
  const unk = await gorza.rpc('set_death_record', { p_id: ghost.id, p_cause: 'Lost in Blackreach.', p_date: '2026-10-01', p_unknown: true });
  ok(unk.data?.death_date === null && unk.data.death_date_unknown === true, 'a date marked unknown replaces any date');
  const blank = await gorza.rpc('set_death_record', { p_id: ghost.id, p_cause: '', p_date: null, p_unknown: false });
  ok(blank.data?.death_date === null && blank.data.death_date_unknown === false && blank.data.death_cause === '', 'and both can be emptied again');
  ok((await ugak.rpc('set_death_record', { p_id: ghost.id, p_cause: 'x', p_date: null, p_unknown: false })).error, 'a member cannot record a death');
  ok((await ghostSelf.rpc('set_death_record', { p_id: ghost.id, p_cause: 'I got better', p_date: null, p_unknown: false })).error, 'nor can the fallen write their own');
  ok((await sharn.rpc('set_death_record', { p_id: ugak.me, p_cause: 'x', p_date: null, p_unknown: false })).error?.message.includes('Deceased tag'), 'a living member has no death to record');
  const tomorrow = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  ok((await sharn.rpc('set_death_record', { p_id: ghost.id, p_cause: 'x', p_date: tomorrow, p_unknown: false })).error, 'a date in the future is refused');
  ok((await sharn.rpc('set_death_record', { p_id: ghost.id, p_cause: 'x'.repeat(501), p_date: null, p_unknown: false })).error, 'a cause over 500 characters is refused');
  ok((await sharn.rpc('set_death_record', { p_id: '00000000-0000-4000-8000-000000000000', p_cause: 'x', p_date: null, p_unknown: false })).error, 'a member who does not exist is refused');
  ok((await guest.rpc('set_death_record', { p_id: ghost.id, p_cause: 'x', p_date: null, p_unknown: false })).error, 'guests are refused');
  // the same reach as the rest of an account (there is only one Forgemaster, so no Forgemaster can fall)
  ok((await nick.api('admin.create', { username: 'Oldsmith', display_name: 'Oldsmith', tags: ['forgemaster', 'deceased'] })).error, 'a second, fallen Forgemaster cannot be made');
  ok(!(await nick.rpc('set_death_record', { p_id: ghost.id, p_cause: 'The forge went cold.', p_date: null, p_unknown: true })).error, 'the Forgemaster records one too');
  ok((await nick.from('audit_log').select('*').eq('action', 'member.death_recorded')).data.length >= 4, 'each record is written to the audit log');
  // the fallen keep their account: the card still saves, the app still opens
  ok(!(await ghostSelf.rpc('update_my_profile', { p_display_name: 'Ghost of Largashbur' })).error, 'a fallen member still changes their own name');
  ok((await ghostSelf.from('announcements').select('id')).error === null, 'and still reads the notice board');
  ok(!(await nick.api('admin.update', { id: ghost.id, tags: ['kinsmen'] })).error && (await nick.rpc('member_admin_list')).data.find((m) => m.id === ghost.id).tags.join() === 'kinsmen', 'taking the Deceased tag away brings them back');
}

console.log('0.2.5: roles');
{
  const first = await ugak.from('role_notes').select('*');
  ok(!first.error && first.data.length === 0, 'members read the role descriptions (none written yet)');
  ok(!(await sharn.from('role_notes').upsert({ tag: 'blooded', about: "Sworn, proven in battle, and trusted with the clan's steel." })).error, 'an officer writes a description');
  const rn = (await velyn.from('role_notes').select('*')).data;
  ok(rn.length === 1 && rn[0].tag === 'blooded' && rn[0].updated_by === sharn.me, 'every member reads it, and who wrote it is recorded');
  ok(!(await gorza.from('role_notes').upsert({ tag: 'blooded', about: 'Proven.' })).error && (await ugak.from('role_notes').select('*')).data[0].about === 'Proven.' && (await ugak.from('role_notes').select('*')).data[0].updated_by === gorza.me, 'another officer rewrites it');
  ok((await ugak.from('role_notes').upsert({ tag: 'ally', about: 'x' })).error, 'a member cannot write one');
  ok((await ugak.from('role_notes').update({ about: 'hacked' }).eq('tag', 'blooded').select()).data.length === 0, 'nor change one');
  ok((await ugak.from('role_notes').delete().eq('tag', 'blooded').select()).data.length === 0, 'nor remove one');
  ok((await sharn.from('role_notes').upsert({ tag: 'daedric', about: 'x' })).error, 'only real tags have a description');
  ok((await sharn.from('role_notes').upsert({ tag: 'ally', about: 'x'.repeat(401) })).error, 'a description over 400 characters is refused');
  ok((await sharn.from('role_notes').upsert({ tag: 'ally', about: '   ' })).error, 'a blank description is refused');
  ok((await gorza.from('role_notes').delete().eq('tag', 'blooded').select()).data.length === 1 && (await ugak.from('role_notes').select('*')).data.length === 0, 'an officer hands a description back to the app');
}


console.log('bow mastery, and officers setting masteries through the database');
{
  const mine = await ugak.rpc('update_my_card', { p_bio: 'Hunter.', p_masteries: [{ skill: 'bow', level: 4 }, { skill: 'skinner', level: 2 }], p_timezone: null, p_availability: null });
  ok(!mine.error && mine.data.masteries[0].skill === 'bow' && mine.data.masteries[0].level === 4, 'a member claims the Bow mastery on their own card', mine.error?.message);
  ok((await velyn.from('profiles').select('masteries').eq('id', ugak.me).single()).data.masteries[0].skill === 'bow', 'and everyone sees it');
  ok((await ugak.rpc('update_my_card', { p_bio: '', p_masteries: [{ skill: 'bow', level: 1 }, { skill: 'bow', level: 2 }], p_timezone: null, p_availability: null })).error, 'Bow twice is refused like any other');
  const set = await sharn.rpc('set_member_masteries', { p_id: velyn.me, p_masteries: [{ skill: 'bow', level: 5 }, { skill: 'one_handed', level: 1 }] });
  ok(!set.error && set.data.masteries.length === 2 && set.data.masteries[0].skill === 'bow', "an officer sets another member's masteries, Bow included", set.error?.message);
  ok((await ugak.from('profiles').select('masteries, bio').eq('id', velyn.me).single()).data.masteries[0].level === 5, 'and the change is there for everyone');
  ok((await ugak.rpc('set_member_masteries', { p_id: velyn.me, p_masteries: [] })).error?.message.includes('officers'), "a Blooded member cannot set someone else's masteries this way");
  ok((await velyn.rpc('set_member_masteries', { p_id: velyn.me, p_masteries: [] })).error?.message.includes('officers'), 'nor their own, which goes through their own card');
  ok((await guest.rpc('set_member_masteries', { p_id: velyn.me, p_masteries: [] })).error, 'guests are refused');
  ok((await sharn.rpc('set_member_masteries', { p_id: nick.me, p_masteries: [{ skill: 'bow', level: 5 }] })).error?.message.includes('Forgemaster'), "an officer cannot set a Forgemaster's masteries");
  ok((await sharn.rpc('set_member_masteries', { p_id: gorza.me, p_masteries: [{ skill: 'bow', level: 5 }] })).error?.message.includes('Chieftain'), "nor the Chieftain's, unless they are the Chieftain or a Forgemaster");
  ok(!(await nick.rpc('set_member_masteries', { p_id: gorza.me, p_masteries: [{ skill: 'bow', level: 3 }] })).error, "the Forgemaster can set the Chieftain's");
  for (const [bad, why] of [[[{ skill: 'dragon_rider', level: 1 }], 'an unknown mastery'], [[{ skill: 'bow', level: 9 }], 'a level above 5'],
    [[{ skill: 'bow', level: 1 }, { skill: 'bow', level: 2 }], 'the same skill twice'], [['bow', 'cook', 'miner', 'tailor'].map((skill) => ({ skill, level: 1 })), 'four masteries'], [{ skill: 'bow', level: 1 }, 'a list that is not a list']]) {
    ok((await sharn.rpc('set_member_masteries', { p_id: velyn.me, p_masteries: bad })).error, `an officer is refused ${why}`);
  }
  ok((await ugak.from('profiles').select('masteries').eq('id', velyn.me).single()).data.masteries.length === 2, 'refused changes leave the masteries as they were');
  ok((await sharn.rpc('set_member_masteries', { p_id: velyn.me, p_masteries: null })).data?.masteries.length === 0, 'an officer can clear them');
  ok((await sharn.rpc('set_member_masteries', { p_id: '00000000-0000-4000-8000-000000000000', p_masteries: [] })).error, 'a member who does not exist is refused');
  ok((await nick.from('audit_log').select('*').eq('action', 'member.masteries_set')).data.length >= 3, 'each change is written to the audit log');
}


console.log('passage of honor');
{
  const born = await nick.api('admin.create', { username: 'Fallen2', display_name: 'Yamarz the Unlucky', tags: ['kinsmen', 'deceased'] });
  const id = born.data?.profile?.id;
  ok((await nick.rpc('member_admin_list')).data.find((m) => m.id === id)?.death_honor === '', 'a fallen card starts with no passage of honor');
  const rec = await sharn.rpc('set_death_record', { p_id: id, p_honor: '  He held the line so the clan could bar the gate.  ', p_cause: 'A giant.', p_date: '2026-10-02', p_unknown: false });
  ok(rec.data?.death_honor === 'He held the line so the clan could bar the gate.' && rec.data.death_cause === 'A giant.' && rec.data.death_date === '2026-10-02',
    'an officer writes the passage of honor with the cause and the date', rec.error?.message);
  ok((await velyn.from('profiles').select('death_honor').eq('id', id).single()).data.death_honor.startsWith('He held the line'), 'every member reads it');
  const old = await gorza.rpc('set_death_record', { p_id: id, p_cause: 'A giant, at the gate.', p_date: null, p_unknown: true });
  ok(old.data?.death_honor === 'He held the line so the clan could bar the gate.' && old.data.death_cause === 'A giant, at the gate.' && old.data.death_date_unknown === true,
    'a copy of the app from before the passage still saves the rest and leaves the passage alone', old.error?.message);
  ok((await sharn.rpc('set_death_record', { p_id: id, p_honor: 'x'.repeat(1001), p_cause: '', p_date: null, p_unknown: false })).error, 'a passage over 1000 characters is refused');
  ok(!(await sharn.rpc('set_death_record', { p_id: id, p_honor: 'x'.repeat(1000), p_cause: 'A giant.', p_date: null, p_unknown: false })).error, 'one of exactly 1000 is kept');
  ok((await ugak.rpc('set_death_record', { p_id: id, p_honor: 'Mine now', p_cause: '', p_date: null, p_unknown: false })).error, 'a member cannot write a passage of honor');
  ok((await guest.rpc('set_death_record', { p_id: id, p_honor: 'x', p_cause: '', p_date: null, p_unknown: false })).error, 'nor a guest');
  const g = await guest.from('profiles').select('death_honor');
  ok(g.error || g.data.length === 0, 'guests read no passages');
  const cleared = await sharn.rpc('set_death_record', { p_id: id, p_honor: '   ', p_cause: 'A giant.', p_date: null, p_unknown: false });
  ok(cleared.data?.death_honor === '' && cleared.data.death_cause === 'A giant.', 'a passage can be taken back out');
  await nick.api('admin.delete', { id });
}

console.log('0.4.0: clan tags');
{
  const pw = 'ClanPass12345';
  const mk = async (username, tags, clans, by = nick) => {
    const r = await by.api('admin.create', { username, display_name: username, tags, password: pw, ...(clans ? { clans } : {}) });
    if (r.error) throw new Error(`create ${username}: ${r.error}`);
    return r.data.profile;
  };
  const clansOf = async (id) => (await nick.from('profiles').select('clans').eq('id', id).single()).data.clans.join();
  ok(await clansOf(ugak.me) === 'black_tusks' && await clansOf(nick.me) === 'black_tusks', 'everyone here before the Scorned is a Black Tusk');
  const zp = await mk('Zgor', ['chieftain'], ['scorned']);
  await mk('Morra', ['wise_woman'], ['scorned']); await mk('Brag', ['right_tusk'], ['scorned']); await mk('Shum', ['blooded'], ['scorned']);
  const zgor = await login('zgor', pw), morra = await login('morra', pw), brag = await login('brag', pw), shum = await login('shum', pw);
  ok(zp.clans.join() === 'scorned', 'the Forgemaster adds a member to the Scorned');
  const twin = await mk('Twin', ['blooded'], ['scorned', 'black_tusks']);
  ok(twin.clans.join() === 'black_tusks,scorned', 'a member can carry both clan tags');
  ok((await nick.api('admin.create', { username: 'NoClan', tags: [], clans: [] })).error?.includes('at least one'), 'every member belongs to a clan');
  ok((await nick.api('admin.create', { username: 'Elsewhere', tags: [], clans: ['stormcloaks'] })).error?.includes('Unknown clan'), 'only the two clans exist');

  // officers add to their own clan
  const byZ = await zgor.api('admin.create', { username: 'Scornling', tags: ['unblooded'] });
  ok(byZ.data?.profile?.clans.join() === 'scorned', 'a member added by the Scorned Chieftain joins the Scorned', byZ.error);
  const byS = await sharn.api('admin.create', { username: 'Tuskling', tags: ['unblooded'] });
  ok(byS.data?.profile?.clans.join() === 'black_tusks', 'one added by the Black Tusk Wise Woman joins the Black Tusks', byS.error);
  ok((await sharn.api('admin.create', { username: 'Spy', tags: [], clans: ['scorned'] })).error?.includes('own clan'), 'an officer cannot add a member to the other clan');

  // officers manage their own clan only
  ok((await zgor.api('admin.update', { id: ugak.me, display_name: 'Renamed' })).error?.includes('own clan'), "the Scorned Chieftain cannot edit a Black Tusk");
  ok((await zgor.api('admin.delete', { id: byS.data.profile.id })).error?.includes('own clan'), 'nor remove one');
  ok((await gorza.api('admin.update', { id: shum.me, tags: ['kinsmen'] })).error?.includes('own clan'), 'the Black Tusk Chieftain cannot edit a Scorned member');
  ok(!(await zgor.api('admin.update', { id: shum.me, tags: ['blooded'], display_name: 'Shum the Grim' })).error, 'the Scorned Chieftain edits a Scorned member');
  ok(!(await zgor.api('admin.update', { id: twin.id, display_name: 'Twin Tusk' })).error && !(await yatul.api('admin.update', { id: twin.id, display_name: 'Twin' })).error, 'officers of either clan edit a member of both');
  ok((await zgor.rpc('set_member_masteries', { p_id: ugak.me, p_masteries: [] })).error?.message.includes('own clan'), 'nor can masteries be set across clans');
  const fallenBT = await mk('Oldbones', ['blooded', 'deceased'], ['black_tusks']);
  ok((await zgor.rpc('set_death_record', { p_id: fallenBT.id, p_cause: 'x', p_date: null, p_unknown: false })).error?.message.includes('own clan'), 'nor a death record');
  await nick.api('admin.delete', { id: fallenBT.id });
  const zl = (await zgor.rpc('member_admin_list')).data;
  ok(zl.length >= 10 && zl.find((m) => m.id === ugak.me).username === null && zl.find((m) => m.id === shum.me).username === 'Shum', "an officer sees every member, but only their own clan's sign-in names");
  ok((await sharn.api('admin.delete', { id: byS.data.profile.id })).error?.includes('Chieftain') && (await morra.api('admin.delete', { id: byZ.data.profile.id })).error?.includes('Chieftain'),
    'only Chieftains remove members, not the Wise Women');
  ok(!(await zgor.api('admin.delete', { id: byZ.data.profile.id })).error && !(await gorza.api('admin.delete', { id: byS.data.profile.id })).error, 'each Chieftain removes members of their own clan');

  // only the Forgemaster sets clan tags
  ok((await gorza.api('admin.update', { id: ugak.me, clans: ['scorned'] })).error?.includes('Forgemaster'), 'a Chieftain cannot change clan tags');
  ok((await zgor.api('admin.update', { id: shum.me, clans: ['scorned', 'black_tusks'] })).error?.includes('Forgemaster'), 'nor can the Scorned Chieftain');
  ok(!(await gorza.api('admin.update', { id: ugak.me, clans: ['black_tusks'], display_name: 'Ugak' })).error, 'sending the clan tags unchanged is fine');
  const moved = await nick.api('admin.update', { id: shum.me, clans: ['black_tusks', 'scorned'] });
  ok(moved.data?.profile?.clans.join() === 'black_tusks,scorned', 'the Forgemaster changes clan tags', moved.error);
  ok((await nick.api('admin.update', { id: shum.me, clans: [] })).error?.includes('at least one'), 'but never to none');
  await nick.api('admin.update', { id: shum.me, clans: ['scorned'] });
  const direct = await shum.from('profiles').update({ clans: ['black_tusks'] }).eq('id', shum.me).select('id');
  ok(direct.error || direct.data.length === 0, 'a member cannot write clan tags straight to the database');
  let badClan = false;
  try { await raw.query(`update public.profiles set clans = array['dawnguard'] where id = $1`, [shum.me]); } catch { badClan = true; }
  ok(badClan, 'the database refuses a clan that does not exist');

  console.log('0.4.0: one Forgemaster');
  ok((await nick.api('admin.create', { username: 'Smith2', tags: ['forgemaster'] })).error?.includes('only one Forgemaster'), 'not even the Forgemaster makes another Forgemaster');
  ok((await nick.api('admin.update', { id: gorza.me, tags: ['chieftain', 'forgemaster'] })).error?.includes('only one Forgemaster'), 'nor hands the tag to an existing member');
  ok((await nick.api('admin.update', { id: nick.me, tags: ['right_tusk'] })).error?.includes('only one Forgemaster'), 'nor takes it from themselves');
  ok((await zgor.api('admin.update', { id: shum.me, tags: ['forgemaster'] })).error, 'no officer can hand it out');
  ok(!(await nick.api('admin.update', { id: nick.me, tags: ['right_tusk', 'forgemaster', 'blooded'] })).error, "the Forgemaster's other tags still change");
  let dbRefused = 0;
  try { await raw.query(`update public.profiles set tags = array['blooded','forgemaster'] where id = $1`, [ugak.me]); } catch { dbRefused++; }
  try { await raw.query(`update public.profiles set tags = array['right_tusk'] where id = $1`, [nick.me]); } catch { dbRefused++; }
  ok(dbRefused === 2, 'the database itself refuses giving or taking the tag');
  await nick.api('admin.update', { id: nick.me, tags: ['right_tusk', 'forgemaster'] });

  console.log('0.4.0: notice boards');
  const np = async (c, clan, title) => (await c.from('announcements').insert({ title, clan }).select().single());
  ok(!(await np(zgor, 'scorned', 'Scorned muster')).error, 'the Scorned Chieftain posts on the Scorned board');
  ok(!(await np(brag, 'black_tusks', 'From Narzulbur')).error, 'a Scorned Right Tusk posts on the Black Tusk board');
  ok(!(await np(yatul, 'scorned', 'From Largashbur')).error, 'a Black Tusk Left Tusk posts on the Scorned board');
  ok((await np(shum, 'scorned', 'no')).error, 'a Scorned Blooded cannot post');
  ok((await np(nick, 'dawnguard', 'no')).error, 'there are only two boards');
  const board = async (c, clan) => (await c.from('announcements').select('title').eq('clan', clan)).data.map((r) => r.title);
  ok((await board(ugak, 'scorned')).includes('Scorned muster') && (await board(shum, 'black_tusks')).includes('From Narzulbur'), "every member reads both clans' boards");

  console.log('0.4.0: the mines');
  const md = async (c, clan, title) => (await c.from('mine_deals').insert({ author_id: c.me, title, clan, visibility: 'all' }).select().single());
  const bt = (await md(yatul, 'black_tusks', 'Largashbur iron')).data;
  ok(bt?.id, 'a Black Tusk Left Tusk keeps the Mine of the Black Tusks');
  ok((await md(zgor, 'black_tusks', 'no')).error, 'the Scorned Chieftain cannot post in the Mine of the Black Tusks');
  const sc = (await md(zgor, 'scorned', 'Gloombound ebony')).data;
  ok(sc?.id && !(await md(morra, 'scorned', 'Gloombound corundum')).error, 'the Scorned Chieftain and Wise Woman keep the Mine of the Scorned');
  ok((await md(shum, 'scorned', 'no')).error, 'a Scorned Blooded cannot');
  ok(!(await md(brag, 'scorned', 'Gloombound iron')).error, 'so does the Scorned Right Tusk: any Scorned officer');
  ok((await md(gorza, 'scorned', 'no')).error, 'nor the Black Tusk Chieftain');
  ok(!(await md(nick, 'scorned', 'Forge terms')).error && !(await md(nick, 'black_tusks', 'Forge terms')).error, 'the Forgemaster keeps both');
  ok((await zgor.from('mine_deals').update({ title: 'x' }).eq('id', bt.id).select()).data.length === 0, 'the Scorned cannot edit a Black Tusk mine deal');
  ok((await yatul.from('mine_deals').update({ title: 'x' }).eq('id', sc.id).select()).data.length === 0, 'nor the Black Tusks a Scorned one');
  ok((await yatul.from('mine_deals').update({ clan: 'scorned' }).eq('id', bt.id).select()).error, 'a deal cannot be moved into the other mine');
  ok((await zgor.from('mine_deals').delete().eq('id', bt.id).select()).data.length === 0 && (await morra.from('mine_deals').delete().eq('id', sc.id).select()).data.length === 1, 'each mine is cleared only by its own keepers');
  ok((await shum.from('mine_deals').select('title').eq('clan', 'black_tusks')).data.some((r) => r.title === 'Largashbur iron'), "a visitor reads the other clan's open deals");

  console.log('0.4.0: expansion goals');
  const scStages = (await shum.from('expansion_stages').select('id, title, sort').eq('clan', 'scorned').order('sort')).data;
  const scRes = (await shum.from('expansion_resources').select('*').in('stage_id', scStages.map((r) => r.id))).data;
  const ssum = (n) => scRes.filter((r) => r.name === n && r.in_total).reduce((t, r) => t + r.goal, 0);
  ok(scStages.length === 5 && scStages[4].title.startsWith('Stage 5') && scRes.every((r) => r.have === 0), 'the Scorned have their own five stages, starting at 0');
  ok(ssum('Gold') === 64500 && ssum('Iron Ingots') === 2380 && ssum('Steel Ingots') === 450 && ssum('Corundum') === 700 && ssum('Firewood') === 5150
    && ssum('Leather Strips') === 420 && ssum('Pelts (Any)') === 275 && ssum('Silver Ingots') === 8, 'their goals add up to the totals in their brief');
  const sGold = scRes.find((r) => r.name === 'Gold').id;
  const bGold = res.find((r) => r.name === 'Gold').id;
  const have = async (c, id, n) => (await c.from('expansion_resources').update({ have: n }).eq('id', id).select()).data?.length === 1;
  ok(await have(zgor, sGold, 500) && await have(morra, sGold, 600) && await have(brag, sGold, 650), 'the Scorned officers keep the Scorned goals');
  ok(!(await have(shum, sGold, 1)) && !(await have(gorza, sGold, 1)), 'a Scorned Blooded and the Black Tusk Chieftain cannot');
  ok(await have(gorza, bGold, 700) && await have(sharn, bGold, 800) && await have(yatul, bGold, 900), 'the Black Tusk officers keep the Black Tusk goals');
  ok(!(await have(ugak, bGold, 1)) && !(await have(zgor, bGold, 1)), 'a Black Tusk Blooded and the Scorned Chieftain cannot');
  ok(await have(nick, sGold, 0) && await have(nick, bGold, 0), 'the Forgemaster keeps both');
  ok((await zgor.from('expansion_stages').insert({ title: 'Sneaky stage', clan: 'black_tusks', sort: 9 })).error, "the Scorned cannot add a stage to the Black Tusks' goals");
  const ns = await zgor.from('expansion_stages').insert({ title: 'Stage 6: Shrine', clan: 'scorned', sort: 6 }).select().single();
  ok(ns.data?.id && (await zgor.from('expansion_stages').delete().eq('id', ns.data.id).select()).data.length === 1, 'but adds and removes their own');

  console.log('0.4.0: two Discord servers');
  for (const k of Object.keys(discordStub.byGuild)) delete discordStub.byGuild[k];
  discordStub.status = 200;
  ok(!(await nick.from('app_settings').upsert({ key: 'discord_guild_id', value: '111111111111111111' })).error
    && !(await nick.from('app_settings').upsert({ key: 'discord_guild_id_scorned', value: '222222222222222222' })).error, 'the Forgemaster saves both Server IDs');
  ok((await zgor.from('app_settings').upsert({ key: 'discord_guild_id_scorned', value: '1' })).error, 'no one else can');
  discordStub.byGuild['111111111111111111'] = { status: 200, body: { name: 'The Black Tusks', presence_count: 2, members: [
    { username: 'Ugak', status: 'online' }, { username: 'Twin', status: 'idle' }] } };
  discordStub.byGuild['222222222222222222'] = { status: 200, body: { name: 'The Scorned', presence_count: 2, members: [
    { username: 'Zgor', status: 'online', activity: { name: 'The Elder Scrolls V: Skyrim Special Edition' } }, { username: 'twin', status: 'online', activity: { name: 'The Elder Scrolls V: Skyrim Special Edition' } }] } };
  const two = (await shum.api('discord.presence')).data;
  const names = two?.members?.map((m) => m.name.toLowerCase()).sort().join();
  ok(two?.ok && names === 'twin,ugak,zgor', 'who is online comes from both servers, each member once', JSON.stringify(two)?.slice(0, 200));
  ok(two.members.find((m) => m.name.toLowerCase() === 'twin').game?.includes('Skyrim'), 'a member in both counts as in the realm if either server says so');
  ok(two.servers.length === 2 && two.servers.every((x) => x.configured && x.ok) && two.server === 'The Black Tusks and The Scorned', 'each server reports its own state');
  await nick.from('app_settings').upsert({ key: 'discord_guild_id_scorned', value: '333333333333333333' });
  discordStub.byGuild['333333333333333333'] = { status: 403, body: {} };
  const half = (await shum.api('discord.presence')).data;
  ok(half?.ok && half.members.length === 2 && half.servers.find((x) => x.clan === 'scorned').reason?.includes('Server Widget'), 'one server down still shows the other, and says what is wrong');
  await nick.from('app_settings').delete().eq('key', 'discord_guild_id');
  await nick.from('app_settings').delete().eq('key', 'discord_guild_id_scorned');
  ok((await shum.api('discord.presence')).data?.configured === false, 'with neither set, presence is not configured');

  for (const c of [zgor, morra, brag, shum]) await nick.api('admin.delete', { id: c.me });
  await nick.api('admin.delete', { id: twin.id });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
