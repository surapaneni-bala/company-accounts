/**
 * Company Accounts — sync server for the company Google Sheet.
 *
 * Install (once): in the Google Sheet open Extensions → Apps Script, replace everything with
 * this file, run setup(), then Deploy → New deployment → Web app
 * (Execute as: Me, Who has access: Anyone). Full steps are in the README.
 *
 * The hidden "_sync" tab is the master copy of every record. Summary, Expenses, Money Received,
 * Cash & Bank moves, Ledger and Change Log are rebuilt from it after every change.
 *
 * Logins (version 3): the hidden "_users" and "_sessions" tabs hold each person's login. Passwords
 * and sign-in tokens are stored only as scrambled hashes. Until an admin switches on "Require logins",
 * phones with the company code keep working exactly as before.
 */
const SYNC_TAB = '_sync';
const FILES_TAB = '_files'; // every Drive file this script made, and which login uploaded it
const FILE_COLS = ['fileId', 'uid'];
// the first bytes of each kind of file allowed: a file must be what it says it is
const MAGIC = { 'image/jpeg': [0xFF, 0xD8, 0xFF], 'image/png': [0x89, 0x50, 0x4E, 0x47], 'application/pdf': [0x25, 0x50, 0x44, 0x46] };
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' };
const VIEW_TABS = ['Summary', 'Expenses', 'Money Received', 'Cash & Bank moves', 'Ledger', 'Change Log', 'Employees'];
// record kinds: Expense, Received, Project, Log, Settings, Transfer (cash ↔ bank move),
// Change request (an office manager's edit, delete or advance, waiting for an admin), Worker (employee),
// File (a photo or PDF kept in the company Google Drive: slip, voucher, receipt, attachment, ID photo …),
// Absence (one day an employee did not work: it comes off that month's wage)
const KINDS = ['E', 'R', 'P', 'L', 'S', 'T', 'C', 'W', 'F', 'A'];
const FILE_TYPES = ['voucher', 'receipt', 'slip', 'photo', 'attachment', 'profile', 'idphoto', 'letterhead', 'stamp', 'statement'];
const BRAND_FILES = ['letterhead', 'stamp']; // the company's own: only admins set them, every login's slips carry them
const FILE_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE = 8 * 1024 * 1024; // bytes
const ACCOUNTS = ['Cash', 'Bank'];
// every id the app makes looks like E-K7Q-0001, L-K7Q-lq2x0 or settings; anything else could carry markup into the app's pages
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const AT_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;
const DATE_RE = /^\d{4}-\d\d-\d\d$/;
const CURS = ['USD', 'SSP'];
// the fields an edit may change, per kind: an approved change request touches only these
const EDITABLE = {
  E: ['cur', 'amount', 'paidTo', 'reason', 'location', 'project', 'mode', 'at', 'manualDate', 'rate'],
  R: ['cur', 'amount', 'project', 'mode', 'note', 'at', 'manualDate', 'rate'],
  T: ['cur', 'amount', 'from', 'to', 'note', 'at', 'manualDate'],
  P: ['name', 'value', 'valueCur'],
  W: ['name', 'phone', 'job', 'site', 'wage', 'cur', 'start', 'idNo', 'status', 'left', 'openingAmount', 'openingNote', 'clearedTo'],
  A: ['date', 'note'],
};
// The same checks the app makes before it shows a record. Anything else is refused: it would also break the tabs.
const SHAPES = {
  E: d => money_(d) && str_(d.paidTo) && str_(d.reason) && extras_(d),
  R: d => money_(d) && extras_(d),
  T: d => money_(d) && ACCOUNTS.indexOf(d.from) >= 0 && ACCOUNTS.indexOf(d.to) >= 0 && d.from !== d.to,
  P: d => str_(d.name),
  L: d => str_(d.text) && str_(d.at),
  S: d => str_(d.company) && isObj_(d.pass) && str_(d.pass.salt) && str_(d.pass.hash),
  // a change request: an edit (only editable fields), a delete, or an advance above the monthly limit
  C: d => !!EDITABLE[d.kind] && SAFE_ID.test(d.target) && isObj_(d.before) && isObj_(d.after) && str_(d.text) && AT_RE.test(d.at)
    && ['waiting', 'approved', 'rejected'].indexOf(d.status) >= 0
    && (d.action === 'delete' ? !Object.keys(d.after).length
      : d.action === 'advance' ? d.kind === 'W' && num_(d.after.amount) && d.after.amount > 0 && CURS.indexOf(d.after.cur) >= 0 && Object.keys(d.after).length === 2
      : d.action === undefined && Object.keys(d.after).every(f => EDITABLE[d.kind].indexOf(f) >= 0)),
  A: d => SAFE_ID.test(d.worker) && DATE_RE.test(d.date) && (d.note === undefined || str_(d.note)),
  W: d => str_(d.name) && num_(d.wage) && d.wage >= 0 && CURS.indexOf(d.cur) >= 0 && DATE_RE.test(d.start)
    && ['active', 'left'].indexOf(d.status || 'active') >= 0 && (!d.left || DATE_RE.test(d.left)) && (d.openingAmount === undefined || num_(d.openingAmount))
    && (!d.clearedTo || DATE_RE.test(d.clearedTo)),
  F: d => /^[A-Za-z0-9_-]{10,100}$/.test(d.fileId) && str_(d.name) && FILE_MIMES.indexOf(d.mime) >= 0 && SAFE_ID.test(d.for) && FILE_TYPES.indexOf(d.type) >= 0,
};
const num_ = v => typeof v === 'number' && isFinite(v);
// optional fields on money records: the SSP rate of the day, and the employee a payment belongs to
const extras_ = d => (d.rate === undefined || (num_(d.rate) && d.rate > 0)) && (d.worker === undefined || SAFE_ID.test(d.worker))
  && (d.pay === undefined || ['salary', 'advance', 'settlement'].indexOf(d.pay) >= 0) && (d.month === undefined || /^\d{4}-\d\d$/.test(d.month))
  && (d.daysOff === undefined || (num_(d.daysOff) && d.daysOff >= 0 && d.daysOff <= 31)) && (d.approval === undefined || SAFE_ID.test(d.approval));
const str_ = v => typeof v === 'string';
const isObj_ = v => !!v && typeof v === 'object' && !Array.isArray(v);
const money_ = d => typeof d.amount === 'number' && isFinite(d.amount) && AT_RE.test(d.at) && CURS.indexOf(d.cur) >= 0;
// limits for logins other than admins (the app never sends more than MAX_PUSH records at once)
const MAX_PUSH = 200;
const MAX_RECORD = 5000; // characters
const LOCK_WAIT_MS = 25000;
const VERSION = 9; // shown when the web app link is opened in a browser
const FMT = {
  USD: '"$"#,##0.00;[Red]-"$"#,##0.00',
  SSP: '"SSP "#,##0.00;[Red]-"SSP "#,##0.00',
  num: '#,##0.00;[Red]-#,##0.00',
  pct: '0%',
  date: 'dd mmm yyyy',
};
const COLOR = {
  ink: '#1b2232', zebra: '#f8f6f1', line: '#e3ddd0', bal: '#e8ecf6', muted: '#6a6458',
  in: '#0e7c57', inSoft: '#e2f3ea', out: '#c0392b', outSoft: '#fce9e3', warn: '#8a5a00', warnSoft: '#fff3d6',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------- install ---------- */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase();
    props.setProperty('KEY', key);
  }
  const ss = SpreadsheetApp.getActive();
  syncTab_(ss);
  const rm = ss.getSheetByName('Read me') || ss.insertSheet('Read me', 0);
  rm.clear();
  rm.getRange(1, 1, 9, 1).setValues([
    ['Company Accounts — shared record book'],
    [''],
    ['Company code (keep it private — it is inside every invite link):'],
    [key],
    [''],
    ['• Summary, Expenses, Money Received, Cash & Bank moves, Ledger and Change Log update by themselves after every sync. Do not type in them.'],
    ['• The hidden "_sync" tab is the master copy of all records. Never edit or delete it.'],
    ['• USD and SSP are always kept separately.'],
    ['• Need an Excel file? File → Download → Microsoft Excel (.xlsx).'],
  ]);
  rm.getRange(1, 1).setFontSize(18).setFontWeight('bold');
  rm.getRange(4, 1).setFontSize(22).setFontWeight('bold').setFontColor(COLOR.in);
  rm.setColumnWidth(1, 900);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);
  rebuild_(ss, readAll_(syncTab_(ss)).map(toRec_));
  Logger.log('Company code: ' + key);
}

/* ---------- web app ---------- */
function doGet() {
  return json_({ ok: true, app: 'company-accounts', version: VERSION, kinds: KINDS, logins: users_().length > 0, required: required_() });
}

// Sync body:  { key | token, since, push: [{ id, k, u, d }] }  →  { ok, seq, sheet, pull, refused, me }
// Login body: { op: 'login' | 'setup' | 'logout' | 'password' | 'users' | 'saveUser' | 'require', … }
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  if (!req || typeof req !== 'object') return json_({ ok: false, error: 'Bad request' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return json_({ ok: false, error: 'The Google Sheet is busy. It will retry by itself.' });
  try {
    return json_(req.op ? account_(req) : sync_(req));
  } catch (err) { // left alone, Google answers with an error page the phone cannot read, which looks like "no internet"
    console.error(err && err.stack || err);
    return json_({ ok: false, error: sheetError_(err) });
  } finally {
    lock.releaseLock();
  }
}
function sheetError_(err) {
  const msg = String(err && err.message || err).slice(0, 300);
  return /permission|authori[sz]/i.test(msg)
    ? `The Google Sheet may not use Google Drive yet. In Apps Script choose allowFiles and press Run; on Google's permission screen tick every box (Select all) and press Continue. (${msg})`
    : `The Google Sheet hit an error: ${msg}`;
}

function sync_(req) {
  const who = who_(req);
  if (who.error) return { ok: false, error: who.error, code: who.code };
  const user = who.user;
  const ss = SpreadsheetApp.getActive();
  const sh = syncTab_(ss);
  const rows = readAll_(sh);
  // once the company has logins, a phone with only the company code (an old invite link) gets no staff records or files
  const codeOnly = !user && users_().length > 0;
  const result = merge_(rows, req.push, Number(req.since) || 0, user, uploads_(), codeOnly);
  let warning = '';
  if (result.changed) {
    sh.getRange(2, 1, result.rows.length, 5).setValues(result.rows);
    // the records are saved; a problem drawing the readable tabs must never stop syncing
    try { rebuild_(ss, result.rows.map(toRec_)); } catch (err) { warning = 'The readable tabs could not be refreshed: ' + err.message; Logger.log(warning); }
  }
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FILES_TIDY') !== String(VERSION)) { // once: what was deleted or cancelled before this version
    props.setProperty('FILES_TIDY', String(VERSION));
    result.moves = result.moves.concat(result.rows.map(toRec_).filter(r => r.d.deleted || (r.k === 'F' && r.d.cancelled))
      .map(r => ({ id: r.id, k: r.k, cancelled: !r.d.deleted })));
  }
  fileMoves_(result.rows, result.moves);
  if (!user && !users_().length) setupCode_(); // ready for the owner, inside the sheet
  return {
    ok: true, version: VERSION, seq: result.seq, sheet: user && user.role === 'store' ? '' : ss.getUrl(), kinds: KINDS,
    pull: result.pull.map(r => view_(user, r)).filter(r => r && !(codeOnly && (r.k === 'W' || r.k === 'F'))), refused: result.refused, me: user ? public_(user) : null,
    logins: !!user || users_().length > 0, warning: warning,
  };
}

// Who is asking: a signed-in person (token), or a phone with the company code (no login, full access as before).
function who_(req) {
  if (req.token) {
    const u = sessionUser_(String(req.token));
    return u ? { user: u } : { error: SIGNED_OUT, code: 'LOGIN' };
  }
  const key = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!key) return { error: 'The Google Sheet is not set up yet: run setup() in Apps Script.' };
  if (required_()) return { error: 'Please sign in with your username and password.', code: 'LOGIN' };
  if (String(req.key || '').toUpperCase() !== key) return { error: 'Wrong company code.' };
  return { user: null };
}

// What each login receives. Store keepers get only their own entries; only admins get the company password.
function view_(user, rec) {
  if (!user || user.role === 'admin') return rec;
  if (rec.k === 'S') return { id: rec.id, k: rec.k, u: rec.u, d: { company: rec.d.company } };
  if (user.role === 'manager') return rec;
  if (rec.k === 'F' && BRAND_FILES.indexOf(rec.d.type) >= 0) return rec; // everyone's vouchers carry the letterhead and stamp
  return (rec.k === 'E' || rec.k === 'L' || rec.k === 'F') && rec.d.uid === user.id ? rec : null;
}
// What each login may change. before = the stored copy (null for a new record).
function allowed_(user, p, before) {
  if (!user || user.role === 'admin') return true;
  if (before) return false; // only admins change what is already there (an office manager's edit is a change request)
  if (p.d.uid !== user.id || p.d.deleted) return false; // a new record carries its sender's login and isn't born deleted
  if (p.k === 'F' && BRAND_FILES.indexOf(p.d.type) >= 0) return false; // the company letterhead and stamp: admins only
  if (user.role === 'manager') return ['E', 'R', 'T', 'P', 'L', 'C', 'W', 'F', 'A'].indexOf(p.k) >= 0 && (p.k !== 'C' || p.d.status === 'waiting');
  return p.k === 'E' || p.k === 'L' || p.k === 'F'; // store keeper: own expenses, notes and their receipts
}

// Pure merge: newest copy of each record wins. rows are [id, kind, u, seq, json].
// user = the signed-in person (null = company code); records they may not change are refused.
// uploads = { fileId: uid of the login that uploaded it }; codeOnly = a company-code phone of a company with logins.
function merge_(rows, push, since, user, uploads, codeOnly) {
  const out = rows.map(r => r.slice());
  const index = Object.create(null); // ids come from phones: no inherited names like "constructor"
  out.forEach((r, i) => { index[r[0]] = i; });
  let seq = out.reduce((m, r) => Math.max(m, Number(r[3]) || 0), 0);
  let changed = false;
  const refused = [], moves = [];
  const limited = !!user && user.role !== 'admin', now = Date.now();
  (Array.isArray(push) ? push : []).forEach((p, n) => {
    if (!p || typeof p.id !== 'string' || !p.id || KINDS.indexOf(p.k) < 0 || typeof p.u !== 'number' || !isObj_(p.d)) return;
    if (!SAFE_ID.test(p.id) || (p.k !== 'S' && (p.k === 'L' ? p.d.lid : p.d.id) !== p.id) || !SHAPES[p.k](p.d)) { refused.push(p.id); return; }
    if (limited && (n >= MAX_PUSH || JSON.stringify(p.d).length > MAX_RECORD)) { refused.push(p.id); return; }
    const i = index[p.id];
    if (i !== undefined && out[i][1] !== p.k) { refused.push(p.id); return; } // a record never changes kind
    const u = limited ? Math.min(p.u, now) : p.u; // a phone can't stamp its copy in the future and so block later edits
    if (i !== undefined && Number(out[i][2]) >= u) return; // already have this copy or a newer one (e.g. sent again after a lost reply)
    const before = i === undefined ? null : JSON.parse(out[i][4]);
    if (!allowed_(user || null, p, before)) { refused.push(p.id); return; }
    if (codeOnly && (p.k === 'W' || p.k === 'F')) { refused.push(p.id); return; }
    const t = p.k === 'C' ? index[p.d.target] : 0;
    if (t === undefined || (p.k === 'C' && out[t][1] !== p.d.kind)) { refused.push(p.id); return; } // a change request needs its entry
    // an edit must leave its entry valid: approving it can never produce a record the sheet would refuse
    if (p.k === 'C' && !p.d.action && !SHAPES[p.d.kind](Object.assign(JSON.parse(out[t][4]), p.d.after))) { refused.push(p.id); return; }
    // a file record may only name a file this script uploaded (else it could fetch any file in the owner's Drive),
    // and a non-admin only one they uploaded themselves
    const up = p.k === 'F' ? (uploads || {})[p.d.fileId] : '';
    if (up === undefined || (p.k === 'F' && limited && up !== user.id)) { refused.push(p.id); return; }
    if (p.k === 'A' && limited && (index[p.d.worker] === undefined || out[index[p.d.worker]][1] !== 'W')) { refused.push(p.id); return; } // a day not worked belongs to an employee
    if (p.k === 'F' && limited) { // a file belongs to a record the sender may see (a store keeper: their own)
      const f = index[p.d.for];
      if (f === undefined || (user.role === 'store' && JSON.parse(out[f][4]).uid !== user.id)) { refused.push(p.id); return; }
    }
    const d = limited ? Object.assign({}, p.d, { by: user.name }) : p.d; // signed by the login that sent it
    seq += 1;
    changed = true;
    const row = [p.id, p.k, u, seq, JSON.stringify(d)];
    if (i === undefined) { index[p.id] = out.length; out.push(row); } else { out[i] = row; }
    if (d.deleted && !(before && before.deleted)) moves.push({ id: p.id, k: p.k });
    else if (p.k === 'F' && d.cancelled && !(before && before.cancelled)) moves.push({ id: p.id, k: 'F', cancelled: true });
  });
  const pull = out.filter(r => Number(r[3]) > since).map(toRec_);
  return { rows: out, seq: seq, changed: changed, pull: pull, refused: refused, moves: moves };
}

/* ---------- logins ---------- */
const USERS_TAB = '_users';
const SESSIONS_TAB = '_sessions';
const USER_COLS = ['id', 'username', 'name', 'role', 'salt', 'hash', 'active', 'fails', 'lockUntil', 'createdAt', 'createdBy', 'lastLogin'];
const SESSION_COLS = ['token', 'uid', 'createdAt', 'seen', 'device'];
const ROLES = ['admin', 'manager', 'store']; // admin = everything · manager = sees all, adds and edits · store = own entries
const PW_MIN = 8;
const PW_ROUNDS = 1000; // ponytail: repeated SHA-256 (Apps Script has no PBKDF2) slows down guessing; raise it if signing in stays quick
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const SESSION_MS = 30 * 864e5; // signed out after 30 days without using the app
const SEEN_EVERY_MS = 864e5;   // "last used" is written at most once a day
const MAX_SESSIONS = 10; // signed-in phones per person; the oldest is signed out
const SIGNED_OUT = 'You have been signed out. Please sign in again.';
// one message for every failure, so nobody learns which usernames exist or are locked
const WRONG_LOGIN = 'Wrong username or password. After 5 wrong tries, wait 15 minutes.';

function account_(req) {
  if (req.op === 'upload' || req.op === 'file') return files_(req);
  if (req.op === 'login') return login_(req);
  if (req.op === 'setup') return setupLogins_(req);
  const me = req.token ? sessionUser_(String(req.token)) : null;
  if (!me) return { ok: false, error: SIGNED_OUT, code: 'LOGIN' };
  if (req.op === 'logout') { endSessions_('', sha_(String(req.token)), true); return { ok: true }; }
  if (req.op === 'password') return changePassword_(me, req);
  if (me.role !== 'admin') return { ok: false, error: 'Only an admin can do this.' };
  if (req.op === 'users') return { ok: true, users: users_().map(public_), required: required_() };
  if (req.op === 'saveUser') return saveUser_(me, req.user || {});
  if (req.op === 'require') {
    PropertiesService.getScriptProperties().setProperty('REQUIRE_LOGIN', req.on ? '1' : '0');
    return { ok: true, required: !!req.on };
  }
  return { ok: false, error: 'Unknown request' };
}
const required_ = () => PropertiesService.getScriptProperties().getProperty('REQUIRE_LOGIN') === '1';

/* ---------- files: photos and PDFs kept in a private folder of the sheet owner's Google Drive ---------- */
// Never shared by link: a file only leaves Drive through this script, to someone allowed to see its record.
function files_(req) {
  const who = who_(req);
  if (who.error) return { ok: false, error: who.error, code: who.code };
  if (!who.user && users_().length > 0) return { ok: false, error: 'Please sign in with your username and password to send or open files.', code: 'LOGIN' };
  if (req.op === 'upload') {
    if (FILE_MIMES.indexOf(req.mime) < 0) return { ok: false, error: 'Only photos (JPG, PNG) and PDFs can be kept.' };
    const bytes = Utilities.base64Decode(String(req.data || ''));
    if (!bytes.length || bytes.length > MAX_FILE) return { ok: false, error: 'The file is empty or bigger than 8 MB.' };
    if (!MAGIC[req.mime].every((b, i) => ((bytes[i] + 256) % 256) === b)) return { ok: false, error: 'This file is not a real photo or PDF.' };
    const name = (String(req.name || '').replace(/\.[^.]*$/, '').replace(/[^\w .()-]/g, '').slice(0, 80) || 'file') + EXT[req.mime];
    const file = monthFolder_().createFile(Utilities.newBlob(bytes, req.mime, name));
    saveRows_(FILES_TAB, FILE_COLS, rowsOf_(FILES_TAB, FILE_COLS).concat([{ fileId: file.getId(), uid: who.user ? who.user.id : '' }]));
    return { ok: true, fileId: file.getId() };
  }
  const row = readAll_(syncTab_(SpreadsheetApp.getActive())).filter(r => r[0] === String(req.id) && r[1] === 'F')[0];
  const rec = row && view_(who.user, toRec_(row));
  if (!rec) return { ok: false, error: 'This file is not available to you.' };
  const blob = DriveApp.getFileById(rec.d.fileId).getBlob();
  return { ok: true, name: rec.d.name, mime: rec.d.mime, data: Utilities.base64Encode(blob.getBytes()) };
}
function uploads_() {
  const map = Object.create(null);
  rowsOf_(FILES_TAB, FILE_COLS).forEach(r => { map[String(r.fileId)] = String(r.uid); });
  return map;
}
function filesRoot_() {
  const props = PropertiesService.getScriptProperties();
  let root = null;
  try { root = props.getProperty('FILES_FOLDER') ? DriveApp.getFolderById(props.getProperty('FILES_FOLDER')) : null; } catch (err) { root = null; }
  if (!root) { root = DriveApp.createFolder('Company app files (do not share)'); props.setProperty('FILES_FOLDER', root.getId()); }
  return root;
}
function monthFolder_() {
  const root = filesRoot_();
  const month = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  const found = root.getFoldersByName(month);
  return found.hasNext() ? found.next() : root.createFolder(month);
}
// Nothing is thrown away. A deleted record's files go to the "Deleted" folder; a cancelled voucher, receipt or slip
// (its entry changed after it was signed) is renamed "CANCELLED …" and goes to "Cancelled". A Drive problem never stops a sync.
function fileMoves_(rows, moves) {
  if (!moves.length) return;
  const files = rows.filter(r => r[1] === 'F').map(r => JSON.parse(r[4]));
  moves.forEach(m => (m.k === 'F' ? files.filter(f => f.id === m.id) : files.filter(f => f.for === m.id)).forEach(f => {
    try {
      const file = DriveApp.getFileById(f.fileId);
      if (m.cancelled && !/^CANCELLED /.test(file.getName())) file.setName('CANCELLED ' + file.getName());
      file.moveTo(subFolder_(m.cancelled ? 'Cancelled' : 'Deleted'));
    } catch (err) { console.error('Could not put away ' + f.id + ': ' + err.message); }
  }));
}
function subFolder_(name) {
  const root = filesRoot_(), found = root.getFoldersByName(name);
  return found.hasNext() ? found.next() : root.createFolder(name);
}
// Run this once in the Apps Script editor after pasting the script: Google then asks permission to use Drive.
// Google's permission screen has a box for each permission; one left unticked is never asked for again by itself,
// so this asks for every missing one, then makes the files folder: if Drive is still not allowed, it fails here.
function allowFiles() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  const folder = monthFolder_();
  Logger.log(`Drive access is allowed: files go to "Company app files (do not share)/${folder.getName()}". Now: Deploy → Manage deployments → ✏️ → New version → Deploy.`);
}

// The very first login is the owner's. It needs the company code AND a one-time setup code that is written only
// inside the Google Sheet ("Read me" tab), so only the person who owns the sheet can become the first admin.
function setupLogins_(req) {
  if (users_().length) return { ok: false, error: 'Logins are already set up. Ask an admin to give you a login.' };
  const props = PropertiesService.getScriptProperties(), key = props.getProperty('KEY');
  if (!key || String(req.key || '').toUpperCase() !== key) return { ok: false, error: 'Wrong company code.' };
  if (String(req.setupCode || '').trim().toUpperCase() !== setupCode_()) return { ok: false, error: 'Wrong setup code. Open your Google Sheet, "Read me" tab: the setup code is at the bottom.' };
  const made = saveUser_({ name: 'Setup' }, { name: req.name, username: req.username, role: 'admin', password: req.newPassword, active: true });
  if (!made.ok) return made;
  const list = users_();
  list[0].lastLogin = Date.now();
  saveUsers_(list);
  props.deleteProperty('SETUP_CODE');
  readMe_().getRange(SETUP_ROW, 1, 2, 1).setValues([['Logins are set up. Admins give logins in the app: Sheet tab → Logins.'], ['']]);
  return { ok: true, token: startSession_(list[0], req.device), me: public_(list[0]) };
}
const SETUP_ROW = 11;
const readMe_ = () => SpreadsheetApp.getActive().getSheetByName('Read me') || SpreadsheetApp.getActive().insertSheet('Read me', 0);
function setupCode_() {
  const props = PropertiesService.getScriptProperties();
  let code = props.getProperty('SETUP_CODE');
  if (!code) {
    code = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
    props.setProperty('SETUP_CODE', code);
    const rm = readMe_();
    rm.getRange(SETUP_ROW, 1, 2, 1).setValues([['Logins setup code — type it once in the app (Sheet tab → Logins → Set up logins). Only someone who can open this sheet can see it:'], [code]]);
    rm.getRange(SETUP_ROW + 1, 1).setFontSize(22).setFontWeight('bold').setFontColor(COLOR.in);
  }
  return code;
}

function login_(req) {
  const list = users_(), now = Date.now();
  const u = list.filter(x => x.username === cleanUsername_(req.username))[0];
  if (!u || !u.active || u.lockUntil > now) return { ok: false, error: WRONG_LOGIN };
  if (pwHash_(u.salt, String(req.password || '')) !== u.hash) return wrongTry_(list, u);
  u.fails = 0; u.lockUntil = 0; u.lastLogin = now;
  saveUsers_(list);
  return { ok: true, token: startSession_(u, req.device), me: public_(u) };
}

// Admins add a login or change one: name, username, role, password reset, disable/enable.
function saveUser_(me, input) {
  const list = users_(), now = Date.now();
  const old = input.id ? list.filter(x => x.id === String(input.id))[0] : null;
  if (input.id && !old) return { ok: false, error: 'That login no longer exists.' };
  const u = old ? Object.assign({}, old) : { id: 'U-' + Utilities.getUuid().slice(0, 8).toUpperCase(), active: true, fails: 0, lockUntil: 0, createdAt: now, createdBy: me.name, lastLogin: 0, salt: '', hash: '' };
  if (input.name !== undefined) u.name = String(input.name).trim().replace(/\s+/g, ' ');
  if (input.username !== undefined) u.username = cleanUsername_(input.username);
  if (input.role !== undefined) u.role = String(input.role);
  if (input.active !== undefined) u.active = !!input.active;
  const pw = input.password === undefined || input.password === '' ? null : String(input.password);
  if (!old && pw === null) return { ok: false, error: 'Give the new login a password.' };
  if (!/^[a-z0-9._-]{2,30}$/.test(u.username)) return { ok: false, error: 'Username: 2 to 30 letters or numbers, no spaces.' };
  if (list.some(x => x.id !== u.id && x.username === u.username)) return { ok: false, error: 'This username is already taken.' };
  if (!u.name || u.name.length > 60) return { ok: false, error: "Type the person's name." };
  if (ROLES.indexOf(u.role) < 0) return { ok: false, error: 'Pick what this person may do.' };
  if (pw !== null && pw.length < PW_MIN) return { ok: false, error: 'The password needs at least ' + PW_MIN + ' characters.' };
  const admins = list.filter(x => x.id !== u.id && x.active && x.role === 'admin').length + (u.active && u.role === 'admin' ? 1 : 0);
  if (!admins) return { ok: false, error: 'There must always be at least one admin.' };
  if (pw !== null) { u.salt = newSecret_().slice(0, 32); u.hash = pwHash_(u.salt, pw); u.fails = 0; u.lockUntil = 0; }
  saveUsers_(old ? list.map(x => (x.id === u.id ? u : x)) : list.concat([u]));
  // a new password, a new role or a disabled login: signed out everywhere, so the phone reloads what it may see
  if (old && (pw !== null || !u.active || u.role !== old.role)) endSessions_(u.id, '', false);
  return { ok: true, users: users_().map(public_) };
}

// a wrong password counts towards the 15-minute lock, whether signing in or changing it
function wrongTry_(list, u) {
  u.fails += 1;
  if (u.fails >= MAX_FAILS) { u.fails = 0; u.lockUntil = Date.now() + LOCK_MS; }
  saveUsers_(list);
  return { ok: false, error: WRONG_LOGIN };
}

function changePassword_(me, req) {
  const list = users_();
  const u = list.filter(x => x.id === me.id)[0];
  if (u.lockUntil > Date.now()) return { ok: false, error: WRONG_LOGIN };
  if (pwHash_(u.salt, String(req.old || '')) !== u.hash) return Object.assign(wrongTry_(list, u), { error: 'Your current password is wrong. After 5 wrong tries, wait 15 minutes.' });
  const pw = String(req.password || '');
  if (pw.length < PW_MIN) return { ok: false, error: 'The new password needs at least ' + PW_MIN + ' characters.' };
  u.salt = newSecret_().slice(0, 32); u.hash = pwHash_(u.salt, pw);
  saveUsers_(list);
  endSessions_(u.id, sha_(String(req.token)), false); // other phones sign in again; this one stays
  return { ok: true };
}

/* sessions: one row per signed-in phone; the token itself is never stored, only its hash */
function sessionUser_(token) {
  const h = sha_(token), now = Date.now();
  const sessions = rowsOf_(SESSIONS_TAB, SESSION_COLS);
  const s = sessions.filter(x => String(x.token) === h)[0];
  if (!s || now - Number(s.seen) > SESSION_MS) return null;
  const u = users_().filter(x => x.id === String(s.uid))[0];
  if (!u || !u.active) return null;
  if (now - Number(s.seen) > SEEN_EVERY_MS) { s.seen = now; saveRows_(SESSIONS_TAB, SESSION_COLS, sessions); }
  return u;
}
function startSession_(u, device) {
  const token = newSecret_(), now = Date.now();
  const live = rowsOf_(SESSIONS_TAB, SESSION_COLS).filter(s => now - Number(s.seen) <= SESSION_MS);
  const theirs = live.filter(s => String(s.uid) === u.id).sort((a, b) => Number(b.seen) - Number(a.seen)).slice(0, MAX_SESSIONS - 1);
  const keep = live.filter(s => String(s.uid) !== u.id).concat(theirs);
  saveRows_(SESSIONS_TAB, SESSION_COLS, keep.concat([{ token: sha_(token), uid: u.id, createdAt: now, seen: now, device: String(device || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20) }]));
  return token;
}
// only = true: end just the session with this token hash. Otherwise end all of uid's sessions except that one.
function endSessions_(uid, tokenHash, only) {
  const left = rowsOf_(SESSIONS_TAB, SESSION_COLS).filter(s => (only ? String(s.token) !== tokenHash : String(s.uid) !== uid || String(s.token) === tokenHash));
  saveRows_(SESSIONS_TAB, SESSION_COLS, left);
}

function users_() {
  return rowsOf_(USERS_TAB, USER_COLS).map(u => Object.assign(u, {
    id: String(u.id), username: String(u.username), name: String(u.name), role: String(u.role), salt: String(u.salt), hash: String(u.hash),
    active: String(u.active) === 'true', fails: Number(u.fails) || 0, lockUntil: Number(u.lockUntil) || 0, lastLogin: Number(u.lastLogin) || 0,
  }));
}
const saveUsers_ = list => saveRows_(USERS_TAB, USER_COLS, list.map(u => Object.assign({}, u, { active: u.active ? 'true' : 'false' })));
const public_ = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active, lastLogin: u.lastLogin || 0 });
const cleanUsername_ = s => String(s || '').trim().toLowerCase();

// small hidden tables: a header row, then one object per row; stored as plain text so nothing is reformatted
function rowsOf_(name, cols) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const n = sh ? sh.getLastRow() - 1 : 0;
  return n > 0 ? sh.getRange(2, 1, n, cols.length).getValues().map(r => {
    const o = {};
    cols.forEach((c, i) => { o[c] = r[i]; });
    return o;
  }) : [];
}
function saveRows_(name, cols, objs) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.hideSheet(); }
  const data = [cols].concat(objs.map(o => cols.map(c => (o[c] === undefined || o[c] === null ? '' : String(o[c])))));
  const had = sh.getLastRow();
  // write first, then remove leftover rows: a failure halfway never leaves the table empty
  sh.getRange(1, 1, data.length, cols.length).setNumberFormat('@').setValues(data);
  if (had > data.length) sh.getRange(data.length + 1, 1, had - data.length, cols.length).clearContent();
}

function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function pwHash_(salt, pw) {
  let h = sha_(salt + '|' + pw);
  for (let i = 1; i < PW_ROUNDS; i++) h = sha_(salt + h);
  return h;
}
const newSecret_ = () => (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); // 64 random hex characters

/* ---------- storage ---------- */
function syncTab_(ss) {
  let sh = ss.getSheetByName(SYNC_TAB);
  if (!sh) {
    sh = ss.insertSheet(SYNC_TAB);
    sh.getRange(1, 1, 1, 5).setValues([['id', 'kind', 'updated', 'seq', 'record']]);
    sh.hideSheet();
  }
  return sh;
}
function readAll_(sh) {
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, 5).getValues() : [];
}
function toRec_(r) { return { id: String(r[0]), k: String(r[1]), u: Number(r[2]), d: JSON.parse(r[4]) }; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- readable tabs ---------- */
function rebuild_(ss, all) {
  const recs = all.filter(r => SHAPES[r.k] && SHAPES[r.k](r.d)); // a damaged record is left out instead of breaking every tab
  const of = k => recs.filter(r => r.k === k).map(r => r.d);
  const projects = Object.create(null);
  of('P').forEach(p => { projects[p.id] = p; });
  const pname = id => (id ? (projects[id] ? projects[id].name : 'Unknown project') : 'General (no project)');
  const workers = Object.create(null);
  of('W').forEach(w => { workers[w.id] = w; });
  const wname = id => (workers[id] ? workers[id].name : 'Unknown employee');
  const live = k => of(k).filter(x => !x.deleted && (k !== 'T' || (ACCOUNTS.indexOf(x.from) >= 0 && ACCOUNTS.indexOf(x.to) >= 0))).sort(byAt_);
  const settings = of('S')[0] || {};
  const ctx = { E: live('E'), R: live('R'), T: live('T'), P: of('P').filter(x => !x.deleted), L: of('L').sort(byAt_), pname: pname, wname: wname, company: settings.company || 'Company' };
  summary_(ss, ctx);
  expenses_(ss, ctx);
  received_(ss, ctx);
  moves_(ss, ctx);
  ledger_(ss, ctx);
  changeLog_(ss, ctx);
  employees_(ss, ctx, of('W').filter(x => !x.deleted));
  // keep the tabs in a fixed order right after "Read me"
  VIEW_TABS.forEach((name, i) => {
    if (ss.getSheets()[i + 1].getName() !== name) { ss.setActiveSheet(ss.getSheetByName(name)); ss.moveActiveSheet(i + 2); }
  });
}
const byAt_ = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : String(a.createdAt || '') < String(b.createdAt || '') ? -1 : String(a.createdAt || '') > String(b.createdAt || '') ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// entries from older app versions may say Card, Cheque or Mobile money
const accountOf_ = mode => (/^(bank|card|cheque|check)/i.test(String(mode || '')) ? 'Bank' : 'Cash');
// running Cash / Bank balance per currency, in cents
function balances_(c) {
  const b = { USD: { Cash: 0, Bank: 0 }, SSP: { Cash: 0, Bank: 0 } };
  c.R.forEach(x => { if (b[x.cur]) b[x.cur][accountOf_(x.mode)] += cents_(x.amount); });
  c.E.forEach(x => { if (b[x.cur]) b[x.cur][accountOf_(x.mode)] -= cents_(x.amount); });
  c.T.forEach(x => { if (b[x.cur]) { b[x.cur][x.from] -= cents_(x.amount); b[x.cur][x.to] += cents_(x.amount); } });
  return b;
}

const cents_ = n => Math.round(Number(n || 0) * 100);
const sum_ = (xs, cur) => xs.filter(x => x.cur === cur).reduce((t, x) => t + cents_(x.amount), 0) / 100;
const sub_ = (a, b) => (cents_(a) - cents_(b)) / 100;
// Dates are written as "2026-10-06" text: Sheets reads that as a date in its own time zone,
// so a different script time zone can never shift it by a day.
const ymd_ = at => at.slice(0, 10);
const day_ = at => new Date(Number(at.slice(0, 4)), Number(at.slice(5, 7)) - 1, Number(at.slice(8, 10)));
const time_ = at => { const h = Number(at.slice(11, 13)), m = at.slice(14, 16); return (h % 12 || 12) + ':' + m + (h < 12 ? ' AM' : ' PM'); };
const when_ = at => (at ? at.slice(0, 10) + ' ' + time_(at) : '');
const only_ = (x, cur) => (x.cur === cur ? x.amount : '');
// a typed "=…" must stay text, never become a formula
const safe_ = v => (typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v);
const remarks_ = x => [x.batch ? 'Bulk ' + x.batch : '', x.editedAt ? 'Edited by ' + (x.editedBy || '?') + ' ' + when_(x.editedAt) : '', x.manualDate ? 'Date set manually' : ''].filter(String).join(' · ');
const now_ = () => Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy, h:mm a');

function freshTab_(ss, name, color) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const filter = sh.getFilter();
  if (filter) filter.remove();
  sh.clear();
  sh.setFrozenRows(0);
  sh.setTabColor(color);
  sh.setHiddenGridlines(true);
  return sh;
}
function title_(sh, text, sub) {
  sh.getRange(1, 1).setValue(safe_(text)).setFontSize(18).setFontWeight('bold').setFontColor(COLOR.ink);
  sh.getRange(2, 1).setValue(sub).setFontStyle('italic').setFontColor(COLOR.muted);
}
// Styled table at row r: dark header, zebra rows, column formats, optional bold total row.
function table_(sh, r, head, rows, fmts, total) {
  const n = head.length;
  const body = rows.length ? rows.map(row => row.map(safe_)) : [['Nothing yet'].concat(new Array(n - 1).fill(''))];
  const data = [head].concat(body, total ? [total] : []);
  sh.getRange(r, 1, data.length, n).setValues(data).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, COLOR.line, SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(r, 1, 1, n).setBackground(COLOR.ink).setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
  sh.getRange(r + 1, 1, body.length, n).setBackgrounds(body.map((_, i) => new Array(n).fill(i % 2 ? COLOR.zebra : '#ffffff')));
  fmts.forEach((f, j) => {
    if (f) sh.getRange(r + 1, j + 1, data.length - 1, 1).setNumberFormat(FMT[f]).setHorizontalAlignment(f === 'date' ? 'center' : 'right');
  });
  if (total) {
    sh.getRange(r + data.length - 1, 1, 1, n).setBackground(COLOR.bal).setFontWeight('bold')
      .setBorder(true, null, null, null, null, null, COLOR.ink, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }
  return r + data.length;
}
function dataTab_(ss, company, name, color, head, rows, fmts, widths, totalCols) {
  const sh = freshTab_(ss, name, color);
  title_(sh, company + ' — ' + name, 'Updated ' + now_() + ' · use the filter buttons in the header row to search');
  const last = 3 + rows.length;
  const total = rows.length && totalCols ? head.map((_, j) => {
    if (j === 0) return 'TOTAL';
    const col = String.fromCharCode(65 + j);
    return totalCols.indexOf(j) >= 0 ? '=SUBTOTAL(109,' + col + '4:' + col + last + ')' : '';
  }) : null;
  table_(sh, 3, head, rows, fmts, total);
  sh.setFrozenRows(3);
  widths.forEach((w, j) => sh.setColumnWidth(j + 1, w));
  if (rows.length) sh.getRange(3, 1, rows.length + 1, head.length).createFilter();
}

function summary_(ss, c) {
  const sh = freshTab_(ss, 'Summary', COLOR.ink);
  title_(sh, c.company, 'Accounts summary · updated ' + now_() + ' · USD and SSP are kept separately (never added together)');
  sh.getRange(1, 1).setFontSize(22);
  const recv = { USD: sum_(c.R, 'USD'), SSP: sum_(c.R, 'SSP') };
  const spent = { USD: sum_(c.E, 'USD'), SSP: sum_(c.E, 'SSP') };
  const bal = { USD: sub_(recv.USD, spent.USD), SSP: sub_(recv.SSP, spent.SSP) };
  const stats = c.P.map(p => {
    const R = c.R.filter(x => x.project === p.id), E = c.E.filter(x => x.project === p.id);
    const vc = p.valueCur || 'USD', got = sum_(R, vc);
    return { p: p, vc: vc, rU: sum_(R, 'USD'), sU: sum_(E, 'USD'), rS: sum_(R, 'SSP'), sS: sum_(E, 'SSP'), pending: p.value ? Math.max(0, sub_(p.value, got)) : 0, pct: p.value ? got / p.value : '' };
  });
  const pending = { USD: 0, SSP: 0 };
  stats.forEach(s => { pending[s.vc] = (cents_(pending[s.vc]) + cents_(s.pending)) / 100; });

  const acct = balances_(c);
  let r = table_(sh, 4, ['', 'USD', 'SSP'], [
    ['💵 Cash balance', acct.USD.Cash / 100, acct.SSP.Cash / 100],
    ['🏦 Bank balance', acct.USD.Bank / 100, acct.SSP.Bank / 100],
    ['Total balance', bal.USD, bal.SSP],
    ['Total money received', recv.USD, recv.SSP],
    ['Total money spent', spent.USD, spent.SSP],
    ['Pending from clients', pending.USD, pending.SSP],
  ], ['', 'USD', 'SSP']);
  [[5, COLOR.bal, COLOR.ink], [6, COLOR.bal, COLOR.ink], [7, COLOR.ink, '#ffffff'], [8, COLOR.inSoft, COLOR.in], [9, COLOR.outSoft, COLOR.out], [10, COLOR.warnSoft, COLOR.warn]].forEach(x => {
    sh.getRange(x[0], 1, 1, 3).setBackground(x[1]).setFontColor(x[2]).setFontWeight('bold');
  });
  sh.getRange(7, 1, 1, 3).setFontSize(14);
  sh.getRange(r + 1, 1).setValue(c.E.length + ' expenses · ' + c.R.length + ' money received entries · ' + c.T.length + ' cash/bank moves · ' + c.P.length + ' projects').setFontStyle('italic').setFontColor(COLOR.muted);

  r = section_(sh, r + 3, 'Projects');
  const gen = c.E.filter(x => !x.project);
  const projRows = stats.map(s => [s.p.name, s.p.value ? s.vc : '', s.p.value || '', s.p.value ? s.pending : '', s.pct, s.rU, s.sU, sub_(s.rU, s.sU), s.rS, s.sS, sub_(s.rS, s.sS)]);
  if (gen.length) projRows.push(['General (no project)', '', '', '', '', 0, sum_(gen, 'USD'), -sum_(gen, 'USD'), 0, sum_(gen, 'SSP'), -sum_(gen, 'SSP')]);
  r = table_(sh, r, ['Project', 'Value in', 'Project value', 'Pending', 'Received %', 'Received USD', 'Spent USD', 'Balance USD', 'Received SSP', 'Spent SSP', 'Balance SSP'],
    projRows, ['', '', 'num', 'num', 'pct', 'USD', 'USD', 'USD', 'SSP', 'SSP', 'SSP'],
    ['TOTAL', '', '', '', '', recv.USD, spent.USD, bal.USD, recv.SSP, spent.SSP, bal.SSP]);

  r = section_(sh, r + 2, 'Month by month');
  const months = Object.create(null);
  c.E.concat(c.R).forEach(x => { months[x.at.slice(0, 7)] = true; });
  const mRows = Object.keys(months).sort().map(m => {
    const e = c.E.filter(x => x.at.indexOf(m) === 0), g = c.R.filter(x => x.at.indexOf(m) === 0);
    return [MONTHS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4), sum_(g, 'USD'), sum_(e, 'USD'), sub_(sum_(g, 'USD'), sum_(e, 'USD')), sum_(g, 'SSP'), sum_(e, 'SSP'), sub_(sum_(g, 'SSP'), sum_(e, 'SSP')), e.length + g.length];
  });
  r = table_(sh, r, ['Month', 'Received USD', 'Spent USD', 'Net USD', 'Received SSP', 'Spent SSP', 'Net SSP', 'Entries'], mRows,
    ['', 'USD', 'USD', 'USD', 'SSP', 'SSP', 'SSP', ''], ['TOTAL', recv.USD, spent.USD, bal.USD, recv.SSP, spent.SSP, bal.SSP, c.E.length + c.R.length]);

  r = section_(sh, r + 2, 'Entries by person');
  const people = Object.create(null);
  c.E.concat(c.R).forEach(x => { people[x.by || '—'] = true; });
  const pRows = Object.keys(people).sort().map(n => {
    const e = c.E.filter(x => (x.by || '—') === n), g = c.R.filter(x => (x.by || '—') === n);
    return [n, e.length, sum_(e, 'USD'), sum_(e, 'SSP'), g.length, sum_(g, 'USD'), sum_(g, 'SSP')];
  });
  r = table_(sh, r, ['Entered by', 'Expenses', 'Expenses USD', 'Expenses SSP', 'Receipts', 'Receipts USD', 'Receipts SSP'], pRows, ['', '', 'USD', 'SSP', '', 'USD', 'SSP']);

  r = section_(sh, r + 2, 'Spending from cash / bank');
  table_(sh, r, ['Paid from', 'Spent USD', 'Spent SSP', 'Entries'], ACCOUNTS.map(a => {
    const e = c.E.filter(x => accountOf_(x.mode) === a);
    return [a, sum_(e, 'USD'), sum_(e, 'SSP'), e.length];
  }), ['', 'USD', 'SSP', '']);
  [220, 130, 130, 120, 110, 130, 130, 130, 150, 150, 150].forEach((w, j) => sh.setColumnWidth(j + 1, w));
}
function section_(sh, r, text) {
  sh.getRange(r, 1).setValue(text.toUpperCase()).setFontWeight('bold').setFontSize(12).setFontColor(COLOR.ink);
  return r + 1;
}
function expenses_(ss, c) {
  dataTab_(ss, c.company, 'Expenses', COLOR.out,
    ['Entry no.', 'Date', 'Day', 'Time', 'Currency', 'Amount USD', 'Amount SSP', 'Paid to', 'Reason', 'Location', 'Project', 'Paid from', 'Entered by', 'Recorded', 'Remarks', 'SSP per USD', 'Employee'],
    c.E.map(x => [x.id, ymd_(x.at), DAYS[day_(x.at).getDay()], time_(x.at), x.cur, only_(x, 'USD'), only_(x, 'SSP'), x.paidTo, x.reason, x.location || '', c.pname(x.project), accountOf_(x.mode), x.by || '', when_(x.createdAt), remarks_(x), x.rate || '', x.worker ? c.wname(x.worker) : '']),
    ['', 'date', '', '', '', 'USD', 'SSP'], [110, 105, 50, 80, 75, 120, 140, 170, 200, 130, 170, 100, 120, 150, 260, 110, 160], [5, 6]);
}
function received_(ss, c) {
  dataTab_(ss, c.company, 'Money Received', COLOR.in,
    ['Entry no.', 'Date', 'Day', 'Time', 'Project', 'Currency', 'Amount USD', 'Amount SSP', 'Received into', 'Note', 'Entered by', 'Recorded', 'Remarks', 'SSP per USD'],
    c.R.map(x => [x.id, ymd_(x.at), DAYS[day_(x.at).getDay()], time_(x.at), c.pname(x.project), x.cur, only_(x, 'USD'), only_(x, 'SSP'), accountOf_(x.mode), x.note || '', x.by || '', when_(x.createdAt), remarks_(x), x.rate || '']),
    ['', 'date', '', '', '', '', 'USD', 'SSP'], [110, 105, 50, 80, 190, 75, 120, 140, 110, 200, 120, 150, 260, 110], [6, 7]);
}
function moves_(ss, c) {
  dataTab_(ss, c.company, 'Cash & Bank moves', '#3b5bdb',
    ['Entry no.', 'Date', 'Day', 'Time', 'Currency', 'Amount USD', 'Amount SSP', 'From', 'To', 'Note', 'Entered by', 'Recorded', 'Remarks'],
    c.T.map(x => [x.id, ymd_(x.at), DAYS[day_(x.at).getDay()], time_(x.at), x.cur, only_(x, 'USD'), only_(x, 'SSP'), x.from, x.to, x.note || '', x.by || '', when_(x.createdAt), remarks_(x)]),
    ['', 'date', '', '', '', 'USD', 'SSP'], [110, 105, 50, 80, 75, 120, 140, 80, 80, 260, 120, 150, 220], [5, 6]);
}
// Every payment in and out plus every cash ↔ bank move, with that currency's running balances.
function ledger_(ss, c) {
  const run = { USD: { Cash: 0, Bank: 0 }, SSP: { Cash: 0, Bank: 0 } };
  const rows = c.E.map(x => ({ x: x, k: 'E' })).concat(c.R.map(x => ({ x: x, k: 'R' })), c.T.map(x => ({ x: x, k: 'T' })))
    .filter(o => run[o.x.cur])
    .sort((a, b) => byAt_(a.x, b.x))
    .map(o => {
      const x = o.x, b = run[x.cur], a = cents_(x.amount);
      let details, where, cashIn = '', cashOut = '';
      if (o.k === 'T') {
        b[x.from] -= a; b[x.to] += a;
        details = 'Moved ' + x.from + ' → ' + x.to + (x.note ? ' — ' + x.note : '');
        where = x.from + ' → ' + x.to;
      } else {
        where = accountOf_(x.mode);
        if (o.k === 'E') { b[where] -= a; cashOut = x.amount; details = 'Paid to ' + x.paidTo + ' — ' + x.reason + (x.location ? ' (' + x.location + ')' : ''); }
        else { b[where] += a; cashIn = x.amount; details = 'Money received' + (x.note ? ' — ' + x.note : ''); }
      }
      return [ymd_(x.at), time_(x.at), x.id, details, o.k === 'T' ? '' : c.pname(x.project), where, x.cur, cashIn, cashOut, b.Cash / 100, b.Bank / 100, (b.Cash + b.Bank) / 100, x.by || ''];
    });
  dataTab_(ss, c.company, 'Ledger', '#1d6f42',
    ['Date', 'Time', 'Entry no.', 'Details', 'Project', 'Cash / Bank', 'Currency', 'In', 'Out', 'Cash balance', 'Bank balance', 'Total balance', 'Entered by'],
    rows, ['date', '', '', '', '', '', '', 'num', 'num', 'num', 'num', 'num'], [105, 80, 110, 300, 170, 110, 75, 110, 110, 130, 130, 140, 120], null);
}
// Staff list with what each person has been paid (wages are worked out in the app).
function employees_(ss, c, workers) {
  const paid = Object.create(null);
  c.E.filter(x => x.worker).forEach(x => { paid[x.worker + x.cur] = (cents_(paid[x.worker + x.cur]) + cents_(x.amount)) / 100; });
  dataTab_(ss, c.company, 'Employees', '#7a1fa2',
    ['Employee no.', 'Name', 'Job', 'Site', 'Phone', 'Monthly wage', 'Currency', 'Started', 'Status', 'Left on', 'Paid USD', 'Paid SSP', 'ID number'],
    workers.map(w => [w.id, w.name, w.job || '', w.site || '', w.phone || '', w.wage, w.cur, w.start, w.status === 'left' ? 'Left' : 'Working', w.left || '', paid[w.id + 'USD'] || 0, paid[w.id + 'SSP'] || 0, w.idNo || '']),
    ['', '', '', '', '', 'num', '', 'date', '', 'date', 'USD', 'SSP'], [110, 170, 130, 120, 120, 110, 80, 105, 90, 105, 110, 120, 130], [10, 11]);
}
function changeLog_(ss, c) {
  dataTab_(ss, c.company, 'Change Log', COLOR.muted, ['When', 'Action', 'Entry', 'By', 'Details'],
    c.L.map(l => [when_(l.at), l.action, l.id || '', l.by || '', l.text]), ['', '', '', '', ''], [160, 110, 120, 120, 700], null);
}
