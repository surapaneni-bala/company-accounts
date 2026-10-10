'use strict';
const APP_VERSION = '__VERSION__'; // filled in by tools/build.js
const KEY = 'company-accounts-v1';
const UNLOCK_MS = 5 * 60 * 1000;
const BACKUP_NAG_DAYS = 7;
// Money is in one of two places: cash in hand or the bank.
const ACCOUNTS = ['Cash', 'Bank'];
const ACCOUNT_ICON = { Cash: '💵', Bank: '🏦' };
// entries saved by older versions may say Card, Cheque or Mobile money
const accountOf = mode => (/^(bank|card|cheque|check)/i.test(String(mode || '')) ? 'Bank' : 'Cash');
const COLL = { E: 'expenses', R: 'credits', T: 'transfers' };
// Two separate money accounts. They are never added together: the rate moves too much.
const CURS = ['USD', 'SSP'];
const CUR_NAME = { USD: 'US Dollar', SSP: 'S. Sudan Pound' };
const SYM = { USD: '$', SSP: 'SSP ' };
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const AT_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;

let S = load();
// 'menu' = the first page after signing in (Accounts, Employees); the bottom bar belongs to Accounts
let tab = 'menu', histKind = 'E', histQuery = '', histMonth = '';
const ACC_TABS = ['home', 'hist', 'proj', 'sheet'];
const WELCOME = 'Welcome';
let unlockedUntil = 0;

/* ---------- storage ---------- */
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { alert('⚠️ Could not save!\nYour browser storage may be full or blocked.\nOpen the Sheet tab and save a backup now.\n\n' + e.message); }
}
// Every change goes through here. Changed records get a fresh time stamp (u); when this device
// is connected to the Google Sheet they are also queued (dirty) for the next sync.
const SYNC_KEYS = { expenses: 'E', credits: 'R', projects: 'P', log: 'L', transfers: 'T', changes: 'C', workers: 'W', absences: 'A', files: 'F' };
const recId = (key, r) => key === 'log' ? r.lid : r.id;
// A new record made by a signed-in person also carries their login (uid); edits keep the original one.
function update(patch) {
  const now = Date.now(), dirty = new Set(S.dirty || []), stamped = {};
  const uid = signedIn() ? { uid: session.user.id } : {};
  for (const key of Object.keys(SYNC_KEYS)) {
    if (!patch[key]) continue;
    const before = new Set(S[key]), known = new Set(S[key].map(r => recId(key, r)));
    stamped[key] = patch[key].map(r => {
      if (before.has(r)) return r;
      dirty.add(recId(key, r));
      return { ...r, ...(known.has(recId(key, r)) ? {} : uid), u: now };
    });
  }
  if ('company' in patch || 'pass' in patch) { dirty.add('settings'); stamped.settingsU = now; }
  const was = S;
  S = { ...S, ...patch, ...stamped, dirty: S.link ? [...dirty] : [] };
  save(); scheduleSync();
  if (patch.expenses || patch.credits) cancelSigned(was); // an entry changed after its voucher was signed (files.js)
}

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
// seconds keep same-minute entries in the order they were made
const stampSec = (d = new Date()) => `${stamp(d)}:${pad(d.getSeconds())}`;
const clean = v => String(v ?? '').trim().replace(/\s+/g, ' ');
const live = a => a.filter(x => !x.deleted);
// money is summed in whole cents so 0.1 + 0.2 never drifts
const cents = n => Math.round(Number(n || 0) * 100);
const total = a => a.reduce((t, x) => t + cents(x.amount), 0) / 100;
const minus = (a, b) => (cents(a) - cents(b)) / 100;
const byCur = items => Object.fromEntries(CURS.map(c => [c, total(items.filter(x => x.cur === c))]));
const byAt = (a, b) => a.at.localeCompare(b.at) || (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id);
const projName = id => id ? (S.projects.find(p => p.id === id)?.name || 'Unknown project') : 'General (no project)';
const fileSafe = s => s.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Company';
const randHex = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
const defCur = () => S.lastCur || 'USD';

function money(n, cur) {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return (n < 0 ? '−' : '') + SYM[cur] + s;
}
// "$1,200 · SSP 50,000" — only the currencies that have money in them
function sumText(items) {
  const parts = Object.entries(byCur(items)).filter(([, v]) => v).map(([c, v]) => money(v, c));
  return parts.length ? parts.join(' · ') : money(0, defCur());
}
function parseAmount(v) {
  const n = Number(String(v ?? '').replace(/[,\s$]/g, '').replace(/^SSP/i, ''));
  return Number.isFinite(n) && n > 0 && n < 1e12 ? Math.round(n * 100) / 100 : null;
}
function fmtTime(at) { const [h, m] = at.slice(11, 16).split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; }
function fmtDate(date) { const [y, m, d] = date.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; }
function fmtDay(date) {
  if (date === stamp().slice(0, 10)) return 'Today';
  if (date === stamp(new Date(Date.now() - 864e5)).slice(0, 10)) return 'Yesterday';
  const [y, m, d] = date.split('-').map(Number);
  return `${DAYS[new Date(y, m - 1, d).getDay()]}, ${fmtDate(date)}`;
}
const fmtWhen = at => `${fmtDay(at.slice(0, 10))}, ${fmtTime(at)}`;
const fmtAbs = at => `${fmtDate(at.slice(0, 10))}, ${fmtTime(at)}`;
const monthName = ym => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

function nextIds(prefix, n, seq) {
  const start = seq[prefix] || 0;
  // the device code keeps ids unique when several phones add entries offline
  const list = Array.from({ length: n }, (_, i) => `${prefix}-${S.dev}-${String(start + i + 1).padStart(4, '0')}`);
  return [list, { ...seq, [prefix]: start + n }];
}
const logWith = (entries, by = S.lastBy || '') => [...S.log, ...entries.map(([action, id, text], i) => ({ lid: `L-${S.dev}-${Date.now().toString(36)}${i}`, at: stampSec(), action, id, text, by }))];

const LABELS = { cur: 'Money type', amount: 'Amount', paidTo: 'Paid to', reason: 'Reason', location: 'Location', project: 'Project', mode: 'Cash or bank', note: 'Note', at: 'Date', from: 'Moved', rate: 'SSP for 1 USD',
  to: 'Moved to', manualDate: 'Date set by hand', name: 'Name', phone: 'Phone', job: 'Job', site: 'Site', wage: 'Monthly wage', start: 'Started', idNo: 'ID number', status: 'Status', left: 'Left on', openingAmount: 'Before the app', openingNote: 'Note', clearedTo: 'Salary cleared up to' };
function showVal(k, r) {
  const v = r[k];
  if (['amount', 'wage', 'openingAmount'].includes(k)) return v === undefined || v === '' ? '(empty)' : money(+v, r.cur);
  if (['start', 'left', 'clearedTo'].includes(k)) return v ? fmtDate(v) : '(empty)';
  return k === 'project' ? projName(v) : k === 'at' ? fmtAbs(v) : k === 'mode' ? accountOf(v) : k === 'from' ? `${v} → ${v === 'Cash' ? 'Bank' : 'Cash'}` : k === 'rate' ? (v ? plain(+v) : '(empty)') : k === 'status' ? (v === 'left' ? 'Left' : 'Working') : k === 'manualDate' ? (v ? 'yes' : 'no') : (v || '(empty)');
}
function diff(a, b) { return Object.keys(LABELS).filter(k => k in b && String(a[k] ?? '') !== String(b[k] ?? '')).map(k => `${LABELS[k]}: ${showVal(k, a)} → ${showVal(k, b)}`); }
function describe(k, r) {
  if (k === 'T') return `${money(r.amount, r.cur)} moved from ${r.from} to ${r.to}${r.note ? ' · ' + r.note : ''} · dated ${fmtAbs(r.at)}`;
  return k === 'E'
    ? `${money(r.amount, r.cur)} paid to ${r.paidTo} for ${r.reason}${r.location ? ' at ' + r.location : ''} · from ${accountOf(r.mode)} · ${projName(r.project)} · dated ${fmtAbs(r.at)}`
    : `${money(r.amount, r.cur)} received for ${projName(r.project)} · into ${accountOf(r.mode)}${r.note ? ' · ' + r.note : ''} · dated ${fmtAbs(r.at)}`;
}
function projStats(id) {
  const p = S.projects.find(x => x.id === id) || {};
  const recv = byCur(live(S.credits).filter(c => c.project === id));
  const spent = byCur(live(S.expenses).filter(e => e.project === id));
  const bal = Object.fromEntries(CURS.map(c => [c, minus(recv[c], spent[c])]));
  const value = p.value || 0, vc = p.valueCur || 'USD';
  const curs = CURS.filter(c => recv[c] || spent[c] || (value && c === vc));
  return { recv, spent, bal, value, vc, curs: curs.length ? curs : [vc], pending: value ? Math.max(0, minus(value, recv[vc])) : 0, pct: value ? Math.min(100, recv[vc] / value * 100) : 0 };
}

/* ---------- password ---------- */
async function hashPw(pw, salt) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + pw));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const isUnlocked = () => Date.now() < unlockedUntil;
// fresh = ask for the password itself even if unlocked a moment ago (e.g. before choosing a new code).
// Signed in with a code: the code pad (or Face ID); otherwise your password, or the company password before logins.
function unlock(why, fresh) {
  if (isUnlocked() && !fresh) return Promise.resolve(true);
  const opened = () => { unlockedUntil = Date.now() + UNLOCK_MS; renderLock(); return true; };
  if (!fresh && quick()) return pinPrompt({ why: why.replace('Enter the password', 'Enter your code') }).then(ok => ok && opened());
  return new Promise(resolve => {
    const d = $('#pw'), pass = signedIn() ? session.check : S.pass;
    $('#pwWhy').textContent = signedIn() ? why.replace('the password', 'your password') : why;
    $('#pwIn').value = ''; $('#pwErr').textContent = ''; $('#pwIn').placeholder = signedIn() ? 'Your password' : 'Password';
    d.returnValue = '';
    d.showModal(); $('#pwIn').focus();
    $('#pwCancel').onclick = () => d.close();
    $('#pwForm').onsubmit = async e => {
      e.preventDefault();
      if (pass && await (signedIn() ? slowHash : hashPw)($('#pwIn').value, pass.salt) === pass.hash) { d.close('ok'); resolve(opened()); }
      else {
        $('#pwErr').textContent = 'Wrong password. Try again.';
        $('#pwIn').select(); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
      }
    };
    d.onclose = () => { if (d.returnValue !== 'ok') resolve(false); };
  });
}
function renderLock() { const p = $('#lockPill'); if (p) p.hidden = !isUnlocked(); }

/* ---------- ui bits ---------- */
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600); }
// here = how to redraw the sheet on screen (after a file is added); back = the sheet to return to when the one
// on top closes: an entry opened from a project or an employee goes back there after it is edited or closed.
let here = null, back = null;
function openSheet(html) {
  const d = $('#sheet'); $('#sheetIn').innerHTML = html;
  if (!d.open) { back = null; d.showModal(); }
  here = null;
  d.scrollTop = 0;
  ($('[autofocus]', d) || $('.close', d))?.focus();
}
// a sheet others can return to: call right after drawing it
function comeBack(fn) { here = back = fn; }
function closeSheet() {
  const to = back;
  if (to && to !== here && $('#sheet').open && to() !== false) return;
  closeAll();
}
function closeAll() { back = here = null; $('#sheet').close(); }
const reopenHere = () => { if (here && $('#sheet').open) here(); };
const head = (title, tone = '', sub = '') => `<div class="sh-head ${tone ? 'tone-' + tone : ''}"><div><h2>${esc(title)}</h2>${sub ? `<small>${esc(sub)}</small>` : ''}</div><button type="button" class="close" data-act="close" aria-label="Close">×</button></div>`;
const empty = (title, text) => `<div class="card empty"><strong>${title}</strong>${text}</div>`;
const curLines = (vals, curs = CURS) => curs.map(c => `<b>${money(vals[c], c)}</b>`).join('');
function formErr(f, name, msg) {
  const el = name && f.elements[name];
  if (el && el.classList) { el.classList.add('bad'); el.focus(); }
  $('.err', f).textContent = msg;
}
const formCur = f => (f && f.elements.cur && f.elements.cur.value) || defCur();

function suggestions(field) {
  const seen = new Set(), out = [];
  for (const e of [...S.credits, ...S.expenses].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))) {
    const v = clean(e[field]);
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
    if (out.length >= 80) break;
  }
  return out;
}
const datalists = () => ['paidTo', 'reason', 'location', 'by'].map(f => `<datalist id="dl-${f}">${suggestions(f).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`).join('');
const textField = (name, label, ph, val, req = true) => `<label class="fld"><span>${label}${req ? '' : ' <em>(optional)</em>'}</span><input name="${name}" placeholder="${ph}" value="${esc(val)}" ${['paidTo', 'reason', 'location'].includes(name) ? `list="dl-${name}"` : ''} autocomplete="off" maxlength="160" ${req ? 'required' : ''}></label>`;
const curChips = (cur, label = 'Money type') => `<div class="fld"><span>${label}</span><div class="curseg">${CURS.map(c => `<label><input type="radio" name="cur" value="${esc(c)}" ${c === cur ? 'checked' : ''}><span><b>${c}</b><small>${CUR_NAME[c]}</small></span></label>`).join('')}</div></div>`;
const amountField = (val, cur, name = 'amount', label = 'Amount', req = true) => `<label class="fld"><span>${label}${req ? '' : ' <em>(optional)</em>'}</span><div class="amt-in"><b class="cur-sym">${SYM[cur].trim()}</b><input name="${name}" inputmode="decimal" placeholder="0" value="${esc(val || '')}" autocomplete="off" ${req ? 'required autofocus' : ''}></div><small class="amt-preview">${val ? money(+val, cur) : ''}</small></label>`;
// Every SSP entry states that day's rate (SSP for 1 US dollar), so its dollar value is known later.
const rateField = (cur, rate) => `<label class="fld ratef" ${cur === 'SSP' ? '' : 'hidden'}><span>SSP for 1 USD <em>(today's rate)</em></span><input name="rate" inputmode="decimal" placeholder="e.g. 4500" value="${esc(rate || S.lastRate || '')}" autocomplete="off" ${cur === 'SSP' ? 'required' : ''}><small class="amt-preview rate-usd"></small></label>`;
// the rate typed in a form: undefined for USD, null when SSP and missing or wrong
const rateFrom = (f, cur) => (cur === 'SSP' ? parseAmount(f.elements.rate && f.elements.rate.value) : undefined);
const RATE_ERR = 'Type how many SSP make 1 US dollar today, like 4500';
const byField = () => (signedIn()
  ? `<input type="hidden" name="by" value="${esc(myName())}"><p class="muted">Entered by <b>${esc(myName())}</b></p>`
  : `<label class="fld"><span>Your name <em>(who is entering this)</em></span><input name="by" placeholder="Type your name" value="${esc(S.lastBy || '')}" list="dl-by" autocomplete="off" maxlength="60" required></label>`);
// who confirms a delete: the signed-in person, or a typed name on phones without logins
function confirmBy(text) {
  if (signedIn()) return confirm(text) ? myName() : '';
  return clean(prompt(`${text}\n\nType your name to confirm:`, S.lastBy || ''));
}
const accountChips = (cur, label) => `<div class="fld"><span>${label}</span><div class="curseg">${ACCOUNTS.map(a => `<label><input type="radio" name="mode" value="${esc(a)}" ${a === accountOf(cur) ? 'checked' : ''}><span><b>${ACCOUNT_ICON[a]} ${a}</b><small>${a === 'Cash' ? 'Cash in hand' : 'Bank account'}</small></span></label>`).join('')}</div></div>`;
function projectSelect(cur, optional) {
  if (!can('projects')) return '<input type="hidden" name="project" value="">';
  const ps = S.projects.filter(p => !p.deleted);
  const isNew = !optional && (!ps.length || cur === '__new');
  return `<label class="fld"><span>Project${optional ? ' <em>(optional)</em>' : ''}</span><select name="project">
    ${optional ? `<option value="">No project — general</option>` : ''}
    ${ps.map(p => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    ${optional ? '' : `<option value="__new" ${isNew ? 'selected' : ''}>＋ New project…</option>`}
  </select></label>
  ${optional ? '' : `<label class="fld newp" ${isNew ? '' : 'hidden'}><span>New project name</span><input name="newProject" placeholder="e.g. Warehouse — Juba" maxlength="80"></label>`}`;
}
function whenField(at, editable) {
  if (editable) return `<label class="fld"><span>Date &amp; time</span><input type="datetime-local" name="at" value="${esc(at)}" required></label>`;
  return `<div class="fld"><span>Date &amp; time</span><div class="when"><div><b>${fmtWhen(stamp())}</b><small>Set automatically</small></div>${can('date') ? '<button type="button" class="btn small ghost" data-act="unlockDate">🔒 Change</button>' : ''}</div></div>`;
}

/* ---------- views ---------- */
function render() {
  const main = $('#main');
  const ready = !!S;
  $('#hdr').hidden = $('#tabs').hidden = !ready;
  if (!ready) { main.innerHTML = viewSetup(); $('[autofocus]', main)?.focus(); return; }
  if (mustSignIn()) { $('#hdr').hidden = $('#tabs').hidden = true; main.innerHTML = viewSignIn(); $('[autofocus]', main)?.focus(); return; }
  if ((tab === 'proj' && !can('projects')) || ((tab === 'staff' || tab === 'menu') && !can('staff'))) tab = 'home'; // one section only: no menu
  $('#tabs').hidden = !ACC_TABS.includes(tab);
  $('#menuBtn').hidden = tab === 'menu' || !can('staff');
  $('#tabs [data-tab=proj]').hidden = !can('projects');
  $('#whoChip').hidden = !signedIn();
  $('#whoChip').textContent = signedIn() ? `👤 ${session.user.name.split(' ')[0]}` : '';
  // the company's logo where its name would be; inside a section, the section's name
  $('#coName').innerHTML = tab === 'menu' || !can('staff') ? `<img class="co-logo" src="logo-wide.png" alt="${esc(S.company)}">` : tab === 'staff' ? 'Employees' : 'Accounts';
  $('#todayDate').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $$('#tabs [data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); });
  const y = tab === render.tab ? scrollY : 0; // redrawn after an edit: stay where you were
  main.innerHTML = { menu: viewMenu, home: viewHome, hist: viewHistory, proj: viewProjects, staff: viewStaff, sheet: viewSheet }[tab]();
  if (y) scrollTo(0, y);
  if (tab === 'staff') loadThumbs();
  render.tab = tab;
  renderLock(); paintSync();
}

let setupMode = ''; // '' = decide when drawn: an invite link in the address opens 'join'
const isPhone = () => matchMedia('(pointer: coarse)').matches;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const APP_LOGO = `<img class="logo" src="icon-192.png" alt="" width="64" height="64">`; // the company's mark (tools/make-icons.py)
const WIDE_LOGO = `<img class="wide-logo" src="logo-wide.png" alt="Brookfield Enterprises Limited" width="441" height="180">`; // mark and name
function viewSetup() {
  const mode = setupMode || 'join';
  const logo = APP_LOGO;
  const tip = isPhone() && !isInstalled() ? `<p class="note">📲 <b>First install the app:</b> iPhone — in Safari tap <b>Share → Add to Home Screen</b>. Android — in Chrome tap <b>⋮ → Add to Home screen</b>. Then open <b>Accounts</b> from your home screen.</p>` : '';
  const back = `<p class="center"><button class="link" data-act="setupMode" data-mode="join">← Back</button></p>`;
  if (mode === 'new') return `<section class="setup card pad">${logo}
    <h1>New company</h1>
    <p>Set up your company accounts. It takes 30 seconds.</p>
    <form data-form="setup">
      <label class="fld"><span>Company name</span><input name="company" required maxlength="80" placeholder="e.g. ABC Constructions" autofocus></label>
      <label class="fld"><span>Create a password</span><input type="password" name="pw" required minlength="4" autocomplete="new-password" placeholder="At least 4 letters or numbers"></label>
      <label class="fld"><span>Type the password again</span><input type="password" name="pw2" required minlength="4" autocomplete="new-password"></label>
      <p class="note">🔑 The password is needed to <b>edit</b> or <b>delete</b> entries, and to add entries with an <b>old date</b>. Anyone can add new entries. <b>Write it down — it can't be recovered.</b></p>
      <p class="err"></p>
      <button class="btn primary">Start</button>
    </form>${back}</section>`;
  return `<section class="setup card pad">${WIDE_LOGO}
    <h1>${WELCOME}</h1>
    <p>Open the invite link you were sent, or paste it below. Then sign in with the username and password your admin gave you.</p>${tip}
    <form data-form="join">
      <label class="fld"><span>Invite link</span><input name="invite" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste the link here" value="${esc(inviteFromHash() ? location.href : '')}" ${inviteFromHash() ? '' : 'autofocus'}></label>
      <p class="invite-hint"></p>
      <div class="loginfields">${signInFields(!!inviteFromHash())}</div>
      <details class="manual"><summary>Join with the web app link and code instead</summary>
        <label class="fld"><span>Web app link</span><input name="url" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <label class="fld"><span>Company code</span><input name="key" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="From the “Read me” tab"></label>
      </details>
      <p class="err"></p>
      <button class="btn primary">Sign in</button>
    </form>
    <details class="manual other"><summary>Other options</summary>
      <div class="stack"><button class="btn ghost" data-act="restore">Restore a backup file</button><button class="btn ghost" data-act="setupMode" data-mode="new">Start a new company</button></div>
    </details>
    <input type="file" id="restoreFile" accept=".json,application/json" hidden>
  </section>`;
}

// The first page after signing in: one big button per part of the company app.
function viewMenu() {
  const h = new Date().getHours(), hi = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const who = signedIn() ? session.user.name.split(' ')[0] : '';
  const staffWaiting = waiting().filter(c => c.kind === 'W').length;
  return `${moveBanner()}${updateBanner()}${signInBanner()}${approvalsBanner()}
    <section class="launch">
      <h1>${hi}${who ? ', ' + esc(who) : ''}</h1>
      <div class="apps">
        <button class="app-tile acc" data-act="tab" data-tab="home"><span class="ai"><svg viewBox="0 0 24 24"><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg></span><span><b>Accounts</b><small>Cash, bank and projects</small></span></button>
        <button class="app-tile emp" data-act="tab" data-tab="staff">${staffWaiting ? `<span class="badge">${staffWaiting} waiting</span>` : ''}<span class="ai"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6"/></svg></span><span><b>Employees</b><small>Salaries, advances and slips</small></span></button>
      </div>
    </section>`;
}

// Cash and bank balance for each currency. A move between them changes both, never the total.
function balances() {
  const b = Object.fromEntries(CURS.map(c => [c, { Cash: 0, Bank: 0 }]));
  live(S.credits).forEach(x => { b[x.cur][accountOf(x.mode)] += cents(x.amount); });
  live(S.expenses).forEach(x => { b[x.cur][accountOf(x.mode)] -= cents(x.amount); });
  live(S.transfers).forEach(x => { b[x.cur][x.from] -= cents(x.amount); b[x.cur][x.to] += cents(x.amount); });
  return Object.fromEntries(CURS.map(c => [c, { Cash: b[c].Cash / 100, Bank: b[c].Bank / 100, Total: (b[c].Cash + b[c].Bank) / 100 }]));
}
const plain = n => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
function viewHome() {
  const E = live(S.expenses), R = live(S.credits), T = live(S.transfers);
  const spent = byCur(E), recv = byCur(R), bal = balances();
  const today = stamp().slice(0, 10), month = today.slice(0, 7);
  const recent = [...E.map(x => [x, 'E']), ...R.map(x => [x, 'R']), ...T.map(x => [x, 'T'])].sort((a, b) => byAt(b[0], a[0])).slice(0, 8);
  const seeMoney = can('money');
  // like a banking app: the figures stay hidden until the code (or Face ID) is given; phones without logins show them
  const hide = signedIn() && !showMoney, M = '<span class="mask">••••••</span>';
  const fig = n => (hide ? M : plain(n));
  const lines = vals => (hide ? `<b>${M}</b>` : curLines(vals));
  return `${moveBanner()}${updateBanner()}${signInBanner()}${approvalsBanner()}${lookalikeBanner()}${backupBanner()}
  ${seeMoney ? '' : `<p class="hint" style="margin:0 4px 4px">Your expenses — only you and the office see them.</p>`}
  <section class="balance ${!hide && CURS.some(c => bal[c].Total < 0) ? 'neg' : ''}" aria-label="Balances" ${seeMoney ? '' : 'hidden'}>
    <div class="lbl">Balance</div>
    ${signedIn() ? `<button class="eye" data-act="${hide ? 'reveal' : 'conceal'}">${hide ? '👁 Show' : '🙈 Hide'}</button>` : ''}
    ${CURS.map(c => `<div class="balrow">
      <div class="balhead"><span class="cur-tag">${c}</span><span class="baltot${!hide && bal[c].Total < 0 ? ' neg' : ''}">${fig(bal[c].Total)}</span><small>total</small></div>
      <div class="balparts">${ACCOUNTS.map(a => `<span>${ACCOUNT_ICON[a]} ${a} <b class="${!hide && bal[c][a] < 0 ? 'neg' : ''}">${fig(bal[c][a])}</b></span>`).join('')}</div>
    </div>`).join('')}
    <div class="split"><div class="i"><small>Money received</small>${lines(recv)}</div><div class="o"><small>Money spent</small>${lines(spent)}</div></div>
  </section>
  <div class="actions">
    <button class="tile out" data-act="addExpense"><span class="ic">−</span><span><b>Add expense</b><small>Money paid out</small></span></button>
    <button class="tile in" data-act="addCredit" ${seeMoney ? '' : 'hidden'}><span class="ic">+</span><span><b>Money received</b><small>From a project</small></span></button>
    <button class="tile bulk" data-act="addBulk"><span class="ic">☰</span><span><b>Add many at once</b><small>Several payments together, with a total</small></span></button>
    <button class="tile bulk move" data-act="addMove" ${seeMoney ? '' : 'hidden'}><span class="ic">⇄</span><span><b>Move money</b><small>Cash into the bank, or bank to cash — not spending</small></span></button>
  </div>
  <div class="minis">
    <div class="mini"><small>Spent today</small>${lines(byCur(E.filter(e => e.at.startsWith(today))))}</div>
    <div class="mini"><small>Spent this month</small>${lines(byCur(E.filter(e => e.at.startsWith(month))))}</div>
  </div>
  <div class="sec-head" style="margin-top:22px"><h2 class="sec">Recent</h2><button class="btn small ghost" data-act="tab" data-tab="hist">See all →</button></div>
  ${recent.length ? `<div class="card list">${recent.map(([x, k]) => itemRow(x, k, true)).join('')}</div>` : empty('Nothing here yet', 'Tap <b>Add expense</b> or <b>Money received</b> to start.')}`;
}

function backupBanner() {
  if (S.link || (!S.expenses.length && !S.credits.length)) return '';
  const days = S.lastBackup ? Math.floor((Date.now() - new Date(S.lastBackup).getTime()) / 864e5) : null;
  if (days !== null && days < BACKUP_NAG_DAYS) return '';
  return `<div class="banner"><span>💾 ${days === null ? 'No backup saved yet.' : `Last backup was ${days} days ago.`}</span><button class="btn small" data-act="backup">Save backup</button></div>`;
}

function itemRow(x, k, showDate) {
  const when = [showDate ? fmtDay(x.at.slice(0, 10)) : '', fmtTime(x.at), x.by && 'by ' + x.by];
  if (k === 'T') {
    return `<button class="row move" data-act="open" data-kind="T" data-id="${esc(x.id)}">
    <span class="dot">⇄</span>
    <span class="main"><span class="t"><span class="tt">${ACCOUNT_ICON[x.from]} ${x.from} → ${ACCOUNT_ICON[x.to]} ${x.to}</span>${x.manualDate ? '<i class="tag warn">Date set</i>' : ''}</span><span class="s">${[x.note, ...when].filter(Boolean).map(esc).join(' · ')}</span></span>
    <span class="amt">${money(x.amount, x.cur)}</span></button>`;
  }
  const isE = k === 'E';
  const title = isE ? x.reason : `From ${projName(x.project)}`;
  const acct = accountOf(x.mode);
  const sub = [isE ? x.paidTo : x.note, isE ? x.location : '', `${ACCOUNT_ICON[acct]} ${acct}`, ...when].filter(Boolean).map(esc).join(' · ');
  const tags = (x.batch ? '<i class="tag">Bulk</i>' : '') + (x.editedAt ? '<i class="tag">Edited</i>' : '') + (x.manualDate ? '<i class="tag warn">Date set</i>' : '') + (waitingFor(x.id).length ? '<i class="tag warn">Change waiting</i>' : '')
    + (needsNewPaper(x.id) ? `<i class="tag bad">New ${isE ? (x.pay ? 'slip' : 'voucher') : 'receipt'} needed</i>` : '');
  return `<button class="row ${isE ? 'out' : 'in'}" data-act="open" data-kind="${k}" data-id="${esc(x.id)}">
    <span class="dot">${isE ? '−' : '+'}</span>
    <span class="main"><span class="t"><span class="tt">${esc(title)}</span>${tags}</span><span class="s">${sub}</span></span>
    <span class="amt">${isE ? '−' : '+'}${money(x.amount, x.cur)}</span></button>`;
}

function viewHistory() {
  const all = live(S[COLL[histKind]]);
  const months = [...new Set(all.map(x => x.at.slice(0, 7)))].sort().reverse();
  return `<div class="seg" role="tablist" ${can('money') ? '' : 'hidden'}>
      ${[['E', '− Out'], ['R', '+ In'], ['T', '⇄ Moves']].map(([k, label]) => `<button data-act="hist" data-k="${k}" class="${histKind === k ? 'on' : ''}" role="tab" aria-selected="${histKind === k}">${label}</button>`).join('')}
    </div>
    <div class="filters">
      <input type="search" id="q" placeholder="Search name, reason, place, USD/SSP…" value="${esc(histQuery)}" aria-label="Search">
      <select id="month" aria-label="Month"><option value="">All time</option>${months.map(m => `<option value="${esc(m)}" ${m === histMonth ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select>
    </div>
    <div id="histRes">${histResults()}</div>`;
}
function histResults() {
  const q = histQuery.trim().toLowerCase();
  const items = live(S[COLL[histKind]])
    .filter(x => !histMonth || x.at.startsWith(histMonth))
    .filter(x => !q || [x.id, x.paidTo, x.reason, x.location, x.note, x.project && projName(x.project), x.mode && accountOf(x.mode), x.from, x.to, x.amount, x.by, x.cur].join(' ').toLowerCase().includes(q))
    .sort((a, b) => byAt(b, a));
  if (!items.length) return `<div style="height:14px"></div>` + empty('No entries', q || histMonth ? 'Try a different search or month.' : 'Entries you add will show here.');
  const groups = new Map();
  items.forEach(x => { const d = x.at.slice(0, 10); (groups.get(d) || groups.set(d, []).get(d)).push(x); });
  return `<div class="sumline"><span>${items.length} ${items.length === 1 ? 'entry' : 'entries'}</span><b class="${{ E: 'out-c', R: 'in-c', T: '' }[histKind]}">${sumText(items)}</b></div>` +
    [...groups].map(([d, xs]) => `<div class="day"><span>${fmtDay(d)}</span><span>${sumText(xs)}</span></div><div class="card list">${xs.map(x => itemRow(x, histKind, false)).join('')}</div>`).join('');
}

const projBar = s => s.value ? `<div class="bar"><i style="width:${s.pct.toFixed(1)}%"></i></div><div class="pv"><span>${money(s.recv[s.vc], s.vc)} of ${money(s.value, s.vc)} received</span><span>${money(s.pending, s.vc)} pending</span></div>` : '';
const projStatsGrid = s => `<div class="stats"><div><small>Received</small><span class="in">${curLines(s.recv, s.curs)}</span></div><div><small>Spent</small><span class="out">${curLines(s.spent, s.curs)}</span></div><div><small>Balance</small><span>${curLines(s.bal, s.curs)}</span></div></div>`;
function viewProjects() {
  const ps = S.projects.filter(p => !p.deleted);
  const general = live(S.expenses).filter(e => !e.project);
  return `<div class="sec-head"><h2 class="sec">Projects</h2><button class="btn small primary" data-act="addProject">＋ New project</button></div>
    ${ps.length ? ps.map(projCard).join('') : empty('No projects yet', 'Add a project, then record the money you receive for it.')}
    ${general.length ? `<div class="card pad" style="margin-top:12px"><div class="ph" style="margin:0"><span>General expenses <em class="muted">(no project)</em></span><b class="out">${sumText(general)}</b></div></div>` : ''}`;
}
function projCard(p) {
  const s = projStats(p.id);
  return `<button class="card proj" data-act="openProject" data-id="${esc(p.id)}">
    <span class="ph"><b>${esc(p.name)}</b><span class="chev">›</span></span>
    ${projBar(s)}${projStatsGrid(s)}
  </button>`;
}

function viewSheet() {
  return `${moveBanner()}<div class="stack">
      ${syncCard()}
      ${loginsCard()}
      <section class="card pad" ${can('import') ? '' : 'hidden'}>
        <h3>📥 Old entries</h3>
        <p class="muted">Have expenses or cash/bank moves from before you started using the app? Paste the whole list in once — they go to every device and the Google Sheet.</p>
        <button class="btn ghost" data-act="importOld">Import old entries 🔒</button>
      </section>
      <section class="card pad" ${can('backup') ? '' : 'hidden'}>
        <h3>💾 Backup file</h3>
        <p class="muted">${S.lastBackup ? 'Last backup: <b>' + fmtAbs(S.lastBackup) + '</b>.' : '<b>No backup file yet.</b>'} ${S.link ? 'Your records are also kept in the company Google Sheet.' : 'Your records are saved on this device only — connect the Google Sheet above, or save a backup file every week.'}</p>
        <div class="two"><button class="btn ghost" data-act="backup">Save backup</button>${can('restore') ? '<button class="btn ghost" data-act="restore">Restore 🔒</button>' : ''}</div>
        <input type="file" id="restoreFile" accept=".json,application/json" hidden>
      </section>
      <section class="card pad">
        <h3>⚙️ Settings</h3>
        <div class="setrow" ${can('settings') ? '' : 'hidden'}><span>${esc(S.company)}<br><span class="muted">Company name${signedIn() ? '' : ', password'} · this device: ${esc(S.dev)}</span></span><button class="btn small ghost" data-act="settings">Change 🔒</button></div>
        <div class="setrow" ${can('settings') ? '' : 'hidden'}><span>Company stamp<br><span class="muted">${latestFile('settings', 'stamp') ? 'On every slip, with its date' : 'Not set'}</span></span><button class="btn small ghost" data-act="stamp">Change 🔒</button></div>
        <div class="setrow" ${can('settings') ? '' : 'hidden'}><span>Letterhead<br><span class="muted">${latestFile('settings', 'letterhead') ? 'Printed on vouchers and slips' : 'Not set — slips get a plain heading'}</span></span><button class="btn small ghost" data-act="letterhead">Change 🔒</button></div>
        <div class="setrow"><span>App version ${APP_VERSION.slice(0, 7)}<br><span class="muted">${newerVersion ? '🆕 A new version is ready' : 'Get the newest version of the app'}</span></span><button class="btn small ${newerVersion ? 'primary' : 'ghost'}" data-act="updateApp">${newerVersion ? 'Update now' : 'Check for update'}</button></div>
        <div class="setrow"><span>Lock now<br><span class="muted">Ask for the password again</span></span><button class="btn small ghost" data-act="lock">🔒 Lock</button></div>
      </section>
    </div>`;
}

/* ---------- forms ---------- */
function expenseForm(old) {
  const d = old || { cur: defCur(), amount: '', paidTo: '', reason: '', location: S.lastLoc || '', project: S.lastExpProject || '', mode: S.lastMode || 'Cash' };
  openSheet(`${head(old ? 'Edit expense' : 'Add expense', 'out', old?.id)}
    <form data-form="expense" data-id="${esc(old?.id || '')}">
      ${curChips(d.cur)}
      ${amountField(d.amount, d.cur)}
      ${rateField(d.cur, d.rate)}
      ${textField('paidTo', 'Paid to', 'Who did you pay?', d.paidTo)}
      ${textField('reason', 'Reason', 'What was it for?', d.reason)}
      ${textField('location', 'Location', 'Where?', d.location, false)}
      ${projectSelect(d.project, true)}
      ${accountChips(d.mode, 'Paid from')}
      ${whenField(old?.at, !!old)}
      ${byField()}${approvalNote(old)}
      ${old ? '' : `<label class="fld check"><input type="checkbox" name="sign"> ✍️ Get their signature now (payment voucher)</label>`}
      <p class="err"></p>
      <button class="btn out">${old ? saveLabel() : 'Save expense'}</button>
    </form>${datalists()}`);
}
function creditForm(old, presetProject) {
  const d = old || { cur: defCur(), amount: '', project: presetProject || S.lastProject || '', mode: 'Bank', note: '' };
  openSheet(`${head(old ? 'Edit money received' : 'Money received', 'in', old?.id)}
    <form data-form="credit" data-id="${esc(old?.id || '')}">
      ${curChips(d.cur)}
      ${amountField(d.amount, d.cur)}
      ${rateField(d.cur, d.rate)}
      ${projectSelect(d.project, false)}
      ${accountChips(d.mode, 'Received into')}
      ${textField('note', 'Note', 'e.g. 2nd installment', d.note, false)}
      ${whenField(old?.at, !!old)}
      ${byField()}${approvalNote(old)}
      ${old ? '' : `<label class="fld check"><input type="checkbox" name="sign"> 🧾 Make a receipt now</label>`}
      <p class="err"></p>
      <button class="btn in">${old ? saveLabel() : 'Save money received'}</button>
    </form>${datalists()}`);
}
function moveForm(old) {
  const d = old || { cur: defCur(), amount: '', from: 'Cash', note: '' };
  openSheet(`${head(old ? 'Edit money move' : 'Move money', '', old?.id)}
    <p class="hint">Putting cash into the bank (or taking cash out) is not spending — the total stays the same.</p>
    <form data-form="move" data-id="${esc(old?.id || '')}">
      ${curChips(d.cur)}
      ${amountField(d.amount, d.cur)}
      <div class="fld"><span>Which way?</span><div class="curseg">
        <label><input type="radio" name="from" value="Cash" ${d.from === 'Cash' ? 'checked' : ''}><span><b>💵 → 🏦</b><small>Cash into the bank</small></span></label>
        <label><input type="radio" name="from" value="Bank" ${d.from === 'Bank' ? 'checked' : ''}><span><b>🏦 → 💵</b><small>Bank to cash</small></span></label>
      </div></div>
      ${textField('note', 'Note', 'e.g. Deposit at the bank', d.note, false)}
      ${whenField(old?.at, !!old)}
      ${byField()}${approvalNote(old)}
      <p class="err"></p>
      <button class="btn primary">${old ? saveLabel() : 'Save move'}</button>
    </form>${datalists()}`);
}
const bulkRow = () => `<div class="brow"><span class="n"></span><input name="amount" inputmode="decimal" placeholder="Amount" autocomplete="off" aria-label="Amount"><input name="paidTo" placeholder="Paid to" list="dl-paidTo" autocomplete="off" maxlength="160" aria-label="Paid to"><input name="reason" placeholder="Reason" list="dl-reason" autocomplete="off" maxlength="160" aria-label="Reason"><button type="button" class="x" data-act="delRow" aria-label="Remove line">×</button></div>`;
function bulkForm() {
  openSheet(`${head('Add many expenses', 'out')}
    <p class="hint">One line for each payment. Empty lines are skipped.</p>
    <form data-form="bulk">
      ${curChips(defCur(), 'Money type (for every line)')}
      ${rateField(defCur())}
      <div class="brows">${bulkRow().repeat(4)}</div>
      <button type="button" class="btn small ghost" data-act="addRow">＋ Add another line</button>
      <div class="shared"><h3>Same for every line</h3>
        ${textField('location', 'Location', 'Where?', S.lastLoc || '', false)}
        ${projectSelect(S.lastExpProject || '', true)}
        ${accountChips(S.lastMode || 'Cash', 'Paid from')}
        ${whenField('', false)}
        ${byField()}
      </div>
      <div class="foot">
        <div class="btotal"><span id="bcount">0 payments</span><b id="bsum">${money(0, defCur())}</b></div>
        <p class="err"></p>
        <button class="btn out">Save all</button>
      </div>
    </form>${datalists()}`);
  $('.brow input', $('#sheet')).focus();
}
function projectForm(old) {
  const vc = old?.valueCur || defCur();
  openSheet(`${head(old ? 'Edit project' : 'New project', '', old?.id)}
    <form data-form="project" data-id="${esc(old?.id || '')}">
      <label class="fld"><span>Project name</span><input name="name" required maxlength="80" value="${esc(old?.name)}" placeholder="e.g. Warehouse — Juba" autofocus></label>
      ${curChips(vc, 'Project value is in')}
      ${amountField(old?.value, vc, 'value', 'Total project value', false)}
      <p class="muted" style="margin:-8px 0 14px">If you add the project value, the app shows how much is still pending from the client.</p>
      ${byField()}${approvalNote(old)}
      <p class="err"></p>
      <button class="btn primary">${old ? saveLabel() : 'Add project'}</button>
      ${old && can('delete') ? `<p class="center"><button type="button" class="link" data-act="delProject" data-id="${esc(old.id)}">Delete this project</button></p>` : ''}
    </form>${datalists()}`);
}
function settingsForm() {
  openSheet(`${head('Settings')}
    <form data-form="settings">
      <label class="fld"><span>Company name</span><input name="company" required maxlength="80" value="${esc(S.company)}"></label>
      <h3 class="subh">Change password <em>(leave empty to keep it)</em></h3>
      <label class="fld"><span>New password</span><input type="password" name="pw" minlength="4" autocomplete="new-password"></label>
      <label class="fld"><span>New password again</span><input type="password" name="pw2" minlength="4" autocomplete="new-password"></label>
      <p class="err"></p>
      <button class="btn primary">Save settings</button>
    </form>`);
}

function detail(k, id) {
  const r = S[COLL[k]].find(x => x.id === id);
  if (!r) return;
  const common = [['Date', fmtAbs(r.at)], ['Entered by', r.by], ['Recorded', fmtAbs(r.createdAt)], ['Last edited', r.editedAt && fmtAbs(r.editedAt)], ['Edited by', r.editedBy]];
  const facts = {
    E: () => [['Money type', CUR_NAME[r.cur]], ...rateFact(r), ['Paid to', r.paidTo], ['Reason', r.reason], ['Location', r.location], ['Project', projName(r.project)], ['Paid from', `${ACCOUNT_ICON[accountOf(r.mode)]} ${accountOf(r.mode)}`], ['Bulk group', r.batch], ...common],
    R: () => [['Money type', CUR_NAME[r.cur]], ...rateFact(r), ['Project', projName(r.project)], ['Received into', `${ACCOUNT_ICON[accountOf(r.mode)]} ${accountOf(r.mode)}`], ['Note', r.note], ...common],
    T: () => [['Money type', CUR_NAME[r.cur]], ['From', `${ACCOUNT_ICON[r.from]} ${r.from}`], ['To', `${ACCOUNT_ICON[r.to]} ${r.to}`], ['Note', r.note], ...common],
  }[k]();
  const look = { E: ['Expense', 'out', '−'], R: ['Money received', 'in', '+'], T: ['Money moved', '', ''] }[k];
  openSheet(`${head(look[0], look[1], r.id)}
    <div class="dbig ${look[1]}">${look[2]}${money(r.amount, r.cur)}</div>
    ${waitingNote(id)}
    <dl class="facts">${facts.filter(f => f[1]).map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    ${k === 'T' || r.deleted ? '' : `${cancelledNote(id)}<div class="two" style="margin-bottom:10px"><button class="btn ${k === 'E' ? 'out' : 'in'}" data-act="slip" data-kind="${k}" data-id="${esc(id)}">🧾 ${k === 'E' ? (r.pay ? 'Slip' : 'Voucher') : 'Receipt'}</button>${attachButton(id, '📎 Attach')}</div>`}
    <div class="two">${canChange() ? `<button class="btn ghost" data-act="edit" data-kind="${k}" data-id="${esc(id)}">✏️ Edit 🔒</button>` : ''}${can('delete') ? `<button class="btn danger" data-act="del" data-kind="${k}" data-id="${esc(id)}">🗑 Delete 🔒</button>` : can('suggest') && !waitingFor(id).length ? `<button class="btn danger" data-act="askDelete" data-kind="${k}" data-id="${esc(id)}">🗑 Ask to delete 🔒</button>` : ''}</div>
    ${canChange() ? '' : '<p class="muted center">To change this entry, ask the office.</p>'}
    ${k === 'E' && r.paidTo ? `<button class="btn ghost" data-act="payeeStatement" data-name="${esc(r.paidTo)}" style="margin-top:10px">📄 All payments to ${esc(r.paidTo)}</button>` : ''}
    ${filesBlock(id)}`);
  here = () => detail(k, id);
}
const rateFact = r => (usdOf(r) === null ? [] : [['SSP for 1 USD', `${plain(r.rate)} · about ${money(usdOf(r), 'USD')}`]]);
function projectDetail(id) {
  const p = S.projects.find(x => x.id === id); if (!p || p.deleted) return false;
  const s = projStats(id);
  const R = live(S.credits).filter(c => c.project === id).sort((a, b) => byAt(b, a));
  const E = live(S.expenses).filter(e => e.project === id).sort((a, b) => byAt(b, a));
  openSheet(`${head(p.name, '', p.id)}
    ${projBar(s)}
    <div style="margin-bottom:16px">${projStatsGrid(s)}</div>
    ${waitingNote(id)}
    <div class="two"><button class="btn in" data-act="addCredit" data-project="${esc(id)}">＋ Money received</button>${canChange() ? `<button class="btn ghost" data-act="editProject" data-id="${esc(id)}">✏️ Edit 🔒</button>` : ''}</div>
    <button class="btn ghost" data-act="projectStatement" data-id="${esc(id)}" style="margin-top:10px">📄 Statement of money received</button>
    ${can('edit') ? `<button class="btn ghost" data-act="assignPick" data-id="${esc(id)}" style="margin-top:10px">＋ Add existing expenses 🔒</button>` : ''}
    ${filesList(R.flatMap(r => filesFor(r.id, 'receipt')), 'Receipts')}
    <h3 class="subh">Money received (${R.length})</h3>
    ${R.length ? `<div class="card list inset">${R.map(x => itemRow(x, 'R', true)).join('')}</div>` : '<p class="muted">Nothing received yet.</p>'}
    <h3 class="subh">Spent on this project (${E.length})</h3>
    ${E.length ? `<div class="card list inset">${E.map(x => itemRow(x, 'E', true)).join('')}</div>` : '<p class="muted">No expenses linked to this project yet.</p>'}`);
  comeBack(() => projectDetail(id));
}

/* ---------- saving ---------- */
function dateFrom(v, old) {
  const at = v.at && AT_RE.test(v.at) ? v.at : (old ? old.at : stamp());
  const manualDate = old ? (old.manualDate || at !== old.at) : !!v.at && at.slice(0, 10) !== stamp().slice(0, 10);
  return { at, manualDate };
}
function saveExpense(f) {
  const v = Object.fromEntries(new FormData(f));
  const old = S.expenses.find(x => x.id === f.dataset.id);
  const amount = parseAmount(v.amount);
  if (amount === null) return formErr(f, 'amount', 'Type a correct amount, like 500');
  const cur = formCur(f), rate = rateFrom(f, cur);
  if (rate === null) return formErr(f, 'rate', RATE_ERR);
  const rec = { cur, amount, rate, paidTo: clean(v.paidTo), reason: clean(v.reason), location: clean(v.location), project: v.project || '', mode: v.mode || 'Cash', ...dateFrom(v, old) };
  if (!rec.paidTo) return formErr(f, 'paidTo', 'Who did you pay?');
  if (!rec.reason) return formErr(f, 'reason', 'What was it for?');
  const by = clean(v.by);
  if (!by) return formErr(f, 'by', 'Type your name');
  if (old) {
    const changes = diff(old, rec);
    if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
    if (!can('edit')) return requestChange('E', old, rec, changes, by);
    update({ expenses: S.expenses.map(x => x.id === old.id ? { ...x, ...rec, editedAt: stampSec(), editedBy: by } : x), log: logWith([['Edited', old.id, changes.join(' ; ')]], by), lastBy: by });
    toast('Changes saved ✓');
    if (needsNewPaper(old.id)) { render(); return slipSheet('E', old.id); } // its signed paper was cancelled: make the new one now
  } else {
    const [[id], seq] = nextIds('E', 1, S.seq);
    update({
      expenses: [...S.expenses, { id, ...rec, by, createdAt: stampSec(), batch: null }], seq,
      log: rec.manualDate ? logWith([['Old date', id, `Added with date ${fmtAbs(rec.at)} (password used) — ${describe('E', rec)}`]], by) : S.log,
      lastLoc: rec.location, lastMode: rec.mode, lastExpProject: rec.project, lastBy: by, lastCur: rec.cur, ...(rate ? { lastRate: rate } : {}),
    });
    toast(`Saved ✓ ${money(amount, rec.cur)} to ${rec.paidTo}`);
    if (v.sign) { render(); return slipSheet('E', id); }
  }
  closeSheet(); render();
}
function saveMove(f) {
  const v = Object.fromEntries(new FormData(f));
  const old = S.transfers.find(x => x.id === f.dataset.id);
  const amount = parseAmount(v.amount);
  if (amount === null) return formErr(f, 'amount', 'Type a correct amount, like 5000');
  const by = clean(v.by);
  if (!by) return formErr(f, 'by', 'Type your name');
  const from = v.from === 'Bank' ? 'Bank' : 'Cash';
  const rec = { cur: formCur(f), amount, from, to: from === 'Cash' ? 'Bank' : 'Cash', note: clean(v.note), ...dateFrom(v, old) };
  if (old) {
    const changes = diff(old, rec);
    if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
    if (!can('edit')) return requestChange('T', old, rec, changes, by);
    update({ transfers: S.transfers.map(x => x.id === old.id ? { ...x, ...rec, editedAt: stampSec(), editedBy: by } : x), log: logWith([['Edited', old.id, changes.join(' ; ')]], by), lastBy: by });
    toast('Changes saved ✓');
  } else {
    const [[id], seq] = nextIds('T', 1, S.seq);
    update({
      transfers: [...S.transfers, { id, ...rec, by, createdAt: stampSec() }], seq, lastBy: by, lastCur: rec.cur,
      log: rec.manualDate ? logWith([['Old date', id, `Added with date ${fmtAbs(rec.at)} (password used) — ${describe('T', rec)}`]], by) : S.log,
    });
    toast(`Saved ✓ ${money(amount, rec.cur)} moved ${from} → ${rec.to}`);
  }
  closeSheet(); render();
}
// Put many existing expenses under one project at once (e.g. a list imported without a project).
async function assignSheet(pid) {
  if (!await unlock('Enter the password to move expenses into this project.')) return;
  const p = S.projects.find(x => x.id === pid);
  const list = live(S.expenses).filter(e => e.project !== pid).sort((a, b) => byAt(b, a));
  openSheet(`${head('Add expenses to project', '', p.name)}
    <p class="hint">Tick the expenses that belong to <b>${esc(p.name)}</b>. Expenses without a project are shown.</p>
    <form data-form="assign" data-id="${esc(pid)}">
      ${list.some(e => e.project) ? '<label class="fld check"><input type="checkbox" name="others"> Also show expenses that are in another project</label>' : ''}
      <div class="two"><button type="button" class="btn small ghost" data-act="pickAll">Select all</button><button type="button" class="btn small ghost" data-act="pickNone">Select none</button></div>
      <div class="picklist">${list.length ? list.map(e => `<label class="pick" data-other="${e.project ? 1 : 0}" ${e.project ? 'hidden' : ''}>
        <input type="checkbox" name="pick" value="${esc(e.id)}"><span class="pd">${fmtDate(e.at.slice(0, 10))}</span>
        <span class="pr">${esc(e.reason)}<small>${esc(e.paidTo)}${e.project ? ' · now in ' + esc(projName(e.project)) : ''}</small></span><b>${money(e.amount, e.cur)}</b></label>`).join('') : '<p class="muted">No other expenses.</p>'}</div>
      ${byField()}
      <div class="foot"><div class="btotal"><span id="pickCount">0 selected</span><b id="pickSum"></b></div><p class="err"></p><button class="btn primary" id="pickBtn" disabled>Add to project</button></div>
    </form>${datalists()}`);
}
function updatePick(f) {
  const ids = new Set($$('input[name=pick]:checked', f).map(i => i.value));
  const chosen = live(S.expenses).filter(e => ids.has(e.id));
  $('#pickCount').textContent = `${chosen.length} selected`;
  $('#pickSum').textContent = chosen.length ? sumText(chosen) : '';
  $('#pickBtn').disabled = !chosen.length;
  $('#pickBtn').textContent = chosen.length ? `Add ${chosen.length} to project` : 'Add to project';
}
function saveAssign(f) {
  const pid = f.dataset.id, p = S.projects.find(x => x.id === pid);
  const ids = new Set($$('input[name=pick]:checked', f).map(i => i.value));
  if (!ids.size) return formErr(f, null, 'Tick at least one expense.');
  const by = clean(f.elements.by.value);
  if (!by) return formErr(f, 'by', 'Type your name');
  const moved = live(S.expenses).filter(e => ids.has(e.id));
  update({
    expenses: S.expenses.map(e => (ids.has(e.id) ? { ...e, project: pid, editedAt: stampSec(), editedBy: by } : e)),
    log: logWith([['Edited', pid, `${moved.length} expenses (${sumText(moved)}) put under project "${p.name}": ${moved.map(e => e.id).join(', ')}`]], by),
    lastBy: by,
  });
  render(); projectDetail(pid);
  toast(`✓ ${moved.length} expenses added to ${p.name}`);
}
function projectFromForm(v) {
  if (v.project !== '__new') return [v.project, S.projects, S.seq];
  const name = clean(v.newProject);
  if (!name) return [null];
  const same = S.projects.find(p => !p.deleted && p.name.toLowerCase() === name.toLowerCase());
  if (same) return [same.id, S.projects, S.seq];
  const [[id], seq] = nextIds('P', 1, S.seq);
  return [id, [...S.projects, { id, name, value: 0, valueCur: v.cur || 'USD', by: clean(v.by), createdAt: stampSec() }], seq];
}
function saveCredit(f) {
  const v = Object.fromEntries(new FormData(f));
  const old = S.credits.find(x => x.id === f.dataset.id);
  const amount = parseAmount(v.amount);
  if (amount === null) return formErr(f, 'amount', 'Type a correct amount, like 50000');
  const by = clean(v.by);
  const [project, projects, seq0] = projectFromForm(v);
  if (!project) return formErr(f, 'newProject', 'Type the new project name');
  if (!by) return formErr(f, 'by', 'Type your name');
  const cur = formCur(f), rate = rateFrom(f, cur);
  if (rate === null) return formErr(f, 'rate', RATE_ERR);
  const rec = { cur, amount, rate, project, mode: v.mode || 'Bank', note: clean(v.note), ...dateFrom(v, old) };
  if (projects !== S.projects) update({ projects, seq: seq0 }); // a new project must exist before describe()/log
  if (old) {
    const changes = diff(old, rec);
    if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
    if (!can('edit')) return requestChange('R', old, rec, changes, by);
    update({ credits: S.credits.map(x => x.id === old.id ? { ...x, ...rec, editedAt: stampSec(), editedBy: by } : x), log: logWith([['Edited', old.id, changes.join(' ; ')]], by), lastBy: by });
    toast('Changes saved ✓');
    if (needsNewPaper(old.id)) { render(); return slipSheet('R', old.id); } // its signed receipt was cancelled: make the new one now
  } else {
    const [[id], seq] = nextIds('R', 1, S.seq);
    update({
      credits: [...S.credits, { id, ...rec, by, createdAt: stampSec() }], seq, lastProject: project, lastBy: by, lastCur: rec.cur, ...(rate ? { lastRate: rate } : {}),
      log: rec.manualDate ? logWith([['Old date', id, `Added with date ${fmtAbs(rec.at)} (password used) — ${describe('R', rec)}`]], by) : S.log,
    });
    toast(`Saved ✓ ${money(amount, rec.cur)} received`);
    if (v.sign) { render(); return slipSheet('R', id); }
  }
  closeSheet(); render();
}
function bulkRows(f) {
  return $$('.brow', f).map(el => ({ el, amount: $('[name=amount]', el).value.trim(), paidTo: clean($('[name=paidTo]', el).value), reason: clean($('[name=reason]', el).value) }))
    .filter(r => r.amount || r.paidTo || r.reason);
}
function updateBulk(f) {
  const rows = bulkRows(f).filter(r => parseAmount(r.amount) !== null);
  $('#bcount').textContent = `${rows.length} ${rows.length === 1 ? 'payment' : 'payments'}`;
  $('#bsum').textContent = money(rows.reduce((t, r) => t + cents(parseAmount(r.amount)), 0) / 100, formCur(f));
}
function saveBulk(f) {
  $$('.bad', f).forEach(x => x.classList.remove('bad'));
  const rows = bulkRows(f);
  if (!rows.length) return formErr(f, null, 'Fill at least one line.');
  let ok = true;
  rows.forEach(r => {
    if (parseAmount(r.amount) === null) { $('[name=amount]', r.el).classList.add('bad'); ok = false; }
    if (!r.paidTo) { $('[name=paidTo]', r.el).classList.add('bad'); ok = false; }
    if (!r.reason) { $('[name=reason]', r.el).classList.add('bad'); ok = false; }
  });
  if (!ok) { $('.bad', f).focus(); return formErr(f, null, 'Fix the red boxes — every line needs an amount, paid to and reason.'); }
  const by = clean(f.elements.by.value);
  if (!by) return formErr(f, 'by', 'Type your name');
  const v = { cur: formCur(f), location: clean(f.elements.location.value), project: f.elements.project.value, mode: f.elements.mode.value || 'Cash', at: f.elements.at?.value };
  const rate = rateFrom(f, v.cur);
  if (rate === null) return formErr(f, 'rate', RATE_ERR);
  const { at, manualDate } = dateFrom(v);
  let seq = S.seq, batch, ids;
  [[batch], seq] = nextIds('B', 1, seq);
  [ids, seq] = nextIds('E', rows.length, seq);
  const recs = rows.map((r, i) => ({ id: ids[i], cur: v.cur, amount: parseAmount(r.amount), rate, paidTo: r.paidTo, reason: r.reason, location: v.location, project: v.project, mode: v.mode, at, manualDate, by, createdAt: stampSec(), batch }));
  update({
    expenses: [...S.expenses, ...recs], seq,
    log: manualDate ? logWith([['Old date', batch, `${recs.length} expenses (${ids[0]} to ${ids[ids.length - 1]}) added with date ${fmtAbs(at)} (password used), total ${money(total(recs), v.cur)}`]], by) : S.log,
    lastLoc: v.location, lastMode: v.mode, lastExpProject: v.project, lastBy: by, lastCur: v.cur, ...(rate ? { lastRate: rate } : {}),
  });
  closeSheet(); render();
  toast(`Saved ✓ ${recs.length} payments · ${money(total(recs), v.cur)}`);
}
function saveProject(f) {
  const v = Object.fromEntries(new FormData(f));
  const old = S.projects.find(p => p.id === f.dataset.id);
  const name = clean(v.name), valueCur = formCur(f);
  const value = v.value.trim() ? parseAmount(v.value) : 0;
  if (!name) return formErr(f, 'name', 'Type the project name');
  if (value === null) return formErr(f, 'value', 'Type a correct amount, or leave it empty');
  if (S.projects.some(p => !p.deleted && p.id !== old?.id && p.name.toLowerCase() === name.toLowerCase())) return formErr(f, 'name', 'A project with this name already exists');
  const by = clean(v.by);
  if (!by) return formErr(f, 'by', 'Type your name');
  if (old) {
    const changes = [old.name !== name && `Name: ${old.name} → ${name}`, (old.value !== value || (old.valueCur || 'USD') !== valueCur) && `Project value: ${money(old.value || 0, old.valueCur || 'USD')} → ${money(value, valueCur)}`].filter(Boolean);
    if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
    if (!can('edit')) return requestChange('P', old, { name, value, valueCur }, changes, by);
    update({ projects: S.projects.map(p => p.id === old.id ? { ...p, name, value, valueCur, editedAt: stampSec(), editedBy: by } : p), log: logWith([['Edited', old.id, changes.join(' ; ')]], by), lastBy: by });
  } else {
    const [[id], seq] = nextIds('P', 1, S.seq);
    update({ projects: [...S.projects, { id, name, value, valueCur, by, createdAt: stampSec() }], seq, lastBy: by });
  }
  closeSheet(); render(); toast('Project saved ✓');
}
async function saveSettings(f) {
  const v = Object.fromEntries(new FormData(f));
  const company = clean(v.company) || S.company;
  const entries = [];
  let pass = S.pass;
  if (v.pw || v.pw2) {
    if (v.pw !== v.pw2) return formErr(f, 'pw2', "The two passwords don't match.");
    const salt = randHex();
    pass = { salt, hash: await hashPw(v.pw, salt) };
    entries.push(['Password', '—', 'The password was changed']);
  }
  if (company !== S.company) entries.push(['Settings', '—', `Company name: ${S.company} → ${company}`]);
  update({ company, pass, log: logWith(entries) });
  closeSheet(); render(); toast('Settings saved ✓');
}
async function doSetup(f) {
  const v = Object.fromEntries(new FormData(f));
  if (v.pw !== v.pw2) return formErr(f, 'pw2', "The two passwords don't match.");
  const salt = randHex();
  S = { v: 2, company: clean(v.company), pass: { salt, hash: await hashPw(v.pw, salt) }, expenses: [], credits: [], transfers: [], projects: [], log: [], changes: [], workers: [], absences: [], files: [], kindsSeen: KINDS_SEEN, seq: {}, dev: newDev(), dirty: [], settingsU: Date.now(), link: null, createdAt: stampSec(), lastBackup: null };
  save();
  navigator.storage?.persist?.();
  render(); scrollTo(0, 0); toast('All set! Add your first entry.');
}

async function deleteRecord(k, id) {
  if (!await unlock('Enter the password to delete this entry.')) return;
  const key = KIND_KEY[k];
  const r = S[key].find(x => x.id === id);
  const by = confirmBy(k === 'W'
    ? `Delete ${whatIs(k, r)}?\n\nTheir payments stay in the accounts. The employee leaves the list, and their folder in Google Drive moves to "08 DELETED EMPLOYEES". A record stays in the Change Log.`
    : `Delete ${k === 'A' ? whatIs(k, r) : `${id} — ${money(r.amount, r.cur)}`}?\n\nIt will be removed from all totals. A record stays in the Change Log.`);
  if (!by) return;
  update({ [key]: S[key].map(x => x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x), log: logWith([['Deleted', id, whatIs(k, r)]], by), lastBy: by });
  closeSheet(); render(); toast('Deleted');
}
async function deleteProject(id) {
  const used = [...live(S.expenses), ...live(S.credits)].some(x => x.project === id);
  if (used) return alert('This project has entries. Delete or move those entries first.');
  if (!await unlock('Enter the password to delete this project.')) return;
  const p = S.projects.find(x => x.id === id);
  const by = confirmBy(`Delete project "${p.name}"?`);
  if (!by) return;
  update({ projects: S.projects.map(x => x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x), log: logWith([['Deleted', id, `Project "${p.name}"`]], by), lastBy: by });
  closeSheet(); render(); toast('Project deleted');
}

/* ---------- backup ---------- */
// Phones get the share sheet (Save to Files, WhatsApp, email…); computers get a normal download.
async function download(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isPhone() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function doBackup() {
  update({ lastBackup: stamp() });
  download(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }), `${fileSafe(S.company)} backup ${stamp().slice(0, 10)}.json`);
  render(); toast('Backup file ready ✓');
}
function validBackup(d) {
  const okRec = x => x && typeof x.id === 'string' && Number.isFinite(x.amount) && AT_RE.test(x.at) && CURS.includes(x.cur);
  return !!d && d.v === 2 && typeof d.company === 'string' && !!d.pass?.hash && !!d.pass?.salt &&
    ['expenses', 'credits', 'projects', 'log'].every(k => Array.isArray(d[k])) && d.expenses.every(okRec) && d.credits.every(okRec) && (d.transfers || []).every(okRec);
}
async function doRestore(file) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return alert('This file could not be read. Pick a backup file saved from this app.'); }
  if (!validBackup(data)) return alert('This is not a backup file from this app.');
  if (S) {
    if (!await unlock('Enter the password to restore a backup. It replaces the data on this computer.')) return;
    if (!confirm(`Replace ALL current data with this backup?\n\nBackup of: ${data.company}\n${live(data.expenses).length} expenses · ${live(data.credits).length} money received\n\nTip: save a backup of the current data first.`)) return;
  }
  // a fresh device code, so ids never clash with the device the backup came from;
  // migrate() also upgrades backups saved by older versions of the app
  const fresh = migrate({ ...data, seq: {}, dev: newDev(), dirty: [] });
  S = { ...fresh, dirty: fresh.link ? allIds(fresh) : [] };
  update({ log: logWith([['Restored', '—', `Data restored from backup file "${file.name}"`]]) });
  unlockedUntil = 0; tab = 'menu';
  closeAll(); render(); scheduleSync(0); toast('Backup restored ✓ — use the password from the backup');
}
