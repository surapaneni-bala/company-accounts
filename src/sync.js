/* ---------- google sheet sync ---------- */
// The company Google Sheet (running apps-script/Code.gs) is the shared record book.
// Every device saves locally first, then sends its waiting changes and receives everyone
// else's whenever it has internet. The newest copy of each record wins (stamp u).
const SYNC_DELAY_MS = 2000;
const SYNC_EVERY_MS = 2 * 60 * 1000;
const SYNC_TIMEOUT_MS = 45000;
const APP_URL = 'https://surapaneni-bala.github.io/company-accounts/';
const KIND_KEY = { E: 'expenses', R: 'credits', P: 'projects', L: 'log' };
const VALID = {
  E: d => typeof d.id === 'string' && Number.isFinite(d.amount) && AT_RE.test(d.at) && CURS.includes(d.cur) && typeof d.paidTo === 'string' && typeof d.reason === 'string',
  R: d => typeof d.id === 'string' && Number.isFinite(d.amount) && AT_RE.test(d.at) && CURS.includes(d.cur),
  P: d => typeof d.id === 'string' && typeof d.name === 'string',
  L: d => typeof d.lid === 'string' && typeof d.text === 'string' && typeof d.at === 'string',
};
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
const inviteLink = () => `${appUrl()}#join=${b64u(JSON.stringify({ u: S.link.u, k: S.link.k }))}`;
const inviteFromHash = () => (location.hash.match(/join=[\w-]+/) || [''])[0];
function decodeInvite(code) {
  try {
    const j = JSON.parse(unb64u(code));
    return validLinkUrl(j.u) && typeof j.k === 'string' && j.k ? { u: j.u, k: j.k.toUpperCase() } : null;
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
  return validLinkUrl(u) && k ? { u, k } : null;
}
function inviteHint(f) {
  const v = f.elements.invite.value.trim(), box = $('.invite-hint', f);
  box.className = 'invite-hint ' + (!v ? '' : parseInvite(v) ? 'good' : 'bad');
  box.textContent = !v ? '' : parseInvite(v) ? '✓ Invite link OK — tap Join.' : /join=/.test(v) ? '✗ This link is cut off or changed. Copy it again from the message, or use the web app link and code below.' : '✗ This is not an invite link. It starts with https://surapaneni-bala.github.io/company-accounts/#join=';
}

async function callServer(link, body) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), SYNC_TIMEOUT_MS);
  let res;
  // text/plain body = no CORS preflight, which Apps Script cannot answer
  try { res = await fetch(link.u, { method: 'POST', body: JSON.stringify({ ...body, key: link.k }), signal: ctl.signal }); }
  catch { throw Object.assign(new Error('No internet'), { offline: true }); }
  finally { clearTimeout(timer); }
  const j = await res.json().catch(() => null);
  if (!j) throw new SyncError('The Google Sheet did not answer. Check the web app link, and that "Who has access" is set to "Anyone".');
  if (!j.ok) throw new SyncError(j.error || 'Sync failed');
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
async function firstContact(link) {
  try { return { link, res: await callServer(link, { since: 0, push: [] }) }; } catch (e) {
    if (!e.offline) throw e;
    const why = await whyUnreachable(link);
    if (!why.alt) throw new SyncError(why.msg);
    const plain = { ...link, u: why.alt };
    return { link: plain, res: await callServer(plain, { since: 0, push: [] }) };
  }
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
    const recs = pull.filter(p => p.k === k && p.d && VALID[k](p.d) && p.id === recId(key, p.d));
    if (!recs.length) continue;
    const list = [...S[key]], at = new Map(list.map((r, i) => [recId(key, r), i]));
    for (const p of recs) {
      const i = at.get(p.id);
      if (i === undefined) { at.set(p.id, list.length); list.push({ ...p.d, u: p.u }); changed = true; }
      else if (p.u > (list[i].u || 0)) { list[i] = { ...p.d, u: p.u }; changed = true; }
    }
    next[key] = list;
  }
  const s = pull.find(p => p.k === 'S' && p.d && p.d.pass && p.d.pass.hash && p.u > (S.settingsU || 0));
  if (s) { Object.assign(next, { company: String(s.d.company || S.company), pass: s.d.pass, settingsU: s.u }); changed = true; }
  S = { ...S, ...next };
  return changed;
}

function scheduleSync(ms = SYNC_DELAY_MS) { if (S && S.link) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, ms); } }
async function syncNow() {
  if (!S || !S.link) return;
  if (syncBusy) { syncAgain = true; return; }
  syncBusy = true; sync = { ...sync, state: 'syncing' }; paintSync();
  const push = pendingRecords();
  try {
    const res = await callServer(S.link, { since: S.link.since || 0, push });
    if (!S.link) return; // disconnected while this was running
    const changed = applyPull(res.pull || []);
    // a record edited while the request was running stays queued
    const sent = new Map(push.map(p => [p.id, p.u])), now = stampsNow();
    S = { ...S, link: { ...S.link, since: res.seq, sheet: sheetOk(res.sheet) || S.link.sheet }, dirty: S.dirty.filter(id => !sent.has(id) || (now.get(id) || 0) !== sent.get(id)) };
    save();
    sync = { state: 'ok', at: stampSec(), err: '' };
    if (changed && !typing()) render();
  } catch (e) {
    sync = { ...sync, state: e.offline ? 'offline' : 'error', err: e.message };
  } finally {
    syncBusy = false; paintSync();
    if (syncAgain) { syncAgain = false; scheduleSync(); }
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
    <p class="muted">${esc(syncText())}</p>
    ${S.link.sheet ? `<a class="btn in" href="${esc(S.link.sheet)}" target="_blank" rel="noopener">Open the Google Sheet</a>` : ''}
    <div class="two" style="margin-top:10px"><button class="btn ghost" data-act="syncNow">Sync now</button><button class="btn ghost" data-act="invite">📲 Add a phone 🔒</button></div>
    <p class="center"><button class="link" data-act="disconnect">Disconnect this device 🔒</button></p></section>`;
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
  $('.err', f).textContent = 'Joining…';
  let res;
  try { ({ link, res } = await firstContact(link)); }
  catch (e) { return formErr(f, null, /^No internet/.test(e.message) ? 'No internet. Joining needs internet once — try again when connected.' : e.message); }
  if (!(res.pull || []).some(p => p.k === 'S')) return formErr(f, null, 'That Google Sheet has no company yet. Connect the main computer first.');
  S = { v: 2, company: '', pass: null, expenses: [], credits: [], projects: [], log: [], seq: {}, dev: newDev(), dirty: [], settingsU: 0, createdAt: stampSec(), lastBackup: null, link: { ...link, since: 0, sheet: sheetOk(res.sheet) } };
  applyPull(res.pull);
  S = { ...S, link: { ...S.link, since: res.seq } };
  save(); navigator.storage?.persist?.();
  history.replaceState(null, '', location.pathname);
  sync = { state: 'ok', at: stampSec(), err: '' };
  tab = 'home'; render(); toast(`Joined ${S.company} ✓`);
}
async function inviteSheet() {
  if (!await unlock('Enter the password to add a phone. The invite link gives access to the company records.')) return;
  openSheet(`${head('Add a phone')}
    <ol class="steps">
      <li>Send this link to the phone (WhatsApp or email).</li>
      <li>On the phone, open the link. <b>iPhone:</b> in Safari tap <b>Share → Add to Home Screen</b>. <b>Android:</b> in Chrome tap <b>⋮ → Add to Home screen</b>.</li>
      <li>Open <b>Accounts</b> from the home screen and tap <b>Join my company</b>. If the link is not filled in already, paste it.</li>
    </ol>
    <label class="fld"><span>Invite link</span><input id="inviteLink" readonly value="${esc(inviteLink())}"></label>
    <div class="two"><button class="btn in" data-act="copyInvite">Copy link</button>${navigator.share ? '<button class="btn ghost" data-act="shareInvite">Send…</button>' : ''}</div>
    <p class="note" style="margin-top:14px">Anyone with this link can see and add company records. Only send it to your own staff.</p>`);
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
  return { ...s, dev, dirty: s.dirty || [], settingsU: s.settingsU || 1, link: s.link || null, log: s.log.map((l, i) => l.lid ? l : { ...l, lid: `L-${dev}-old${i}` }) };
}
