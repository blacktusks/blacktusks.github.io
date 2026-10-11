# Black Tusk Companion

A companion app for the Black Tusk clan of Largashbur on the Daedric Online Skyrim roleplay server. It runs in any browser and installs to a phone's home screen, where it opens full screen like a native app.

**Live site:** https://blacktusks.github.io/

The repository is named `blacktusks.github.io` inside the `blacktusks` GitHub organisation, which is what gives the site that address.

Unofficial fan project. Not affiliated with Bethesda Softworks, ZeniMax Media or Daedric Online.

## What is in it

| Screen | Who can change it |
| --- | --- |
| Code of Mauloch | Fixed text. Open to guests. |
| Black Tusk Oath | Fixed text, with the member's own name in it, bold and with a light passing over it. |
| Notice Board: announcements | Officers: Chieftain, Right Tusk, Left Tusk, Wise Woman, Forgemaster. Each notice can go to everyone, to chosen members, or stay a private draft, and can take itself down after a set time. |
| Notice Board: change log | Forgemaster only. Each entry folds shut; the newest starts open. |
| Members | Every member has a card they fill in themselves: a bio (500 characters), up to three masteries with a level from 0 to 5, and the hours of the week they are usually free, shown to each reader in their own time zone (the card says so). Every card opens as members see it; an Edit button, shown only to those allowed, opens the form. Officers (Chieftain, Right Tusk, Left Tusk, Wise Woman, Forgemaster) add, edit and remove members and their tags, and can set another member's masteries (not their bio or hours). Only the Forgemaster can view or set another member's password, hand out the Forgemaster tag, or change a sign-in name. Only the Chieftain or a Forgemaster can change the Chieftain's account. Members change their own display name, Discord name and password. |
| Profile | The member's own card, straight from the main menu: the same pop-up as their name on the Members screen. |
| Deceased | The same list as Members, over the members who carry the Deceased tag (they are listed here and not under Members). The fallen have no online status. A fallen card has no bio and no hours; it carries a passage of honor, a cause of death and a date of passing, all written by officers. The date is empty until one is entered, or reads UNKNOWN. Anyone reading the card can press Pay Respect: green praying hands and a fire rise from the button and fade (nothing is saved). |
| Roles | A short description of every tag. Officers can put the clan's own words in place of any of them. |
| Mine of the Black Tusks | Officers. Same visibility choices as notices. |
| Expansion Goals | Officers edit stages and update what has been gathered. Each stage shows its own progress bar. |
| Mining Map | Any member pings an ore vein. Officers approve or deny pings; their own markers go straight on the map. |
| Pricing Ledger | Officers set tier, clan price, notes and a picture for any item. Every item starts with a picture rendered from its own game model. On a phone, an open item can be swiped left or right (or stepped with the arrows above its picture) to the next or previous item in the list. |

Tags work like Discord roles and a member can hold several. The developer tag is called **Forgemaster**. A member whose character has died gets the **Deceased** tag: they keep their account and full access, and move from the Members screen to the Deceased screen.

## How it is put together

- **App**: React and Vite, published as static files to GitHub Pages. `vite-plugin-pwa` makes it installable and lets the app shell open offline.
- **Backend**: a free Supabase project. Supabase Auth holds the accounts; Postgres row level security enforces every permission in the table above; one Edge Function (`clan-api`) handles account management and reads the clan Discord's Server Widget.
- **Game data**: `public/data` (about 4,000 items, their recipes and 402 map places), `public/map` (the world map) and `public/items` (a picture of every item) are built from the game files of a Daedric Online install by the scripts in `tools/`.
- **Starting up**: a loading screen written into `index.html` covers the app until the fonts, the member's session and the first screen's pictures are all in (`src/lib/splash.ts`). The main menu, the map and the ledger are pinned to the screen and sized from their own box, so nothing sits off-screen on a phone. Opened from the home screen, an iPhone can start the app with a page that is shorter than the screen by the height of the status bar (WebKit bug 254868); a small script at the top of `index.html` spots the home-screen app and sizes every full-screen layer from the screen itself (`--full`), so no band is left along the bottom.

## Setting up the backend (once)

Use a Supabase project made for this app alone: the migration takes away the default access to every table in the `public` schema and grants back only what the app uses.

1. Create a project at supabase.com (free plan).
2. **SQL Editor**: paste and run each file in `supabase/migrations`, in number order (`0001_...` to `0007_...`). They are safe to re-run.
3. **Authentication > Sign In / Providers**: turn off "Allow new users to sign up". Leave "Confirm email" on. Every account is made by the app with its email already confirmed, so nothing needs it off, and leaving it on stops a member changing their own sign-in.
4. **Edge Functions**: deploy `supabase/functions/clan-api` (`supabase functions deploy clan-api --no-verify-jwt`, or paste `index.ts` into a new function named `clan-api` in the dashboard). Then open the function's **Settings** and turn **off** "Verify JWT with legacy secret": that check only understands Supabase's old API keys, and the function already verifies every caller against Supabase Auth itself.
5. **Edge Functions > Secrets**: add `VAULT_KEY`, 32 random bytes in base64. Generate one with `openssl rand -base64 32` (PowerShell: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`). Keep a copy somewhere safe: without it the saved password copies cannot be read.
6. Create the first Forgemaster. In **Authentication > Users**, add a user with the email `yourname@blacktusk.invalid` and a password, with "Auto Confirm User" on. Then in the SQL Editor:

   ```sql
   insert into public.profiles (id, username, display_name, tags, must_change_password)
   select id, 'YourName', 'Your Name', array['right_tusk', 'forgemaster'], true
   from auth.users where email = 'yourname@blacktusk.invalid';
   ```

   The first sign-in asks for a new password, which also starts the saved copy for that account. Every other account is made inside the app from the Members screen.
7. `.env.production` holds the project URL and the **publishable** key (`sb_publishable_...`, from **Project Settings > API Keys**). Both are safe to commit: access is decided by the database rules, not by hiding the key. Use the publishable key rather than the legacy `anon` key, which Supabase is retiring.

Members sign in with a name. It keeps the capitals it was given (`Grug`), but capitals never matter when signing in. Behind the scenes Supabase sees the lower-case `name@blacktusk.invalid`. `.invalid` is a reserved ending that can never receive mail, so nobody can trigger a password-reset email for a member. If Supabase ever refuses that ending, set `LOGIN_EMAIL_DOMAIN` (function secret) and `VITE_LOGIN_EMAIL_DOMAIN` (`.env.production`) to a domain you own.

## Publishing

Once, in the repository on GitHub: **Settings > Pages > Source: GitHub Actions**.

After that, every change to `main` is built and published by `.github/workflows/deploy.yml`. There are two ways to change `main`:

- **With git**: push as usual.
- **Without git**: on the repository page choose **Add file > Upload files**, drop in a zip of the whole project and commit. The workflow unpacks the zip over the repository, removes it, then builds and publishes. Small text fixes can also be made with the pencil icon on any file. The `.github` folder is never taken from a zip. A zip without `public/map` or `public/items` keeps the map and pictures already in the repository, which keeps everyday zips to about 2 MB. Item pictures are uploaded on their own as `pictures-1.zip`, `pictures-2.zip` and so on; their `.webp` files are added to `public/items`.

## Day to day

- **Add a member**: Members > Add member. The app shows a temporary password once; the member must choose their own at first sign-in.
- **Forgotten password**: the Forgemaster opens the member in Members and uses Show current password or Set password. Every view is written to the audit log (`audit_log` table). Setting a password signs that member out on every device.
- **Staying signed in**: with "Stay signed in" ticked on the sign-in screen, a device remembers the member until they sign out. Unticked, they are signed out when the app or tab is closed. Changing a password signs the member out everywhere else.
- **Online status**: Members > Discord link (Forgemaster). Someone who can manage the clan Discord turns on Server Settings > Engagement > Server Widget > Enable Server Widget and copies the Server ID from that page; the Forgemaster pastes it into the app. Discord's widget names each online member by their **nickname in the clan server** (their own Discord name if they have none), not by username or Name#0000. A member whose nickname is the same as their name in the app is found with nothing more to do; anyone else puts that nickname on their profile as their Discord name. The Discord link pop-up lists who is online in Discord but matches no member. A member reads as in the realm when Discord reports them playing Skyrim; Discord cannot tell Daedric Online from single-player Skyrim, and members who hide their game activity read as in Discord only. Discord documents the names and online status in the widget but not the game being played, so that part could change without notice. Members who are online are listed first. Separately from Discord, the Members screen marks who has the companion app itself open ("On the app"): a signed-in app says so once a minute while it is in front of the member, and anyone heard from in the last two and a half minutes counts (`supabase/migrations/0004_app_presence.sql`).
- **New versions**: the app checks for a new build when it opens and when it comes back to the front, and switches to it by itself. If someone is in the middle of typing, a bar offers a Reload button instead.
- **Install on a phone**: iPhone: open in Safari, Share, Add to Home Screen. Android: open in Chrome, menu, Install app.

## About passwords and safety

- Sign-in passwords are hashed by Supabase Auth. Because the clan asked for the Forgemaster to be able to read a member's current password, a second copy is kept in the `password_vault` table, encrypted with AES-256-GCM under `VAULT_KEY`. The key lives only in the function's secrets; the table is closed to every app user; each copy is bound to its owner and padded to one length. Members are told on the change-password screen that the Forgemaster can read their password.
- The copy cannot drift from the real password. The function stages the new copy, and a database trigger moves it into place in the same transaction that changes the password. A password changed any other way drops the copy and asks the member to set one through the app.
- Anyone holding both the database and `VAULT_KEY` can read every password. Guard the Supabase account with a strong password and two-factor sign-in.
- Every permission in the table at the top is enforced in the database, not only in the screens. Who posted a notice, who pinged a vein and who reviewed it are stamped by the database and cannot be rewritten. Password views, password resets and member changes are written to `audit_log`, which only the Forgemaster can read.
- All sites published from one GitHub account or organisation share the address `<name>.github.io`, and so share browser storage. Keep the `blacktusks` organisation for this app alone: do not publish other sites from it.

## Working on it

```
npm install
npm run backend          # local stand-in for Supabase on :54321 (prints the two env values)
npm run dev              # the app on :5173
node tests/api.mjs       # 319 permission checks against real Postgres rules
node tests/e2e.mjs       # 188 browser checks of every screen and role
node tests/look_fit.mjs  # the main menu at 27 screen sizes: nothing off-screen, overlapping or scrolling
node tests/built.mjs     # production build served from a sub-path, as GitHub Pages does
```

The local backend (`dev/server.mjs`) runs the real migration and the real function against an in-process Postgres, so the permission rules under test are the ones that ship. Test accounts: `nick`, `gorza`, `ugak`, `sharn`, `velyn`, `yatul`, password `TestPass123`.

## Rebuilding the game data

When the server's mod collection changes, run on a PC with the collection installed (Python 3, no extra packages):

```
python tools/extract_game_data.py  <out folder>     # items, recipes, map markers
python tools/extract_heightmap.py  <out folder>     # terrain heights for map shading
```

Then, anywhere with Python, Pillow, NumPy and OpenCV:

```
python tools/build_catalog.py <out folder> public/data
python tools/build_map.py     # stitches and shades the world map (edit the paths at the top)
python tools/build_tiles.py map_shaded.png map_geo.json public/map
```

The extractors only read. Paths to the game folder are at the top of `extract_game_data.py`.

Left out of the ledger at the clan's request (see `unwanted` in `build_catalog.py`): keys, every book except spell tomes and the Code of Malacath, from Misc the clutter, dragon claws, untyped "Misc" items and every tool but the lockpick and linen wrap, and the generic enchanted variants of ordinary gear ("Iron Sword of Embers"; named enchanted items stay). Grindstone and workbench recipes are left out too: the realm has no weapon or armor improvement, and for the same reason the Blacksmith's potions are out. The dragon priests' gear is out as well: their masks (Miraak's and the Wooden Mask included), the armor sets named after them, Miraak's robes, boots and gloves, and the four armor pieces of Ahzidal's relics. So are the spiders in the scrolls, and the handful of items that have no model in the game files and so no picture.

### Item pictures

Each picture is a still of the item's own game model, rendered in Blender with no background. On the game PC, with Blender 5.2 and the PyNifly add-on (reads Skyrim's `.nif` models) installed:

```
python tools/bt_probe.py  <out folder>                           # each item's model and texture swaps (also the enchantment survey)
python tools/build_render_jobs.py public/data/items.json <out>/probe_items.json <jobs folder>
python tools/bt_assets.py <jobs.json> <stage folder>             # copies the models and textures out of the game's archives (about 15 GB)
python tools/bt_render_all.py <jobs.json> <stage folder> <renders folder>   # about half an hour on a mid-range graphics card
```

Then, anywhere with Python and Pillow:

```
python tools/pack_pictures.py <renders folder> public/items <jobs.json>      # 384px WebP, about 40 MB in all
python tools/build_catalog.py <raw folder> public/data <out>/probe_items.json # ties each item to its picture
```

Items that share a model and textures share a picture, so about 4,000 items need about 2,550 pictures. A model with an inventory marker is shown from the angle the game's own inventory uses; one without is shown from the front, or from above if it lies flat, and a weapon without one is shown flat-on. Anything long and thin is turned to run corner to corner, so it fills its square instead of standing in it as a sliver. Blood overlays, scabbards, glow cards and attachment markers are left out of the picture, and a texture slot whose file is missing is unplugged (a missing normal map otherwise turns the part into a flat pale shape). `build_catalog.py` stamps each picture's contents into `items.json`, and the app puts that stamp in the picture's address, so a picture that is drawn again replaces the copy a phone has kept. A handful of items have no model in the game files at all and keep the category mark instead.

## Credits

- The Elder Scrolls V: Skyrim and its item names, map data and terrain belong to Bethesda Softworks.
- Map textures come from **A Quality World Map** by IcePenguin, the map mod in the Daedric Online collection. Terrain shading and water are computed from the installed game's height data.
- Item and recipe data includes content from the mods in the Daedric Online collection and from the server's own plugins. Item pictures are renders of those games' and mods' own models and textures, read with **PyNifly** by BadDog.
- Clan banner art and the Largashbur image were supplied by the clan. `tools/grade_background.py` colours the Largashbur picture to match the banner; `tools/clean_banner.py` tidies the banner cut-out.
