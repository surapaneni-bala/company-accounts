# Handover — Company Accounts

Last updated **8 Oct 2026 (night)** · live app version **186414e5b5** (logins released) · script in this repo: **version 4**
(staff, files, vouchers — built and tested, **not released yet**: see [§6](#6-where-things-stand-open-items))
· the owner's real sheet was still on the FIRST script on 8 Oct — see [§6](#6-where-things-stand-open-items)

Read this first when picking the project up. The everyday user guide is [README.md](README.md).

**Where the project lives on the owner's Mac:** a clone of this repo in their home folder (the folder name is in
the assistant's memory notes, not here). Its `private/` folder is git-ignored and holds the owner's real data and plans: `private/PLAN.md` (the whole super-app plan, stages and the
owner's decisions — read it next), `private/brand/` (logo, letterhead), `private/old-files/` (their old lists).

> **This repository is public.** Never commit the owner's real data: names, amounts, suppliers,
> project names, company code or web app link. Use made-up values in tests and placeholders, and run
> the data check in [Publishing](#publishing) before every commit.

---

## 1. What this is

An offline-first app for a small construction company's money: expenses, money received per project,
and cash ↔ bank moves, in **USD and SSP** (South Sudanese Pound). It runs on iPhone, Android and
computers. Every device syncs through the company's **Google Sheet**, which also shows the readable
report.

| | |
|---|---|
| App (installable, works offline) | https://app.b-e-p-l.com/ (custom domain since 8 Oct 2026; the old github.io address redirects there) |
| Repository | https://github.com/surapaneni-bala/company-accounts (GitHub Pages serves `docs/`) |
| Sheet script to paste into Apps Script | https://app.b-e-p-l.com/sheet-script.txt (a copy of apps-script/Code.gs made by the build) |
| Check which app version is live | `https://app.b-e-p-l.com/version.json` (also names `home`, the app's address) |

**The owner** isn't technical, writes short messages (often with typos) and wants the UI simple enough
for a child. They use an **iPhone first**, then Android, plus a Mac with Chrome and Google Drive for
desktop. Explain fixes in plain words, give exact tap-by-tap steps, and show the numbers they should
see afterwards.

## 2. What it does today

- **Add expense / Money received / Add many at once.** Anyone can add. Date and time fill in by
  themselves.
- **Password needed for:** editing, deleting, changing the date (old entries), importing, settings,
  adding a phone, connecting or disconnecting the sheet. Once entered, it stays unlocked for 5
  minutes.
- **Who entered it** is stored on every entry. Edits and deletes are recorded in the **Change Log**.
  Deletes are *soft*: the entry is hidden and excluded from totals, but kept.
- **USD and SSP** have separate balances and are never added together.
- **💵 Cash and 🏦 Bank.** Every entry says which one it used. **Move money** records Cash → Bank or
  Bank → Cash; a move is not spending. Home shows **Total, Cash and Bank** for each currency.
- **Projects** have an optional project value, which gives "pending from client". **＋ Add existing
  expenses** moves many expenses into a project at once.
- **History** has three tabs (Out / In / Moves), with search and a month filter. Long text wraps on
  phones.
- **Import old entries** (Sheet tab): paste lines like
  `Date | Currency | Amount | Paid to | Reason | Location | Project | Paid from | Entered by`.
  *Paid from* is `Cash`, `Bank`, or `Cash → Bank` / `Bank → Cash` for a move. Lines already in the
  app are skipped. Imports **expenses and moves only**, not money received.
- **Google Sheet sync:** works offline, syncs when the internet returns, about every 2 minutes, and
  when the app is reopened.
- **Phones join with an invite link**, or with the web app link plus company code.
- **App updates:** a 🆕 **Update now** banner appears when a new version is online. **Check for update**
  is under Sheet tab → Settings.
- **Backup file** save and restore. Restoring also upgrades backups made by older versions.
- **Automatic repairs:**
  - "Cash → Bank" lines that an older importer saved as expenses become moves.
  - An expense that looks like the same money as a move gets a warning banner.

## 3. Code map

```
src/            app source, joined in this order by tools/build.js into one page
  shell.html    page, all CSS, markers <!--APP-->
  core.js       state, helpers, password/unlock, all screens and forms, saving, backup, sheet back-navigation
  calc.js       pay maths (30-day month, worker ledger, advances in USD), amounts in words, JPEG → one-page PDF
  files.js      photos/PDFs: IndexedDB copy + upload outbox, view/share, signature pad, slip/voucher renderer, letterhead
  sync.js       Google Sheet sync, invite links, join/connect, "update the script" help
  auth.js       logins, can()/RIGHTS per role, change requests (edit/delete/advance) + approvals, quick unlock (code / Face ID)
  staff.js      Staff tab: employees, pay salary / advance / final settlement, leaving, salary slip contents
  import.js     paste import (expenses + moves), repairs, double-count warning
  update.js     new-version check (version.json) and "Update now"
  main.js       button/form wiring, events, start-up, service-worker registration
  sw.js         offline copy (cache name = build version)
  manifest.webmanifest, icons (tools/make-icons.py draws them)
apps-script/Code.gs   the sync server that lives inside the Google Sheet (owner pastes it)
docs/           BUILT output, served by GitHub Pages — never edit by hand
docs/test/      the TEST COPY (node tools/build.js --test): own storage key bepl-test-v1, own offline-copy
                prefix test-accounts-, purple "TEST COPY" bar, home-screen name TEST
tools/          build, tests, local Google stand-in, real-Chrome checks
```
Build order (tools/build.js): core, calc, files, sync, auth, staff, import, update, main.

All the source files run as **one script** (they are concatenated). Top-level code must not *call* a
function or `const` defined in a later file. This once broke start-up: `inviteFromHash` was called
before it existed.

### Data on the device (`localStorage['company-accounts-v1']`)

```
S = { v: 2, company, pass: {salt, hash},              // SHA-256(salt|password), checked on the device
      expenses: [E], credits: [R], transfers: [T], projects: [P], log: [L], changes: [C], workers: [W], files: [F],
      seq: {E,R,T,P,B: n},  dev: 'K7Q',                // ids are PREFIX-DEV-0001, so devices never clash
      dirty: [ids waiting to sync], settingsU, link: {u, k, since, sheet} | null,
      lastBy, lastCur, lastLoc, lastMode, lastProject, lastExpProject, lastRate, lastBackup, createdAt, kindsSeen }
E = { id, cur:'USD'|'SSP', amount, paidTo, reason, location, project, mode:'Cash'|'Bank', at:'YYYY-MM-DDTHH:MM',
      manualDate, by, createdAt:'…:SS', batch, editedAt, editedBy, deleted, deletedBy, u }
      + rate (SSP for 1 USD, required on SSP entries from v4), and for a payment to an employee:
        worker (W id), pay: 'salary'|'advance'|'settlement', month 'YYYY-MM', daysOff, approval (C id of an approved advance)
R = { id, cur, amount, project (required), mode, note, at, rate, … }      T = { id, cur, amount, from, to, note, at, … }
W = { id, name, job, site, phone, wage, cur, start:'YYYY-MM-DD', idNo, status:'active'|'left', left, openingAmount, openingNote, … }
F = { id, fileId (Drive), name, mime, for (record id | 'settings'), type: voucher|receipt|slip|photo|attachment|profile|idphoto|letterhead, no (PV-…/RC-…), by, createdAt }
C = { id, kind, target, action?: 'delete'|'advance', before, after, text, by, at, status: waiting|approved|rejected, decidedBy }
P = { id, name, value, valueCur, by, createdAt, deleted }           L = { lid, at, action, id (the entry), text, by }
```

- Every change goes through `update(patch)`. It stamps changed records with `u` (time in ms) and
  queues them in `dirty` when the device is connected. When someone is signed in, **new** records also get
  `uid` (their login id); edits keep the original `uid`.
- The sign-in is stored separately in `localStorage['company-accounts-v1-login']` (never in backups):
  `{ token, user: {id, name, username, role}, check: {salt, hash} }` (check = their password, for offline
  unlock), or `{ out: true, why }` when signed out. `S.link` also keeps `v` (script version) and `logins`.
- Money is added up in whole cents (`cents()`).
- **Files** live in IndexedDB `<KEY>-files` (store `files`, key = F id, `{…meta, data: ArrayBuffer, pending}`), never in
  localStorage or backups. `keepFile()` puts a file there as *pending*; `uploadFiles()` (after every sync, needs script
  v4) sends `{op:'upload'}` and only then creates the F record, so the sheet never has a record without its file.
  Uploaded files stay as an offline copy; `dropFileCopies()` removes those (not pending ones) on sign-out.
- **Slips** are drawn on a 1240×1754 canvas (A4 at 150 dpi) over the letterhead (latest F of type `letterhead`,
  for `settings`, admins only; content kept between y 270 and 1570 to miss its header/footer), saved as JPEG and
  wrapped by `jpegToPdf()`. Voucher numbers come from `nextIds('PV'|'RC')`, so they are per device. Share happens
  from a separate tap (`shareShown`), because iPhone refuses the share sheet after a long async step.
- `accountOf(mode)` maps older payment types: Card/Cheque count as Bank, anything else counts as Cash.

### Sync protocol (app ↔ `Code.gs`)

- **Request:** `POST` the web app link with a **text/plain** body (no CORS preflight):
  `{ key, since, push: [{ id, k, u, d }] }`. The kinds `k` are E, R, P, L, S (settings), T, C, W, F.
  Records are pushed in `KIND_KEY` order (…, W, C, F): the sheet only takes a change request whose entry it has,
  and (from non-admins) a file record whose `for` record it has.
- **Files (script v4):** `{ op:'upload', name, mime, data: base64 }` → `{ ok, fileId }` (JPEG/PNG/PDF, ≤ 8 MB, into
  Drive folder "Company app files (do not share)/YYYY-MM"); `{ op:'file', id: <F id> }` → `{ ok, name, mime, data }`
  only if `view_()` lets this login see that F record. The owner runs `allowFiles()` once after pasting v4.
- **Reply:** `{ ok, version, seq, sheet, kinds, pull: [...] }`.
  - The newest copy of each id wins (by `u`).
  - `pull` returns every record whose `seq` is greater than `since`.
- **Opening the link with a GET** returns `{ ok, app, version, kinds }`. That's how the owner checks
  which script is running.
- **Master copy:** the hidden `_sync` tab, one row per record: `[id, kind, u, seq, json]`.
- **Readable tabs**, rebuilt in full after every change: Summary, Expenses, Money Received,
  Cash & Bank moves, Ledger, Change Log.
- **Older scripts:** if the sheet's script doesn't report a kind (an old script), the app keeps those
  records queued and shows "update the script" plus a **Show me how** guide.
- **Changing `Code.gs`:** bump `VERSION`, and tell the owner to paste it and use **Manage deployments
  → ✏️ → New version**. Not "New deployment", which creates a different link.
- **Deployment settings must be:** Execute as **Me**, Who has access **Anyone**. "Anyone with Google
  account" breaks the app, because the reply is a sign-in page and the browser treats it as a CORS
  failure. The app now detects this and says so.

### Logins (script version 3)

- Requests carry `token` (signed in) or `key` (company code, no login). Until an admin turns on **Require logins**
  (Script property `REQUIRE_LOGIN=1`), key-only requests keep full access exactly like version 2 — so old phones
  keep working during the switch. After it, they get `{ ok:false, code:'LOGIN' }`.
- Ops (`{ op, … }`): `setup` (first admin; needs the company code + a one-time **setup code** that the script
  writes only into the sheet's "Read me" tab, rows 11–12, and deletes after use; only when no users exist),
  `login`, `logout`, `password`, and admin-only `users`, `saveUser`, `require`. One error message for every
  failed sign-in. Passwords ≥ 8 characters. Wrong `password`-op guesses count towards the lock.
- Every pushed record must have a safe id (`SAFE_ID`), its id inside the record, the right shape (`SHAPES`, the
  same checks as the app's `VALID`) and keep its kind; damaged stored records are skipped when drawing tabs, and
  a drawing failure never stops a sync. For non-admins the sheet also caps a push at 200 records and 5000
  characters each, clamps `u` to now, and signs records with the login's name (`by`). The app sends at most
  200 records per sync and puts previously refused ones last.
- Hidden tabs: `_users` (salted SHA-256 ×1000 password hashes) and `_sessions` (only the hash of each token;
  ended after 30 days unused, on password reset, role change or block). 5 wrong passwords → 15-minute lock.
  The last active admin can't be demoted or blocked.
- Server rules (`view_` = what is sent, `allowed_` = what is accepted): admin everything; non-admins may only
  add new records (store keeper: own E and L; manager: E R T P L C) — the manager **never changes an existing one** — her edits are **change requests** (kind `C`:
  `{kind, target, before, after, text, by, status: waiting|approved|rejected, decidedBy}`) that an admin
  approves (the app then applies `after` to the target) or rejects; store keeper only their own E and L (by
  `uid`). Only admins receive the company password inside S. Refused records come back in `refused` and stay
  queued on the phone. A copy the sheet already has (same or older `u`) is ignored before any rule is checked,
  so a phone resending after a lost reply is never refused.
- Change requests carry `action`: none = an edit (only `EDITABLE` fields), `'delete'` (after = {}), `'advance'` (kind W,
  after = {amount, cur}; approving changes nothing — whoever pays then records the advance with `approval: <C id>`).
- Rights: `staff` (Staff tab) for admin and manager. The letterhead F goes to everyone (store keepers make vouchers);
  employees (W) and their files never go to store keepers.
- **App lock and the 4-digit code** (auth.js `pinPrompt`, `lockApp`; the `#lock` dialog is a full-screen code pad):
  `session.quick = {salt, hash, len: 4, cred, tries}` lives only in the sign-in slot. `lockApp()` runs at start-up, after
  every sign-in (a new session chooses its code first, then `offerBio()`), and when the page becomes visible again —
  except right after the app itself opened the camera / file picker / share sheet (`pickerAt`, consumed on return).
  The lock can't be closed (Escape and forced closes reopen it). 5 wrong codes → password (`session.check`, offline).
  `unlock()` (edits, deletes, settings) uses the pad when a code exists, else the password box. Face ID = WebAuthn
  platform credential made from a tap (`bioOn`), accepted when the assertion's UV flag is set; the code always works.
  `showMoney` (Accounts home balances and totals) is false until the code is given, and again after every lock.
- **Sections:** `tab = 'menu'` is the first page (Accounts / Employees tiles); `ACC_TABS` (home, hist, proj, sheet) show
  the bottom bar; `staff` is Employees. Without the `staff` right (store keeper) there is no menu. The header shows the
  section name and a round ‹ back button. `WELCOME` (core.js) is the title of the first screen.
- **Slip pages are as tall as the slip** (A4 width): the form is drawn on a see-through layer, then put on a page with the
  letterhead's top part and its bottom tenth (`LH_FOOT`, the address strip) at the foot; `pdfPages` sizes each page
  from its picture. Nothing is painted white over the letterhead, so its watermark shows (tints are see-through).
  One plain type family (`SANS`: Helvetica Neue / Arial / Roboto), no 800 weights; the app uses the phone's system font.
  The signature is cut to its ink (`inkOnly`) and set on its line with the name under it, never enlarged past a pen
  line (`placeSignature`). Stamps are kept as PNG; `cleanStamp` removes whatever background a stamp picture has
  (white paper, a black square from an old JPEG, or none) before it is drawn.
- **Slips** (files.js `renderSlip`) follow the company's paper voucher: ruled box with paid to | date, being payment
  for | amount in (SSP/USD boxes + amount), amount in words | paid from / rate, received by (signature) | photo, then
  prepared / checked / approved. It measures first and sets a long slip tighter so it ends above the letterhead
  footer (y ≤ 1570). The **company stamp** (F type `stamp`, for `settings`, admins only, sent to everyone like the
  letterhead) is drawn at the right of "approved"; `inkCircle()` finds its ring from the ink, and the date is written
  letter by letter along the arc at `place = {a, r, s}` (angle, radius and size as parts of the ring's radius;
  defaults `STAMP_PLACE` measured on the owner's stamp), adjustable in Settings → Company stamp and saved on the F record.
- **Statements** (files.js `renderStatement`, as many A4 pages as needed via calc.js `pdfPages`): info box, tables that
  carry on to the next page with their header, totals, a verdict box, and for a final settlement the signature, photo
  and stamp. Employee (`workerStatementSpec`: wages by month + payments with voucher numbers; final = signed "FULLY
  SETTLED", kept as F type `statement` for the employee, or as the settlement payment's slip), project (receipts) and
  payee (all payments to one "Paid to" name); the last two are made on demand and not kept.
- **Days not worked** (kind A `{ id, worker, date, note, by }`, one record per day): added by admins and the office
  manager (the sheet checks the employee exists; store keepers never receive them); `workerLedger(w, pays, today,
  absences)` takes each day in the counted range off its month (plus the `daysOff` number older salary payments
  carried). The salary screen lists the month's days and can add one; slips and statements print the dates. Deleting
  one: admin directly, office manager via a change request (`EDITABLE.A`). `KINDS_SEEN` = 4.
- **Employees added on an old date:** `clearedTo` (W) = salary settled up to that day (the ledger counts from the next
  day); "not fully paid" stores what was already paid as a negative `openingAmount` ("paid before the app").
  New employees need a job and an ID photo; the Site field is gone (old records keep it).
- **App icon / logo:** `python3 tools/make-icons.py` cuts the "B" mark from `private/brand/logo.png` (never committed)
  into `src/icon-*.png`; the in-app logo (`APP_LOGO`) is `icon-192.png`. Installed iPhones keep their old home-screen
  icon until the app is removed and added again — only do that when nothing is waiting to sync.
- `KINDS_SEEN` (sync.js) goes up whenever the app learns a new record kind (now 3: W and F); `migrate()` then sets `since` to 0
  once, because an older version skipped the unknown records but moved past them.
- Sync replies also carry `me` (the signed-in person) and `logins` (whether the company has logins).
- Phone side: signing in removes the company code from the phone; a store keeper's phone drops everything
  else it held (only when nothing is unsent). Being signed out by the sheet removes the company records from
  the phone unless some are unsent. The client only hides buttons — the sheet enforces every rule.

### The app's address (custom domain)

- `docs/CNAME` = `app.b-e-p-l.com`. DNS: a CNAME record `app` → `surapaneni-bala.github.io` in **Netlify**, which runs
  the b-e-p-l.com zone (nameservers dnsN.p09.nsone.net; registrar Namecheap). Never touch the nameservers in
  Namecheap: on 8 Oct the owner briefly added github.io there as a fifth nameserver, and it had to be removed.
- `version.json` carries `home`. A phone still on an old address shows a "moved" banner, and moving waits until
  nothing is unsent, because each address has its own storage.

### Offline copy and updates

- `sw.js` serves app files from its cache first. The cache name is the build version.
- When installing, it downloads every file with `cache: 'reload'`. **GitHub Pages sends
  `max-age=600`.** Without `reload`, an update can re-save the *old* page, which actually happened.
- `version.json` is never cached. The app compares it with `APP_VERSION` and shows "Update now".
- "Update now" clears only the app's saved files and the service worker (records stay in
  localStorage), then loads `?v=<new>`.
- A new service worker taking over reloads the page right away. If a form is open, the reload waits
  until it's closed.

## 4. Build, test, run locally

```bash
node tools/build.js                 # src/ → docs/ (index.html, sw.js, version.json, manifest, icons)
node tools/build.js --test          # src/ → docs/test/ (the practice copy; does NOT touch the live docs/ files)
node tools/test-sheet-server.js     # runs the real Code.gs on fake Google services (sync, balances, tabs)
node tools/test-auth.js             # logins and roles on the same fake Google services
node tools/test-invite.js           # invite links survive WhatsApp wrapping, double paste, encoding
```

**Try it with two devices, without Google:**
```bash
python3 -m http.server 8764 --bind 127.0.0.1 --directory docs
node tools/mock-server.js           # prints a company code; web app link = http://127.0.0.1:8770/exec
#   CODE=/path/to/other/Code.gs  → run another script version (e.g. an old one: git show <rev>:apps-script/Code.gs)
#   BLOCK=1                      → behave like a sheet whose access is not "Anyone"
```

- Open `http://127.0.0.1:8764/` and `http://localhost:8764/`. They are two different origins, so they
  act like **two separate devices**.
- Mock state is kept in `tools/.mock-state.json` (git-ignored). Delete it to start fresh.

**Offline and update checks need real Chrome** (headless, below). Note: since Oct 2026 the built-in browser pane
*does* run service workers — after a rebuild, reload twice (or call `registration.update()`), and the first visit
to `/test/` on an address that already has the real app reloads once while the test copy's offline copy takes over.
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-test about:blank &
node tools/pages-like-server.js docs 8795          # behaves like GitHub Pages (10-minute caching)
node tools/chrome-check.js http://127.0.0.1:8795/ expr.js            # e.g. expr.js: (async()=>({v:APP_VERSION}))()
node tools/chrome-check.js http://127.0.0.1:8795/ expr.js --offline  # network cut: the app must still open
```

To test an update, edit `APP_VERSION` in the served `index.html`, the cache name in `sw.js` and
`version.json`. Then run `--reload` and the reported version must change.

**Try files, staff and approvals end to end:** start `mock-server.js` and the docs server (both are in
`.claude/launch.json`: `mock-sheet` and `app`), set up a company + logins, then use `http://localhost:8764/`,
`http://127.0.0.1:8764/` and `http://localhost:8764/test/` as three phones (admin, manager, store keeper).
The fake Drive keeps uploaded files in `tools/.mock-state.json` (`drive.files[*].b64`): decode a PDF and convert it with
`sips -s format png x.pdf --out x.png` to look at a slip. WebAuthn can't be finished there (it waits for a finger).

**Test the owner's way:** at phone widths 375 px and 320 px, check that no text is cut off, no number
splits across lines, and there's no sideways scrolling. Before declaring a total correct, reproduce
the owner's exact data first. The double-counted-deposit bug was found that way.

## 5. Publishing

```bash
node tools/test-sheet-server.js && node tools/test-invite.js && node tools/build.js
git add -A
# data check — must print nothing (extend the list with any real names you have seen):
git grep --cached -nIE "real-supplier|real-person|real-project|real-amount"
git commit -m "fix: …" && git push
```

- GitHub Actions ("pages build and deployment") publishes `docs/` in about a minute. Confirm by
  comparing the live `version.json` with `docs/version.json`.
- Once, the job failed with a GitHub-side **500**. Fix with
  `gh run rerun <id> --failed` or `gh api -X POST repos/surapaneni-bala/company-accounts/pages/builds`.
- Commits use the `type: description` style. No attribution lines (the owner's setting).

## 6. Where things stand (open items)

**Version 4–6 — staff, files, vouchers, app lock, stamp, statements: BUILT AND TESTED, NOT RELEASED.** (Script v5 = v4 +
the company stamp; v6 = + `clearedTo` on employees and the `statement` file type; v7 = + days not worked (kind A);
the app needs ≥ 4 for files.) The source is on branch
**`staff`** (pushed); `main` got only `docs/test/` (commit e71d330, 9 Oct 2026), so https://app.b-e-p-l.com/test/ runs
d376856f61 with `/test/sheet-script.txt` v4, while the live app stays 186414e5b5 with `sheet-script.txt` v3. Keep it so
until release: the live app's "Show me how" must not hand the owner v4 before the Drive permission step. To update
the test copy: on `staff` build `--test`, commit, then on `main` `git checkout staff -- docs/test` and push.
- Checked: all five `tools/test-*.js` pass; end to end in the browser with the mock (admin, office manager, store
  keeper as three phones): SSP rate required; voucher, receipt and salary slip PDFs (on the real letterhead, read
  back from fake Drive and rendered); upload → F record → other phone downloads it; employee ledger matches a hand
  count; advance limit (admin confirm / manager request → approval → "Give it", capped at the approved amount);
  office-manager wage change, leaving and delete wait for approval and apply on approve; store keeper gets the
  letterhead but no employees; quick-unlock code (5 wrong → password); back to the project after an edit; History
  keeps its scroll; no sideways scroll at 375/320 px. The owner's old list entered in live 186414e5b5 and opened by
  the new code: identical totals to the cent (USD cash, bank, total; SSP; 71 expenses, 1 move).
- Not checkable here: Face ID / fingerprint (needs a real phone), the iPhone share sheet, camera capture.
- **Security review of v4 (independent reviewer, 8 Oct 2026).** Fixed, each with a check in `tools/test-files.js`:
  (HIGH) a forged file record could name any Drive file id and download it as the owner → the script keeps a hidden
  `_files` tab of the files it uploaded (with the uploader) and refuses any other fileId, and a non-admin may only
  name their own uploads; once a company has logins, company-code phones (old invite links) get no employees or
  files and can't upload/download; an edit request must leave its entry valid (refused otherwise); uploads must start
  with real JPEG/PNG/PDF bytes and get the extension of their type. In the app: quick-unlock setup always asks for
  the password itself; approval cards also show "Date set by hand" and "Moved to"; a phone signed out by the sheet
  keeps only its unsent records (and drops the company password copy). Accepted, tell the owner: the $100 advance
  limit and its approval are checked by the app, not the sheet (the office manager can record any expense anyway;
  every advance shows on the employee's page and in the Expenses tab with its rate); a store keeper can tell that an
  id like W-…-0001 exists (nothing about it).
- Owner's steps, in order: (1) make a backup in the app; (2) push only the test copy (`docs/test/`), or release
  everything once happy — see the plan; (3) in the **test** Google Sheet paste `/test/sheet-script.txt`, run
  `allowFiles` once (Drive permission), Manage deployments → ✏️ → New version; (4) on the iPhone test copy: Sheet →
  Settings → Letterhead; add an employee, pay a salary, sign, send the PDF to themselves on WhatsApp; set up quick
  unlock with Face ID; (5) then the same script steps on the real sheet, build, push, "Update now" on every phone.

**Stage 1 — logins: RELEASED 8 Oct 2026** (app 6497338b76, script v3 on main). The owner still has to paste
script v3 into the real sheet, update the app, set up logins with the setup code, give logins, and only then
switch on "Require logins". Earlier notes on how it was built: Code.gs version 3, `src/auth.js`, the test copy build.
Verified locally: all three test files pass; the owner's real old list, entered in the live version (5b2a803) and
opened by the new code, gives the same totals to the cent; old-version phones keep syncing with script v3 until
"Require logins"; store keeper / office manager / admin / blocked / signed-out flows checked in the browser.
Release order (nothing disturbs the live app until step 4):
1. ✅ Done 8 Oct 2026: the source is on branch **`logins`**; `main` got only `docs/test/` (plus the `.gitignore`
   rule for `private/`), so `main`'s sheet script — the link the live app's "Show me how" uses — stays version 2.
   Keep it that way until release: the owner may be pasting it into the real sheet. The test copy's own script
   is published at `/test/sheet-script.txt`, and restoring a backup in the test copy drops its sheet link.
2. The owner makes a separate TEST Google Sheet with Code.gs v3, opens `…/company-accounts/test/` on the
   iPhone, restores their backup file into it, connects it to the TEST sheet, and tries logins.
3. Fix whatever they find. 4. Owner pastes Code.gs v3 into the real sheet (Manage deployments → New version);
   then `node tools/build.js` and push, so phones get "Update now". 5. Set up logins; everyone signs in;
   only then "Require logins".

**Security review (8 Oct 2026, independent reviewer, snapshot 5056e73).** All CRITICAL and HIGH findings were
reproduced, fixed and each has a check in `tools/test-auth.js` (setup hijack via the company password → setup
code; shapeless records breaking the tabs; re-kinding; unwhitelisted change-request fields; sign-out wiping a
fresh entry; stored markup in ids). Accepted for now, tell the owner: a fake invite link pointing at someone
else's script could collect a password (pin the company's script address in the release build); anyone who
knows a username can lock it for 15 minutes at a time (signed-in phones keep working); hidden `_users` tab has
1000-round SHA-256 hashes (don't share the whole sheet file); until "Require logins" is on, old invite links
still give full access — switch it on as soon as everyone has signed in.

**Waiting on the owner (we can't do these for them):**
1. **Update the Google Sheet script to version 2.** They last saw the "script needs updating"
   message, and their cash ↔ bank move was still queued on the device. To check, open their web app
   link in a browser: it must show `"version":2`.
2. **Get app version ≥ 5b2a803 on every device**, using Update now or Check for update. Earlier
   versions had the bad update step.
3. **Put their imported old expenses under their main project** with Project → ＋ Add existing
   expenses → Select all. Given step-by-step instructions; whether they did it is unknown.
4. **Record money received / opening balances.** Cash shows negative until they do, because only
   spending has been entered so far.

**Offered, not done:**
- Arrange their **money-received list** for pasting. This needs the importer extended to kind **R**:
  project plus "Received into".
- **Erase one real expense line from the git history.** Commit `0f7aac1` had a real row as the import
  box placeholder; it was replaced in `464ef03`. Removing it needs a history rewrite and force-push,
  so **ask first**.

**Owner decisions to respect:**
- A bank deposit is a cash → bank **move**, not an expense.
- A USD → SSP exchange is recorded as **USD going out only**.
- Their old list was imported as paid in **Cash**, entered by them. One supplier payment and its
  bank charge are two separate **Bank** lines; nobody objected.
- They prefer **Google Sheets over Excel**. The Excel export and Drive-folder auto-save were removed
  on purpose; Sheets can download .xlsx.

**Private working files (not in this repo).** These sit beside it in the original Claude session
folder, which is temporary:
- `old-expenses-original.txt`: their pasted list
- `old-expenses-import.txt`: the 69 arranged lines
- `old-entries-import.txt`: those plus the cash → bank move and the bank payment lines
- `Company Accounts.html`: the obsolete first, Excel-based version

## 7. Ideas / known limits

- Import money received (R), and add an "opening balance" entry.
- USD ↔ SSP exchange as a pair: USD out plus SSP in at a typed rate.
- Receipt photos. localStorage is too small for these; they would need IndexedDB or Drive.
- Limits:
  - The password only stops casual changes on the device.
  - Anyone with an invite link can read and add records. To revoke access, change `KEY` in Script
    properties, reconnect, and send new invites.
  - On iPhone, removing the home-screen app deletes entries that haven't synced.
  - localStorage holds about 5 MB, roughly 20k entries.
  - The sheet rebuilds every tab on each change. That's fine for thousands of rows; batch it if it
    grows.

## 8. Lessons from building it

- **Reproduce first:** rebuild the owner's exact data state before fixing a reported total.
- **Never test a "fix" in a browser that can't run it:** use `tools/chrome-check.js` for anything
  involving the offline copy (and remember the built-in pane now has its own service worker, see §4).
- **Don't trust caches:** anything the service worker stores must be fetched with `cache: 'reload'`.
- **Expect pasted links to be damaged:** the join box replaces its content on paste and finds the
  invite inside any text.
- **Keep real data out of public files:** every commit gets a grep for real values.
