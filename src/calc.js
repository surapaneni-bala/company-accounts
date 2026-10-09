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
  const W = 595.28, H = 841.89; // A4 in points
  const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  add('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const n = 3 + 3 * i;
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
