// Wages, days, amounts in words and the one-page PDF: the plain maths in src/calc.js, checked in Node.
// Usage: node tools/test-calc.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ TextEncoder });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/calc.js'), 'utf8') + '\n;this.api = { payDays, workerLedger, amountInWords, jpegToPdf, pdfPages, advancesUsd, dueOn, regularDue, invoiceTotals, invoiceState, findRegulars, guessCat, orderShares, spendByProject, findDoubles, salaryDue, seesEntry, landedCost, splitCents, sellPrice, belowList, stockBook, niceUp, suggestPrice, tally };', ctx);
const { payDays, workerLedger, amountInWords, jpegToPdf, pdfPages, advancesUsd, dueOn, regularDue, invoiceTotals, invoiceState, findRegulars, guessCat, orderShares, spendByProject, findDoubles, salaryDue, seesEntry, landedCost, splitCents, sellPrice, belowList, stockBook, niceUp, suggestPrice, tally } = ctx.api;
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

/* ---------- one payment for several months at once ("Internet till Dec"), as typed in the old entries ---------- */
const exA = (id, at, amount, reason, extra = {}) => ({ id, at: at + 'T10:00', amount, cur: 'USD', paidTo: 'Not recorded', reason, mode: 'Cash', project: '', ...extra });
const ahead = plain(findRegulars([
  exA('A1', '2026-09-24', 400, 'Internet advance till dec 2026'),
  exA('A2', '2026-10-15', 4200, 'House rent payment till Jan 2027', { paidTo: 'Landlord' }), exA('A3', '2026-10-15', 4200, 'Rent payment up to jan2027', { paidTo: 'Land rent' }),
  exA('A4', '2026-11-03', 600, 'Water tank rent for 6 months'), exA('A8', '2026-11-20', 300, 'Generator service till February'),
  exA('A5', '2026-08-17', 1000, 'Exchange USD to SSP'), exA('A6', '2026-09-17', 1000, 'Diesel'), exA('A7', '2026-10-17', 1000, 'Visa'),
  exA('A9', '2026-10-02', 100, 'Phone till Oct 2026')]));
assert.deepStrictEqual(ahead.map(s => [s.pays[0].id, s.reason, s.amount, s.first, s.pays[0].periods, s.ahead.to]), [
  ['A1', 'Internet', 100, '2026-09-24', 4, '2026-12-24'],
  ['A2', 'House rent', 1400, '2026-11-15', 3, '2027-01-15'], ['A3', 'Rent', 1400, '2026-11-15', 3, '2027-01-15'],
  ['A4', 'Water tank rent', 100, '2026-11-03', 6, '2027-04-03'], ['A8', 'Generator service', 100, '2026-12-20', 3, '2027-02-20']],
  'from the month paid (400 till Dec = Sep–Dec at 100), or the next month when rounder (4,200 till Jan = Nov–Jan at 1,400); "for 6 months"; "till February" with no year is the next one; one month is not several; "Not recorded" entries are not lumped into one monthly payment');
assert.deepStrictEqual(plain(findRegulars([exA('A5', '2026-08-17', 1000, 'Exchange USD to SSP'), exA('A6', '2026-09-17', 1000, 'Diesel'), exA('A7', '2026-10-17', 1000, 'Visa')])), [], 'three unrelated "Not recorded" payments of 1,000 a month apart are not a regular payment');
assert.deepStrictEqual(plain(findRegulars([exA('B1', '2026-10-05', 600, 'Generator service every 6 months'), exA('B2', '2026-10-05', 1200, 'Cement 12 months credit'), exA('B3', '2026-10-05', 2700, 'Licence till Dec 2028'),
  exA('B4', '2026-10-05', 2400, 'Licence for 2 years')])).map(s => [s.pays[0].id, s.pays[0].periods]), [['B4', 24]], 'not "every 6 months" or "12 months credit"; at most 24 months, the sheet’s limit');
assert.deepStrictEqual(ahead.filter(s => s.twins).map(s => [s.pays[0].id, s.twins]), [['A2', ['A3']], ['A3', ['A2']]], 'the same 4,200 up to the same month on the same day: maybe typed twice');
assert.deepStrictEqual(plain(findRegulars([exA('A2', '2026-10-15', 4200, 'House rent payment till Jan 2027', { regular: 'G-1' }), exA('A3', '2026-10-15', 4200, 'Rent payment up to jan2027')])).map(s => s.twins), [['A2']], 'confirming one keeps the warning on the other');
assert.deepStrictEqual(plain(regularDue(ahead[0], ahead[0].pays, '2026-10-16')), { next: '2027-01-24', late: 0 }, 'the internet is paid up to December');

/* ---------- buying: a category guessed from a line typed in a hurry ---------- */
const guessed = [['Sofa, L-shape', 'Furniture & décor'], ['Wardrobe with sliding doors', 'Furniture & décor'], ['Concrete block machine for the new venture', 'Machinery & vehicles'],
  ['Opaque light-blocking window film', 'Doors & windows'], ['Smart switches, Zigbee', 'Home automation & security'], ['Floor tiles 60x60 matt beige', 'Finishes'], ['Kitchen cabinets', 'Kitchen'],
  ['Hollow blocks 6 inch', 'Structure & civil'], ['Chandelier for the hall', 'Lighting'], ['Cordless drill', 'Tools & hardware'], ['Water pump 1 HP', 'Plumbing & sanitary'], ['Something else', 'Other'],
  // a list typed for a buying trip
  ['T.V 100 inch, 50 inch & 30 inch (1,2,1)', 'Electronics & appliances'], ['Modular kitchen', 'Kitchen'], ['Cooking range', 'Kitchen'], ['Ceiling fans', 'Electronics & appliances'],
  ['Table fans', 'Electronics & appliances'], ['AC', 'Electronics & appliances'], ['Solar CCTV', 'Home automation & security'], ['Refrigerators', 'Electronics & appliances'],
  ['Exterior lights', 'Lighting'], ['Carpets', 'Furniture & décor'], ['Curtain and curtain rods', 'Furniture & décor'], ['Wall panels & false ceiling', 'Finishes'],
  ['Roofing tiles, top ridge and gutters', 'Structure & civil'], ['Computers', 'Office & IT'], ['Big tool box, multiple drawers', 'Tools & hardware'], ['Car wash equipment', 'Machinery & vehicles'],
  ['Modern cabinets', 'Furniture & décor'], ['Kitchen utensils', 'Kitchen'], ['Monitor mounts', 'Office & IT'], ['Moulds for pillars', 'Structure & civil'], ['Paintings', 'Furniture & décor'],
  ['Sintered stone', 'Finishes'], ['Overall clothing for workers', 'Tools & hardware'], ['Gloves and safety equipment', 'Tools & hardware'], ['Concrete pump', 'Machinery & vehicles'],
  ['Generator', 'Electrical & solar'], ['Tiles', 'Finishes'], ['Second hand clothes', 'Goods for trading'],
  ['Solar panels 550W', 'Electrical & solar'], ['Hoodies for staff', 'Other'], ['Cement mixer', 'Machinery & vehicles'], ['Smart TV 65 inch', 'Electronics & appliances'], ['Kitchen hood', 'Kitchen'], ['Smart door lock', 'Home automation & security']];
assert.deepStrictEqual(guessed.map(([t]) => [t, guessCat(t)]), guessed, 'a block is not a lock; smart switches are home automation; table fans are not tables; roofing tiles are roofing; second-hand clothes are for trading');

/* ---------- buying: an order shared between projects and extra; what each project costs in dollars ---------- */
const toilets = { sup: 'U-1', price: 40, cur: 'USD', qty: 15, date: '2026-10-20', alloc: [{ p: 'P-1', q: 10 }] };
assert.deepStrictEqual(plain(orderShares(toilets, 'P-1')), [{ p: 'P-1', q: 10, cost: 400 }, { p: '', q: 5, cost: 200 }], '15 toilets, 10 for the project: 5 extra, each at $40');
assert.deepStrictEqual(plain(orderShares({ ...toilets, alloc: undefined }, 'P-1')), [{ p: 'P-1', q: 15, cost: 600 }], 'no split typed: all for the item’s project');
assert.deepStrictEqual(plain(orderShares({ ...toilets, alloc: undefined }, '')), [{ p: '', q: 15, cost: 600 }], 'no project at all: all extra');
const sofas = { sup: 'U-2', price: 7100, cur: 'CNY', rate: 7.1, qty: 3, date: '2026-10-21', alloc: [{ p: 'P-1', q: 2 }, { p: 'P-2', q: 1 }] };
const lamps = { sup: 'U-2', price: 100, cur: 'CNY', qty: 4, date: '2026-10-21' };
assert.deepStrictEqual(plain(spendByProject([{ order: toilets, project: 'P-1', status: 'ordered' }, { order: sofas, project: 'P-1', status: 'ordered' }, { order: lamps, project: 'P-2', status: 'ordered' },
  { order: toilets, project: 'P-1', status: 'dropped' }])),
  { 'P-1': { usd: 2400, unrated: {}, items: 2 }, '': { usd: 200, unrated: {}, items: 1 }, 'P-2': { usd: 1000, unrated: { CNY: 400 }, items: 2 } },
  'the villa: 10 toilets $400 + 2 sofas ¥14,200 at 7.1 = $2,000; extra: 5 toilets $200; the other project: a sofa $1,000 and lamps with no rate kept in yuan; a dropped item counts nothing');

/* ---------- the same payment entered twice ---------- */
const dpay = (id, at, amount, by, extra = {}) => ({ id, at: at + 'T10:00', amount, cur: 'USD', paidTo: 'Landlord', reason: 'Rent', by, ...extra });
const doubles = plain(findDoubles([dpay('D1', '2026-10-15', 4200, 'Bala'), dpay('D2', '2026-10-15', 4200, 'Babu', { paidTo: 'Land rent', reason: 'Rent up to Jan' }),
  dpay('D3', '2026-08-19', 100, 'Bala', { paidTo: 'Airport lounge', reason: 'Lounge' }), dpay('D4', '2026-08-19', 100, 'Bala', { paidTo: 'Airport', reason: 'Management fee' }),
  dpay('D5', '2026-09-01', 300, 'Bala', { paidTo: 'Shop', reason: 'Nails' }), dpay('D6', '2026-09-01', 300, 'Bala', { paidTo: 'shop', reason: 'nails ' }),
  dpay('D7', '2026-09-01', 100, 'Agnes', { worker: 'W-1' }), dpay('D8', '2026-09-01', 100, 'Bala', { worker: 'W-2' }),
  dpay('D9', '2026-09-05', 50, 'Bala', { batch: 'B-1' }), dpay('D10', '2026-09-05', 50, 'Agnes', { batch: 'B-1' }),
  dpay('D11', '2026-10-15', 4200, 'Babu', { cur: 'SSP' }), dpay('D12', '2026-10-25', 4200, 'Babu'), dpay('D13', '2026-10-16', 4200, 'Agnes', { deleted: 'x' }),
  dpay('D14', '2026-09-10', 20, 'Store', { paidTo: 'Hardware', reason: 'Nails' }), dpay('D15', '2026-09-10', 20, 'Agnes', { paidTo: 'Taxi', reason: 'To the site' }),
  dpay('D16', '2026-09-12', 75, 'bala ', { paidTo: 'Garage', reason: 'Tyre' }), dpay('D17', '2026-09-12', 75, 'Bala', { paidTo: 'garage', reason: 'Tyre repair' })])).map(d => d.key);
assert.deepStrictEqual(doubles.sort(), ['D16|D17', 'D1|D2', 'D5|D6'], 'the rent typed by two people; one person twice to the same payee ("bala " is Bala); not two airport fees to different payees, nails and a taxi of the same $20, salaries, one bulk entry, another currency, ten days apart or a deleted one');
assert.deepStrictEqual(plain(findDoubles([dpay('D1', '2026-10-15', 4200, 'Bala'), dpay('D2', '2026-10-15', 4200, 'Babu')], ['D1|D2'])), [], 'said not to be a double: not asked again');

const many = Array.from({ length: 6000 }, (_, i) => dpay(`M${i}`, `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, 10 + (i % 997), `P${i % 7}`, { paidTo: `Shop ${i % 50}`, reason: `Item ${i}` }));
const t0 = Date.now(); findDoubles(many); assert.ok(Date.now() - t0 < 500, `6,000 payments are checked quickly (${Date.now() - t0} ms)`);

/* ---------- an advance repaid a little each month (owner, 1 Nov 2026: "advance of 1000, I earn 200: cut 100 a month") ---------- */
{
  const w = { id: 'W-9', wage: 200, cur: 'USD', start: '2026-06-01', status: 'active' };
  const p = (at, amount, kind, extra = {}) => ({ id: `E-${at}-${amount}`, worker: 'W-9', at: at + 'T10:00', amount, cur: 'USD', pay: kind, ...extra });
  const salaries = ['06', '07', '08', '09'].map(m => p(`2026-${m}-28`, 200, 'salary', { month: `2026-${m}` }));
  const owed = (list, upTo) => Math.round(workerLedger(w, list, upTo).balance * 100);
  const due = (list, month, repay) => {
    const end = owed(list, `${month}-31`), before = owed(list, new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1, 0)).toISOString().slice(0, 10));
    const paidMonth = list.filter(x => x.pay === 'salary' && x.month === month).reduce((t, x) => t + Math.round(x.amount * 100), 0);
    return plain(salaryDue(end, before, paidMonth, Math.round(repay * 100)));
  };
  const adv = [...salaries, p('2026-10-05', 1000, 'advance', { repay: 100 })];
  assert.deepStrictEqual(due(adv, '2026-10', 100), { pay: 10000, debt: 100000, back: 10000, left: 90000 }, 'October: $200 earned, $100 comes off, $100 paid, $900 still to repay');
  const oct = [...adv, p('2026-10-31', 100, 'salary', { month: '2026-10' })];
  assert.deepStrictEqual(due(oct, '2026-11', 100), { pay: 10000, debt: 90000, back: 10000, left: 80000 }, 'November: the same again, $800 left');
  const half = [...adv, p('2026-10-15', 50, 'salary', { month: '2026-10' })];
  assert.deepStrictEqual(due(half, '2026-10', 100), { pay: 5000, debt: 100000, back: 10000, left: 90000 }, '$50 of October paid already: $50 more (not counted as more advance)');
  assert.deepStrictEqual(due(adv, '2026-10', 0), { pay: 0, debt: 100000, back: 20000, left: 80000 }, 'no plan: all of the salary goes to the advance, as before');
  assert.deepStrictEqual(due(adv, '2026-10', 300), { pay: 0, debt: 100000, back: 20000, left: 80000 }, 'more a month than the wage: only what was earned can come off');
  const last = [...salaries, p('2026-10-05', 50, 'advance', { repay: 100 })];
  assert.deepStrictEqual(due(last, '2026-10', 100), { pay: 15000, debt: 5000, back: 5000, left: 0 }, 'the last $50: all of it comes off, $150 paid');
  assert.deepStrictEqual(due(salaries.slice(0, 3), '2026-10', 100), { pay: 40000, debt: 0, back: 0, left: 0 }, 'no advance: September and October are paid');
}

/* ---------- what else an office manager may see in Accounts (owner, 1 Nov 2026) ---------- */
{
  const e = { id: 'E-1', project: 'P-1', location: '  Juba   Town ', uid: 'U-2' };
  assert.strictEqual(seesEntry(null, e), false, 'nothing given: only her own');
  assert.strictEqual(seesEntry({ all: true }, e), true, 'every payment');
  assert.deepStrictEqual([seesEntry({ p: ['P-1'] }, e), seesEntry({ p: ['P-2'] }, e)], [true, false], 'a project');
  assert.deepStrictEqual([seesEntry({ l: ['juba town'] }, e), seesEntry({ l: ['juba'] }, e)], [true, false], 'a place, however it was typed (case, spaces)');
  assert.deepStrictEqual([seesEntry({ u: ['U-2'] }, e), seesEntry({ u: ['U-3'] }, e)], [true, false], 'what one person entered');
  assert.strictEqual(seesEntry({ p: 'P-1', l: 5, u: null }, e), false, 'a damaged grant gives nothing');
  assert.strictEqual(seesEntry({ l: [''] }, { id: 'E-2', location: '' }), false, 'an empty place matches nothing');
}

/* ---------- the warehouse: landed cost (the owner's rebars, 2 Nov 2026) ---------- */
{
  const rebars = { gcur: 'USD', lines: [{ m: 'R10', qty: 280, amt: 1617.03, kg: 2073 }, { m: 'R12', qty: 470, amt: 3906.49, kg: 5008 }, { m: 'R16', qty: 792, amt: 11712.73, kg: 15016 }, { m: 'R20', qty: 338, amt: 7814.29, kg: 10018 }],
    costs: [300, 2458, 1000, 5837, 2340].map(amt => ({ t: 'other', amt, cur: 'USD', split: 'kg' })) };
  const r = plain(landedCost(rebars));
  assert.deepStrictEqual([r.goods, r.extra, r.total, r.kg], [2505054, 1193500, 3698554, 32115], 'invoice $25,050.54 (the lines added up, not typed) + $11,935 = $36,985.54 over 32.115 tons');
  assert.deepStrictEqual(r.lines.map(l => Math.round(l.unit * 100) / 100), [8.53, 12.27, 21.83, 34.13], 'landed cost of one bar: 10, 12, 16 and 20 mm, as the owner worked out');
  assert.deepStrictEqual(r.lines.map(l => sellPrice(l.unit)), [9.38, 13.5, 24.02, 37.55], 'and with 10 % on top, what one sells for');
  assert.deepStrictEqual(r.lines.map(l => suggestPrice(l.unit)), [9.4, 13.5, 24.25, 37.75], 'the price suggested to an admin: 10 % on top, rounded up to a clean price, so the markup does not show through (owner, 3 Nov 2026)');
  assert.deepStrictEqual([niceUp(9.379), niceUp(9.4), niceUp(13.4988), niceUp(13.5), niceUp(0.123), niceUp(99.99), niceUp(100.2), niceUp(1003)], [9.4, 9.4, 13.5, 13.5, 0.15, 100, 101, 1005], '5 cents under $10, 25 cents under $100, $1 under $1,000, $5 above; a clean price stays as it is');
  assert.strictEqual(r.lines.reduce((t, l) => t + l.extra, 0), 1193500, 'the extra costs are spread to the cent: nothing lost or made up');
  assert.deepStrictEqual(plain(landedCost({ ...rebars, costs: rebars.costs.map(c => ({ ...c, split: 'value' })) })).lines.map(l => Math.round(l.unit * 100) / 100), [8.53, 12.27, 21.83, 34.13], 'by value: the same here (every size cost $780 a ton)');
  // a cost paid in SSP at that day's rate; goods bought in yuan
  const mixed = plain(landedCost({ gcur: 'CNY', grate: 7.1, lines: [{ m: 'A', qty: 10, amt: 710 }, { m: 'B', qty: 30, amt: 2130 }], costs: [{ t: 'duty', amt: 450000, cur: 'SSP', rate: 4500, split: 'value' }, { t: 'transport', amt: 40, cur: 'USD', split: 'qty' }] }));
  assert.deepStrictEqual([mixed.goods, mixed.costs, mixed.lines.map(l => l.unit)], [40000, [10000, 4000], [13.5, 13.5]], '¥710 = $100, ¥2,130 = $300; SSP 450,000 at 4,500 = $100 by value (25/75), $40 by quantity (10/30): $135 ÷ 10 and $405 ÷ 30');
  assert.ok(/rate/.test(landedCost({ gcur: 'CNY', lines: [{ m: 'A', qty: 1, amt: 5 }], costs: [] }).err), 'goods in yuan need a rate');
  assert.deepStrictEqual([/rate/.test(landedCost({ lines: [{ m: 'A', qty: 1, amt: 5 }], costs: [{ amt: 9, cur: 'SSP' }] }).err), landedCost({ lines: [{ m: 'A', qty: 1, amt: 5 }], costs: [{ amt: 9, cur: 'SSP' }] }).cost], [true, 0], 'a cost in SSP needs that day\'s rate, and says which cost');
  assert.ok(/weight/.test(landedCost({ lines: [{ m: 'A', qty: 1, amt: 5, kg: 2 }, { m: 'B', qty: 1, amt: 5 }], costs: [{ amt: 9, cur: 'USD', split: 'kg' }] }).err), 'by weight needs every line\'s weight');
  assert.deepStrictEqual(plain(splitCents(100, [1, 1, 1])), [34, 33, 33], 'a cent left over goes somewhere, never lost');
  assert.deepStrictEqual([belowList(99, 100), belowList(98.5, 100), belowList(101, 100)], [1, 1.5, 0], '% below the list price');
}

/* ---------- the warehouse: stock at moving average cost ---------- */
{
  const Y = (id, date, lines, extra = {}) => ({ id, date, lines: lines.map(([m, qty]) => ({ m, qty })), lc: lines.map(l => l[2]), createdAt: date + 'T08:00:00', ...extra });
  const O = (id, date, kind, lines, extra = {}) => ({ id, date, kind, lines: lines.map(([m, qty]) => ({ m, qty })), createdAt: date + 'T09:00:00', ...extra });
  const I = (id, date, lines, extra = {}) => ({ id, type: 'invoice', date, cur: 'USD', items: lines.map(([m, qty, price]) => ({ t: 'x', m, qty, price })), createdAt: date + 'T10:00:00', ...extra });
  const book = plain(stockBook(
    [Y('Y1', '2026-11-01', [['bar', 100, 10]]), Y('Y2', '2026-11-05', [['bar', 50, 13]]), Y('Y3', '2026-11-06', [['bar', 999, 1]], { deleted: 'x' })],
    [O('O1', '2026-11-06', 'use', [['bar', 20]], { project: 'P-1' }), O('O2', '2026-11-07', 'count', [['bar', -2]]), O('O3', '2026-11-07', 'damage', [['bar', 1]])],
    [I('I1', '2026-11-03', [['bar', 30, 11]]), I('I2', '2026-11-08', [['bar', 10, 49500]], { cur: 'SSP', rate: 4500 }), I('I3', '2026-11-08', [['bar', 5, 11]], { ok: 'waiting' }),
      I('I4', '2026-11-08', [['bar', 5, 11]], { cancelled: 'x' }), I('I5', '2026-11-08', [['bar', 5, 11]], { type: 'quote' }), I('I6', '2026-11-08', [['bar', 5, 11]], { ok: 'rejected' })]));
  const b = book.bar;
  assert.strictEqual(b.moves.length, 7, 'counted: 2 receipts, 1 sale before, use, count, damage, 1 sale in SSP; not deleted, waiting, cancelled, quoted or refused');
  assert.deepStrictEqual(b.moves.map(m => [m.kind, m.bal, m.avg]), [['in', 100, 10], ['sale', 70, 10], ['in', 120, 11.25], ['use', 100, 11.25], ['damage', 99, 11.25], ['count', 97, 11.25], ['sale', 87, 11.25]],
    '100 at $10, 30 sold, 50 more at $13 → (70 × 10 + 50 × 13) ÷ 120 = $11.25; going out never changes the average; a count comes last in its day');
  assert.deepStrictEqual([b.qty, b.avg, b.value], [87, 11.25, 97875], '87 left, worth $978.75 at cost');
  assert.deepStrictEqual([b.sold, b.revenue, b.cogs], [40, 44000, 41250], 'sold 40: $330 + SSP 495,000 at 4,500 ($110) = $440; they cost $300 + $112.50');
  assert.deepStrictEqual([b.used, b.usedValue, b.lost, b.lostValue], [20, 22500, 3, 3375], 'used on the project 20 ($225); 2 missing at the count and 1 damaged ($33.75)');
  assert.strictEqual(plain(stockBook([], [O('O9', '2026-11-01', 'use', [['nut', 3]])], [])).nut.short, true, 'more out than ever came in: flagged, not hidden');
  assert.deepStrictEqual(plain(stockBook([Y('Y1', '2026-11-01', [['a', 5, 2]])], [], [I('I1', '2026-11-01', [['a', 5, 3]])])).a.moves.map(m => m.kind), ['in', 'sale'], 'received and sold the same day: in first');
}

{ // an import's cost against its payments in Accounts: one cost entered as one line here but paid in parts there (owner, 3 Nov 2026)
  const p = (amount, cur, rate) => ({ amount, cur, rate });
  assert.deepStrictEqual(plain(tally(2458, 'USD', undefined, [p(1458, 'USD'), p(1000, 'USD')])), { paid: 2458, diff: 0, ok: true, about: false }, 'two payments that add up: tallies');
  assert.deepStrictEqual(plain(tally(2458, 'USD', undefined, [p(1458, 'USD'), p(500, 'USD'), p(500.01, 'USD')])), { paid: 2458.01, diff: 0.01, ok: false, about: false }, 'one cent over: does not tally');
  assert.deepStrictEqual(plain(tally(2458, 'USD', undefined, [p(1458, 'USD')])), { paid: 1458, diff: -1000, ok: false, about: false }, 'part linked: $1,000 still to link');
  assert.strictEqual(tally(0.3, 'USD', undefined, [p(0.1, 'USD'), p(0.2, 'USD')]).ok, true, 'counted in cents, so 0.1 + 0.2 is 0.3');
  assert.deepStrictEqual(plain(tally(10530000, 'SSP', 4500, [p(5265000, 'SSP', 4500), p(1170, 'USD')])), { paid: 10530000, diff: 0, ok: true, about: true }, 'SSP duty paid partly in dollars: brought over at the cost\'s rate, tallies within 1 %');
  assert.strictEqual(tally(2340, 'USD', undefined, [p(10530000, 'SSP', 4600)]).ok, false, 'the same SSP at a rate 2 % off: does not tally');
  assert.strictEqual(tally(2340, 'USD', undefined, [p(10530000, 'SSP', 4520)]).ok, true, 'rates less than 1 % apart: tallies (about)');
  assert.deepStrictEqual(plain(tally(100, 'USD', undefined, [p(450000, 'SSP')])), { err: true }, 'an SSP payment without its rate cannot be compared');
  assert.deepStrictEqual(plain(tally(1000, 'USD', undefined, [p(2250000, 'SSP', 4500), p(500, 'USD')])), { paid: 1000, diff: 0, ok: true, about: true }, 'a dollar cost paid partly in SSP in Accounts: the SSP brought over at its own rate (owner, 3 Nov 2026)');
  assert.deepStrictEqual(plain(tally(1000, 'USD', undefined, [p(4500000, 'SSP', 4300)])), { paid: 1046.51, diff: 46.51, ok: false, about: true }, 'SSP at a rate 4.4 % off: shows the $46.51 difference, not hidden');
  assert.deepStrictEqual(plain(tally(100, 'USD', undefined, [])), { paid: 0, diff: -100, ok: false, about: false }, 'nothing linked');
}

console.log('Pay maths, words and PDF: all checks passed');
