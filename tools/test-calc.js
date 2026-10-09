// Wages, days, amounts in words and the one-page PDF: the plain maths in src/calc.js, checked in Node.
// Usage: node tools/test-calc.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ TextEncoder });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/calc.js'), 'utf8') + '\n;this.api = { payDays, workerLedger, amountInWords, jpegToPdf, pdfPages, advancesUsd };', ctx);
const { payDays, workerLedger, amountInWords, jpegToPdf, pdfPages, advancesUsd } = ctx.api;
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

console.log('Pay maths, words and PDF: all checks passed');
