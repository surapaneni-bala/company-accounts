// Runs the real apps-script/Code.gs against fake Google services and checks sync + the readable tabs.
// Usage: node tools/test-sheet-server.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadGas } = require('./fake-gas');

const code = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const gas = loadGas(code);
gas.setup();
const key = gas.props.KEY;
const post = body => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const rows = name => { const sh = gas.ss.getSheetByName(name); return sh.getRange(1, 1, sh.getLastRow(), 16).getValues(); };

// setup made the tabs, hid the master copy and put the code on "Read me"
assert.deepStrictEqual(gas.ss.getSheets().map(s => s.getName()), ['Read me', 'Summary', 'Expenses', 'Money Received', 'Cash & Bank moves', 'Ledger', 'Change Log', 'Employees', '_sync']);
assert.ok(gas.ss.getSheetByName('_sync').hidden);
assert.strictEqual(rows('Read me')[3][0], key);

// wrong code and junk are refused
assert.strictEqual(post({ key: 'WRONG', since: 0, push: [] }).ok, false);
assert.strictEqual(JSON.parse(gas.doPost({ postData: { contents: 'not json' } }).getContent()).ok, false);

const settings = { id: 'settings', k: 'S', u: 1, d: { company: 'Test Juba Builders', pass: { salt: 's', hash: 'h' } } };
const proj = { id: 'P-AAA-0001', k: 'P', u: 2, d: { id: 'P-AAA-0001', name: 'Warehouse', value: 1000, valueCur: 'USD' } };
const exp = (id, u, cur, amount, extra = {}) => ({ id, k: 'E', u, d: { id, cur, amount, paidTo: 'Ravi', reason: 'Rods', location: 'Site A', project: '', mode: 'Cash', at: '2026-10-01T10:00', by: 'Bala', createdAt: '2026-10-01T10:00:00', ...extra } });
const e1 = exp('E-AAA-0001', 3, 'USD', 100.1, { project: 'P-AAA-0001', reason: '=HYPERLINK("http://evil")' });
const e2 = exp('E-BBB-0001', 4, 'SSP', 250000, { at: '2026-09-15T08:30', by: 'Deng' });
const r1 = { id: 'R-AAA-0001', k: 'R', u: 5, d: { id: 'R-AAA-0001', cur: 'USD', amount: 500, project: 'P-AAA-0001', mode: 'Bank', note: 'Advance', at: '2026-10-02T09:00', by: 'Kumar', createdAt: '2026-10-02T09:00:00' } };
const log1 = { id: 'L-AAA-x0', k: 'L', u: 6, d: { lid: 'L-AAA-x0', at: '2026-10-02T09:05:00', action: 'Edited', id: 'E-AAA-0001', text: 'Amount: $1 → $100.10', by: 'Bala' } };

// first device sends everything
let res = post({ key: key.toLowerCase(), since: 0, push: [settings, proj, e1, e2, r1, log1] });
assert.ok(res.ok, res.error);
assert.strictEqual(res.seq, 6);
assert.strictEqual(res.pull.length, 6);
assert.match(res.sheet, /^https:\/\/docs\.google\.com\//);
assert.ok(res.kinds.includes('T'), 'this script stores cash/bank moves');
assert.strictEqual(JSON.parse(gas.doGet().getContent()).version, 8, 'opening the link shows the script version');

// an older copy is ignored; a newer edit wins and is handed to the others
res = post({ key, since: 6, push: [{ ...e1, u: 2, d: { ...e1.d, amount: 1 } }] });
assert.deepStrictEqual([res.seq, res.pull.length], [6, 0]);
res = post({ key, since: 6, push: [{ ...e1, u: 10, d: { ...e1.d, amount: 200.2, editedAt: '2026-10-03T10:00:00', editedBy: 'Bala' } }] });
assert.deepStrictEqual([res.seq, res.pull.map(p => p.id)], [7, ['E-AAA-0001']]);
assert.strictEqual(res.pull[0].d.amount, 200.2);

// a second device joining gets everything in one go
assert.strictEqual(post({ key, since: 0, push: [] }).pull.length, 6);

// readable tabs: balances per currency, never mixed
const summary = rows('Summary');
const line = label => rows('Summary').find(r => r[0] === label).slice(1, 3);
assert.strictEqual(summary[0][0], 'Test Juba Builders');
assert.deepStrictEqual(line('Total money received'), [500, 0]);
assert.deepStrictEqual(line('Total money spent'), [200.2, 250000]);
assert.deepStrictEqual(line('Total balance'), [299.8, -250000]);
assert.deepStrictEqual(line('💵 Cash balance'), [-200.2, -250000], 'expenses were paid in cash');
assert.deepStrictEqual(line('🏦 Bank balance'), [500, 0], 'the advance came into the bank');
assert.deepStrictEqual(line('Pending from clients'), [500, 0]);
const warehouse = summary.find(r => r[0] === 'Warehouse');
assert.deepStrictEqual(warehouse.slice(1, 8), ['USD', 1000, 500, 0.5, 500, 200.2, 299.8]);

const expenses = rows('Expenses');
assert.deepStrictEqual(expenses[2].slice(0, 7), ['Entry no.', 'Date', 'Day', 'Time', 'Currency', 'Amount USD', 'Amount SSP']);
assert.deepStrictEqual(expenses.slice(3, 5).map(r => r[0]), ['E-BBB-0001', 'E-AAA-0001'], 'sorted by date');
assert.strictEqual(expenses[4][8], "'=HYPERLINK(\"http://evil\")", 'typed formulas stay plain text');
assert.match(expenses[4][14], /Edited by Bala/);
assert.deepStrictEqual(expenses[5].slice(0, 7), ['TOTAL', '', '', '', '', '=SUBTOTAL(109,F4:F5)', '=SUBTOTAL(109,G4:G5)']);

const ledger = rows('Ledger');
assert.deepStrictEqual(ledger.slice(3, 6).map(r => [r[2], r[9], r[10], r[11]]), [['E-BBB-0001', -250000, 0, -250000], ['E-AAA-0001', -200.2, 0, -200.2], ['R-AAA-0001', -200.2, 500, 299.8]]);
assert.strictEqual(rows('Change Log')[3][3], 'Bala');

// deleting removes it from totals and tables (it stays in the master copy)
post({ key, since: 7, push: [{ ...e2, u: 20, d: { ...e2.d, deleted: '2026-10-04T10:00:00', deletedBy: 'Bala' } }] });
assert.deepStrictEqual(line('Total money spent'), [200.2, 0]);
assert.ok(!rows('Expenses').some(r => r[0] === 'E-BBB-0001'));

// rebuilding many times is stable (filters are removed and recreated, tab order kept)
for (let i = 0; i < 3; i++) post({ key, since: 0, push: [{ ...r1, u: 30 + i, d: { ...r1.d, note: 'n' + i } }] });
assert.deepStrictEqual(gas.ss.getSheets().map(s => s.getName()), ['Read me', 'Summary', 'Expenses', 'Money Received', 'Cash & Bank moves', 'Ledger', 'Change Log', 'Employees', '_sync']);

// cash into the bank, then a steel payment and bank charges paid from the bank
const move = { id: 'T-AAA-0001', k: 'T', u: 40, d: { id: 'T-AAA-0001', cur: 'USD', amount: 40000, from: 'Cash', to: 'Bank', note: 'Deposit', at: '2026-08-29T12:00', by: 'Bala', createdAt: '2026-10-06T20:00:00' } };
const steel = exp('E-AAA-0002', 41, 'USD', 20000, { paidTo: 'Steel supplier', reason: 'Steel purchase', mode: 'Bank', at: '2026-09-01T12:00' });
const fee = exp('E-AAA-0003', 42, 'USD', 100, { paidTo: 'Bank', reason: 'Bank charges', mode: 'Bank', at: '2026-09-01T12:00' });
res = post({ key, since: 0, push: [move, steel, fee, { id: 'Z-1', k: 'Z', u: 1, d: {} }] });
assert.ok(res.ok && !res.pull.some(p => p.k === 'Z'), 'unknown kinds are ignored');
assert.deepStrictEqual(line('💵 Cash balance'), [-40200.2, 0], 'cash: -200.20 spent, 40,000 moved out');
assert.deepStrictEqual(line('🏦 Bank balance'), [20400, 0], 'bank: 500 + 40,000 - 20,000 - 100');
assert.deepStrictEqual(line('Total balance'), [-19800.2, 0], 'a move never changes the total');
assert.deepStrictEqual(line('Total money spent'), [20300.2, 0], 'the move is not spending');
const moves = rows('Cash & Bank moves');
assert.deepStrictEqual(moves[3].slice(0, 1).concat(moves[3].slice(4, 9)), ['T-AAA-0001', 'USD', 40000, '', 'Cash', 'Bank']);
const lastLedger = rows('Ledger').filter(r => /^[ERT]-/.test(r[2])).pop();
assert.deepStrictEqual(lastLedger.slice(9, 12), [-40200.2, 20400, -19800.2], 'ledger ends on the same balances');

console.log('Sheet server: all checks passed');
