# Handover — Company Accounts

Last updated **7 Oct 2026** · live app version **5b2a803** · Google Sheet script **version 2**

Read this first when picking the project up. The everyday user guide is [README.md](README.md).

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
| App (installable, works offline) | https://surapaneni-bala.github.io/company-accounts/ |
| Repository | https://github.com/surapaneni-bala/company-accounts (GitHub Pages serves `docs/`) |
| Sheet script to paste into Apps Script | https://raw.githubusercontent.com/surapaneni-bala/company-accounts/main/apps-script/Code.gs |
| Check which app version is live | `https://surapaneni-bala.github.io/company-accounts/version.json` |

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
  core.js       state, helpers, password, all screens and forms, saving, backup
  sync.js       Google Sheet sync, invite links, join/connect, "update the script" help
  import.js     paste import (expenses + moves), repairs, double-count warning
  update.js     new-version check (version.json) and "Update now"
  main.js       button/form wiring, events, start-up, service-worker registration
  sw.js         offline copy (cache name = build version)
  manifest.webmanifest, icons (tools/make-icons.py draws them)
apps-script/Code.gs   the sync server that lives inside the Google Sheet (owner pastes it)
docs/           BUILT output, served by GitHub Pages — never edit by hand
tools/          build, tests, local Google stand-in, real-Chrome checks
```

All the source files run as **one script** (they are concatenated). Top-level code must not *call* a
function or `const` defined in a later file. This once broke start-up: `inviteFromHash` was called
before it existed.

### Data on the device (`localStorage['company-accounts-v1']`)

```
S = { v: 2, company, pass: {salt, hash},              // SHA-256(salt|password), checked on the device
      expenses: [E], credits: [R], transfers: [T], projects: [P], log: [L],
      seq: {E,R,T,P,B: n},  dev: 'K7Q',                // ids are PREFIX-DEV-0001, so devices never clash
      dirty: [ids waiting to sync], settingsU, link: {u, k, since, sheet} | null,
      lastBy, lastCur, lastLoc, lastMode, lastProject, lastExpProject, lastBackup, createdAt }
E = { id, cur:'USD'|'SSP', amount, paidTo, reason, location, project, mode:'Cash'|'Bank', at:'YYYY-MM-DDTHH:MM',
      manualDate, by, createdAt:'…:SS', batch, editedAt, editedBy, deleted, deletedBy, u }
R = { id, cur, amount, project (required), mode, note, at, … }      T = { id, cur, amount, from, to, note, at, … }
P = { id, name, value, valueCur, by, createdAt, deleted }           L = { lid, at, action, id (the entry), text, by }
```

- Every change goes through `update(patch)`. It stamps changed records with `u` (time in ms) and
  queues them in `dirty` when the device is connected.
- Money is added up in whole cents (`cents()`).
- `accountOf(mode)` maps older payment types: Card/Cheque count as Bank, anything else counts as Cash.

### Sync protocol (app ↔ `Code.gs`)

- **Request:** `POST` the web app link with a **text/plain** body (no CORS preflight):
  `{ key, since, push: [{ id, k, u, d }] }`. The kinds `k` are E, R, P, L, S (settings), T.
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
node tools/test-sheet-server.js     # runs the real Code.gs on fake Google services (sync, balances, tabs)
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

**Offline and update checks need real Chrome.** Claude Code's built-in browser pane blocks service
workers.
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/chrome-test about:blank &
node tools/pages-like-server.js docs 8795          # behaves like GitHub Pages (10-minute caching)
node tools/chrome-check.js http://127.0.0.1:8795/ expr.js            # e.g. expr.js: (async()=>({v:APP_VERSION}))()
node tools/chrome-check.js http://127.0.0.1:8795/ expr.js --offline  # network cut: the app must still open
```

To test an update, edit `APP_VERSION` in the served `index.html`, the cache name in `sw.js` and
`version.json`. Then run `--reload` and the reported version must change.

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
  involving the offline copy.
- **Don't trust caches:** anything the service worker stores must be fetched with `cache: 'reload'`.
- **Expect pasted links to be damaged:** the join box replaces its content on paste and finds the
  invite inside any text.
- **Keep real data out of public files:** every commit gets a grep for real values.
