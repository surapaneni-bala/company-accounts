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
const FILE_COLS = ['fileId', 'uid', 'key']; // key = the phone's id for the file: an upload sent again is not a second copy
// the first bytes of each kind of file allowed: a file must be what it says it is
const MAGIC = { 'image/jpeg': [0xFF, 0xD8, 0xFF], 'image/png': [0x89, 0x50, 0x4E, 0x47], 'application/pdf': [0x25, 0x50, 0x44, 0x46] };
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' };
const VIEW_TABS = ['Summary', 'Expenses', 'Money Received', 'Cash & Bank moves', 'USD to SSP', 'Ledger', 'Change Log', 'Employees', 'Regular payments', 'Bank accounts', 'Documents', 'Invoices', 'Stock', 'Stock moves', 'Imports', 'Import costs', 'Deliveries', 'Buying list', 'Suppliers', 'Trips', 'Files'];
// record kinds: Expense, Received, Project, Log, Settings, Transfer (cash ↔ bank move),
// Change request (an office manager's edit, delete or advance, waiting for an admin), Worker (employee),
// File (a photo or PDF kept in the company Google Drive: slip, voucher, receipt, attachment, ID photo …),
// Absence (one day an employee did not work: it comes off that month's wage),
// reGular payment (rent, internet, licence fees: due every 1, 3, 6 or 12 months), Bank account (the company's, to be paid into),
// Vault document (a licence, a vehicle's papers, a passport…: its file is an F record of type 'document'),
// Klient (who invoices and quotations go to) and Invoice (an invoice or a quotation: its PDF is an F record) — admins only
const KINDS = ['E', 'R', 'P', 'L', 'S', 'T', 'C', 'W', 'F', 'A', 'G', 'B', 'V', 'K', 'I', 'N', 'U', 'J', 'X', 'M', 'Y', 'O', 'D'];
// the warehouse (owner, 2 Nov 2026): stock items (M), goods received — an import with every cost (Y), goods out (O), and the
// delivery note (D) every load leaves with: who takes it, the vehicle, and once there who received what, signed, with a photo
const STOCK_KINDS = ['M', 'Y', 'O', 'D'];
const OUT_KINDS = ['use', 'damage', 'return', 'count'];
const FILE_TYPES = ['voucher', 'receipt', 'slip', 'photo', 'attachment', 'profile', 'idphoto', 'letterhead', 'stamp', 'statement', 'document', 'invoice', 'quote', 'delivery'];
// buying: the list of what to buy (N), suppliers and factories (U) and buying trips (J): admins only (owner, 16 Oct 2026)
const BUY_KINDS = ['N', 'U', 'J'];
const BUY_STATES = ['idea', 'tobuy', 'ordered', 'inspected', 'shipped', 'received', 'dropped'];
const CUR_CODE = /^[A-Z]{3}$/; // what goods are priced in abroad: CNY, UGX, KES, AED… (payments stay USD or SSP)
// the vault's kinds of document: company and vehicle papers are for admins and the office manager; personal ones (the
// shareholders' and staff's IDs and passports) for admins only (owner, 11 Oct 2026)
const DOC_KINDS = ['company', 'vehicle', 'personal'];
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
  P: d => str_(d.name) && (d.buyBudget === undefined || (num_(d.buyBudget) && d.buyBudget >= 0)), // buyBudget: what may be spent buying for it, in dollars
  L: d => str_(d.text) && str_(d.at),
  S: d => str_(d.company) && isObj_(d.pass) && str_(d.pass.salt) && str_(d.pass.hash),
  // a change request: an edit (only editable fields), a delete, or an advance above the monthly limit
  C: d => !!EDITABLE[d.kind] && SAFE_ID.test(d.target) && isObj_(d.before) && isObj_(d.after) && str_(d.text) && AT_RE.test(d.at)
    && ['waiting', 'approved', 'rejected'].indexOf(d.status) >= 0
    && (d.action === 'delete' ? !Object.keys(d.after).length
      : d.action === 'advance' ? d.kind === 'W' && num_(d.after.amount) && d.after.amount > 0 && CURS.indexOf(d.after.cur) >= 0 && Object.keys(d.after).length === 2
        && (d.repay === undefined || (num_(d.repay) && d.repay >= 0))
      : d.action === undefined && Object.keys(d.after).every(f => EDITABLE[d.kind].indexOf(f) >= 0)),
  A: d => SAFE_ID.test(d.worker) && DATE_RE.test(d.date) && (d.note === undefined || str_(d.note)),
  W: d => str_(d.name) && num_(d.wage) && d.wage >= 0 && CURS.indexOf(d.cur) >= 0 && DATE_RE.test(d.start)
    && ['active', 'left'].indexOf(d.status || 'active') >= 0 && (!d.left || DATE_RE.test(d.left)) && (d.openingAmount === undefined || num_(d.openingAmount))
    && (!d.clearedTo || DATE_RE.test(d.clearedTo)),
  F: d => /^[A-Za-z0-9_-]{10,100}$/.test(d.fileId) && str_(d.name) && FILE_MIMES.indexOf(d.mime) >= 0 && SAFE_ID.test(d.for) && FILE_TYPES.indexOf(d.type) >= 0,
  G: d => str_(d.name) && str_(d.paidTo) && num_(d.amount) && d.amount > 0 && CURS.indexOf(d.cur) >= 0 && EVERY_MONTHS.indexOf(d.every) >= 0 && DATE_RE.test(d.first)
    && (d.mode === undefined || ACCOUNTS.indexOf(d.mode) >= 0) && (d.project === undefined || str_(d.project)),
  B: d => str_(d.bank) && d.bank.length > 0 && str_(d.number) && d.number.length > 0 && ['accName', 'cur', 'branch', 'swift', 'note'].every(k => d[k] === undefined || str_(d[k])),
  V: d => str_(d.title) && d.title.length > 0 && DOC_KINDS.indexOf(d.kind) >= 0 && ['issued', 'expires'].every(k => !d[k] || DATE_RE.test(d[k]))
    && (d.remind === undefined || (num_(d.remind) && d.remind >= 0 && d.remind <= 365)) && ['owner', 'docNo', 'note'].every(k => d[k] === undefined || str_(d[k])),
  K: d => str_(d.name) && d.name.length > 0 && ['phone', 'address', 'tin', 'note'].every(k => d[k] === undefined || str_(d[k])),
  I: d => ['invoice', 'quote'].indexOf(d.type) >= 0 && str_(d.no) && d.no.length > 0 && SAFE_ID.test(d.client) && DATE_RE.test(d.date) && (!d.due || DATE_RE.test(d.due))
    && CURS.indexOf(d.cur) >= 0 && Array.isArray(d.items) && d.items.length > 0 && d.items.length <= 100
    && d.items.every(it => isObj_(it) && str_(it.t) && num_(it.qty) && it.qty > 0 && num_(it.price) && it.price >= 0 && (it.unit === undefined || str_(it.unit))
      && (it.m === undefined || SAFE_ID.test(it.m)) && (it.list === undefined || (num_(it.list) && it.list >= 0))) // from stock: the item and its list price then
    && (d.rate === undefined || (num_(d.rate) && d.rate > 0)) && (d.ok === undefined || ['waiting', 'approved', 'rejected'].indexOf(d.ok) >= 0) // SSP for 1 USD; a price below the list waiting for an admin
    && (d.dl === undefined || ['deliver', 'collect'].indexOf(d.dl) >= 0) && strs_(d, ['addr', 'okBy', 'why']) && d.items.every(it => it.dlv === undefined || typeof it.dlv === 'boolean') // delivered or collected; the delivery charge line
    && (d.tax === undefined || (num_(d.tax) && d.tax >= 0 && d.tax <= 100)) && ['bank', 'from'].every(k => !d[k] || SAFE_ID.test(d[k])) && ['notes', 'project'].every(k => d[k] === undefined || str_(d[k])),
  // an item to buy: what, its category, every detail as spec lines (label, value), suppliers' quotes, the order, the inspection
  N: d => str_(d.t) && d.t.length > 0 && BUY_STATES.indexOf(d.status) >= 0 && strs_(d, ['cat', 'sub', 'area', 'unit', 'notes', 'link', 'where', 'ship', 'project'])
    && (d.cur === undefined || CUR_CODE.test(d.cur)) && ['qty', 'target'].every(k => d[k] === undefined || (num_(d[k]) && d[k] >= 0)) && (d.pri === undefined || [1, 2, 3].indexOf(d.pri) >= 0)
    && ['trip', 'from', 'under'].every(k => !d[k] || SAFE_ID.test(d[k])) && (d.tags === undefined || (Array.isArray(d.tags) && d.tags.length <= 20 && d.tags.every(str_)))
    && (d.specs === undefined || (Array.isArray(d.specs) && d.specs.length <= 40 && d.specs.every(x => Array.isArray(x) && str_(x[0]) && str_(x[1]) && (x.length === 2 || (x.length === 3 && SAFE_ID.test(x[2])))))) // a line may hold its photo's file
    && (d.quotes === undefined || (Array.isArray(d.quotes) && d.quotes.length <= 30 && d.quotes.every(q => isObj_(q) && SAFE_ID.test(q.id) && SAFE_ID.test(q.sup) && num_(q.price) && q.price >= 0 && CUR_CODE.test(q.cur))))
    && (d.order === undefined || (isObj_(d.order) && SAFE_ID.test(d.order.sup) && num_(d.order.price) && d.order.price >= 0 && CUR_CODE.test(d.order.cur) && num_(d.order.qty) && d.order.qty > 0 && DATE_RE.test(d.order.date)
      && (d.order.rate === undefined || (num_(d.order.rate) && d.order.rate > 0)) // 1 USD = rate in the order's currency
      && (d.order.alloc === undefined || (Array.isArray(d.order.alloc) && d.order.alloc.length <= 20 && d.order.alloc.every(a => isObj_(a) && SAFE_ID.test(a.p) && num_(a.q) && a.q > 0)
        && d.order.alloc.reduce((t, a) => t + a.q, 0) <= d.order.qty + 1e-9)))) // each project's share; the rest is extra
    && (d.insp === undefined || (isObj_(d.insp) && DATE_RE.test(d.insp.date) && ['pass', 'fail', 'open'].indexOf(d.insp.result) >= 0))
    && (d.steps === undefined || (isObj_(d.steps) && Object.keys(d.steps).every(k => BUY_STATES.indexOf(k) >= 0 && DATE_RE.test(d.steps[k])))),
  U: d => str_(d.name) && d.name.length > 0 && strs_(d, ['kind', 'city', 'country', 'market', 'person', 'phone', 'wechat', 'email', 'note']),
  // dollars changed into SSP (owner, 17 Oct 2026): usd out of Cash or Bank, ssp into Cash or Bank; was = the old expense it replaced
  X: d => AT_RE.test(d.at) && num_(d.usd) && d.usd > 0 && num_(d.ssp) && d.ssp > 0 && ACCOUNTS.indexOf(d.from) >= 0 && ACCOUNTS.indexOf(d.to) >= 0 && strs_(d, ['with', 'note']) && (!d.was || SAFE_ID.test(d.was)),
  // a stock item: what it is, its unit, where it is kept, when to reorder; price = what one sells for in dollars (the admin's
  // phone sets it from the landed cost and the markup, or an admin types it)
  M: d => str_(d.name) && d.name.length > 0 && str_(d.unit) && strs_(d, ['cat', 'code', 'bin', 'note']) && ['price', 'min', 'markup'].every(k => d[k] === undefined || (num_(d[k]) && d[k] >= 0))
    && (d.fixed === undefined || typeof d.fixed === 'boolean'),
  // goods received: the supplier's lines (item, how many, what the line cost in gcur at grate, weight) and every other cost, each in
  // its own currency at that day's rate, spread by weight, value or quantity; lc = landed cost of one, per line (worked out by the app)
  Y: d => DATE_RE.test(d.date) && strs_(d, ['ref', 'from', 'origin', 'note']) && (!d.sup || SAFE_ID.test(d.sup)) && CUR_CODE.test(d.gcur || 'USD') && (d.grate === undefined || (num_(d.grate) && d.grate > 0))
    && Array.isArray(d.lines) && d.lines.length > 0 && d.lines.length <= 100 && d.lines.every(l => isObj_(l) && SAFE_ID.test(l.m) && num_(l.qty) && l.qty > 0 && num_(l.amt) && l.amt >= 0 && (l.kg === undefined || (num_(l.kg) && l.kg >= 0)))
    && Array.isArray(d.costs) && d.costs.length <= 40 && d.costs.every(c => isObj_(c) && str_(c.t) && num_(c.amt) && c.amt >= 0 && CUR_CODE.test(c.cur) && (c.rate === undefined || (num_(c.rate) && c.rate > 0))
      && ['kg', 'value', 'qty'].indexOf(c.split) >= 0 && strs_(c, ['what']) && (!c.pay || SAFE_ID.test(c.pay)))
    && Array.isArray(d.lc) && d.lc.length === d.lines.length && d.lc.every(x => num_(x) && x >= 0),
  // goods out: used (on a project), damaged or lost, returned to the supplier, or a stock count's differences (+ or −)
  O: d => DATE_RE.test(d.date) && OUT_KINDS.indexOf(d.kind) >= 0 && strs_(d, ['project', 'to', 'note']) && Array.isArray(d.lines) && d.lines.length > 0 && d.lines.length <= 300
    && d.lines.every(l => isObj_(l) && SAFE_ID.test(l.m) && num_(l.qty) && (d.kind === 'count' ? l.qty !== 0 : l.qty > 0) && (l.counted === undefined || (num_(l.counted) && l.counted >= 0))),
  // a delivery note: for an invoice (inv) or goods used on a project (out); delivered by us or collected; who takes it; what the
  // client pays for delivery (charge) and what it cost us (cost, pay = that payment); status out (left) → done (received:
  // recv = who received what, when, and where it was signed if the phone allowed)
  D: d => /^DN-[A-Za-z0-9-]{1,40}$/.test(d.no) && DATE_RE.test(d.date) && (d.inv ? SAFE_ID.test(d.inv) && !d.out : SAFE_ID.test(d.out || '')) && ['deliver', 'collect'].indexOf(d.how) >= 0
    && strs_(d, ['to', 'addr', 'driver', 'phone', 'vehicle', 'note', 'check']) && ['charge', 'cost'].every(k => d[k] === undefined || (num_(d[k]) && d[k] >= 0)) && (d.cur === undefined || CURS.indexOf(d.cur) >= 0) && (!d.pay || SAFE_ID.test(d.pay))
    && Array.isArray(d.lines) && d.lines.length > 0 && d.lines.length <= 100 && d.lines.every(l => isObj_(l) && SAFE_ID.test(l.m) && num_(l.qty) && l.qty > 0)
    && ['out', 'done'].indexOf(d.status) >= 0 && (d.status === 'out' ? d.recv === undefined : isObj_(d.recv) && str_(d.recv.name) && d.recv.name.length > 0 && AT_RE.test(d.recv.at)
      && strs_(d.recv, ['phone', 'note', 'how']) && Array.isArray(d.recv.lines) && d.recv.lines.every(l => isObj_(l) && SAFE_ID.test(l.m) && num_(l.qty) && l.qty >= 0)
      && (d.recv.geo === undefined || (isObj_(d.recv.geo) && num_(d.recv.geo.lat) && num_(d.recv.geo.lng) && num_(d.recv.geo.acc)))),
  J: d => str_(d.to) && d.to.length > 0 && DATE_RE.test(d.out) && (!d.back || DATE_RE.test(d.back)) && Array.isArray(d.who) && d.who.length <= 20 && d.who.every(str_) && strs_(d, ['country', 'purpose', 'note'])
    && (d.budget === undefined || (num_(d.budget) && d.budget >= 0)),
};
const strs_ = (d, ks) => ks.every(k => d[k] === undefined || str_(d[k]));
const EVERY_MONTHS = [1, 3, 6, 12];
const num_ = v => typeof v === 'number' && isFinite(v);
// optional fields on money records: the SSP rate of the day, and the employee a payment belongs to
const extras_ = d => (d.rate === undefined || (num_(d.rate) && d.rate > 0)) && (d.worker === undefined || SAFE_ID.test(d.worker))
  && (d.pay === undefined || ['salary', 'advance', 'settlement'].indexOf(d.pay) >= 0) && (d.month === undefined || /^\d{4}-\d\d$/.test(d.month))
  && (d.daysOff === undefined || (num_(d.daysOff) && d.daysOff >= 0 && d.daysOff <= 31)) && (d.approval === undefined || SAFE_ID.test(d.approval))
  && (d.regular === undefined || SAFE_ID.test(d.regular)) && (d.period === undefined || DATE_RE.test(d.period)) // a regular payment, and the due date it pays
  && (d.invoice === undefined || SAFE_ID.test(d.invoice)) // money received for an invoice
  && (d.periods === undefined || (num_(d.periods) && d.periods >= 1 && d.periods <= 24 && d.periods % 1 === 0)) // a regular payment, several periods at once
  && (d.advance === undefined || typeof d.advance === 'boolean') && (d.advanceTotal === undefined || (num_(d.advanceTotal) && d.advanceTotal > 0)) // an advance to a supplier
  && (d.from === undefined || SAFE_ID.test(d.from)) && (d.received === undefined || DATE_RE.test(d.received)) // goods taken from an advance
  && (d.trip === undefined || SAFE_ID.test(d.trip)) && (d.need === undefined || SAFE_ID.test(d.need)) // a buying trip's cost, an item bought
  && (d.repay === undefined || (num_(d.repay) && d.repay >= 0)) // an employee's advance, taken back this much a month (0: all at once)
  && (d.imp === undefined || SAFE_ID.test(d.imp)) && (d.dn === undefined || SAFE_ID.test(d.dn)); // a cost of an import (goods received), of a delivery
const str_ = v => typeof v === 'string';
const isObj_ = v => !!v && typeof v === 'object' && !Array.isArray(v);
const money_ = d => typeof d.amount === 'number' && isFinite(d.amount) && AT_RE.test(d.at) && CURS.indexOf(d.cur) >= 0;
// limits for logins other than admins (the app never sends more than MAX_PUSH records at once)
const MAX_PUSH = 200;
const MAX_RECORD = 5000; // characters
const LOCK_WAIT_MS = 25000;
const VERSION = 23; // shown when the web app link is opened in a browser
const FMT = {
  USD: '"$"#,##0.00;[Red]-"$"#,##0.00',
  SSP: '"SSP "#,##0.00;[Red]-"SSP "#,##0.00',
  num: '#,##0.00;[Red]-#,##0.00',
  num4: '#,##0.0000;[Red]-#,##0.0000', // a landed cost of one: a rebar's to the hundredth of a cent
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
  // what an office manager was given goes only to an app that knows it (req.sees): an older one would take it for something not
  // hers, drop everything and fetch again, over and over
  const viewer = user && user.sees && req.sees !== 1 ? Object.assign({}, user, { sees: null }) : user;
  const result = merge_(rows, req.push, Number(req.since) || 0, user, uploads_(), codeOnly), hidden = hiddenFor_(result.rows, viewer);
  let warning = '';
  if (result.changed) {
    sh.getRange(2, 1, result.rows.length, 5).setValues(result.rows);
    // the records are saved; a problem drawing the readable tabs must never stop syncing
    try { rebuild_(ss, result.rows.map(toRec_)); } catch (err) { warning = 'The readable tabs could not be refreshed: ' + err.message; Logger.log(warning); }
  }
  try { // filing in Drive never stops a sync
    if (PropertiesService.getScriptProperties().getProperty('FILES_LAYOUT') !== LAYOUT) organizeAll_(result.rows);
    else organize_(result.rows, result.touched, result.trash);
  } catch (err) { console.error('Filing in Drive: ' + err.message); }
  if (!user && !users_().length) setupCode_(); // ready for the owner, inside the sheet
  const pull = result.pull.map(r => view_(viewer, r, hidden)).filter(r => r && !(codeOnly && (r.k === 'W' || r.k === 'F' || r.k === 'V')));
  // an entry an office manager had that changed and is no longer hers to see (moved to another project or place, no longer an
  // employee's pay): only its id, so her phone forgets its old copy
  const forget = viewer && viewer.role === 'manager' && Number(req.since) > 0 ? result.pull.filter(r => r.k === 'E' && !view_(viewer, r, hidden)).map(r => r.id) : [];
  return {
    ok: true, version: VERSION, seq: result.seq, sheet: user && user.role !== 'admin' ? '' : ss.getUrl(), kinds: KINDS, // the sheet shows every balance
    pull: pull, refused: result.refused, older: (result.older || []).filter(id => pull.some(r => r.id === id)), stamps: result.stamps || [], me: user ? public_(user) : null, forget: forget,
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
// hidden = what the office manager may not have (hiddenFor_): personal documents, other people's expenses, and their files
// and change requests
function view_(user, rec, hidden) {
  if (!user || user.role === 'admin') return rec;
  if (rec.k === 'S') return { id: rec.id, k: rec.k, u: rec.u, d: { company: rec.d.company } };
  if (rec.k === 'B') return rec; // the company's bank details are for everyone to give to clients (no balances)
  if (user.role === 'manager' && rec.k === 'I' && hidden && hidden[rec.id]) return saleStub_(rec); // someone else's: only what left the stock
  if (user.role === 'manager') return (rec.k === 'V' && rec.d.kind === 'personal') || (hidden && hidden[rec.k === 'F' ? rec.d.for : rec.k === 'C' ? rec.d.target : rec.id]) ? null : managerView_(user, rec);
  if (rec.k === 'F' && BRAND_FILES.indexOf(rec.d.type) >= 0) return rec; // everyone's vouchers carry the letterhead and stamp
  return (rec.k === 'E' || rec.k === 'L' || rec.k === 'F') && rec.d.uid === user.id ? rec : null;
}
// The office manager runs staff and salaries but never sees the company's money (owner, 10 Oct 2026): no money received,
// no cash ↔ bank moves, no project values, no files or change requests about those, and only her own Change Log lines
// (the log names amounts received). Without money in and moves, no balance can be worked out from what she holds.
const MONEY_KINDS = ['R', 'T', 'X'];
// Her expenses are her own (owner, 12 Oct 2026): she gets the ones she entered, and an admin's only when it pays an employee
// or a regular payment (rent…), for the Employees and Regular payments screens — and what an admin lets her see besides
// (owner, 1 Nov 2026): every payment, or those of some projects, places or people (seesE_). Personal documents in the vault (IDs,
// passports) are admins' only, with their scans. Ids map to true; null for other logins.
function hiddenFor_(rows, user) {
  if (!user || user.role !== 'manager') return null;
  const out = Object.create(null);
  rows.forEach(r => {
    if (r[1] !== 'E' && r[1] !== 'V' && r[1] !== 'I') return;
    let d = null;
    try { d = JSON.parse(r[4]); } catch (err) { out[r[0]] = true; return; } // a damaged record: admins only
    if (r[1] === 'I') { if (d.uid !== user.id) out[r[0]] = true; return; } // her own invoices and quotations (owner, 2 Nov 2026)
    if (r[1] === 'V' ? d.kind === 'personal' : d.uid !== user.id && !d.worker && !d.regular && !seesE_(user.sees, d)) out[r[0]] = true;
  });
  return out;
}
// What else an office manager may see: sees = { all, p: [project ids], l: [places, as placeKey_ makes them], u: [login ids] }
// (the app's seesEntry in calc.js is the same rule). Money received, moves and balances stay hidden whatever is given.
const placeKey_ = v => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
function seesE_(s, d) {
  if (!s) return false;
  const has = (list, v) => !!v && list.indexOf(v) >= 0;
  return s.all === true || has(s.p, d.project) || has(s.l, placeKey_(d.location)) || has(s.u, d.uid);
}
// a grant as an admin sent it, made safe to store: only ids that look like ids, places of up to 60 letters; null when it gives nothing
function cleanSees_(x) {
  if (!isObj_(x)) return null;
  const list = (v, ok) => (Array.isArray(v) ? v : []).filter(i => typeof i === 'string' && ok(i)).slice(0, 100);
  const s = { all: x.all === true, p: list(x.p, i => SAFE_ID.test(i)), l: list(x.l, i => i.length <= 60).map(placeKey_).filter(Boolean), u: list(x.u, i => SAFE_ID.test(i)) };
  return s.all || s.p.length || s.l.length || s.u.length ? s : null;
}
function seesOf_(raw) { try { return raw ? cleanSees_(JSON.parse(String(raw))) : null; } catch (err) { return null; } }
// The warehouse (owner, 2 Nov 2026): an office manager sells from stock and records what is used, so she gets the stock items with
// their selling price, how many came in, went out and were sold; never what anything cost (landed cost, markup, import costs, the
// import papers) nor other people's invoices beyond what they took out of stock. Clients, to invoice them; her own invoices.
const stripCost_ = rec => { const d = Object.assign({}, rec.d); delete d.markup; return { id: rec.id, k: rec.k, u: rec.u, d: d }; };
const receivedOnly_ = rec => ({ id: rec.id, k: rec.k, u: rec.u, d: { id: rec.d.id, date: rec.d.date, ref: rec.d.ref || '', lines: rec.d.lines.map(l => ({ m: l.m, qty: l.qty })), stub: true,
  createdAt: rec.d.createdAt, deleted: rec.d.deleted } });
function saleStub_(rec) {
  const d = rec.d, lines = (d.items || []).filter(it => it.m);
  return lines.length ? { id: rec.id, k: rec.k, u: rec.u, d: { id: d.id, type: d.type, date: d.date, items: lines.map(it => ({ m: it.m, qty: it.qty })), stub: true,
    cancelled: d.cancelled, deleted: d.deleted, ok: d.ok, createdAt: d.createdAt } } : null;
}
function managerView_(user, rec) {
  if (MONEY_KINDS.indexOf(rec.k) >= 0 || BUY_KINDS.indexOf(rec.k) >= 0) return null;
  if (rec.k === 'M') return stripCost_(rec);
  if (rec.k === 'Y') return receivedOnly_(rec);
  if (rec.k === 'F' && /^[NUJY]-/.test(String(rec.d.for))) return null; // the buying list's photos and reports, import papers (they show costs)
  if (rec.k === 'P') { const d = Object.assign({}, rec.d); delete d.value; delete d.valueCur; delete d.buyBudget; return { id: rec.id, k: rec.k, u: rec.u, d: d }; }
  if (rec.k === 'C' && MONEY_KINDS.indexOf(rec.d.kind) >= 0) return null;
  if (rec.k === 'F' && /^[RT]-/.test(String(rec.d.for))) return null;
  if (rec.k === 'L' && rec.d.uid !== user.id) return null;
  return rec;
}
// What each login may change. before = the stored copy (null for a new record).
function allowed_(user, p, before) {
  if (!user || user.role === 'admin') return true;
  if (before) return false; // only admins change what is already there (an office manager's edit is a change request)
  if (p.d.uid !== user.id || p.d.deleted) return false; // a new record carries its sender's login and isn't born deleted
  if (p.k === 'F' && BRAND_FILES.indexOf(p.d.type) >= 0) return false; // the company letterhead and stamp: admins only
  if (p.k === 'F' && /^[KNUJMY]-/.test(String(p.d.for))) return false; // nor photos or papers on clients, the buying list, stock items or imports
  if (p.k === 'D' && p.d.status !== 'out') return false; // a delivery note starts out; its receipt is added to it (merge_ receiptOnly_)
  if (p.k === 'F' && /^I-/.test(String(p.d.for)) && user.role !== 'manager') return false; // an office manager's own invoices' PDFs
  if (p.k === 'I' && (p.d.ok === 'approved' && !p.d.from || p.d.ok === 'rejected')) return false; // only an admin approves a price (or it came from an approved quotation)
  if (user.role === 'manager') return ['E', 'L', 'C', 'W', 'F', 'A', 'V', 'K', 'I', 'O', 'D'].indexOf(p.k) >= 0 && (p.k !== 'C' || (p.d.status === 'waiting' && MONEY_KINDS.indexOf(p.d.kind) < 0)) && (p.k !== 'V' || p.d.kind !== 'personal');
  return p.k === 'E' || p.k === 'L' || p.k === 'F'; // store keeper: own expenses, notes and their receipts
}

// the delivery note as it was made, now with who received what: status out → done and recv added, every other field the same
function receiptOnly_(was, now, user) {
  if (was.uid !== user.id || was.status !== 'out' || now.status !== 'done' || !now.recv) return false;
  const rest = x => JSON.stringify(Object.keys(x).filter(k => ['status', 'recv', 'by', 'u'].indexOf(k) < 0).sort().map(k => [k, x[k]])); // u: the phone's own stamp, sent inside the record
  return rest(was) === rest(now);
}
// An office manager may sell from stock at most 1 % below the list price (owner, 2 Nov 2026); lower waits for an admin (ok:
// 'waiting'). A price from a quotation an admin approved stands. The list price is the stock item's as the sheet has it now.
const MANAGER_OFF_ = 1;
function pricesOk_(d, out, index) {
  if (d.ok === 'waiting') return true;
  const rec = id => (index[id] === undefined ? null : { k: out[index[id]][1], d: JSON.parse(out[index[id]][4]) });
  const quote = d.from ? rec(d.from) : null, approved = quote && quote.k === 'I' && quote.d.ok === 'approved' ? quote.d : null;
  if (d.ok === 'approved' && !approved) return false;
  return d.items.every(it => {
    if (!it.m) return true;
    const m = rec(it.m);
    if (!m || m.k !== 'M' || !(m.d.price > 0)) return false; // an item that is not in stock, or has no price yet
    const usd = d.cur === 'USD' ? it.price : d.rate > 0 ? it.price / d.rate : null;
    if (usd === null) return false;
    if (approved && approved.items.some(q => q.m === it.m && it.price >= q.price - 1e-9)) return true;
    return usd >= m.d.price * (1 - MANAGER_OFF_ / 100) - 0.005;
  });
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
  const refused = [], touched = [], trash = [], behind = [];
  const limited = !!user && user.role !== 'admin', now = Date.now(), cap = now; // no copy is stamped later than the sheet's own clock
  (Array.isArray(push) ? push : []).forEach((p, n) => {
    if (!p || typeof p.id !== 'string' || !p.id || KINDS.indexOf(p.k) < 0 || typeof p.u !== 'number' || !isObj_(p.d)) return;
    if (!SAFE_ID.test(p.id) || (p.k !== 'S' && (p.k === 'L' ? p.d.lid : p.d.id) !== p.id) || !SHAPES[p.k](p.d)) { refused.push(p.id); return; }
    if (limited && (n >= MAX_PUSH || JSON.stringify(p.d).length > MAX_RECORD)) { refused.push(p.id); return; }
    const i = index[p.id];
    if (i !== undefined && out[i][1] !== p.k) { refused.push(p.id); return; } // a record never changes kind
    // A phone can't stamp its copy in the future and so block later edits; a copy stored with a future stamp (a phone clock
    // that was ahead) counts as old, so it can be changed again. The same copy sent again (a lost reply) is skipped; an older
    // one too, and the newer one goes back to that phone, which shows it instead of its own (never lost in silence).
    const stored = i === undefined ? 0 : Number(out[i][2]), sane = stored > cap ? 0 : stored, d = limited ? Object.assign({}, p.d, { by: user.name }) : p.d; // signed by the login that sent it
    let u = Math.min(p.u, cap);
    // a login other than an admin never changes what is there (an edit is a change request): refused alike whether it can
    // see the entry or not, so nothing is learnt about entries it may not see; the same copy sent again is skipped. One
    // exception: the office manager who made a delivery note adds its receipt to it — nothing else on it changes.
    const receipt = limited && i !== undefined && p.k === 'D' && user.role === 'manager' && receiptOnly_(JSON.parse(out[i][4]), d, user);
    if (limited && i !== undefined && !receipt) { if (out[i][4] !== JSON.stringify(d)) refused.push(p.id); return; }
    // an edit made from an older copy than the sheet's (b: the copy it started from): the entry changed on another phone
    // meanwhile, so this one would undo that change — not stored; the sheet's copy goes back and that phone says so
    if (i !== undefined && typeof p.b === 'number' && sane > p.b && out[i][4] !== JSON.stringify(d)) { behind.push(i); return; }
    if (i !== undefined && sane > u) { behind.push(i); return; }
    if (i !== undefined && sane === u) { if (out[i][4] === JSON.stringify(d)) return; u = sane + 1; } // a different copy at the same instant is the later one
    const before = i === undefined ? null : JSON.parse(out[i][4]);
    if (!receipt && !allowed_(user || null, p, before)) { refused.push(p.id); return; }
    if (codeOnly && (p.k === 'W' || p.k === 'F' || p.k === 'V')) { refused.push(p.id); return; }
    const t = p.k === 'C' ? index[p.d.target] : 0;
    if (t === undefined || (p.k === 'C' && out[t][1] !== p.d.kind)) { refused.push(p.id); return; } // a change request needs its entry
    // an edit must leave its entry valid: approving it can never produce a record the sheet would refuse
    if (p.k === 'C' && !p.d.action && !SHAPES[p.d.kind](Object.assign(JSON.parse(out[t][4]), p.d.after))) { refused.push(p.id); return; }
    // a file record may only name a file this script uploaded (else it could fetch any file in the owner's Drive),
    // and a non-admin only one they uploaded themselves
    const up = p.k === 'F' ? (uploads || {})[p.d.fileId] : '';
    if (up === undefined || (p.k === 'F' && limited && up !== user.id)) { refused.push(p.id); return; }
    if (p.k === 'A' && limited && (index[p.d.worker] === undefined || out[index[p.d.worker]][1] !== 'W')) { refused.push(p.id); return; } // a day not worked belongs to an employee
    if (p.k === 'I' && limited && !pricesOk_(p.d, out, index)) { refused.push(p.id); return; } // a lower price waits for an admin
    if (p.k === 'F' && limited) { // a file belongs to a record the sender may see (a store keeper: their own)
      const f = index[p.d.for];
      const o = f === undefined ? null : JSON.parse(out[f][4]);
      if (!o || (user.role === 'store' && o.uid !== user.id) || (out[f][1] === 'V' && o.kind === 'personal') || (out[f][1] === 'I' && o.uid !== user.id)) { refused.push(p.id); return; }
    }
    seq += 1;
    changed = true;
    const row = [p.id, p.k, u, seq, JSON.stringify(d)];
    if (i === undefined) { index[p.id] = out.length; out.push(row); } else { out[i] = row; }
    touched.push(p.id);
    // the unstamped original of a cancelled paper once its stamped copy is in; the stamped copy once an admin takes the cancel back
    if (p.k === 'F' && before && before.fileId !== d.fileId && (d.stamped || before.stamped)) trash.push(before.fileId);
  });
  const pull = out.filter((r, i) => Number(r[3]) > since || behind.indexOf(i) >= 0).map(toRec_);
  // stamps: the time each copy was stored at, which the phone takes (its own clock may be wrong)
  return { rows: out, seq: seq, changed: changed, pull: pull, refused: refused, touched: touched, trash: trash, older: behind.map(i => out[i][0]), stamps: touched.map(id => [id, Number(out[index[id]][2])]) };
}

/* ---------- logins ---------- */
const USERS_TAB = '_users';
const SESSIONS_TAB = '_sessions';
const USER_COLS = ['id', 'username', 'name', 'role', 'salt', 'hash', 'active', 'fails', 'lockUntil', 'createdAt', 'createdBy', 'lastLogin', 'sees'];
const SESSION_COLS = ['token', 'uid', 'createdAt', 'seen', 'device'];
const ROLES = ['admin', 'manager', 'store']; // admin = everything · manager = staff, her own payments (and what she is given), asks for edits · store = own entries
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
  if (req.op === 'upload' || req.op === 'file' || req.op === 'original') return files_(req);
  if (req.op === 'alerts' || req.op === 'number') { // admins (or, before logins, a phone with the company code)
    const who = who_(req);
    if (who.error) return { ok: false, error: who.error, code: who.code };
    const may = who.user ? who.user.role === 'admin' || (req.op === 'number' && who.user.role === 'manager') : !users_().length; // office managers invoice too (2 Nov 2026)
    if (!may) return { ok: false, error: 'Only an admin can do this.' };
    return req.op === 'alerts' ? alerts_(req) : nextInvoiceNo_();
  }
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
    // On a slow connection the phone may not hear the answer and send the same file again: the copy already made is the
    // answer (the owner found spare copies loose in the company folder, 15 Oct 2026). Old app versions send no key.
    const key = SAFE_ID.test(String(req.key || '')) ? String(req.key) : '', rows = rowsOf_(FILES_TAB, FILE_COLS);
    const had = key && rows.filter(r => String(r.key) === key).pop();
    if (had) { try { if (!DriveApp.getFileById(String(had.fileId)).isTrashed()) return { ok: true, fileId: String(had.fileId) }; } catch (err) { /* gone: upload it again */ } }
    const file = filesRoot_().createFile(Utilities.newBlob(bytes, req.mime, name)); // its record files it in a moment
    saveRows_(FILES_TAB, FILE_COLS, rows.concat([{ fileId: file.getId(), uid: who.user ? who.user.id : '', key: key }]));
    return { ok: true, fileId: file.getId() };
  }
  if (req.op === 'original') return original_(who.user, String(req.id || ''));
  const all = readAll_(syncTab_(SpreadsheetApp.getActive())), row = all.filter(r => r[0] === String(req.id) && r[1] === 'F')[0];
  const rec = row && view_(who.user, toRec_(row), hiddenFor_(all, who.user));
  if (!rec) return { ok: false, error: 'This file is not available to you.' };
  const blob = DriveApp.getFileById(rec.d.fileId).getBlob();
  return { ok: true, fileId: rec.d.fileId, name: rec.d.name, mime: rec.d.mime, data: Utilities.base64Encode(blob.getBytes()) };
}
// An admin takes back the cancel of a paper (owner, 10 Oct 2026: a voucher the client already has stays valid). Its
// unstamped original went to the bin when the stamped copy came in, so it comes back out: the newest binned upload before
// the stamped copy that carries the paper's number. The phone then names it in the file record (and the stamped copy is binned).
function original_(user, id) {
  if (user && user.role !== 'admin') return { ok: false, error: 'Only an admin can do this.' };
  const row = readAll_(syncTab_(SpreadsheetApp.getActive())).filter(r => r[0] === id && r[1] === 'F')[0];
  const f = row ? JSON.parse(row[4]) : null;
  if (!f || !f.stamped || !f.no) return { ok: false, error: 'This paper has no original in the bin to bring back.' };
  const ids = rowsOf_(FILES_TAB, FILE_COLS).map(r => String(r.fileId));
  for (let i = ids.lastIndexOf(f.fileId) - 1; i >= 0; i--) {
    let file = null;
    try { file = DriveApp.getFileById(ids[i]); } catch (err) { continue; } // gone for good
    if (!file.isTrashed() || file.getName().replace(/\.\w+$/, '').split(' ').indexOf(f.no) < 0) continue;
    file.setTrashed(false);
    return { ok: true, fileId: ids[i] };
  }
  return { ok: false, error: 'The original of ' + f.no + ' is no longer in the Google Drive bin (Drive keeps it for 30 days).' };
}
// Invoices are numbered by the sheet, in one unbroken series for the whole company (phones may be offline, so they can't
// count by themselves). Each request takes the next number, under the script lock that every request holds.
function nextInvoiceNo_() {
  const props = PropertiesService.getScriptProperties(), n = Number(props.getProperty('INVOICE_SEQ') || 0) + 1;
  props.setProperty('INVOICE_SEQ', String(n));
  return { ok: true, no: 'INV-' + ('000' + n).slice(-4) };
}
function uploads_() {
  const map = Object.create(null);
  rowsOf_(FILES_TAB, FILE_COLS).forEach(r => { map[String(r.fileId)] = String(r.uid); });
  return map;
}
/* ---------- Drive: one company folder, arranged like a filing cabinet ----------
   BROOKFIELD SUPER APP/                (first word of the company name + SUPER APP), with the Google Sheet in it
     01 PAYMENTS/2026/2026-10 OCTOBER/2026-10-08 TEST SUPPLIER (E-…)/   one payment: voucher, photo, attachments
     02 MONEY RECEIVED/2026/2026-10 OCTOBER/2026-10-08 WAREHOUSE (R-…)/  one receipt and its attachments
     03 EMPLOYEES/JOHN DOE (W-…)/        one employee:
         ID DOCUMENT/  PROFILE PHOTO/  STATEMENTS/  OTHER DOCUMENTS/
         PAYMENT SLIPS/2026/2026-10-08 ADVANCE (E-…)/                   one payment: slip, photo, attachments
     04 COMPANY/LETTERHEAD/  04 COMPANY/STAMP/
     08 DELETED EMPLOYEES/JOHN DOE (W-…)/   an employee an admin deleted, folder and all
     09 DELETED ENTRIES/01 PAYMENTS/…, 09 DELETED ENTRIES/02 MONEY RECEIVED/…   files of deleted entries, same folders
   One rule for old versions: each section (and each employee) has a CHANGES folder with the same folders inside, holding
   replaced photos and documents and cancelled vouchers or slips. Photos and documents without a number are named by kind
   and date ("ID DOCUMENT 2026-10-08.jpg"), so the versions read as a history. A folder named "… (ID)" is found by its ID:
   editing the date or who was paid renames it, and a folder a move leaves empty goes to the bin.
   Where a file goes follows from its record (fileHome_, no Drive calls), so any later change refiles it. Nothing is thrown
   away, except the unstamped original of a cancelled paper once its stamped copy is in. A Drive problem never stops a sync. */
const LAYOUT = '3'; // bump when the layout changes: every sheet then refiles everything once
const DOC_FOLDER = { company: 'COMPANY', vehicle: 'VEHICLES', personal: 'PERSONAL' };
const FOLDER = { pay: '01 PAYMENTS', received: '02 MONEY RECEIVED', staff: '03 EMPLOYEES', company: '04 COMPANY', docs: '05 DOCUMENTS', invoices: '06 INVOICES', quotes: '07 QUOTATIONS', unfiled: '10 UNFILED', buying: '11 BUYING', stock: '12 WAREHOUSE', staffGone: '08 DELETED EMPLOYEES', gone: '09 DELETED ENTRIES', changes: 'CHANGES', slips: 'PAYMENT SLIPS', other: 'OTHER DOCUMENTS' };
const TYPE_FOLDER = { idphoto: 'ID DOCUMENT', profile: 'PROFILE PHOTO', statement: 'STATEMENTS', letterhead: 'LETTERHEAD', stamp: 'STAMP' };
const MONTHS_ = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const upper_ = s => String(s || '').replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 60);
const endsId_ = (name, id) => name.slice(-(id.length + 2)) === `(${id})`;
const idSeg_ = (name, id) => ({ name: `${String(name).trim()} (${id})`, id: id }); // a folder found by the ID at the end of its name
const segName_ = seg => (typeof seg === 'string' ? seg : seg.name);
// year and month folders for a day 'YYYY-MM-DD'
const dated_ = day => (/^\d{4}-\d{2}/.test(day) ? [day.slice(0, 4), `${day.slice(0, 7)} ${MONTHS_[+day.slice(5, 7) - 1]}`] : ['NO DATE']);
function topName_(rows) {
  const s = rows.filter(r => r[1] === 'S').map(r => JSON.parse(r[4]))[0] || {};
  return upper_(String(s.company || '').trim().split(/\s+/)[0] || 'Company') + ' SUPER APP';
}
function filesRoot_() {
  const props = PropertiesService.getScriptProperties();
  let root = null;
  try { root = props.getProperty('FILES_FOLDER') ? DriveApp.getFolderById(props.getProperty('FILES_FOLDER')) : null; } catch (err) { root = null; }
  if (!root) { root = DriveApp.createFolder(props.getProperty('TOP_NAME') || 'COMPANY SUPER APP'); props.setProperty('FILES_FOLDER', root.getId()); }
  return root;
}
// a folder inside parent: by name, or (an ID segment) by the ID at the end of its name, renamed if the rest changed
function child_(parent, seg) {
  if (typeof seg === 'string') { const it = parent.getFoldersByName(seg); return it.hasNext() ? it.next() : parent.createFolder(seg); }
  for (const it = parent.getFolders(); it.hasNext();) { const f = it.next(); if (endsId_(f.getName(), seg.id)) { if (f.getName() !== seg.name) f.setName(seg.name); return f; } }
  return parent.createFolder(seg.name);
}
const inside_ = (item, folder) => { const it = item.getParents(); return it.hasNext() && it.next().getId() === folder.getId(); };
function folderAt_(path, cache) {
  const key = '/' + path.map(segName_).join('/');
  if (!cache[key]) cache[key] = path.length ? child_(folderAt_(path.slice(0, -1), cache), path[path.length - 1]) : filesRoot_();
  return cache[key];
}
const staffName_ = w => `${upper_(w.d.name)} (${w.id})`;
// an employee's own folder, found by their number (a name can change), kept in EMPLOYEES or DELETED EMPLOYEES
function staffFolder_(w, cache) {
  if (cache[w.id]) return cache[w.id];
  const home = folderAt_([w.d.deleted ? FOLDER.staffGone : FOLDER.staff], cache), name = staffName_(w);
  let found = null;
  [FOLDER.staff, FOLDER.staffGone].some(p => {
    for (const it = folderAt_([p], cache).getFolders(); it.hasNext();) { const f = it.next(); if (endsId_(f.getName(), w.id)) { found = f; return true; } }
    return false;
  });
  if (!found) found = home.createFolder(name);
  if (found.getName() !== name) found.setName(name);
  if (!inside_(found, home)) found.moveTo(home);
  return (cache[w.id] = found);
}
const slipLabel_ = o => (o.pay === 'salary' ? `SALARY ${o.month || ''}` : o.pay === 'advance' ? 'ADVANCE' : o.pay === 'settlement' ? 'FINAL SETTLEMENT' : upper_(o.reason));
// Where a file belongs, its Drive name and its status, worked out from its record and the record it is for (no Drive
// calls, so the Files tab shows the same): { w: the employee whose folder it is in, path: folders below that (or below
// the company folder), name: the Drive name ('' = keep), status }
function fileHome_(f, byId, files) {
  const owner = byId[f.for], o = owner ? owner.d : {};
  const w = owner && owner.k === 'W' ? owner : o.worker && byId[o.worker] && byId[o.worker].k === 'W' ? byId[o.worker] : null;
  const older = (f.for === 'settings' || f.type === 'profile' || f.type === 'idphoto') && files.some(g => g.id !== f.id && g.for === f.for && g.type === f.type && String(g.createdAt || '') > String(f.createdAt || ''));
  const gone = !!o.deleted && owner.k !== 'W', old = !!(f.cancelled || f.replaced || f.removed) || older; // old versions go to CHANGES
  const status = f.cancelled ? 'Cancelled' : f.removed ? 'Removed' : f.replaced || older ? 'Replaced by a newer one' : gone ? 'Entry deleted' : w && w.d.deleted ? 'Employee deleted' : 'In use';
  const ext = (String(f.name).match(/\.\w+$/) || [''])[0], kind = TYPE_FOLDER[f.type];
  const name = (f.for === 'settings' || owner && owner.k === 'W') && kind && kind !== 'STATEMENTS' ? `${kind} ${String(f.createdAt || '').slice(0, 10)}${ext}`.replace(' ' + ext, ext) : '';
  const changes = old ? [FOLDER.changes] : [];
  if (f.for === 'settings') return { path: [FOLDER.company].concat(changes, [kind || FOLDER.other]), name: name, status: status };
  const day = String(o.at || f.createdAt || '').slice(0, 10);
  if (w) {
    const sub = owner.k === 'W' ? [kind || FOLDER.other] : [FOLDER.slips, day.slice(0, 4) || 'NO DATE', idSeg_(`${day} ${slipLabel_(o)}`, owner.id)];
    return { w: w, path: (old || gone ? [FOLDER.changes] : []).concat(sub), name: name, status: status };
  }
  if (!owner) return { path: [FOLDER.pay, FOLDER.other], name: name, status: status };
  if (owner.k === 'I') { // invoices and quotations by year and month, named by number and client; a cancelled one under CHANGES
    const k = byId[o.client], who = k && k.k === 'K' ? k.d.name : '';
    return { path: [o.type === 'quote' ? FOLDER.quotes : FOLDER.invoices].concat(changes, dated_(String(o.date || ''))), name: `${o.no} ${upper_(who)}${ext}`.replace(' ' + ext, ext), status: status };
  }
  if (BUY_KINDS.indexOf(owner.k) >= 0) { // buying: a folder per item (by category), per supplier and per trip
    const seg = owner.k === 'N' ? [upper_(o.cat) || 'OTHER', idSeg_(upper_(o.t), owner.id)] : owner.k === 'U' ? ['SUPPLIERS', idSeg_(upper_(o.name), owner.id)] : ['TRIPS', idSeg_(`${o.out} ${upper_(o.to)}`, owner.id)];
    return { path: (gone ? [FOLDER.gone, FOLDER.buying] : [FOLDER.buying].concat(changes)).concat(seg), name: name, status: status };
  }
  if (STOCK_KINDS.indexOf(owner.k) >= 0) { // the warehouse: a folder per item (its photos), goods received and out by month (their papers)
    const seg = owner.k === 'M' ? ['ITEMS', idSeg_(upper_(o.name), owner.id)] : [{ Y: 'GOODS RECEIVED', O: 'GOODS OUT', D: 'DELIVERY NOTES' }[owner.k]].concat(dated_(String(o.date || '')), [idSeg_(`${o.date} ${upper_(o.no || o.ref || o.from || o.kind || '')}${o.to ? ' ' + upper_(o.to) : ''}`, owner.id)]);
    return { path: (gone ? [FOLDER.gone, FOLDER.stock] : [FOLDER.stock].concat(changes)).concat(seg), name: name, status: status };
  }
  if (owner.k === 'V') { // the vault: one folder per document, its older versions under CHANGES
    const doc = [DOC_FOLDER[o.kind] || FOLDER.other, idSeg_(upper_(o.title), owner.id)];
    return { path: (gone ? [FOLDER.gone, FOLDER.docs] : [FOLDER.docs].concat(changes)).concat(doc), name: `${upper_(o.title)} ${String(f.createdAt || '').slice(0, 10)}${ext}`, status: status };
  }
  const section = owner.k === 'R' ? FOLDER.received : FOLDER.pay;
  const who = owner.k === 'R' ? (byId[o.project] ? byId[o.project].d.name : 'GENERAL') : o.paidTo || o.reason;
  const entry = dated_(day).concat([idSeg_(`${day} ${upper_(who)}`, owner.id)]);
  return { path: (gone ? [FOLDER.gone, section] : [section].concat(changes)).concat(entry), name: name, status: status };
}
const homeText_ = h => (h.w ? [h.w.d.deleted ? FOLDER.staffGone : FOLDER.staff, staffName_(h.w)] : []).concat(h.path).map(segName_).join(' / ');
const homeFolder_ = (h, cache) => (h.w ? h.path.reduce(child_, staffFolder_(h.w, cache)) : folderAt_(h.path, cache));
const SECTIONS = [FOLDER.pay, FOLDER.received, FOLDER.staff, FOLDER.company, FOLDER.docs, FOLDER.invoices, FOLDER.quotes, FOLDER.staffGone, FOLDER.gone, FOLDER.buying, FOLDER.stock];
// folders a move left empty go to the bin, up to the sections (the sections and the company folder always stay)
function tidyUp_(folder, rootId) {
  while (folder && folder.getId() !== rootId && SECTIONS.indexOf(folder.getName()) < 0 && !folder.getFiles().hasNext() && !folder.getFolders().hasNext()) {
    const up = folder.getParents();
    folder.setTrashed(true);
    folder = up.hasNext() ? up.next() : null;
  }
}
function placeFile_(f, h, cache) {
  const folder = homeFolder_(h, cache), file = DriveApp.getFileById(f.fileId);
  const name = (f.cancelled ? 'CANCELLED ' : '') + (h.name || file.getName().replace(/^CANCELLED /, ''));
  if (file.getName() !== name) file.setName(name);
  const from = file.getParents(), was = from.hasNext() ? from.next() : null;
  if (was && was.getId() === folder.getId()) return;
  file.moveTo(folder);
  tidyUp_(was, folderAt_([], cache).getId());
}
// File what this sync changed (touched = record ids; null = everything): those records' files, a changed file's
// neighbours (a new profile photo sends the older one to CHANGES), an employee's folder and their payments' files.
function organize_(rows, touched, trash) {
  if (touched && !touched.length && !trash.length) return;
  if (touched && touched.indexOf('settings') >= 0) nameRoot_(rows); // the company's name changed
  const recs = rows.map(toRec_), byId = Object.create(null), cache = {};
  recs.forEach(r => { byId[r.id] = r; });
  const files = recs.filter(r => r.k === 'F' && !r.d.deleted).map(r => r.d), want = touched && new Set(touched);
  if (want) touched.forEach(id => { const r = byId[id]; if (r && r.k === 'F') want.add(r.d.for); });
  trash.forEach(id => { try { DriveApp.getFileById(id).setTrashed(true); } catch (err) { console.error('Could not bin ' + id + ': ' + err.message); } });
  recs.filter(r => r.k === 'W' && (!want || want.has(r.id))).forEach(w => { try { staffFolder_(w, cache); } catch (err) { console.error('Employee folder ' + w.id + ': ' + err.message); } });
  files.filter(f => { if (!want || want.has(f.id) || want.has(f.for)) return true; const o = byId[f.for]; return !!(o && o.d.worker && want.has(o.d.worker)); })
    .forEach(f => { try { placeFile_(f, fileHome_(f, byId, files), cache); } catch (err) { console.error('Could not file ' + f.id + ': ' + err.message); } });
}
function nameRoot_(rows) {
  const name = topName_(rows), root = filesRoot_();
  PropertiesService.getScriptProperties().setProperty('TOP_NAME', name);
  if (root.getName() !== name) root.setName(name);
  return root;
}
// empty folders (left by an older layout) go to the bin, deepest first; the company folder itself stays
function dropEmpty_(folder, keep) {
  for (const it = folder.getFolders(); it.hasNext();) dropEmpty_(it.next(), false);
  if (!keep && !folder.getFiles().hasNext() && !folder.getFolders().hasNext()) folder.setTrashed(true);
}
// Once per layout: name the company folder, move the Google Sheet into it, file everything, bin the emptied folders.
function organizeAll_(rows) {
  const props = PropertiesService.getScriptProperties(), root = nameRoot_(rows);
  try { const sheet = DriveApp.getFileById(SpreadsheetApp.getActive().getId()); if (!inside_(sheet, root)) sheet.moveTo(root); } catch (err) { console.error('Could not move the Google Sheet: ' + err.message); }
  organize_(rows, null, []);
  tidySpares_(rows);
  dropEmpty_(root, true);
  SECTIONS.forEach(name => child_(root, name)); // the cabinet always shows all its drawers
  props.setProperty('FILES_LAYOUT', LAYOUT);
}
// Uploads no record names (a day old or more, so never one whose record is still on its way): a spare copy of a filed file
// (same name and size) goes to the Drive bin, where Google keeps it 30 days; anything else is put in 10 UNFILED so it is
// seen. Runs with every refiling and each morning.
function tidySpares_(rows) {
  const named = Object.create(null), byName = Object.create(null);
  rows.filter(r => r[1] === 'F').forEach(r => { try { const d = JSON.parse(r[4]); named[d.fileId] = true; (byName[d.name] = byName[d.name] || []).push(d.fileId); } catch (err) { /* damaged */ } });
  const dayAgo = Date.now() - 864e5;
  let unfiled = null;
  rowsOf_(FILES_TAB, FILE_COLS).forEach(u => {
    const id = String(u.fileId);
    if (!id || named[id]) return;
    let file = null;
    try { file = DriveApp.getFileById(id); } catch (err) { return; } // gone for good
    try {
      if (file.isTrashed() || file.getDateCreated().getTime() > dayAgo) return;
      const name = file.getName(), size = file.getSize();
      const twin = (byName[name] || []).some(t => { try { return DriveApp.getFileById(t).getSize() === size; } catch (err) { return false; } });
      if (twin) { file.setTrashed(true); return; }
      unfiled = unfiled || child_(filesRoot_(), FOLDER.unfiled);
      const from = file.getParents(), was = from.hasNext() ? from.next() : null;
      if (!was || was.getId() !== unfiled.getId()) file.moveTo(unfiled);
    } catch (err) { console.error('Tidying ' + id + ': ' + err.message); }
  });
}
// Run this once in the Apps Script editor after pasting the script. Google asks permission to use Drive: its screen has a
// box for each permission, and one left unticked is never asked for again by itself, so this asks for every missing one.
// Then it files everything into the company folder (the Google Sheet too): if Drive is still not allowed, it fails here.
function allowFiles() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  if (!hasMorning_()) ScriptApp.newTrigger('morningEmail').timeBased().everyDays(1).atHour(7).create(); // the morning email, at about 7
  organizeAll_(readAll_(syncTab_(SpreadsheetApp.getActive())));
  Logger.log(`Drive access is allowed, and everything is filed in the folder ${filesRoot_().getName()} (the Google Sheet too). Now: Deploy → Manage deployments → ✏️ → New version → Deploy.`);
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
  if (input.sees !== undefined) u.sees = cleanSees_(input.sees);
  if (u.role !== 'manager') u.sees = null; // only an office manager is given more to see
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
  // a new password, a new role, a change in what she may see or a disabled login: signed out everywhere, so the phone drops what it
  // held and reloads what it may see
  if (old && (pw !== null || !u.active || u.role !== old.role || JSON.stringify(u.sees || null) !== JSON.stringify(old.sees || null))) endSessions_(u.id, '', false);
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
    sees: String(u.role) === 'manager' ? seesOf_(u.sees) : null,
  }));
}
const saveUsers_ = list => saveRows_(USERS_TAB, USER_COLS, list.map(u => Object.assign({}, u, { active: u.active ? 'true' : 'false', sees: u.sees ? JSON.stringify(u.sees) : '' })));
const public_ = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active, lastLogin: u.lastLogin || 0, sees: u.sees || null });
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
  const ctx = { E: live('E'), R: live('R'), T: live('T'), X: live('X'), P: of('P').filter(x => !x.deleted), L: of('L').sort(byAt_), pname: pname, wname: wname, company: settings.company || 'Company' };
  summary_(ss, ctx);
  expenses_(ss, ctx);
  received_(ss, ctx);
  moves_(ss, ctx);
  changes_(ss, ctx);
  ledger_(ss, ctx);
  changeLog_(ss, ctx);
  employees_(ss, ctx, of('W').filter(x => !x.deleted));
  regulars_(ss, ctx, of('G').filter(x => !x.deleted));
  banks_(ss, ctx, of('B').filter(x => !x.deleted));
  docs_(ss, ctx, of('V').filter(x => !x.deleted), recs);
  invoices_(ss, ctx, of('I').filter(x => !x.deleted), of('K'));
  stock_(ss, ctx, of('M').filter(x => !x.deleted), of('Y').filter(x => !x.deleted), of('O').filter(x => !x.deleted), of('I').filter(x => !x.deleted), of('U'), of('D').filter(x => !x.deleted));
  buying_(ss, ctx, of('N').filter(x => !x.deleted), of('U'), of('J'));
  filesTab_(ss, ctx, recs);
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
  (c.X || []).forEach(x => { b.USD[x.from] -= cents_(x.usd); b.SSP[x.to] += cents_(x.ssp); }); // dollars changed into SSP
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
const remarks_ = x => [x.advance ? 'Supplier advance: ' + (x.advanceTotal || x.amount) + ' paid, ' + x.amount + ' left' : x.advanceTotal ? 'Supplier advance of ' + x.advanceTotal + ', used up' : '',
  x.from ? 'Taken from advance ' + x.from + (x.received ? ' on ' + x.received : '') : '', x.trip ? 'Trip ' + x.trip : '', x.need ? 'Buying list ' + x.need : '', x.periods > 1 ? x.periods + ' periods paid at once' : '', x.batch ? 'Bulk ' + x.batch : '', x.editedAt ? 'Edited by ' + (x.editedBy || '?') + ' ' + when_(x.editedAt) : '', x.manualDate ? 'Date set manually' : ''].filter(String).join(' · ');
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
  const xUsd = c.X.reduce((t, x) => t + cents_(x.usd), 0) / 100, xSsp = c.X.reduce((t, x) => t + cents_(x.ssp), 0) / 100; // changed, not spent
  const bal = { USD: sub_(sub_(recv.USD, spent.USD), xUsd), SSP: (cents_(sub_(recv.SSP, spent.SSP)) + cents_(xSsp)) / 100 };
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
  sh.getRange(r + 1, 1).setValue(c.E.length + ' expenses · ' + c.R.length + ' money received entries · ' + c.T.length + ' cash/bank moves · ' + c.X.length + ' changes of USD to SSP (' + xUsd + ' USD → ' + xSsp + ' SSP) · ' + c.P.length + ' projects').setFontStyle('italic').setFontColor(COLOR.muted);

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
// Every uploaded file: what it is, what it belongs to, its status and the Drive folder it is filed in.
const FILE_KIND = { voucher: 'Payment voucher', receipt: 'Receipt', slip: 'Salary slip', photo: 'Photo', attachment: 'Attachment', profile: 'Profile photo', idphoto: 'ID photo', letterhead: 'Letterhead', stamp: 'Company stamp', statement: 'Statement', document: 'Document', invoice: 'Invoice', quote: 'Quotation' , delivery: 'Delivery note'};
function filesTab_(ss, c, recs) {
  const byId = Object.create(null);
  recs.forEach(r => { byId[r.id] = r; });
  const files = recs.filter(r => r.k === 'F' && !r.d.deleted).map(r => r.d);
  const what = f => {
    const o = byId[f.for];
    if (f.for === 'settings') return 'The company';
    if (!o) return '';
    const d = o.d;
    return o.k === 'I' ? (d.type === 'quote' ? 'Quotation ' : 'Invoice ') + d.no : o.k === 'V' ? 'Document: ' + d.title : o.k === 'W' ? 'Employee: ' + d.name : o.k === 'E' ? (d.worker ? c.wname(d.worker) : d.paidTo || '') + ' — ' + (d.reason || '') : o.k === 'R' ? 'Money received — ' + c.pname(d.project) : '';
  };
  // in the order of the folders in Drive, so the tab reads like the filing cabinet
  const rows = files.map(f => {
    const h = fileHome_(f, byId, files);
    return [when_(String(f.createdAt || '')), f.no || '', FILE_KIND[f.type] || f.type, (f.cancelled ? 'CANCELLED ' : '') + (h.name || f.name), f.for === 'settings' ? '' : f.for, what(f), h.status, homeText_(h), f.by || '', 'https://drive.google.com/file/d/' + f.fileId + '/view'];
  }).sort((a, b) => a[7].localeCompare(b[7]) || a[0].localeCompare(b[0]));
  dataTab_(ss, c.company, 'Files', '#0f766e', ['Uploaded', 'Number', 'Kind', 'File name', 'For entry', 'What it belongs to', 'Status', 'Folder in Drive', 'Uploaded by', 'Open'],
    rows, [], [140, 120, 120, 240, 120, 280, 150, 300, 120, 300], null);
}
function moves_(ss, c) {
  dataTab_(ss, c.company, 'Cash & Bank moves', '#3b5bdb',
    ['Entry no.', 'Date', 'Day', 'Time', 'Currency', 'Amount USD', 'Amount SSP', 'From', 'To', 'Note', 'Entered by', 'Recorded', 'Remarks'],
    c.T.map(x => [x.id, ymd_(x.at), DAYS[day_(x.at).getDay()], time_(x.at), x.cur, only_(x, 'USD'), only_(x, 'SSP'), x.from, x.to, x.note || '', x.by || '', when_(x.createdAt), remarks_(x)]),
    ['', 'date', '', '', '', 'USD', 'SSP'], [110, 105, 50, 80, 75, 120, 140, 80, 80, 260, 120, 150, 220], [5, 6]);
}
// Every payment in and out, every cash ↔ bank move and every change of dollars into SSP (two lines: the dollars out, the
// SSP in), with each currency's running balances.
function ledger_(ss, c) {
  const run = { USD: { Cash: 0, Bank: 0 }, SSP: { Cash: 0, Bank: 0 } };
  const xs = (c.X || []).reduce((out, x) => out.concat([{ x: Object.assign({}, x, { cur: 'USD', amount: x.usd, mode: x.from }), k: 'XU', o: x }, { x: Object.assign({}, x, { cur: 'SSP', amount: x.ssp, mode: x.to }), k: 'XS', o: x }]), []);
  const rows = c.E.map(x => ({ x: x, k: 'E' })).concat(c.R.map(x => ({ x: x, k: 'R' })), c.T.map(x => ({ x: x, k: 'T' })), xs)
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
        else if (o.k === 'XU') { b[where] -= a; cashOut = x.amount; details = 'Changed into SSP ' + o.o.ssp + ' at ' + rateOf_(o.o) + (o.o.with ? ' — with ' + o.o.with : ''); }
        else if (o.k === 'XS') { b[where] += a; cashIn = x.amount; details = 'SSP from changing USD ' + o.o.usd + ' at ' + rateOf_(o.o) + (o.o.with ? ' — with ' + o.o.with : ''); }
        else { b[where] += a; cashIn = x.amount; details = 'Money received' + (x.note ? ' — ' + x.note : ''); }
      }
      return [ymd_(x.at), time_(x.at), x.id, details, o.k === 'T' || o.k[0] === 'X' ? '' : c.pname(x.project), where, x.cur, cashIn, cashOut, b.Cash / 100, b.Bank / 100, (b.Cash + b.Bank) / 100, x.by || ''];
    });
  dataTab_(ss, c.company, 'Ledger', '#1d6f42',
    ['Date', 'Time', 'Entry no.', 'Details', 'Project', 'Cash / Bank', 'Currency', 'In', 'Out', 'Cash balance', 'Bank balance', 'Total balance', 'Entered by'],
    rows, ['date', '', '', '', '', '', '', 'num', 'num', 'num', 'num', 'num'], [105, 80, 110, 300, 170, 110, 75, 110, 110, 130, 130, 140, 120], null);
}
// Dollars changed into SSP: what went out, the rate, what came in (the app's SSP screen)
const rateOf_ = x => Math.round(x.ssp / x.usd * 100) / 100;
function changes_(ss, c) {
  dataTab_(ss, c.company, 'USD to SSP', '#0f766e', ['Entry no.', 'Date', 'Day', 'USD out', 'From', 'Rate (SSP for 1 USD)', 'SSP in', 'Into', 'Changed with', 'Note', 'Entered by', 'Recorded', 'Replaces'],
    c.X.map(x => [x.id, ymd_(x.at), DAYS[day_(x.at).getDay()], x.usd, x.from, rateOf_(x), x.ssp, x.to, x.with || '', x.note || '', x.by || '', when_(x.createdAt), x.was || '']),
    ['', 'date', '', 'USD', '', 'num', 'SSP'], [110, 105, 50, 120, 80, 140, 160, 80, 160, 220, 120, 150, 120], [3, 6]);
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
/* ---------- regular payments: the same sums as the app (src/calc.js dueOn, regularDue) ---------- */
function dueOn_(first, every, k) {
  const y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7)), d = Number(first.slice(8, 10)), t = new Date(Date.UTC(y, m - 1 + k * every, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return t.getUTCFullYear() + '-' + ('0' + (t.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + Math.min(d, last)).slice(-2);
}
const monthNo_ = d => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
// pays = [{ period, periods }]: each payment counts for its stretch, and the ones after it when it paid several at once
function regularDue_(g, pays, today) {
  const paid = Object.create(null);
  pays.forEach(p => { const k = Math.floor((monthNo_(p.period) - monthNo_(g.first)) / g.every), n = p.periods || 1; for (let i = Math.max(0, k); i < k + n; i++) paid[i] = true; });
  let next = '', late = 0;
  for (let k = 0; k < 1200; k++) {
    if (paid[k]) continue;
    const d = dueOn_(g.first, g.every, k);
    if (!next) next = d;
    if (d < today) late++; else break;
  }
  return { next: next, late: late };
}
const today_ = () => Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
const EVERY_TEXT = { 1: 'Every month', 3: 'Every 3 months', 6: 'Every 6 months', 12: 'Every year' };
function regulars_(ss, c, regs) {
  const t = today_();
  dataTab_(ss, c.company, 'Regular payments', '#b45309',
    ['No.', 'What', 'Paid to', 'How often', 'Currency', 'Amount', 'Usually paid from', 'Project', 'First due', 'Next due', 'Status', 'Times paid', 'Last paid'],
    regs.map(g => {
      const pays = c.E.filter(x => x.regular === g.id), d = regularDue_(g, pays.filter(x => x.period).map(x => ({ period: x.period, periods: x.periods || 1 })), t);
      const status = d.late ? d.late + ' late' : d.next === t ? 'Due today' : 'OK';
      return [g.id, g.name, g.paidTo, EVERY_TEXT[g.every], g.cur, g.amount, g.mode || '', g.project ? c.pname(g.project) : '', g.first, d.next, status, pays.length, pays.length ? ymd_(pays[pays.length - 1].at) : ''];
    }), ['', '', '', '', '', 'num', '', '', 'date', 'date'], [110, 180, 170, 120, 80, 110, 120, 160, 105, 105, 90, 90, 105], null);
}
function banks_(ss, c, banks) {
  dataTab_(ss, c.company, 'Bank accounts', '#0e7490', ['No.', 'Bank', 'Account name', 'Account number', 'Currency', 'Branch', 'SWIFT code', 'Note'],
    banks.map(b => [b.id, b.bank, b.accName || '', b.number, b.cur || '', b.branch || '', b.swift || '', b.note || '']), [], [110, 220, 240, 180, 80, 160, 120, 260], null);
}
/* ---------- the vault: documents and when they expire ---------- */
const DOC_TEXT = { company: 'Company', vehicle: 'Vehicle', personal: 'Personal' };
const daysBetween_ = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
const remindOf_ = v => (num_(v.remind) ? v.remind : 30);
function docState_(v, t) {
  if (!v.expires) return { text: 'No expiry date', left: '' };
  const left = daysBetween_(t, v.expires);
  return { left: left, text: left < 0 ? 'Expired' : left === 0 ? 'Expires today' : left <= remindOf_(v) ? 'Expires soon' : 'Valid' };
}
function docs_(ss, c, docs, recs) {
  const t = today_(), file = Object.create(null);
  recs.filter(r => r.k === 'F' && r.d.type === 'document' && !r.d.deleted && !r.d.replaced && !r.d.removed).forEach(r => { file[r.d.for] = r.d.fileId; });
  dataTab_(ss, c.company, 'Documents', '#4338ca', ['No.', 'Document', 'Kind', 'Belongs to', 'Number', 'Issued', 'Expires', 'Days left', 'Status', 'Remind days before', 'Note', 'Open'],
    docs.map(v => { const s = docState_(v, t); return [v.id, v.title, DOC_TEXT[v.kind], v.owner || '', v.docNo || '', v.issued || '', v.expires || '', s.left, s.text, remindOf_(v), v.note || '', file[v.id] ? 'https://drive.google.com/file/d/' + file[v.id] + '/view' : '']; }),
    ['', '', '', '', '', 'date', 'date'], [110, 220, 90, 180, 140, 105, 105, 80, 110, 90, 220, 300], null);
}

/* ---------- invoices and quotations: the same sums as the app (src/calc.js invoiceTotals, invoiceState) ---------- */
function invoiceState_(inv, credits, t) {
  const sub = inv.items.reduce((s, it) => s + Math.round(it.qty * it.price * 100), 0), tax = inv.tax > 0 ? Math.round(sub * inv.tax / 100) : 0, total = sub + tax;
  const paid = credits.filter(c => c.invoice === inv.id && c.cur === inv.cur).reduce((s, c) => s + cents_(c.amount), 0), due = Math.max(0, total - paid);
  const state = inv.cancelled ? 'Cancelled' : inv.type === 'quote' ? 'Quotation' : due === 0 ? 'Paid' : inv.due && inv.due < t ? 'Overdue' : paid ? 'Part paid' : 'Unpaid';
  return { total: total / 100, paid: paid / 100, due: inv.type === 'quote' || inv.cancelled ? 0 : due / 100, state: state };
}
function invoices_(ss, c, invs, clients) {
  const t = today_(), name = Object.create(null);
  clients.forEach(k => { name[k.id] = k.name; });
  dataTab_(ss, c.company, 'Invoices', '#9d174d', ['Number', 'Kind', 'Client', 'Date', 'Due / valid until', 'Currency', 'Total', 'Paid', 'Still owed', 'Status', 'Entry no.'],
    invs.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map(inv => {
      const s = invoiceState_(inv, c.R, t);
      return [inv.no, inv.type === 'quote' ? 'Quotation' : 'Invoice', name[inv.client] || '', inv.date, inv.due || '', inv.cur, s.total, s.paid, s.due, s.state, inv.id];
    }), ['', '', '', 'date', 'date', '', 'num', 'num', 'num'], [110, 100, 220, 105, 120, 80, 120, 120, 120, 100, 120], null);
}

/* ---------- the warehouse (the app's stock.js; calc.js stockBook is the same replay) ---------- */
// every move in date order (a day's receipts first, its counts last); the average landed cost changes only when goods come in
const OUT_TEXT_ = { in: 'Received', sale: 'Sold', use: 'Used', damage: 'Damaged / lost', return: 'Returned to supplier', count: 'Stock count' };
const OUT_RANK_ = { in: 0, sale: 1, use: 1, damage: 1, return: 1, count: 2 };
const sells_ = x => x.type === 'invoice' && !x.cancelled && x.ok !== 'waiting' && x.ok !== 'rejected';
function stockMoves_(Y, O, I) {
  const mv = [];
  Y.forEach(y => y.lines.forEach((l, i) => mv.push({ m: l.m, date: y.date, kind: 'in', qty: l.qty, cost: y.lc[i] || 0, ref: y.ref || '', id: y.id, by: y.by || '', at: y.createdAt })));
  O.forEach(o => o.lines.forEach(l => mv.push({ m: l.m, date: o.date, kind: o.kind, qty: o.kind === 'count' ? l.qty : -l.qty, ref: o.to || '', project: o.project || '', id: o.id, by: o.by || '', at: o.createdAt })));
  I.filter(sells_).forEach(x => x.items.forEach(it => { if (it.m) mv.push({ m: it.m, date: x.date, kind: 'sale', qty: -it.qty, ref: x.no, id: x.id, by: x.by || '', at: x.createdAt }); }));
  mv.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : OUT_RANK_[a.kind] - OUT_RANK_[b.kind] || (String(a.at || '') < String(b.at || '') ? -1 : String(a.at || '') > String(b.at || '') ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  const st = Object.create(null);
  mv.forEach(x => {
    const s = st[x.m] || (st[x.m] = { qty: 0, avg: 0, inQ: 0, outQ: 0 });
    if (x.kind === 'in') s.avg = s.qty > 0 ? Math.round((s.qty * s.avg + x.qty * x.cost) / (s.qty + x.qty) * 1e4) / 1e4 : x.cost;
    x.val = Math.round(x.qty * (x.kind === 'in' ? x.cost : s.avg) * 100) / 100;
    s.qty = Math.round((s.qty + x.qty) * 1e6) / 1e6;
    if (x.qty > 0) s.inQ += x.qty; else s.outQ -= x.qty;
    x.bal = s.qty; x.avg = s.avg;
  });
  return { moves: mv, st: st };
}
function stock_(ss, c, items, Y, O, I, sups, D) {
  const item = Object.create(null), sup = Object.create(null);
  items.forEach(m => { item[m.id] = m; });
  sups.forEach(u => { sup[u.id] = u.name; });
  const r = stockMoves_(Y, O, I), name = id => (item[id] ? item[id].name : 'Unknown item ' + id), code = id => (item[id] ? item[id].code || '' : '');
  dataTab_(ss, c.company, 'Stock', '#b45309', ['Code', 'Item', 'Category', 'Unit', 'Shelf / place', 'Came in', 'Went out', 'On hand', 'Reorder at', 'Low', 'Average landed cost USD', 'Stock value USD', 'Markup %', 'Sells for USD', 'Entry no.'],
    items.slice().sort((a, b) => String(a.cat || '').localeCompare(String(b.cat || '')) || a.name.localeCompare(b.name)).map(m => {
      const s = r.st[m.id] || { qty: 0, avg: 0, inQ: 0, outQ: 0 };
      return [safe_(m.code || ''), safe_(m.name), safe_(m.cat || ''), m.unit, safe_(m.bin || ''), s.inQ, s.outQ, s.qty, m.min || '', m.min && s.qty <= m.min ? 'LOW' : '', s.avg, Math.round(s.qty * s.avg * 100) / 100, m.markup === undefined ? 10 : m.markup, m.price || '', m.id];
    }), ['', '', '', '', '', 'num', 'num', 'num', 'num', '', 'num4', 'num', 'num', 'num'], [90, 220, 150, 70, 110, 90, 90, 90, 90, 60, 150, 130, 80, 110, 120], [11]);
  dataTab_(ss, c.company, 'Stock moves', '#b45309', ['Date', 'Item', 'Code', 'What', 'In', 'Out', 'Balance', 'Unit cost USD', 'Value USD', 'Project', 'Reference / to', 'By', 'Entry no.'],
    r.moves.map(x => [x.date, safe_(name(x.m)), safe_(code(x.m)), OUT_TEXT_[x.kind] || x.kind, x.qty > 0 ? x.qty : '', x.qty < 0 ? -x.qty : '', x.bal, x.kind === 'in' ? x.cost : x.avg, x.val, x.project ? c.pname(x.project) : '', safe_(x.ref), safe_(x.by), x.id]),
    ['date', '', '', '', 'num', 'num', 'num', 'num4', 'num'], [105, 220, 90, 150, 80, 80, 90, 120, 110, 170, 160, 110, 120], null);
  const rows = [], costs = [];
  Y.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach(y => {
    const rate = y.gcur && y.gcur !== 'USD' ? y.grate : '';
    y.lines.forEach((l, i) => {
      const goods = Math.round((y.gcur && y.gcur !== 'USD' ? (y.grate > 0 ? l.amt / y.grate : 0) : l.amt) * 100) / 100, landed = Math.round(y.lc[i] * l.qty * 100) / 100;
      rows.push([y.date, safe_(y.ref || ''), safe_(sup[y.sup] || y.from || ''), safe_(y.origin || ''), safe_(name(l.m)), l.qty, item[l.m] ? item[l.m].unit : '', l.amt, y.gcur || 'USD', rate, goods, Math.round((landed - goods) * 100) / 100, landed, y.lc[i], l.kg || '', y.id]);
    });
    y.costs.forEach(k => costs.push([y.date, safe_(y.ref || ''), safe_(COST_TEXT_[k.t] || k.t), safe_(k.what || ''), k.amt, k.cur, k.cur === 'USD' ? '' : k.rate || '', k.cur === 'USD' ? k.amt : k.rate > 0 ? Math.round(k.amt / k.rate * 100) / 100 : '', SPLIT_TEXT_[k.split] || k.split, k.pay || '', y.id]));
  });
  dataTab_(ss, c.company, 'Imports', '#b45309', ['Date', 'Reference', 'Supplier', 'From', 'Item', 'Qty', 'Unit', 'Goods (as invoiced)', 'Currency', '1 USD =', 'Goods USD', 'Extra costs USD', 'Landed USD', 'Landed cost of one USD', 'Weight kg', 'Entry no.'],
    rows, ['date', '', '', '', '', 'num', '', 'num', '', 'num', 'num', 'num', 'num', 'num4', 'num'], [105, 140, 170, 100, 200, 80, 60, 120, 80, 80, 110, 120, 110, 140, 90, 120], [10, 11, 12]);
  deliveries_(ss, c, D, I, O, item);
  dataTab_(ss, c.company, 'Import costs', '#b45309', ['Date', 'Reference', 'Cost', 'Detail', 'Amount', 'Currency', '1 USD =', 'USD', 'Spread by', 'Payment entry', 'Entry no.'],
    costs, ['date', '', '', '', 'num', '', 'num', 'num'], [105, 140, 170, 200, 110, 80, 80, 110, 100, 130, 120], [7]);
}
// every delivery note: what left, who took it, what the client paid for delivery and what it cost, who received what, where
function deliveries_(ss, c, D, I, O, item) {
  const inv = Object.create(null), out = Object.create(null);
  I.forEach(x => { inv[x.id] = x; });
  O.forEach(x => { out[x.id] = x; });
  const list = ls => ls.map(l => l.qty + ' × ' + (item[l.m] ? item[l.m].name : l.m)).join('; ');
  dataTab_(ss, c.company, 'Deliveries', '#b45309', ['Number', 'Left on', 'For', 'To', 'Address', 'Delivered or collected', 'Taken by', 'Phone', 'Vehicle', 'Goods', 'Delivery charged', 'Delivery cost', 'Currency', 'Status', 'Received by', 'Received at', 'Received', 'Short', 'Where signed', 'Entry no.'],
    D.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map(d => {
      const got = d.recv ? d.recv.lines : [], short = d.recv ? d.lines.some(l => (got.filter(g => g.m === l.m).reduce((t, g) => t + g.qty, 0)) < l.qty) : false;
      const forWhat = d.inv ? (inv[d.inv] ? inv[d.inv].no : d.inv) : out[d.out] && out[d.out].project ? c.pname(out[d.out].project) : d.out || '';
      return [d.no, d.date, safe_(forWhat), safe_(d.to || ''), safe_(d.addr || ''), d.how === 'collect' ? 'Collected' : 'Delivered by us', safe_(d.driver || ''), safe_(d.phone || ''), safe_(d.vehicle || ''), safe_(list(d.lines)),
        d.charge === undefined ? '' : d.charge, d.cost === undefined ? '' : d.cost, d.cur || '', d.status === 'done' ? 'Received' : 'On the way', d.recv ? safe_(d.recv.name) : '', d.recv ? when_(d.recv.at) : '', safe_(list(got)), short ? 'SHORT' : '',
        d.recv && d.recv.geo ? 'https://maps.google.com/?q=' + d.recv.geo.lat + ',' + d.recv.geo.lng : '', d.id];
    }), ['', 'date', '', '', '', '', '', '', '', '', 'num', 'num'], [130, 105, 130, 170, 170, 130, 140, 110, 100, 260, 110, 110, 80, 100, 140, 150, 260, 70, 200, 120], [10, 11]);
}
const COST_TEXT_ = { freight: 'Freight / shipping', duty: 'Customs duty', tax: 'Taxes at import', clearing: 'Clearing agent', port: 'Port / border charges', transport: 'Transport to the warehouse', handling: 'Loading / offloading', insurance: 'Insurance', bank: 'Bank / transfer charges', other: 'Other' };
const SPLIT_TEXT_ = { kg: 'Weight', value: 'Value', qty: 'Quantity' };

/* ---------- buying: the list, suppliers and trips (the app's buying.js) ---------- */
const BUY_TEXT = { idea: 'Idea', tobuy: 'To buy', ordered: 'Ordered', inspected: 'Inspected', shipped: 'Shipped', received: 'Received', dropped: 'Dropped' };
const PRI_TEXT = { 1: 'Urgent', 2: 'Normal', 3: 'Some day' };
// who an order is for (the app's calc.js orderShares): each project's share, the rest extra; and in dollars at its rate
function shares_(o, project) {
  const al = o.alloc && o.alloc.length ? o.alloc : project ? [{ p: project, q: o.qty }] : [], used = al.reduce((t, a) => t + a.q, 0), rest = Math.round((o.qty - used) * 1000) / 1000;
  return al.concat(rest > 0 ? [{ p: '', q: rest }] : []);
}
const usd_ = (amount, o) => (o.cur === 'USD' ? amount : o.rate > 0 ? Math.round(amount / o.rate * 100) / 100 : '');
function buying_(ss, c, items, sups, trips) {
  const sup = Object.create(null), trip = Object.create(null), cost = Object.create(null);
  sups.forEach(u => { sup[u.id] = u; });
  trips.forEach(j => { trip[j.id] = j; });
  c.E.filter(x => x.trip).forEach(x => { const k = x.trip + '|' + x.cur; cost[k] = (cost[k] || 0) + cents_(x.amount); });
  const supName = id => (sup[id] ? sup[id].name : ''), tripName = id => (trip[id] ? trip[id].to + ' ' + trip[id].out : ''), byId = Object.create(null);
  items.forEach(n => { byId[n.id] = n; });
  const goodsUsd = id => Math.round(items.filter(n => n.order && n.status !== 'dropped' && (n.order.trip === id || n.trip === id)).reduce((t, n) => t + (Number(usd_(n.order.qty * n.order.price, n.order)) || 0), 0) * 100) / 100;
  const best = n => (n.quotes || []).filter(q => !n.cur || q.cur === n.cur).sort((a, b) => a.price - b.price)[0];
  dataTab_(ss, c.company, 'Buying list', '#7c3aed',
    ['No.', 'Item', 'Category', 'Sub-category', 'Project', 'Area / room', 'Tags', 'Qty', 'Unit', 'Details', 'Notes', 'Where to buy', 'Priority', 'Status', 'Target price', 'Currency', 'Quotes', 'Lowest quote', 'Ordered from', 'Unit price', 'Qty ordered', 'Order total', 'Order currency', 'Ordered on', 'Trip', 'Inspection', 'Shipment', 'Received on', 'Added by', 'Added on', 'For (projects / extra)', '1 USD =', 'Order total USD', 'Part of'],
    items.slice().sort((a, b) => String(a.cat || '').localeCompare(String(b.cat || '')) || String(a.t).localeCompare(String(b.t))).map(n => {
      const q = best(n), o = n.order || {}, st = n.steps || {};
      return [n.id, n.t, n.cat || '', n.sub || '', n.project ? c.pname(n.project) : '', n.area || '', (n.tags || []).join(', '), n.qty || '', n.unit || '', (n.specs || []).map(x => x[0] + ': ' + x[1]).join('; '), n.notes || '',
        n.where || '', PRI_TEXT[n.pri] || '', BUY_TEXT[n.status], n.target || '', n.cur || '', (n.quotes || []).length || '', q ? q.cur + ' ' + q.price + ' (' + supName(q.sup) + ')' : '',
        supName(o.sup), o.price === undefined ? '' : o.price, o.qty || '', o.qty ? Math.round(o.qty * o.price * 100) / 100 : '', o.cur || '', o.date || '', tripName(n.trip || o.trip),
        n.insp ? ({ pass: 'Passed ', fail: 'FAILED ', open: 'Checked in part ' })[n.insp.result] + n.insp.date : '', n.ship || '', st.received || '', n.by || '', when_(n.createdAt),
        n.order ? shares_(o, n.project).map(sh => (sh.p ? c.pname(sh.p) : 'Extra') + ' ' + sh.q).join('; ') : '', o.rate || '', n.order ? usd_(Math.round(o.qty * o.price * 100) / 100, o) : '', n.under && byId[n.under] ? byId[n.under].t : ''];
    }), ['', '', '', '', '', '', '', 'num', '', '', '', '', '', '', 'num', '', '', '', '', 'num', 'num', 'num', '', 'date', '', '', '', 'date', '', '', '', 'num', 'USD'],
    [110, 220, 150, 150, 160, 120, 120, 70, 70, 320, 220, 100, 80, 90, 100, 70, 70, 170, 170, 100, 90, 110, 80, 105, 170, 130, 130, 105, 110, 150, 220, 80, 120, 180], null);
  const live = sups.filter(u => !u.deleted);
  dataTab_(ss, c.company, 'Suppliers', '#0f766e', ['No.', 'Name', 'Kind', 'City / market', 'Country', 'Contact person', 'Phone / WhatsApp', 'WeChat', 'Email', 'Quotes given', 'Items ordered', 'Note'],
    live.map(u => [u.id, u.name, u.kind || '', [u.city, u.market].filter(Boolean).join(' · '), u.country || '', u.person || '', u.phone || '', u.wechat || '', u.email || '',
      items.filter(n => (n.quotes || []).some(q => q.sup === u.id)).length, items.filter(n => n.order && n.order.sup === u.id).length, u.note || '']),
    [], [110, 200, 90, 200, 100, 150, 150, 130, 180, 90, 90, 260], null);
  dataTab_(ss, c.company, 'Trips', '#1d4ed8', ['No.', 'Destination', 'Country', 'Who travelled', 'Left on', 'Back on', 'Days', 'Purpose', 'Items on the list', 'Items ordered', 'Trip costs USD', 'Trip costs SSP', 'Note', 'Budget USD', 'Goods ordered USD'],
    trips.filter(j => !j.deleted).sort((a, b) => (a.out < b.out ? -1 : 1)).map(j => [j.id, j.to, j.country || '', j.who.join(', '), j.out, j.back || '', j.back ? daysBetween_(j.out, j.back) + 1 : '', j.purpose || '',
      items.filter(n => n.trip === j.id).length, items.filter(n => n.order && (n.order.trip === j.id || n.trip === j.id)).length, (cost[j.id + '|USD'] || 0) / 100, (cost[j.id + '|SSP'] || 0) / 100, j.note || '', j.budget || '', goodsUsd(j.id)]),
    ['', '', '', '', 'date', 'date', 'num', '', 'num', 'num', 'USD', 'SSP', '', 'USD', 'USD'], [110, 200, 100, 200, 105, 105, 60, 200, 90, 90, 120, 130, 260, 120, 140], null);
}

/* ---------- the morning email: what needs doing today ---------- */
// Sent by a daily trigger (allowFiles sets it up) to the address an admin chose in the app (Settings → Morning email).
// Payments: due in 3 days, today, or late (every morning until paid). Documents: on their reminder day, 7 days and 1 day
// before, the day they expire, then every Monday while expired. Nothing to say: no email.
function alertLines_(recs, t) {
  const live = k => recs.filter(r => r.k === k && SHAPES[k](r.d) && !r.d.deleted).map(r => r.d);
  const E = live('E'), lines = [];
  live('G').forEach(g => {
    const d = regularDue_(g, E.filter(x => x.regular === g.id && x.period).map(x => ({ period: x.period, periods: x.periods || 1 })), t), left = daysBetween_(t, d.next);
    if (d.late) lines.push('LATE: ' + g.name + ' — ' + g.cur + ' ' + g.amount + ' to ' + g.paidTo + ' (' + d.late + ' unpaid, oldest due ' + d.next + ')');
    else if (left === 0 || left === 3) lines.push('Due ' + (left ? 'in 3 days' : 'today') + ': ' + g.name + ' — ' + g.cur + ' ' + g.amount + ' to ' + g.paidTo + ' (' + d.next + ')');
  });
  const monday = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10))).getUTCDay() === 1;
  live('V').filter(v => v.expires).forEach(v => {
    const left = daysBetween_(t, v.expires), who = v.owner ? ' (' + v.owner + ')' : '';
    if (left < 0 && monday) lines.push('EXPIRED: ' + v.title + who + ' — expired on ' + v.expires);
    else if (left >= 0 && [remindOf_(v), 7, 1, 0].indexOf(left) >= 0) lines.push((left ? 'Expires in ' + left + ' day' + (left === 1 ? '' : 's') : 'Expires TODAY') + ': ' + v.title + who + ' (' + v.expires + ')');
  });
  // deliveries: one that arrived short (for two days), one on the way for more than two days, goods sold three days ago not sent
  const D = live('D'), I = live('I');
  D.filter(d => d.status === 'done' && daysBetween_(d.recv.at.slice(0, 10), t) <= 2 && d.lines.some(l => d.recv.lines.filter(g => g.m === l.m).reduce((a, g) => a + g.qty, 0) < l.qty))
    .forEach(d => lines.push('SHORT DELIVERY: ' + d.no + ' to ' + (d.to || '') + ' — received by ' + d.recv.name + ' with less than was sent'));
  D.filter(d => d.status === 'out' && daysBetween_(d.date, t) > 2 && daysBetween_(d.date, t) <= 30).forEach(d => lines.push('NOT CONFIRMED: ' + d.no + ' to ' + (d.to || '') + ' left on ' + d.date + ' (' + (d.driver || '?') + ') — nobody has recorded it as received'));
  I.filter(x => sells_(x) && x.items.some(it => it.m) && daysBetween_(x.date, t) >= 3 && daysBetween_(x.date, t) <= 60).forEach(x => {
    const sent = D.filter(d => d.inv === x.id).reduce((a, d) => a + d.lines.reduce((b, l) => b + l.qty, 0), 0), sold = x.items.filter(it => it.m).reduce((a, it) => a + it.qty, 0);
    if (sent < sold) lines.push('NOT DELIVERED: ' + x.no + ' of ' + x.date + ' — ' + (sold - sent) + ' of ' + sold + ' still in the warehouse, with no delivery note');
  });
  // the warehouse on Mondays: what is at or below its reorder level
  if (monday) {
    const st = stockMoves_(live('Y'), live('O'), live('I')).st;
    live('M').filter(m => m.min > 0 && (st[m.id] ? st[m.id].qty : 0) <= m.min).forEach(m => lines.push('LOW STOCK: ' + m.name + ' — ' + (st[m.id] ? st[m.id].qty : 0) + ' ' + m.unit + ' left (reorder at ' + m.min + ')'));
  }
  // a buying trip a week, a day and on the day before it leaves: what is still on its list
  const N = live('N');
  live('J').forEach(j => {
    const left = daysBetween_(t, j.out), open = N.filter(n => n.trip === j.id && ['idea', 'tobuy'].indexOf(n.status) >= 0).length;
    if ([7, 1, 0].indexOf(left) >= 0) lines.push('Trip ' + (left ? 'in ' + left + ' day' + (left === 1 ? '' : 's') : 'TODAY') + ': ' + j.to + (j.who.length ? ' (' + j.who.join(', ') + ')' : '') + ' — ' + open + ' item' + (open === 1 ? '' : 's') + ' on its buying list');
  });
  return lines;
}
function morningEmail(test) {
  if (test !== true) { try { tidySpares_(readAll_(syncTab_(SpreadsheetApp.getActive()))); } catch (err) { console.error('Tidying spare copies: ' + err.message); } } // the daily job
  const to = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
  if (!to) return 'No address: an admin sets it in the app (Settings → Morning email).';
  const recs = readAll_(syncTab_(SpreadsheetApp.getActive())).map(toRec_), lines = alertLines_(recs, today_());
  if (!lines.length && test !== true) return 'Nothing to do today.';
  const company = (recs.filter(r => r.k === 'S').map(r => r.d.company)[0]) || 'Company';
  MailApp.sendEmail({ to: to, subject: company + (lines.length ? ' — ' + lines.length + ' thing' + (lines.length === 1 ? '' : 's') + ' to do today' : ' — test: the morning email works'),
    body: (lines.length ? lines.join('\n') : 'Nothing is due or expiring today. This is the test you asked for.') + '\n\nOpen the app: ' + APP_URL_ });
  return 'Sent to ' + to + '.';
}
const APP_URL_ = 'https://app.b-e-p-l.com/';
const hasMorning_ = () => ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'morningEmail');
// an admin chooses where the morning email goes ('' = none), or asks for a test now
function alerts_(req) {
  const props = PropertiesService.getScriptProperties();
  if (typeof req.email === 'string') {
    const email = req.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'That is not an email address.' };
    if (email) props.setProperty('ALERT_EMAIL', email); else props.deleteProperty('ALERT_EMAIL');
  }
  let running = false;
  try { running = hasMorning_(); } catch (err) { running = false; } // not allowed yet: allowFiles has not been run since script 15
  const sent = req.test ? morningEmail(true) : '';
  return { ok: true, email: props.getProperty('ALERT_EMAIL') || '', running: running, sent: sent };
}
function changeLog_(ss, c) {
  dataTab_(ss, c.company, 'Change Log', COLOR.muted, ['When', 'Action', 'Entry', 'By', 'Details'],
    c.L.map(l => [when_(l.at), l.action, l.id || '', l.by || '', l.text]), ['', '', '', '', ''], [160, 110, 120, 120, 700], null);
}
