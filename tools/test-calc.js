// Wages, days, amounts in words and the one-page PDF: the plain maths in src/calc.js, checked in Node.
// Usage: node tools/test-calc.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ TextEncoder });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/calc.js'), 'utf8') + '\n;this.api = { payDays, workerLedger, amountInWords, jpegToPdf, pdfPages, advancesUsd, dueOn, regularDue, invoiceTotals, invoiceState, findRegulars };', ctx);
const { payDays, workerLedger, amountInWords, jpegToPdf, pdfPages, advancesUsd, dueOn, regularDue, invoiceTotals, invoiceState, findRegulars } = ctx.api;
const plain = x => JSON.parse(JSON.stringify(x));

/* ---------- days on a 30-day month: joining and leaving days both count, day 31 counts as day 30 ---------- */
assert.strictEqual(payDays('2026-08', '2026-08-10', '2026-10-15'), 21, 'joined on the 10th');
assert.strictEqual(payDays('2026-09', '2026-08-10', '2026-10-15'), 30, 'a whole month');
assert.strictEqual(payDays('2026-10', '2026-08-10', '2026-10-15'), 15, 'left on the 15th');
assert.strictEqual(payDays('2026-10', '2026-08-10', '2026-10-31'), 30, 'the 31st counts as the 30th');
assert.strictEqual(payDays('2027-02', '2026-08-10', '2027-03-05'), 30, 'February is a whole month too');
assert.strictEqual(payDays('2026-11', '2026-08-10', '2026-10-15'), 0, 'after leaving');
assert.strictEqual(payDays('2026-07', '2026-08-10', '2026-10-15'), 0, 'before joining');
assert.strictEqual(payDays('2026-10', '2026-10-15', '2026-10-15'), 1, 'joined and left the same day');

/* ---------- the worked example: $300 a month, joined 1 Aug, left 15 Oct ---------- */
const james = { id: 'W-1', wage: 300, cur: 'USD', start: '2026-08-01', status: 'left', left: '2026-10-15' };
const pay = (at, amount, kind, extra = {}) => ({ id: 'E-' + at + amount, worker: 'W-1', at: at + 'T10:00', amount, cur: 'USD', pay: kind, ...extra });
const pays = [
  pay('2026-08-12', 50, 'advance'), pay('2026-08-31', 250, 'salary', { month: '2026-08' }),
  pay('2026-09-05', 100, 'advance'), pay('2026-09-20', 80, 'advance'), pay('2026-09-30', 120, 'salary', { month: '2026-09' }),
  pay('2026-10-05', 60, 'advance'),
];
let l = plain(workerLedger(james, pays, '2026-10-20'));
assert.deepStrictEqual([l.earned, l.paid, l.balance], [750, 660, 90], 'Aug 300 + Sep 300 + Oct 15 days 150, less 660 paid: $90 still owed');
assert.deepStrictEqual(l.months.map(x => [x.month, x.days, x.earned]), [['2026-08', 30, 300], ['2026-09', 30, 300], ['2026-10', 15, 150]]);

// days not worked come off at wage ÷ 30 a day
l = plain(workerLedger(james, pays.map(p => (p.month === '2026-09' ? { ...p, daysOff: 2 } : p)), '2026-10-20'));
assert.deepStrictEqual([l.earned, l.balance], [730, 70], '2 days not worked in September: $20 less');

// still working: this month counts up to today
const ann = { id: 'W-1', wage: 300, cur: 'USD', start: '2026-10-01', status: 'active' };
assert.strictEqual(plain(workerLedger(ann, [], '2026-10-10')).earned, 100, '10 days into the month');
// opening balance from the salary book, and an SSP payment converted at its own rate
l = plain(workerLedger({ ...ann, openingAmount: 120 }, [pay('2026-10-05', 450000, 'advance', { cur: 'SSP', rate: 4500 })], '2026-10-10'));
assert.deepStrictEqual([l.earned, l.paid, l.balance], [100, 100, 120], 'SSP 450,000 at 4,500 = $100');
// deleted payments don't count; payments for other people don't count
assert.strictEqual(plain(workerLedger(ann, [pay('2026-10-05', 40, 'advance', { deleted: 'x' }), { ...pay('2026-10-05', 40, 'advance'), worker: 'W-2' }], '2026-10-10')).paid, 0);
// an SSP wage paid in SSP needs no rate
assert.strictEqual(plain(workerLedger({ ...ann, wage: 900000, cur: 'SSP' }, [pay('2026-10-05', 300000, 'advance', { cur: 'SSP' })], '2026-10-10')).balance, 0);

// added on an old date with the salary already paid up to a day: wages count again from the next day
const ben = { id: 'W-1', wage: 300, cur: 'USD', start: '2026-08-01', status: 'active' };
l = plain(workerLedger({ ...ben, clearedTo: '2026-09-30' }, [], '2026-10-10'));
assert.deepStrictEqual([l.earned, l.balance, l.months.map(m => m.month)], [100, 100, ['2026-10']], 'cleared to the end of September: only October counts');
assert.strictEqual(plain(workerLedger({ ...ben, clearedTo: '2026-10-10' }, [], '2026-10-10')).balance, 0, 'cleared up to today: nothing owed');
assert.strictEqual(plain(workerLedger({ ...ben, clearedTo: '2026-10-05' }, [], '2026-10-10')).earned, 50, 'cleared mid-month: the days after it count');
assert.strictEqual(plain(workerLedger({ ...ben, clearedTo: '2026-07-31' }, [], '2026-10-10')).earned, 700, 'a date before the start changes nothing');
// not fully paid: what was paid before the app comes off (a negative opening balance)
assert.strictEqual(plain(workerLedger({ ...ben, openingAmount: -450 }, [], '2026-10-10')).balance, 250, '700 earned, 450 paid before the app');

// days not worked are recorded one by one with their dates; each comes off that month at wage ÷ 30
const off = (date, extra = {}) => ({ id: 'A-' + date, worker: 'W-1', date, ...extra });
l = plain(workerLedger(ben, [], '2026-10-20', [off('2026-09-03'), off('2026-09-04'), off('2026-10-02')]));
assert.deepStrictEqual(l.months.map(m => [m.month, m.daysOff, m.earned]), [['2026-08', 0, 300], ['2026-09', 2, 280], ['2026-10', 1, 190]], 'two days in September, one in October');
assert.strictEqual(plain(workerLedger(ben, [], '2026-10-20', [off('2026-09-03', { deleted: 'x' }), { ...off('2026-09-04'), worker: 'W-2' }])).earned, 800, 'deleted days and other people\'s days don\'t count');
assert.strictEqual(plain(workerLedger({ ...ben, clearedTo: '2026-09-30' }, [], '2026-10-20', [off('2026-09-03'), off('2026-10-25')])).earned, 200, 'days before the cleared date or after today don\'t count');
// salaries saved before dated days existed still carry their number of days, and both add up
l = plain(workerLedger(ben, [pay('2026-09-30', 0, 'salary', { month: '2026-09', daysOff: 1 })], '2026-10-20', [off('2026-09-03')]));
assert.strictEqual(l.months.find(m => m.month === '2026-09').daysOff, 2);

/* ---------- advances this month, in dollars (the $100 limit) ---------- */
assert.strictEqual(advancesUsd(pays, '2026-09'), 180);
assert.strictEqual(advancesUsd([pay('2026-10-05', 225000, 'advance', { cur: 'SSP', rate: 4500 })], '2026-10'), 50);

/* ---------- amounts in words (printed on every slip so a figure can't be quietly changed) ---------- */
assert.strictEqual(amountInWords(250, 'USD'), 'Two hundred fifty US dollars only');
assert.strictEqual(amountInWords(85.16, 'USD'), 'Eighty-five US dollars and sixteen cents only');
assert.strictEqual(amountInWords(1200000.5, 'SSP'), 'One million two hundred thousand South Sudanese pounds and fifty piasters only');
assert.strictEqual(amountInWords(1, 'USD'), 'One US dollar only');
assert.strictEqual(amountInWords(0.07, 'USD'), 'Zero US dollars and seven cents only');
assert.strictEqual(amountInWords(2017, 'USD'), 'Two thousand seventeen US dollars only');

/* ---------- one-page PDF around a JPEG: every cross-reference must point at its object ---------- */
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const pdf = Buffer.from(jpegToPdf(jpeg, 1240, 1754));
const text = pdf.toString('latin1');
assert.ok(text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'));
const xrefAt = text.lastIndexOf('\nxref\n') + 1; // the table itself, not the "xref" inside "startxref"
const offsets = text.slice(xrefAt).split('\n').slice(3, 8).map(r => Number(r.slice(0, 10)));
offsets.forEach((o, i) => assert.ok(text.startsWith(`${i + 1} 0 obj`, o), `object ${i + 1} is where the xref says`));
assert.strictEqual(Number(text.slice(text.indexOf('startxref') + 10).trim().split('\n')[0]), xrefAt);
assert.ok(pdf.includes(Buffer.from(jpeg)), 'the photo bytes are inside, untouched');
assert.ok(text.includes('/Width 1240 /Height 1754'));
assert.ok(text.includes('/MediaBox [0 0 595.28 842.03]'), 'an A4 picture makes an A4 page (1240 × 1754 dots)');
assert.ok(Buffer.from(jpegToPdf(jpeg, 1240, 1240)).toString('latin1').includes('/MediaBox [0 0 595.28 595.28]'), 'a shorter slip makes a page as tall as it is');

/* ---------- several pages (a long statement) ---------- */
const two = Buffer.from(pdfPages([{ data: jpeg, w: 1240, h: 1754 }, { data: jpeg, w: 1240, h: 1754 }])).toString('latin1');
assert.ok(two.includes('/Kids [3 0 R 6 0 R] /Count 2'), 'two pages listed');
const at2 = two.lastIndexOf('\nxref\n') + 1, rows2 = two.slice(at2).split('\n');
assert.strictEqual(rows2[1], '0 9', 'catalog, page list and 3 objects per page');
rows2.slice(3, 11).map(r => Number(r.slice(0, 10))).forEach((o, i) => assert.ok(two.startsWith(`${i + 1} 0 obj`, o), `object ${i + 1} is where the xref says`));
assert.strictEqual(Number(two.slice(two.indexOf('startxref') + 10).trim().split('\n')[0]), at2);

/* ---------- regular payments: due dates every 1, 3, 6 or 12 months, and what is paid ---------- */
assert.deepStrictEqual([0, 1, 2, 3].map(k => dueOn('2026-01-31', 1, k)), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'], 'the 31st falls on the last day of a shorter month, and comes back');
assert.deepStrictEqual([0, 1, 2].map(k => dueOn('2026-11-15', 3, k)), ['2026-11-15', '2027-02-15', '2027-05-15'], 'every 3 months, across the year end');
assert.strictEqual(dueOn('2024-02-29', 12, 1), '2025-02-28', 'every year from 29 February');
const rent = { first: '2026-09-01', every: 1 };
assert.deepStrictEqual(plain(regularDue(rent, [], '2026-08-20')), { next: '2026-09-01', late: 0 }, 'not due yet');
assert.deepStrictEqual(plain(regularDue(rent, [], '2026-09-01')), { next: '2026-09-01', late: 0 }, 'due today is not late');
assert.deepStrictEqual(plain(regularDue(rent, [], '2026-10-11')), { next: '2026-09-01', late: 2 }, 'September and October unpaid: the oldest comes first');
assert.deepStrictEqual(plain(regularDue(rent, ['2026-09-01'], '2026-10-11')), { next: '2026-10-01', late: 1 }, 'September paid');
assert.deepStrictEqual(plain(regularDue(rent, ['2026-09-01', '2026-10-01'], '2026-10-11')), { next: '2026-11-01', late: 0 }, 'paid up: the next one');
assert.deepStrictEqual(plain(regularDue(rent, ['2026-09-01', '2026-10-01', '2026-11-01'], '2026-10-11')), { next: '2026-12-01', late: 0 }, 'paid ahead');
assert.deepStrictEqual(plain(regularDue({ first: '2026-09-05', every: 1 }, ['2026-09-01', '2026-10-01'], '2026-10-11')), { next: '2026-11-05', late: 0 }, 'the due day moved from the 1st to the 5th: payments still count for their month');
assert.deepStrictEqual(plain(regularDue({ first: '2026-01-10', every: 12 }, ['2026-01-10'], '2026-10-11')), { next: '2027-01-10', late: 0 }, 'a yearly licence');

/* ---------- invoices: lines, tax, what is paid and what is left ---------- */
const inv = { id: 'I-1', cur: 'USD', due: '2026-10-20', tax: 0, items: [{ t: 'Cement 42.5', qty: 3, unit: 'bags', price: 19.99 }, { t: 'Delivery', qty: 1, price: 50 }] };
assert.deepStrictEqual(plain(invoiceTotals(inv)), { sub: 109.97, tax: 0, total: 109.97 }, 'quantity × price to the cent (3 × 19.99 is 59.97, not 59.970000001)');
assert.deepStrictEqual(plain(invoiceTotals({ ...inv, tax: 18 })), { sub: 109.97, tax: 19.79, total: 129.76 }, 'tax on the sum, rounded to the cent');
const paid = (amount, extra = {}) => ({ invoice: 'I-1', cur: 'USD', amount, ...extra });
assert.deepStrictEqual(plain(invoiceState(inv, [], '2026-10-11')), { total: 109.97, paid: 0, due: 109.97, state: 'unpaid' });
assert.strictEqual(invoiceState(inv, [paid(50)], '2026-10-11').state, 'part', 'part paid');
assert.deepStrictEqual(plain(invoiceState(inv, [paid(50), paid(59.97)], '2026-10-11')), { total: 109.97, paid: 109.97, due: 0, state: 'paid' });
assert.strictEqual(invoiceState(inv, [paid(50)], '2026-10-21').state, 'overdue', 'past the due date with money still owed');
assert.strictEqual(invoiceState(inv, [paid(500)], '2026-10-21').due, 0, 'paid more: nothing owed');
assert.strictEqual(invoiceState(inv, [paid(50, { deleted: 'x' }), paid(50, { cur: 'SSP' }), paid(50, { invoice: 'I-2' })], '2026-10-11').paid, 0, 'a deleted entry, another currency or another invoice does not count');
assert.strictEqual(invoiceState({ ...inv, cancelled: '2026-10-12T10:00' }, [], '2026-10-30').state, 'cancelled');

/* ---------- several periods paid at once, and spotting regular payments among old entries ---------- */
assert.deepStrictEqual(plain(regularDue(rent, [{ period: '2026-09-01', periods: 6 }], '2026-10-11')), { next: '2027-03-01', late: 0 }, 'six months of rent paid at once');
assert.deepStrictEqual(plain(regularDue({ first: '2026-01-15', every: 3 }, [{ period: '2026-01-15', periods: 2 }], '2026-10-11')), { next: '2026-07-15', late: 1 }, 'two quarters at once, the third late');
const ex = (id, at, amount, extra = {}) => ({ id, at: at + 'T10:00', amount, cur: 'USD', paidTo: 'Wani', reason: 'Land rent', mode: 'Cash', project: '', ...extra });
const found = plain(findRegulars([ex('E1', '2026-03-03', 500), ex('E2', '2026-04-04', 500), ex('E3', '2026-05-02', 500), ex('E4', '2026-06-05', 3000, { reason: 'Rent 6 months' }),
  ex('S1', '2026-05-01', 40, { paidTo: 'Hardware shop', reason: 'Nails' }), ex('S2', '2026-05-03', 260, { paidTo: 'Hardware shop' }), ex('S3', '2026-05-20', 15, { paidTo: 'hardware  shop' }), ex('S4', '2026-06-02', 90, { paidTo: 'Hardware Shop' }),
  ex('L1', '2025-01-10', 300, { paidTo: 'Authority', reason: 'Trading licence' }), ex('L2', '2026-01-12', 310, { paidTo: 'Authority', reason: 'Trading licence' }),
  ex('W1', '2026-03-01', 300, { paidTo: 'John', worker: 'W-1', pay: 'salary' }), ex('W2', '2026-04-01', 300, { paidTo: 'John', worker: 'W-1', pay: 'salary' }), ex('W3', '2026-05-01', 300, { paidTo: 'John', worker: 'W-1', pay: 'salary' }),
  ex('X1', '2026-03-01', 50, { paidTo: 'Internet co' }), ex('X2', '2026-04-01', 50, { paidTo: 'Internet co' }), ex('X3', '2026-05-01', 50, { paidTo: 'Internet co', regular: 'G-1' })]));
assert.deepStrictEqual(found.map(f => [f.paidTo, f.every, f.amount]), [['Wani', 1, 500], ['Authority', 12, 305]], 'monthly rent and a yearly licence; not a shop bought from often, not salaries, not what is already linked');
assert.deepStrictEqual(found[0].pays, [{ id: 'E1', period: '2026-03-03' }, { id: 'E2', period: '2026-04-03' }, { id: 'E3', period: '2026-05-03' }, { id: 'E4', period: '2026-06-03', periods: 6 }], 'each payment pays its month; 3000 = six months at once');
assert.deepStrictEqual(plain(regularDue(found[0], found[0].pays, '2026-10-11')), { next: '2026-12-03', late: 0 }, 'so rent is paid up to November');
assert.deepStrictEqual(found[0].reason, 'Land rent', 'the usual reason');

console.log('Pay maths, words and PDF: all checks passed');
