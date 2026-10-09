/* ---------- google sheet sync ---------- */
// The company Google Sheet (running apps-script/Code.gs) is the shared record book.
// Every device saves locally first, then sends its waiting changes and receives everyone
// else's whenever it has internet. The newest copy of each record wins (stamp u).
const SYNC_DELAY_MS = 2000;
const SYNC_EVERY_MS = 2 * 60 * 1000;
const SYNC_TIMEOUT_MS = 45000, SLOWEST_BPS = 4000; // a request gets 45 s plus the time its body takes at 32 kbps: a voucher can go up on a weak phone connection
const APP_URL = 'https://app.b-e-p-l.com/';
// the order is the order records are sent in: an employee before a change request about them, files last
// (the sheet only takes a file record whose entry it already has)
const KIND_KEY = { E: 'expenses', R: 'credits', P: 'projects', L: 'log', T: 'transfers', W: 'workers', A: 'absences', C: 'changes', F: 'files' };
// Raised whenever the app learns a new kind of record. A phone that was on an older version skipped those
// records (it didn't know them) but moved on past them, so after updating it downloads everything once.
const KINDS_SEEN = 4; // 2 = change requests (C), 3 = employees (W) and files (F), 4 = days not worked (A)
const VALID = {
  E: d => typeof d.id === 'string' && Number.isFinite(d.amount) && AT_RE.test(d.at) && CURS.includes(d.cur) && typeof d.paidTo === 'string' && typeof d.reason === 'string' && okRate(d),
  R: d => typeof d.id === 'string' && Number.isFinite(d.amount) && AT_RE.test(d.at) && CURS.includes(d.cur) && okRate(d),
  P: d => typeof d.id === 'string' && typeof d.name === 'string',
  L: d => typeof d.lid === 'string' && typeof d.text === 'string' && typeof d.at === 'string',
  T: d => typeof d.id === 'string' && Number.isFinite(d.amount) && AT_RE.test(d.at) && CURS.includes(d.cur) && ACCOUNTS.includes(d.from) && ACCOUNTS.includes(d.to) && d.from !== d.to,
  C: d => typeof d.id === 'string' && SAFE_ID.test(d.target) && ['E', 'R', 'T', 'P', 'W', 'A'].includes(d.kind) && !!d.after && typeof d.after === 'object' && typeof d.status === 'string' && AT_RE.test(d.at),
  A: d => typeof d.id === 'string' && SAFE_ID.test(d.worker) && DATE_RE.test(d.date),
  W: d => typeof d.id === 'string' && typeof d.name === 'string' && Number.isFinite(d.wage) && CURS.includes(d.cur) && DATE_RE.test(d.start),
  F: d => typeof d.id === 'string' && /^[\w-]{10,100}$/.test(d.fileId) && typeof d.name === 'string' && FILE_MIMES.includes(d.mime) && SAFE_ID.test(d.for) && typeof d.type === 'string',
};
const DATE_RE = /^\d{4}-\d\d-\d\d$/;
const okRate = d => d.rate === undefined || (Number.isFinite(d.rate) && d.rate > 0);
// ids end up inside the app's pages: only plain ones are ever accepted (the sheet checks this too)
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
// what a Google Sheet script from before cash/bank moves can store
const OLD_SERVER_KINDS = ['E', 'R', 'P', 'L', 'S'];
const OUTDATED_MSG = 'The Google Sheet script needs updating before some new records (employees, files, days not worked …) can reach the sheet. Everything else is syncing; those are kept safe on this device.';
const NEWEST_SCRIPT = 7; // apps-script/Code.gs VERSION: admins are told when their sheet runs an older one
const notAllowedMsg = n => `${n} change${n === 1 ? ' is' : 's are'} not allowed for your login, so ${n === 1 ? 'it was' : 'they were'} not sent. ${n === 1 ? 'It is' : 'They are'} kept safe on this phone — ask an admin to sign in here to send ${n === 1 ? 'it' : 'them'}.`;
const SCRIPT_URL = 'https://app.b-e-p-l.com/sheet-script.txt'; // the sheet script, published next to the app
let sync = { state: 'idle', at: '', err: '' }; // idle | syncing | ok | offline | error
let syncBusy = false, syncAgain = false, syncTimer = 0;

class SyncError extends Error {}
const newDev = () => Array.from(crypto.getRandomValues(new Uint8Array(3)), b => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
const allIds = s => Object.values(KIND_KEY).flatMap(key => s[key].map(r => recId(key, r)));
const sheetOk = u => typeof u === 'string' && /^https:\/\/docs\.google\.com\//.test(u) ? u : '';
const validLinkUrl = u => /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(u) || /^http:\/\/(127\.0\.0\.1|localhost):\d+\/\w*$/.test(u);

/* invite links: <app address>#join=<web app link + company code> */
const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const appUrl = () => /^https?:$/.test(location.protocol) ? location.origin + location.pathname : APP_URL;
const inviteFromHash = () => (location.hash.match(/join=[\w-]+/) || [''])[0];
// Once the company has logins, invites carry only the web app link: each person signs in instead of using the company code.
const inviteCode = () => b64u(JSON.stringify(S.link.logins ? { u: S.link.u } : { u: S.link.u, k: S.link.k }));
const inviteLink = () => `${appUrl()}#join=${inviteCode()}`;
function decodeInvite(code) {
  try {
    const j = JSON.parse(unb64u(code));
    if (!validLinkUrl(j.u)) return null;
    if (j.k === undefined) return { u: j.u, k: '' };
    return typeof j.k === 'string' && j.k ? { u: j.u, k: j.k.toUpperCase() } : null;
  } catch { return null; }
}
// Find the invite in whatever was pasted: a whole chat message, the link pasted twice in a row,
// a link broken over several lines, or one a messaging app %-encoded.
function parseInvite(text) {
  let t = String(text || '').replace(/\s+/g, '');
  try { t = decodeURIComponent(t); } catch { /* not %-encoded: use as is */ }
  const codes = [...t.matchAll(/join=([\w-]+)/g)].map(m => m[1]);
  if (!codes.length && /^eyJ[\w-]{20,}$/.test(t)) codes.push(t); // just the code part
  for (const code of codes) {
    // a link pasted onto the end of another reads as "…codehttps": try without that tail
    for (const c of [code, code.replace(/(https?)+$/, '')]) { const link = decodeInvite(c); if (link) return link; }
  }
  return null;
}
function manualLink(f) {
  const u = (f.elements.url ? f.elements.url.value : '').trim(), k = (f.elements.key ? f.elements.key.value : '').trim().toUpperCase();
  const user = f.elements.username ? f.elements.username.value.trim() : '';
  return validLinkUrl(u) && (k || user) ? { u, k } : null; // with logins, the web app link + username is enough
}
function inviteHint(f) {
  const v = f.elements.invite.value.trim(), box = $('.invite-hint', f), link = parseInvite(v);
  const needLogin = !!link && !link.k;
  if (needLogin) $('.loginfields', f).hidden = false;
  box.className = 'invite-hint ' + (!v ? '' : link ? 'good' : 'bad');
  box.textContent = !v ? '' : link ? (needLogin ? '✓ Invite link OK — type your username and password, then tap Sign in.' : '✓ Invite link OK — tap Sign in.') : /join=/.test(v) ? '✗ This link is cut off or changed. Copy it again from the message, or use the web app link and code below.' : `✗ This is not an invite link. It starts with ${appUrl()}#join=`;
}

// Every request says who is asking: this phone's sign-in, or (no sign-in yet) the company code.
// Signing in and setting up logins send their own details instead.
async function callServer(link, body) {
  const who = body.op === 'login' || body.op === 'setup' ? {} : signedIn() ? { token: session.token } : { key: link.k };
  const text = JSON.stringify({ ...body, ...who }), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), SYNC_TIMEOUT_MS + text.length / SLOWEST_BPS * 1000);
  let res;
  // text/plain body = no CORS preflight, which Apps Script cannot answer
  try { res = await fetch(link.u, { method: 'POST', body: text, signal: ctl.signal }); }
  catch (e) { throw Object.assign(new Error('No internet'), { offline: true, timedOut: e.name === 'AbortError' }); }
  finally { clearTimeout(timer); }
  const j = await res.json().catch(() => null);
  if (!j) throw new SyncError('The Google Sheet did not answer. Check the web app link, and that "Who has access" is set to "Anyone".');
  if (!j.ok) throw Object.assign(new SyncError(j.error || 'Sync failed'), { code: j.code });
  return j;
}

// When a connection fails, find out why, so the message says what to fix.
const BLOCKED_MSG = 'The Google Sheet is blocking the app. In Apps Script click Deploy → Manage deployments → ✏️ (edit), set "Execute as: Me" and "Who has access: Anyone" (exactly "Anyone" — not "Anyone with Google account"), then click Deploy. If plain "Anyone" is not in the list, your company\'s Google admin has switched it off.';
const plainUrl = u => u.replace(/^https:\/\/script\.google\.com\/a\/macros\/[\w.-]+\/s\//, 'https://script.google.com/macros/s/');
async function answers(url) {
  try { const j = await (await fetch(url, { cache: 'no-store' })).json(); return !!j && j.app === 'company-accounts'; } catch { return false; }
}
async function hasInternet() {
  try { await fetch('https://www.gstatic.com/generate_204', { mode: 'no-cors', cache: 'no-store' }); return true; } catch { return false; }
}
async function whyUnreachable(link) {
  if (!await hasInternet()) return { msg: 'No internet. Connect to the internet and try again.' };
  if (await answers(link.u)) return { msg: 'The Google Sheet answered but could not save. In Apps Script paste the newest Code.gs, click Save, then Deploy → Manage deployments → ✏️ → Version: New version → Deploy.' };
  const alt = plainUrl(link.u);
  if (alt !== link.u && await answers(alt)) return { alt };
  return { msg: BLOCKED_MSG };
}
// First contact with a sheet: on failure explain why; company (Workspace) links get retried in their plain form.
async function firstContact(link, body = { since: 0, push: [] }) {
  try { return { link, res: await callServer(link, body) }; } catch (e) {
    if (!e.offline) throw e;
    const why = await whyUnreachable(link);
    if (!why.alt) throw new SyncError(why.msg);
    const plain = { ...link, u: why.alt };
    return { link: plain, res: await callServer(plain, body) };
  }
}

// A big backlog goes in batches: the sheet takes at most 200 records at once from logins other than admins.
// Records it refused last time go last, so they can never hold the others up.
const MAX_PUSH = 200;
let lastRefused = new Set();
function nextBatch() {
  const all = pendingRecords();
  return [...all.filter(p => !lastRefused.has(p.id)), ...all.filter(p => lastRefused.has(p.id))].slice(0, MAX_PUSH);
}
function pendingRecords() {
  const want = new Set(S.dirty), out = [];
  for (const [k, key] of Object.entries(KIND_KEY)) {
    for (const r of S[key]) { const id = recId(key, r); if (want.has(id)) out.push({ id, k, u: r.u || 0, d: r }); }
  }
  if (want.has('settings')) out.push({ id: 'settings', k: 'S', u: S.settingsU || 0, d: { company: S.company, pass: S.pass } });
  return out;
}
function stampsNow() {
  const m = new Map([['settings', S.settingsU]]);
  for (const key of Object.values(KIND_KEY)) for (const r of S[key]) m.set(recId(key, r), r.u);
  return m;
}
// Merge records from the Google Sheet into this device. Returns true if anything changed.
function applyPull(pull) {
  const next = {};
  let changed = false;
  for (const [k, key] of Object.entries(KIND_KEY)) {
    const recs = pull.filter(p => p.k === k && p.d && SAFE_ID.test(p.id) && VALID[k](p.d) && p.id === recId(key, p.d));
    if (!recs.length) continue;
    const list = [...S[key]], at = new Map(list.map((r, i) => [recId(key, r), i]));
    for (const p of recs) {
      const i = at.get(p.id);
      if (i === undefined) { at.set(p.id, list.length); list.push({ ...p.d, u: p.u }); changed = true; }
      else if (p.u > (list[i].u || 0)) { list[i] = { ...p.d, u: p.u }; changed = true; }
    }
    next[key] = list;
  }
  // only admins (and phones without a login) receive the company password with the settings
  const s = pull.find(p => p.k === 'S' && p.d && (p.d.company || (p.d.pass && p.d.pass.hash)) && p.u > (S.settingsU || 0));
  if (s) { Object.assign(next, { company: String(s.d.company || S.company), settingsU: s.u }, s.d.pass && s.d.pass.hash ? { pass: s.d.pass } : {}); changed = true; }
  S = { ...S, ...next };
  return changed;
}

function scheduleSync(ms = SYNC_DELAY_MS) { if (S && S.link) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms); } }
async function syncNow() {
  if (!S || !S.link) return;
  if (syncBusy) { syncAgain = true; return; }
  syncBusy = true; sync = { ...sync, state: 'syncing' }; paintSync();
  const push = nextBatch();
  try {
    const res = await callServer(S.link, { since: S.link.since || 0, push });
    if (!S.link) return; // disconnected while this was running
    const changed = applyPull(res.pull || []);
    if (changed) repairImportedMoves(); // a device on an old version may have sent mistaken expenses
    // a record edited while the request was running stays queued
    // records the sheet's script cannot store yet stay queued until it is updated
    // records this login may not change stay queued too, until an admin signs in on this phone
    const accepted = new Set(res.kinds || OLD_SERVER_KINDS), notAllowed = new Set(res.refused || []);
    const refused = new Set([...push.filter(p => !accepted.has(p.k)).map(p => p.id), ...notAllowed]);
    const sent = new Map(push.map(p => [p.id, p.u])), now = stampsNow(), was = S.link;
    S = { ...S, link: { ...S.link, since: res.seq, sheet: sheetOk(res.sheet) || S.link.sheet, v: res.version || 2, logins: !!(res.logins || S.link.logins) }, dirty: S.dirty.filter(id => refused.has(id) || !sent.has(id) || (now.get(id) || 0) !== sent.get(id)) };
    save();
    if (res.me && signedIn()) saveSession({ ...session, user: res.me }); // a changed name shows at once
    lastRefused = refused;
    if (S.dirty.some(id => !sent.has(id))) syncAgain = true; // more waiting than one batch: send the rest straight after
    sync = notAllowed.size ? { state: 'error', at: stampSec(), err: notAllowedMsg(notAllowed.size) }
      : refused.size ? { state: 'error', at: stampSec(), err: OUTDATED_MSG } : { state: 'ok', at: stampSec(), err: '' };
    if ((changed || was.logins !== S.link.logins || was.v !== S.link.v) && !typing()) render();
  } catch (e) {
    if (e.code === 'LOGIN' && S.link) return signedOutByServer(e.message);
    sync = { ...sync, state: e.offline ? 'offline' : 'error', err: e.message };
  } finally {
    syncBusy = false; paintSync();
    if (syncAgain) { syncAgain = false; scheduleSync(); }
    if (sync.state === 'ok' || sync.state === 'error') { uploadFiles(); warmLetterhead(); }
  }
}
const typing = () => { const a = document.activeElement; return !!a && $('#main').contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); };

function syncText() {
  const n = (S.dirty || []).length, waiting = n ? ` ${n} change${n === 1 ? '' : 's'} waiting to sync.` : '';
  return {
    idle: `Connected.${waiting}`,
    syncing: 'Syncing…',
    ok: `✅ Up to date — last synced ${fmtTime(sync.at)}.${waiting}`,
    offline: `📴 No internet right now. Everything is saved on this device${n ? ` (${n} change${n === 1 ? '' : 's'} waiting)` : ''} and syncs by itself when the internet is back.`,
    error: `⚠️ ${sync.err}`,
  }[sync.state];
}
function paintSync() {
  const c = $('#syncChip');
  if (!c || !S) return;
  const n = (S.dirty || []).length;
  c.hidden = !S.link;
  c.className = 'chip' + (sync.state === 'error' ? ' bad' : sync.state === 'offline' || n ? ' wait' : '');
  c.textContent = sync.state === 'syncing' ? '⟳ Syncing…' : sync.state === 'error' ? '⚠️ Sync problem' : n ? `⏳ ${n} to sync` : sync.state === 'ok' ? `✓ Synced ${fmtTime(sync.at)}` : '☁️ Connected';
  const card = $('#syncCard');
  if (card) card.outerHTML = syncCard();
}
function syncCard() {
  if (!S.link) return `<section class="card pad" id="syncCard"><h3>📊 Company Google Sheet</h3>
    <p class="muted">Connect your company Google Sheet so phones and computers share the same records. The app keeps working offline and syncs when the internet is on.</p>
    <button class="btn in" data-act="connect">Connect to Google Sheet 🔒</button></section>`;
  return `<section class="card pad" id="syncCard"><h3>📊 Company Google Sheet</h3>
    <p class="muted">${esc(syncText())}${outbox.length ? ` ${outbox.length} file${outbox.length === 1 ? '' : 's'} waiting to upload: ${esc(uploadWhy())}` : ''}</p>
    ${sync.err === OUTDATED_MSG ? '<button class="btn primary" data-act="howUpdate" style="margin-bottom:10px">Show me how to update it</button>'
      : (S.link.v || 2) < NEWEST_SCRIPT && can('settings') ? `<p class="note">A newer Google Sheet script is ready (version ${NEWEST_SCRIPT}; this sheet runs ${S.link.v || 2}). It is needed for employees, files, vouchers and days not worked. <button class="link" data-act="howUpdate">Show me how</button></p>` : ''}
    ${S.link.sheet ? `<a class="btn in" href="${esc(S.link.sheet)}" target="_blank" rel="noopener">Open the Google Sheet</a>` : ''}
    <div class="two" style="margin-top:10px"><button class="btn ghost" data-act="syncNow">Sync now</button>${can('phones') ? '<button class="btn ghost" data-act="invite">📲 Add a phone 🔒</button>' : ''}</div>
    ${signedIn() ? '' : '<p class="center"><button class="link" data-act="disconnect">Disconnect this device 🔒</button></p>'}</section>`;
}

function howUpdateSheet() {
  openSheet(`${head('Update the Google Sheet script')}
    <p class="hint">About 2 minutes, on a computer. Your records are safe while you do this.</p>
    <ol class="steps">
      <li>Open your company <b>Google Sheet</b> → menu <b>Extensions → Apps Script</b>.</li>
      <li>Open the new script: <a href="${SCRIPT_URL}" target="_blank" rel="noopener">new Code.gs</a>. Select all (<b>Ctrl+A</b>, Mac <b>Cmd+A</b>) and copy (<b>Ctrl+C</b> / <b>Cmd+C</b>).</li>
      <li>In Apps Script click inside the code, select all, press <b>Delete</b>, then paste (<b>Ctrl+V</b> / <b>Cmd+V</b>). Click <b>💾 Save</b>.</li>
      <li>Click the blue <b>Deploy</b> button → <b>Manage deployments</b> → the ✏️ <b>pencil</b>.</li>
      <li><b>Only the first time you update to version 4 or newer:</b> in the list at the top of Apps Script choose <b>allowFiles</b> and click <b>▶ Run</b>. Google asks for permission to use your Drive: <b>Review permissions</b> → the company account → <b>Advanced → Go to … (unsafe)</b> → <b>Allow</b> (it is your own script). This lets the app keep receipts, vouchers and photos in a private Drive folder.</li>
      <li>Under <b>Version</b> choose <b>New version</b>. Leave “Execute as: Me” and “Who has access: Anyone”. Click <b>Deploy</b>.<br><em>Not “New deployment” — that makes a different link.</em></li>
      <li>Come back here and tap <b>Sync now</b>.</li>
    </ol>
    <p class="note">Check: open your web app link (ends in /exec) in a browser. After the update it shows <b>"version":${NEWEST_SCRIPT}</b>.</p>
    <button class="btn in" data-act="syncNow">Sync now</button>`);
}
function connectForm() {
  openSheet(`${head('Connect to Google Sheet')}
    <p class="hint">Do this once, on the main computer. The setup guide shows where to find these two things.</p>
    <form data-form="connect">
      <label class="fld"><span>Web app link</span><input name="url" required autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec" autofocus></label>
      <label class="fld"><span>Company code</span><input name="key" required autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="From the “Read me” tab of the Google Sheet"></label>
      <p class="err"></p>
      <button class="btn in">Connect</button>
    </form>`);
}
async function doConnect(f) {
  const typed = { u: f.elements.url.value.trim(), k: f.elements.key.value.trim().toUpperCase() };
  if (!validLinkUrl(typed.u)) return formErr(f, 'url', /\/dev$/.test(typed.u) ? 'This is the test link (ends in /dev). Use the Web app URL from Deploy → Manage deployments — it ends in /exec.' : 'This is not a web app link. It starts with https://script.google.com/ and ends with /exec');
  $('.err', f).textContent = 'Connecting…';
  let link, res;
  try { ({ link, res } = await firstContact(typed)); }
  catch (e) { return formErr(f, null, e.message); }
  const theirs = (res.pull || []).find(p => p.k === 'S');
  if (theirs && !confirm(`This Google Sheet already has records for "${theirs.d.company}".\n\nAdd this device's entries to it?`)) return;
  // send everything this device has; the sheet keeps the newest copy of each record.
  // If the sheet already has a company, its name and password win.
  S = { ...S, link: { ...link, since: 0, sheet: sheetOk(res.sheet) }, dirty: [...allIds(S), ...(theirs ? [] : ['settings'])], settingsU: theirs ? 0 : S.settingsU };
  update({ log: logWith([['Connected', '—', 'This device was connected to the company Google Sheet']]) });
  closeSheet(); render(); toast('Connected ✓ Syncing now…');
  syncNow();
}
async function doJoin(f) {
  let link = parseInvite(f.elements.invite.value) || manualLink(f);
  if (!link) {
    if (f.elements.url.value.trim() || f.elements.key.value.trim()) return formErr(f, validLinkUrl(f.elements.url.value.trim()) ? 'key' : 'url', validLinkUrl(f.elements.url.value.trim()) ? 'Type the company code.' : 'The web app link starts with https://script.google.com/ and ends with /exec');
    return formErr(f, 'invite', f.elements.invite.value.trim() ? 'This invite link is cut off or changed. Copy it again from the message — or open “Join with the web app link and code” below.' : 'Paste the invite link first.');
  }
  const username = clean(f.elements.username.value), password = f.elements.password.value;
  if (!link.k || username) return joinSignedIn(f, link, username, password);
  $('.err', f).textContent = 'Joining…';
  let res;
  try { ({ link, res } = await firstContact(link)); }
  catch (e) {
    if (e.code === 'LOGIN') { $('.loginfields', f).hidden = false; return formErr(f, 'username', 'This company now uses logins. Type your username and password, then tap Join.'); }
    return formErr(f, null, /^No internet/.test(e.message) ? 'No internet. Joining needs internet once — try again when connected.' : e.message);
  }
  if (!(res.pull || []).some(p => p.k === 'S')) return formErr(f, null, 'That Google Sheet has no company yet. Connect the main computer first.');
  S = { v: 2, company: '', pass: null, expenses: [], credits: [], transfers: [], projects: [], log: [], changes: [], workers: [], absences: [], files: [], kindsSeen: KINDS_SEEN, seq: {}, dev: newDev(), dirty: [], settingsU: 0, createdAt: stampSec(), lastBackup: null, link: { ...link, since: 0, sheet: sheetOk(res.sheet) } };
  applyPull(res.pull);
  S = { ...S, link: { ...S.link, since: res.seq } };
  save(); navigator.storage?.persist?.();
  repairImportedMoves();
  history.replaceState(null, '', location.pathname);
  sync = { state: 'ok', at: stampSec(), err: '' };
  tab = 'menu'; render(); toast(`Joined ${S.company} ✓`);
}
// a new phone joining a company that has logins: sign in, then load what this person may see
async function joinSignedIn(f, link, username, password) {
  $('.loginfields', f).hidden = false;
  if (!username || !password) return formErr(f, username ? 'password' : 'username', 'Type your username and password.');
  $('.err', f).textContent = 'Signing in…';
  const dev = newDev();
  let res;
  try { ({ link, res } = await firstContact(link, { op: 'login', username, password, device: dev })); }
  catch (e) {
    const offline = /^No internet/.test(e.message);
    return formErr(f, offline ? null : 'password', offline ? 'No internet. Joining needs internet once — try again when connected.' : e.message);
  }
  S = { v: 2, company: '', pass: null, expenses: [], credits: [], transfers: [], projects: [], log: [], changes: [], workers: [], absences: [], files: [], kindsSeen: KINDS_SEEN, seq: {}, dev, dirty: [], settingsU: 0, createdAt: stampSec(), lastBackup: null, link: { u: link.u, k: '', since: 0, sheet: '', logins: true } };
  await signedInAs(res, password);
  navigator.storage?.persist?.();
  history.replaceState(null, '', location.pathname);
  tab = 'menu';
  await syncNow();
  render(); toast(`Welcome, ${res.me.name} ✓`);
  lockApp(); // a new sign-in chooses its 4-digit code first
}
async function inviteSheet() {
  if (!await unlock('Enter the password to add a phone. The invite link gives access to the company records.')) return;
  openSheet(`${head('Add a phone')}
    <ol class="steps">
      <li>Send this link to the phone (WhatsApp or email).</li>
      <li>On the phone, open the link. <b>iPhone:</b> in Safari tap <b>Share → Add to Home Screen</b>. <b>Android:</b> in Chrome tap <b>⋮ → Add to Home screen</b>.</li>
      <li>Open <b>Accounts</b> from the home screen and tap <b>Join my company</b>. If the link is not filled in already, paste it.${S.link.logins ? ' Then type the username and password you gave them.' : ''}</li>
    </ol>
    <label class="fld"><span>Invite link</span><input id="inviteLink" readonly value="${esc(inviteLink())}"></label>
    <div class="two"><button class="btn in" data-act="copyInvite">Copy link</button>${navigator.share ? '<button class="btn ghost" data-act="shareInvite">Send…</button>' : ''}</div>
    <p class="note" style="margin-top:14px">${S.link.logins ? 'The link alone opens nothing: each person signs in with the login you gave them (👥 Logins).' : 'Anyone with this link can see and add company records. Only send it to your own staff.'}</p>`);
}
async function disconnect() {
  if (!await unlock('Enter the password to disconnect this device from the Google Sheet.')) return;
  const n = S.dirty.length;
  if (!confirm(`Stop syncing this device with the Google Sheet?${n ? `\n\n⚠️ ${n} change${n === 1 ? ' has' : 's have'} not reached the Google Sheet yet.` : ''}\n\nRecords stay on this device.`)) return;
  clearTimeout(syncTimer);
  S = { ...S, link: null, dirty: [] }; save();
  sync = { state: 'idle', at: '', err: '' };
  render(); toast('Disconnected');
}
function migrate(s) {
  const dev = s.dev || newDev();
  const relearn = s.link && (s.kindsSeen || 1) < KINDS_SEEN;
  return { ...s, dev, transfers: s.transfers || [], changes: s.changes || [], workers: s.workers || [], absences: s.absences || [], files: s.files || [], dirty: s.dirty || [], settingsU: s.settingsU || 1, kindsSeen: KINDS_SEEN,
    link: relearn ? { ...s.link, since: 0 } : (s.link || null), log: s.log.map((l, i) => l.lid ? l : { ...l, lid: `L-${dev}-old${i}` }) };
}
