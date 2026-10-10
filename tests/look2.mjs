import { boot } from './harness.mjs';
const t = await boot();
const raw = t.backend.raw;
const id = async (u) => (await raw.query(`select id from profiles where username=$1`, [u])).rows[0].id;
const nick = await id('nick'), ugak = await id('ugak'), gorza = await id('gorza'), velyn = await id('velyn');
await raw.query(`insert into announcements (title, body, author_id, expires_at) values ($1,$2,$3, now() + interval '3 days')`, ['Moot at the longhouse', 'All Blooded gather at the fire on Sundas after dusk.\n\nBring your grievances and speak them plainly.', gorza]);
await raw.query(`insert into announcements (title, body, author_id, visibility, audience) values ($1,$2,$3,'specific',$4)`, ['Escort for the ore cart', 'Ugak, you ride with the cart to Riften at first light.', nick, `{${ugak}}`]);
await raw.query(`insert into announcements (title, body, author_id, visibility) values ($1,$2,$3,'draft')`, ['Wall raising plan', 'Draft of the work crews for stage one.', nick]);
await raw.query(`insert into mine_deals (title, body, author_id) values ($1,$2,$3)`, ['Iron for the Rift guard', 'Forty iron ingots each week to the Riften guard, paid at 9 septims an ingot. Agreed by the Chieftain.', gorza]);
await raw.exec(`update expansion_resources set have = (goal * 0.4)::int where name in ('Gold','Firewood'); update expansion_resources set have = goal where name = 'Leather Strips' and goal = 100`);
await raw.query(`insert into ore_markers (ore,x,y,kind,place,note,status,created_by,veins) values
 ('iron',145000,-98000,'mine','Largashbur','Two veins by the entrance','approved',$1,2),('orichalcum',146500,-99500,'mine','Largashbur','','approved',$1,1),
 ('ebony',118000,-20000,'mine','Gloombound Mine','Deep in the lower tunnels','approved',$1,5),('gold',-150000,5000,'mine','Kolskeggr Mine','','approved',$1,3),
 ('silver',-170000,14000,'surface','Markarth','','approved',$1,1),('moonstone',60000,90000,'surface','','','approved',$1,1),('corundum',20000,-30000,'surface','','','approved',$1,1),
 ('malachite',130000,-60000,'cave','Steamscorch Mine','','approved',$1,2),('quicksilver',25000,110000,'mine','Quicksilver Mine','','approved',$1,2),('salt',-60000,112000,'surface','Solitude','On the rocks below the arch','approved',$1,1),
 ('iron',100000,-90000,'surface','','Saw it from the road, east of the lake','pending',$2,1)`, [nick, ugak]);
await raw.query(`update profiles set discord_name = username`);
await raw.query(`insert into app_settings (key, value) values ('discord_guild_id', '"123456789012345678"')`);
t.backend.discordStub.body = { name: 'Black Tusks', presence_count: 3, members: [{ username: 'nick', status: 'online', game: { name: 'The Elder Scrolls V: Skyrim Special Edition' } }, { username: 'gorza', status: 'online', game: { name: 'The Elder Scrolls V: Skyrim Special Edition' } }, { username: 'ugak', status: 'idle' }] };
await raw.query(`update profiles set tags = tags || '{deceased}' where username = 'velyn'`);

const which = process.argv.slice(2);
const want = (n) => !which.length || which.includes(n);
const d = await t.open(); await t.signIn(d, 'nick');
const go = async (page, route, wait = 900) => { await page.goto(t.base + '#' + route); await page.waitForTimeout(wait); };
if (want('members')) { await go(d, '/members'); await t.shot(d, 'members'); await d.getByText('Ugak', { exact: true }).click(); await d.waitForTimeout(300); await d.getByRole('button', { name: 'Show current password' }).click().catch(() => {}); await d.waitForTimeout(400); await t.shot(d, 'member-card'); }
if (want('notices')) { await go(d, '/notices'); await t.shot(d, 'notices'); await d.getByRole('button', { name: 'Post a notice' }).click(); await d.waitForTimeout(300); await d.getByText('Chosen members only').click(); await t.shot(d, 'notice-editor'); await d.keyboard.press('Escape'); await d.getByRole('tab', { name: 'Change log' }).click(); await d.waitForTimeout(400); await t.shot(d, 'changelog'); }
if (want('mine')) { await go(d, '/mine'); await t.shot(d, 'mine'); }
if (want('expansion')) { await go(d, '/expansion'); await d.screenshot({ path: 'tests/shots/expansion.png', fullPage: true }); }
if (want('map')) { await go(d, '/map', 2500); await t.shot(d, 'map'); await d.locator('.pendrow').first().click(); await d.waitForTimeout(1800); await t.shot(d, 'map-pending'); }
if (want('ledger')) {
  await raw.query(`insert into ledger_entries (item_key, tier, price, price_note) values ('skyrim.esm:05ACE4', 1, 9, 'Per ingot. Allies pay 11.'), ('skyrim.esm:013957', 3, 1400, ''), ('skyrim.esm:071CF3', 1, 4, '')`);
  await go(d, '/ledger', 1800); await t.shot(d, 'ledger');
  await d.getByLabel('Filter by name').fill('iron ingot'); await d.waitForTimeout(400); await d.locator('.lrow').first().click(); await d.waitForTimeout(500); await t.shot(d, 'ledger-item');
  await d.getByLabel('Filter by name').fill('orcish'); await d.getByRole('button', { name: 'Apparel' }).click(); await d.waitForTimeout(400); await d.getByText('Orcish Armor', { exact: true }).first().click(); await d.waitForTimeout(400); await t.shot(d, 'ledger-armor');
  await d.getByRole('button', { name: 'Edit' }).click(); await d.waitForTimeout(400); await t.shot(d, 'ledger-edit'); await d.keyboard.press('Escape');
}
if (want('code')) { await go(d, '/code'); await t.shot(d, 'code'); await go(d, '/oath'); await t.shot(d, 'oath'); }
if (want('phone')) {
  const m = await t.open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await t.signIn(m, 'ugak');
  for (const r of ['members', 'notices', 'expansion', 'map', 'code', 'ledger']) { await go(m, '/' + r, r === 'map' ? 2500 : 1200); await t.shot(m, 'phone-' + r); }
  await m.locator('.lrow').nth(3).click(); await m.waitForTimeout(500); await t.shot(m, 'phone-ledger-item');
}
console.log('errors:', t.errors);
await t.stop(); process.exit(0);
