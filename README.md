# Company Accounts

A simple app for company expenses and money received, in **USD and SSP**.
It works **without internet** on phones and computers. Whenever there is internet, every device
syncs with your **company Google Sheet**, so everyone sees the same records.

**App address:** https://surapaneni-bala.github.io/company-accounts/

---

## One-time setup (about 10 minutes, on the main computer)

### A. Make the Google Sheet
1. Sign in to Google with your **company** account and open <https://sheets.google.com>.
2. Click **Blank spreadsheet**. Name it **Company Accounts**.
3. In the menu click **Extensions → Apps Script**. A code editor opens.
4. Delete everything in the editor. Open [`apps-script/Code.gs`](apps-script/Code.gs), click the
   **Copy raw file** button, and paste it into the editor. Click the **Save** icon (💾).
5. At the top, in the box next to **Run**, choose **setup**, then click **Run**.
   Google asks for permission → **Review permissions** → pick your account → **Allow**.
   (If you see "Google hasn't verified this app": click **Advanced → Go to project**. It is your own script.)
6. Go back to the Google Sheet. A new **Read me** tab shows your **Company code**. Keep it private.

### B. Turn the sheet into a "web app" (so the app can reach it)
7. In Apps Script click **Deploy → New deployment**. Click the ⚙️ next to "Select type" → **Web app**.
8. Set **Execute as: Me** and **Who has access: Anyone** — exactly **Anyone**, *not* "Anyone with Google account"
   (that one makes Google ask for a sign-in, and the app gets blocked). Click **Deploy**.
9. Copy the **Web app URL** (it ends with `/exec`).
   *If "Anyone" is not in the list, your company's Google admin has blocked it — ask them to allow it,
   or use another Google account for the sheet.*

### C. Connect the main computer
10. Open the app address in **Google Chrome**. (Tip: click the install icon ⊕ in the address bar to
    get it as an app.) Tap **Start a new company**, type the company name and a password.
11. Open the **Sheet** tab → **Connect to Google Sheet** → paste the **Web app URL** and the
    **Company code** → **Connect**. Done — the sheet fills in by itself.

### D. Add phones
12. On the computer: **Sheet** tab → **Add a phone** → **Copy link** → send it by WhatsApp or email.
13. **iPhone:** open the link in **Safari** → **Share → Add to Home Screen** → open **Accounts** from the
    home screen → **Join my company** → paste the link → **Join**.
    **Android:** open the link in **Chrome** → **⋮ → Add to Home screen** (or **Install app**) → open it →
    **Join my company** → paste the link → **Join**.

Joining needs internet once. After that the phone works offline.

---

## Everyday use
- **Add expense / Money received / Add many at once** — anyone can add. Date and time fill in by themselves.
- **Edit, delete, or an old date** — needs the password (stays unlocked for 5 minutes).
- Every entry records **who entered it**. Edits and deletes are kept in the **Change Log**.
- **USD and SSP are kept separately** — they are never added together.
- **Cash or bank** — every entry says where the money came from or went: 💵 **Cash** or 🏦 **Bank**.
  **Move money** records cash put into the bank (or taken out of it) — that is not spending.
  The Home screen shows **Cash**, **Bank** and **Total** for USD and for SSP.
- **Import old entries** (Sheet tab) — paste a list, one per line:
  `Date | Currency | Amount | Paid to | Reason | Location | Project | Paid from | Entered by`.
  *Paid from* is `Cash` or `Bank`; write `Cash → Bank` for a deposit. Lines already in the app are skipped.
- The badge at the top shows sync: **✓ Synced**, **⏳ 3 to sync** (waiting for internet), or **⚠️** if
  something needs attention. Waiting entries are safe on the device and sync by themselves.

## Logins (each person their own username and password)
Needs the sheet script **version 3** (see *Updating the sync script later*).

1. **Set up (once, by the owner):** open your Google Sheet → **Read me** tab: at the bottom is a **setup code**
   (only someone who can open the Sheet sees it). In the app: **Sheet** tab → **👥 Logins → Set up logins** →
   type that code, your name, a username and a new password. You are now the first **Admin**.
2. **Give logins:** **Sheet** tab → **👥 Logins → ＋ Give someone a login**. Pick what they may do:
   - **Admin** — everything, including giving logins (owner, Managing Director).
   - **Office manager** — sees everything and adds entries. **Her edits wait for an admin to approve them**;
     until then the entry and the totals stay as they were. Can't delete, change settings or give logins.
   - **Store keeper** — adds expenses and sees only their own; sees no company money, projects or totals.
3. **Each person signs in** on their phone: an existing phone shows **Sign in**; a new phone opens the invite
   link (**Add a phone**) and types its username and password. "Entered by" then fills in by itself.
4. When **everyone** has signed in: **👥 Logins → Require logins for everyone**. From then on old invite links
   and the company code stop working. (It can be switched back.)

- **Forgot a password?** An admin opens **👥 Logins**, taps the person, types a new password.
- **Someone leaves?** An admin opens their login and unticks **Login is open**. Their phone is signed out at its
  next sync and the company records leave it.
- **Approving changes:** when an office manager edits something, admins see **✏️ changes waiting for your
  approval** on Home → **Review** → **Approve** or **Reject**. Both are written in the Change Log.
- **Edit / delete** asks for **your own** password. Passwords need at least 8 characters. 5 wrong tries lock a
  login for 15 minutes (phones already signed in keep working).
- Only use invite links that come from an admin, and type your password only into the app you installed from
  them. Don't send the whole Google Sheet file to anyone: its hidden tabs hold the scrambled passwords.
- Change your own password or sign out: tap your name at the top.

## The Google Sheet
Tabs: **Summary** (Cash / Bank / Total balances, projects, month by month, who entered what), **Expenses**,
**Money Received**, **Cash & Bank moves**, **Ledger** (running Cash / Bank / Total balances), **Change Log**. They update after every sync —
**don't type in them**. The hidden `_sync` tab is the master copy: never edit or delete it. The hidden `_users`
and `_sessions` tabs hold the logins (passwords are stored scrambled): never edit them either.
Need Excel? In Google Sheets: **File → Download → Microsoft Excel**.

## Good to know
- The password stops casual changes; it is not bank-level security.
- On a phone, don't delete the app while the badge shows **⏳ to sync** — those entries are only on that phone.
- Until **Require logins** is on, anyone with an old invite link can see and add records. Only send links to
  your own staff. With logins required, a link alone opens nothing.

## Updating the sync script later
If `apps-script/Code.gs` changes: paste the new code in Apps Script → **Save** → **Deploy → Manage
deployments** → ✏️ → **Version: New version** → **Deploy**. The web app URL stays the same.

---

## For developers
Start with **[HANDOVER.md](HANDOVER.md)**: how everything works, how to test and publish, and what is open.

- Source: `src/` (`core.js`, `sync.js`, `auth.js`, `main.js`, `shell.html`). Build: `node tools/build.js` → `docs/` (served by GitHub Pages).
  `node tools/build.js --test` → `docs/test/`, a practice copy with its own storage and offline copy.
- Sync server: `apps-script/Code.gs`. Test it locally: `node tools/test-sheet-server.js` and `node tools/test-auth.js`.
- Try the app without Google: `node tools/mock-server.js` (prints a company code, web app link
  `http://127.0.0.1:8770/exec`) and serve `docs/` on `http://127.0.0.1:<port>/`.
- Icons: `python3 tools/make-icons.py`.
