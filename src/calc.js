/* ---------- pay maths, amounts in words, one-page PDF ---------- */
// No screen code here: tools/test-calc.js checks all of it in Node.

// Days paid in a month, on a 30-day month (the owner's rule): joining and leaving days both count, and the
// 31st counts as the 30th. start/end are 'YYYY-MM-DD'; end is the leaving day, or today.
function payDays(month, start, end) {
  if (start.slice(0, 7) > month || end.slice(0, 7) < month) return 0;
  const first = start.slice(0, 7) === month ? Math.min(+start.slice(8, 10), 30) : 1;
  const last = end.slice(0, 7) === month ? Math.min(+end.slice(8, 10), 30) : 30;
  return Math.max(0, last - first + 1);
}
const nextMonth = m => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };

// A payment in the wage's currency, in cents; null when it can't be converted (another currency, no rate).
// rate = SSP for 1 USD, saved on every SSP entry.
function inWage(p, cur) {
  if (p.cur === cur) return Math.round(p.amount * 100);
  if (!(p.rate > 0)) return null;
  return Math.round((cur === 'USD' ? p.amount / p.rate : p.amount * p.rate) * 100);
}

const dayAfter = d => { const [y, m, dd] = d.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, dd + 1)); return t.toISOString().slice(0, 10); };

/* ---------- regular payments: rent, internet, licence fees ---------- */
const EVERY_MONTHS = [1, 3, 6, 12];
// The k-th due date of a payment due every `every` months from `first`, on the same day of the month (or the month's last
// day when it is shorter: from the 31st it falls on 30 April and 28 February, and is back on the 31st in May).
function dueOn(first, every, k) {
  const [y, m, d] = first.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + k * every, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const monthNo = d => +d.slice(0, 4) * 12 + +d.slice(5, 7) - 1;
// which due date (0, 1, 2 …) the stretch a day falls in belongs to: due date k covers its month and the months up to the next
const stretchOf = (g, d) => Math.floor((monthNo(d) - monthNo(g.first)) / g.every);
// Where a regular payment stands today: the oldest due date not paid yet (next), and how many due dates before today are
// unpaid (late). pays = what its payments were for: { period: the due date paid, periods: how many in a row (6 months of
// rent at once) } (or just the due date). A payment counts for the stretch it falls in, so moving the due day (the 1st to
// the 5th) keeps the months already paid.
function regularDue(g, pays, today) {
  const paid = new Set();
  pays.forEach(p => { const d = typeof p === 'string' ? p : p.period, n = (p && p.periods) || 1, k = stretchOf(g, d); for (let i = Math.max(0, k); i < k + n; i++) paid.add(i); });
  let next = '', late = 0;
  for (let k = 0; k < 1200; k++) {
    if (paid.has(k)) continue;
    const d = dueOn(g.first, g.every, k);
    if (!next) next = d;
    if (d < today) late++; else break;
  }
  return { next, late };
}

// Payments that look like a regular payment, for the owner to confirm: the same payee and currency, paid again and again
// about every 1, 3, 6 or 12 months for a similar amount (a whole multiple of it counts as several periods paid at once).
// Each suggestion lists its payments and the due date each one pays. Frequent buying from one shop (several times a
// month, or amounts all over the place) is not regular.
const EVERY_OF_GAP = g => (g < 0.5 ? 0 : g < 2 ? 1 : g < 4.5 ? 3 : g < 9 ? 6 : g <= 15 ? 12 : 0);
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function findRegulars(expenses) {
  const groups = new Map();
  expenses.filter(e => !e.deleted && !e.regular && !e.worker && !e.pay && !e.advance && !e.from && String(e.paidTo || '').trim())
    .forEach(e => { const key = `${String(e.paidTo).trim().toLowerCase().replace(/\s+/g, ' ')}|${e.cur}`; (groups.get(key) || groups.set(key, []).get(key)).push(e); });
  const out = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.at.localeCompare(b.at));
    const unit = median(list.map(e => e.amount));
    const periodsOf = a => { if (Math.abs(a - unit) <= unit * 0.15) return 1; const n = Math.round(a / unit); return n >= 2 && n <= 12 && Math.abs(a - n * unit) <= unit * n * 0.05 ? n : 0; };
    const items = list.map(e => ({ e, n: periodsOf(e.amount) })).filter(x => x.n);
    if (items.length < 2) continue;
    const gaps = items.slice(1).map((x, i) => (monthNo(x.e.at) - monthNo(items[i].e.at)) / items[i].n);
    const every = EVERY_OF_GAP(median(gaps));
    if (!every || (every === 1 && items.length < 3)) continue;
    if (gaps.filter(g => Math.abs(g - every) <= Math.max(1, every * 0.34)).length < gaps.length * 0.6) continue; // not steady enough
    const g = { first: items[0].e.at.slice(0, 10), every }, taken = new Set();
    const pays = items.map(({ e, n }) => {
      let k = Math.max(0, stretchOf(g, e.at));
      while (taken.has(k)) k++;
      for (let i = k; i < k + n; i++) taken.add(i);
      return { id: e.id, period: dueOn(g.first, every, k), ...(n > 1 ? { periods: n } : {}) };
    });
    const most = f => { const c = new Map(); items.forEach(({ e }) => c.set(e[f] || '', (c.get(e[f] || '') || 0) + 1)); return [...c].sort((a, b) => b[1] - a[1])[0][0]; };
    out.push({ key, paidTo: items[items.length - 1].e.paidTo, cur: items[0].e.cur, amount: Math.round(unit * 100) / 100, every, first: g.first, reason: most('reason'), mode: most('mode'), project: most('project'), pays });
  }
  return out.sort((a, b) => b.pays.length - a.pays.length);
}

/* ---------- invoices and quotations ---------- */
// The money on an invoice: each line is quantity × unit price to the cent; tax (a percentage, 0 = none) on their sum.
function invoiceTotals(inv) {
  const sub = inv.items.reduce((t, it) => t + Math.round(it.qty * it.price * 100), 0), tax = inv.tax > 0 ? Math.round(sub * inv.tax / 100) : 0;
  return { sub: sub / 100, tax: tax / 100, total: (sub + tax) / 100 };
}
// What has been received for it (money received entries that name it, in its currency) and what is still owed.
function invoiceState(inv, credits, today) {
  const total = invoiceTotals(inv).total;
  const paid = credits.filter(c => c.invoice === inv.id && !c.deleted && c.cur === inv.cur).reduce((t, c) => t + Math.round(c.amount * 100), 0);
  const due = Math.max(0, Math.round(total * 100) - paid) / 100;
  const state = inv.cancelled ? 'cancelled' : due === 0 ? 'paid' : inv.due && inv.due < today ? 'overdue' : paid ? 'part' : 'unpaid';
  return { total, paid: paid / 100, due, state };
}

// An employee's account: wage earned month by month (less days not worked: the dated ones recorded for them, plus
// the number older salary payments carried),
// minus everything paid to them (salary, advances, final settlement), plus the balance from before the app
// (openingAmount: owed to them, or negative = already paid). clearedTo = salary already settled up to that day.
function workerLedger(w, pays, today, absences = []) {
  const end = w.status === 'left' && w.left && w.left < today ? w.left : today;
  const from = w.clearedTo && w.clearedTo >= w.start ? dayAfter(w.clearedTo) : w.start;
  const mine = pays.filter(p => p.worker === w.id && !p.deleted);
  const off = {};
  mine.forEach(p => { if (p.pay === 'salary' && p.month && p.daysOff) off[p.month] = (off[p.month] || 0) + p.daysOff; });
  absences.forEach(a => { if (a.worker === w.id && !a.deleted && a.date >= from && a.date <= end) off[a.date.slice(0, 7)] = (off[a.date.slice(0, 7)] || 0) + 1; });
  const months = [];
  let earned = 0;
  if (from <= end) {
    for (let m = from.slice(0, 7); m <= end.slice(0, 7); m = nextMonth(m)) {
      const days = payDays(m, from, end), daysOff = Math.min(off[m] || 0, days);
      const cents = Math.round(w.wage * 100 * (days - daysOff) / 30);
      months.push({ month: m, days, daysOff, earned: cents / 100 });
      earned += cents;
    }
  }
  let paid = 0;
  const unconverted = [];
  mine.forEach(p => { const c = inWage(p, w.cur); if (c === null) unconverted.push(p.id); else paid += c; });
  const opening = Math.round((w.openingAmount || 0) * 100);
  return { cur: w.cur, months, earned: earned / 100, paid: paid / 100, opening: opening / 100, balance: (opening + earned - paid) / 100, unconverted };
}

// Advances given in a month, in US dollars (the monthly limit is in dollars).
function advancesUsd(pays, month) {
  const cents = pays.filter(p => p.pay === 'advance' && !p.deleted && p.at.slice(0, 7) === month)
    .reduce((t, p) => t + (p.cur === 'USD' ? Math.round(p.amount * 100) : p.rate > 0 ? Math.round(p.amount / p.rate * 100) : 0), 0);
  return cents / 100;
}

// "Two hundred fifty US dollars only" — printed on every slip so a figure can't be quietly changed.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const BIG = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
const UNITS = { USD: ['US dollar', 'US dollars', 'cent', 'cents'], SSP: ['South Sudanese pound', 'South Sudanese pounds', 'piaster', 'piasters'] };
function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + words(n % 100) : '');
  const [size, name] = BIG.find(([s]) => n >= s);
  return words(Math.floor(n / size)) + ' ' + name + (n % size ? ' ' + words(n % size) : '');
}
function amountInWords(amount, cur) {
  const c = Math.round(amount * 100), whole = Math.floor(c / 100), part = c % 100;
  const [one, many, sub, subs] = UNITS[cur];
  const s = `${words(whole)} ${whole === 1 ? one : many}${part ? ` and ${words(part)} ${part === 1 ? sub : subs}` : ''} only`;
  return s[0].toUpperCase() + s.slice(1);
}

// An A4 PDF with one JPEG per page (slips and statements are drawn as pictures): no PDF library needed.
// pages = [{ data: JPEG bytes, w, h }]; each page is objects 3+3i (page), 4+3i (drawing), 5+3i (picture).
function pdfPages(pages) {
  const enc = new TextEncoder(), parts = [], offsets = [];
  let size = 0;
  const add = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; add(`${n} 0 obj\n${body}\nendobj\n`); };
  const W = 595.28; // A4 width in points; each page is as tall as its picture (an A4 page, or a slip as tall as it needs)
  add('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const n = 3 + 3 * i, H = Math.round(W * p.h / p.w * 100) / 100, draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    obj(n + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    offsets[n + 2] = size;
    add(`${n + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.data.length} >>\nstream\n`);
    add(p.data);
    add('\nendstream\nendobj\n');
  });
  const count = 3 + 3 * pages.length, xref = size;
  add(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let at = 0;
  parts.forEach(b => { out.set(b, at); at += b.length; });
  return out;
}
const jpegToPdf = (jpeg, w, h) => pdfPages([{ data: jpeg, w, h }]);
