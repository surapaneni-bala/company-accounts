/**
 * Company Accounts — sync server for the company Google Sheet.
 *
 * Install (once): in the Google Sheet open Extensions → Apps Script, replace everything with
 * this file, run setup(), then Deploy → New deployment → Web app
 * (Execute as: Me, Who has access: Anyone). Full steps are in the README.
 *
 * The hidden "_sync" tab is the master copy of every record. Summary, Expenses, Money Received,
 * Cash & Bank moves, Ledger and Change Log are rebuilt from it after every change.
 */
const SYNC_TAB = '_sync';
const VIEW_TABS = ['Summary', 'Expenses', 'Money Received', 'Cash & Bank moves', 'Ledger', 'Change Log'];
// record kinds: Expense, Received, Project, Log, Settings, Transfer (cash ↔ bank move)
const KINDS = ['E', 'R', 'P', 'L', 'S', 'T'];
const ACCOUNTS = ['Cash', 'Bank'];
const LOCK_WAIT_MS = 25000;
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
  return json_({ ok: true, app: 'company-accounts' });
}

// Body: { key, since, push: [{ id, k, u, d }] }  →  { ok, seq, sheet, pull: [{ id, k, u, d }] }
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  const key = PropertiesService.getScriptProperties().getProperty('KEY');
  if (!key) return json_({ ok: false, error: 'The Google Sheet is not set up yet: run setup() in Apps Script.' });
  if (String(req.key || '').toUpperCase() !== key) return json_({ ok: false, error: 'Wrong company code.' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return json_({ ok: false, error: 'The Google Sheet is busy. It will retry by itself.' });
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = syncTab_(ss);
    const rows = readAll_(sh);
    const result = merge_(rows, req.push, Number(req.since) || 0);
    if (result.changed) {
      sh.getRange(2, 1, result.rows.length, 5).setValues(result.rows);
      rebuild_(ss, result.rows.map(toRec_));
    }
    return json_({ ok: true, seq: result.seq, sheet: ss.getUrl(), kinds: KINDS, pull: result.pull });
  } finally {
    lock.releaseLock();
  }
}

// Pure merge: newest copy of each record wins. rows are [id, kind, u, seq, json].
function merge_(rows, push, since) {
  const out = rows.map(r => r.slice());
  const index = {};
  out.forEach((r, i) => { index[r[0]] = i; });
  let seq = out.reduce((m, r) => Math.max(m, Number(r[3]) || 0), 0);
  let changed = false;
  (Array.isArray(push) ? push : []).forEach(p => {
    if (!p || typeof p.id !== 'string' || !p.id || KINDS.indexOf(p.k) < 0 || typeof p.u !== 'number' || !p.d || typeof p.d !== 'object') return;
    const i = index[p.id];
    if (i !== undefined && Number(out[i][2]) >= p.u) return;
    seq += 1;
    changed = true;
    const row = [p.id, p.k, p.u, seq, JSON.stringify(p.d)];
    if (i === undefined) { index[p.id] = out.length; out.push(row); } else { out[i] = row; }
  });
  const pull = out.filter(r => Number(r[3]) > since).map(toRec_);
  return { rows: out, seq: seq, changed: changed, pull: pull };
}

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
function rebuild_(ss, recs) {
  const of = k => recs.filter(r => r.k === k).map(r => r.d);
  const projects = {};
  of('P').forEach(p => { projects[p.id] = p; });
  const pname = id => (id ? (projects[id] ? projects[id].name : 'Unknown project') : 'General (no project)');
  const live = k => of(k).filter(x => !x.deleted && (k !== 'T' || (ACCOUNTS.indexOf(x.from) >= 0 && ACCOUNTS.indexOf(x.to) >= 0))).sort(byAt_);
  const settings = of('S')[0] || {};
  const ctx = { E: live('E'), R: live('R'), T: live('T'), P: of('P').filter(x => !x.deleted), L: of('L').sort(byAt_), pname: pname, company: settings.company || 'Company' };
  summary_(ss, ctx);
  expenses_(ss, ctx);
  received_(ss, ctx);
  moves_(ss, ctx);
  ledger_(ss, ctx);
  changeLog_(ss, ctx);
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
  sh.getRange(1, 1).setValue(text).setFontSize(18).setFontWeight('bold').setFontColor(COLOR.ink);
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
  const months = {};
  c.E.concat(c.R).forEach(x => { months[x.at.slice(0, 7)] = true; });
  const mRows = Object.keys(months).sort().map(m => {
    const e = c.E.filter(x => x.at.indexOf(m) === 0), g = c.R.filter(x => x.at.indexOf(m) === 0);
    return [MONTHS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4), sum_(g, 'USD'), sum_(e, 'USD'), sub_(sum_(g, 'USD'), sum_(e, 'USD')), sum_(g, 'SSP'), sum_(e, 'SSP'), sub_(sum_(g, 'SSP'), sum_(e, 'SSP')), e.length + g.length];
  });
  r = table_(sh, r, ['Month', 'Received USD', 'Spent USD', 'Net USD', 'Received SSP', 'Spent SSP', 'Net SSP', 'Entries'], mRows,
    ['', 'USD', 'USD', 'USD', 'SSP', 'SSP', 'SSP', ''], ['TOTAL', recv.USD, spent.USD, bal.USD, recv.SSP, spent.SSP, bal.SSP, c.E.length + c.R.length]);

  r = section_(sh, r + 2, 'Entries by person');
  const people = {};
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
    ['Entry no.', 'Date', 'Day', 'Time', 'Currency', 'Amount USD', 'Amount SSP', 'Paid to', 'Reason', 'Location', 'Project', 'Paid from', 'Entered by', 'Recorded', 'Remarks'],
    c.E.map(x => [x.id, ymd_(x.at), DAYS[day_(x.at).getDay()], time_(x.at), x.cur, only_(x, 'USD'), only_(x, 'SSP'), x.paidTo, x.reason, x.location || '', c.pname(x.project), accountOf_(x.mode), x.by || '', when_(x.createdAt), remarks_(x)]),
    ['', 'date', '', '', '', 'USD', 'SSP'], [110, 105, 50, 80, 75, 120, 140, 170, 200, 130, 170, 100, 120, 150, 260], [5, 6]);
}
function received_(ss, c) {
  dataTab_(ss, c.company, 'Money Received', COLOR.in,
    ['Entry no.', 'Date', 'Day', 'Time', 'Project', 'Currency', 'Amount USD', 'Amount SSP', 'Received into', 'Note', 'Entered by', 'Recorded', 'Remarks'],
    c.R.map(x => [x.id, ymd_(x.at), DAYS[day_(x.at).getDay()], time_(x.at), c.pname(x.project), x.cur, only_(x, 'USD'), only_(x, 'SSP'), accountOf_(x.mode), x.note || '', x.by || '', when_(x.createdAt), remarks_(x)]),
    ['', 'date', '', '', '', '', 'USD', 'SSP'], [110, 105, 50, 80, 190, 75, 120, 140, 110, 200, 120, 150, 260], [6, 7]);
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
function changeLog_(ss, c) {
  dataTab_(ss, c.company, 'Change Log', COLOR.muted, ['When', 'Action', 'Entry', 'By', 'Details'],
    c.L.map(l => [when_(l.at), l.action, l.id || '', l.by || '', l.text]), ['', '', '', '', ''], [160, 110, 120, 120, 700], null);
}
