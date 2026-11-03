// The warehouse in the real apps-script/Code.gs on fake Google services: who sees what (an office manager never sees a cost),
// the 1 % price rule, approvals, the readable tabs and where papers are filed. Usage: node tools/test-stock.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadGas } = require('./fake-gas');

const gas = loadGas(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'));
gas.setup();
const key = gas.props.KEY;
const post = body => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const tab = name => { const sh = gas.ss.getSheetByName(name); return sh.getRange(1, 1, sh.getLastRow(), 20).getValues(); };
const rowOf = (name, id) => tab(name).find(r => r.includes(id));

post({ key, since: 0, push: [{ id: 'settings', k: 'S', u: 1, d: { company: 'Test Builders', pass: { salt: 's', hash: 'h' } } }] });
const owner = post({ op: 'setup', key, setupCode: gas.props.SETUP_CODE, name: 'Owner', username: 'owner', newPassword: 'owner-pass' }).token;
post({ op: 'saveUser', token: owner, user: { name: 'Mary', username: 'mary', role: 'manager', password: 'mary-pass1' } });
post({ op: 'saveUser', token: owner, user: { name: 'Store One', username: 'store1', role: 'store', password: 'store-pass1' } });
const m = post({ op: 'login', username: 'mary', password: 'mary-pass1' }), s = post({ op: 'login', username: 'store1', password: 'store-pass1' });
const ownerId = post({ op: 'users', token: owner }).users.find(u => u.username === 'owner').id;
let saveUserFull;
const sync = (tok, push = [], since = 0) => post({ token: tok, since, push, sees: 1 });
const ago = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10); // sales a few days back (the morning email counts days)

/* ---------- an admin brings in the rebars: four stock items and one import with its costs ---------- */
const item = (id, name, price, extra = {}) => ({ id, k: 'M', u: 10, d: { id, name, unit: 'pcs', cat: 'Steel', markup: 10, price, uid: ownerId, ...extra } });
const items = [item('M-OW1-0001', 'Rebar 10 mm × 12 m', 9.38, { code: 'RB10', min: 50 }), item('M-OW1-0002', 'Rebar 12 mm × 12 m', 13.5), item('M-OW1-0003', 'Rebar 16 mm × 12 m', 24.02), item('M-OW1-0004', 'Rebar 20 mm × 12 m', 37.55)];
const imp = { id: 'Y-OW1-0001', k: 'Y', u: 11, d: { id: 'Y-OW1-0001', date: '2026-10-28', ref: 'PI-2026-118', from: 'Steel mill', origin: 'Uganda', gcur: 'USD', uid: ownerId, createdAt: '2026-10-28T09:00:00',
  lines: [['M-OW1-0001', 280, 1617.03, 2073], ['M-OW1-0002', 470, 3906.49, 5008], ['M-OW1-0003', 792, 11712.73, 15016], ['M-OW1-0004', 338, 7814.29, 10018]].map(([mm, qty, amt, kg]) => ({ m: mm, qty, amt, kg })),
  costs: [{ t: 'freight', what: 'Truck Kampala → Juba', amt: 5837, cur: 'USD', split: 'kg' }, { t: 'duty', amt: 11061000, cur: 'SSP', rate: 4500, split: 'value' }, { t: 'clearing', amt: 1000, cur: 'USD', split: 'kg', pay: 'E-OW1-0090' }],
  lc: [8.5265, 12.2716, 21.8348, 34.134] } };
let res = sync(owner, [...items, imp, { id: 'E-OW1-0090', k: 'E', u: 11, d: { id: 'E-OW1-0090', cur: 'USD', amount: 1000, paidTo: 'Clearing agent', reason: 'Clearing PI-2026-118', at: '2026-10-28T10:00', imp: 'Y-OW1-0001', uid: ownerId } }]);
assert.deepStrictEqual(res.refused, [], 'items, the import and its clearing payment (naming the import) are taken');
assert.deepStrictEqual(sync(owner, [{ ...imp, id: 'Y-OW1-0002', d: { ...imp.d, id: 'Y-OW1-0002', lc: [1] } }, { ...imp, id: 'Y-OW1-0003', d: { ...imp.d, id: 'Y-OW1-0003', costs: [{ t: 'x', amt: 5, cur: 'USD', split: 'magic' }] } },
  item('M-OW1-0009', '', 1)]).refused.sort(), ['M-OW1-0009', 'Y-OW1-0002', 'Y-OW1-0003'], 'a landed cost for every line, a known way to spread each cost, an item with a name');

/* ---------- what an office manager receives: quantities and selling prices, never a cost ---------- */
let pull = sync(m.token).pull;
const mItem = pull.find(p => p.id === 'M-OW1-0001'), mImp = pull.find(p => p.id === 'Y-OW1-0001');
assert.deepStrictEqual([mItem.d.price, 'markup' in mItem.d], [9.38, false], 'the item with what it sells for, not its markup');
assert.deepStrictEqual(Object.keys(mImp.d).sort(), ['createdAt', 'date', 'id', 'lines', 'ref', 'stub'], 'the import: only its date, reference and how many of each came in');
assert.deepStrictEqual(mImp.d.lines[0], { m: 'M-OW1-0001', qty: 280 }, 'no cost, no weight');
assert.ok(!pull.some(p => p.id === 'E-OW1-0090'), 'nor the payment for clearing');
assert.ok(!sync(s.token).pull.some(p => ['M', 'Y', 'O', 'I', 'K'].includes(p.k)), 'a store keeper gets nothing of the warehouse or of sales');

/* ---------- the office manager records goods used and sells at the list price, or at most 1 % below ---------- */
const out = (id, u, extra = {}) => ({ id, k: 'O', u, d: { id, date: '2026-10-29', kind: 'use', project: 'P-OW1-0001', to: 'Site foreman', lines: [{ m: 'M-OW1-0003', qty: 40 }], uid: m.me.id, createdAt: '2026-10-29T08:00:00', ...extra } });
assert.deepStrictEqual(sync(m.token, [out('O-AG1-0001', 20), out('O-AG1-0002', 20, { kind: 'steal' }), out('O-AG1-0003', 20, { lines: [{ m: 'M-OW1-0003', qty: -4 }] })]).refused.sort(), ['O-AG1-0002', 'O-AG1-0003'], 'goods used on a project; not an unknown kind or a minus');
assert.deepStrictEqual(sync(m.token, [out('O-AG1-0004', 21, { kind: 'count', lines: [{ m: 'M-OW1-0001', qty: -3, counted: 277 }] })]).refused, [], 'a stock count may find fewer (or more)');
assert.deepStrictEqual(sync(m.token, [{ ...imp, id: 'Y-AG1-0001', d: { ...imp.d, id: 'Y-AG1-0001', uid: m.me.id } }, item('M-AG1-0001', 'Sand', 1, { uid: m.me.id })]).refused.sort(), ['M-AG1-0001', 'Y-AG1-0001'], 'she cannot bring goods in or make items (costs are for admins)');
const client = { id: 'K-AG1-0001', k: 'K', u: 22, d: { id: 'K-AG1-0001', name: 'Builder Ltd', uid: m.me.id } };
// the company's own SSP rate: dollars changed at 2,500 (an SSP sale is checked against it)
assert.deepStrictEqual(sync(owner, [{ id: 'X-OW1-0001', k: 'X', u: 21, d: { id: 'X-OW1-0001', at: ago(6) + 'T09:00', usd: 1000, ssp: 2500000, from: 'Cash', to: 'Cash', uid: ownerId } }]).refused, []);
const sale = (id, u, lines, extra = {}) => ({ id, k: 'I', u, d: { id, type: 'invoice', no: post({ op: 'number', token: m.token }).no || 'X', client: 'K-AG1-0001', date: ago(4), cur: 'USD', items: lines.map(([mm, qty, price, list]) => ({ t: 'Rebar', m: mm, qty, price, list, unit: 'pcs' })), tax: 0, uid: m.me.id, createdAt: '2026-10-30T09:00:00', ...extra } });
res = sync(m.token, [client, sale('I-AG1-0001', 23, [['M-OW1-0002', 100, 13.5, 13.5]]), sale('I-AG1-0002', 23, [['M-OW1-0002', 10, 13.37, 13.5]]), sale('I-AG1-0003', 23, [['M-OW1-0002', 10, 13.3, 13.5]]),
  sale('I-AG1-0004', 23, [['M-OW1-0002', 10, 13.3, 13.3]]), sale('I-AG1-0005', 23, [['M-OW1-0004', 5, 37.55, 37.55]], { ok: 'approved' }), sale('I-AG1-0006', 23, [['M-OW1-0003', 10, 60750, 24.02 * 2500]], { cur: 'SSP', rate: 2500 })]);
assert.deepStrictEqual(res.refused.sort(), ['I-AG1-0002', 'I-AG1-0003', 'I-AG1-0004', 'I-AG1-0005'], 'the list price only (owner, 3 Nov 2026): not even 0.96 % below unless an admin allows it, not with a lower list price claimed, not her own approval; an SSP sale at its rate is checked in dollars');
// an admin allows her 1 % below the list: 0.96 % is taken, 1.5 % is not
post({ op: 'saveUser', token: owner, user: { id: m.me.id, off: 1 } });
const mOff = post({ op: 'login', username: 'mary', password: 'mary-pass1' });
assert.strictEqual(mOff.me.off, 1, 'her phone is told what she may give');
m.token = mOff.token;
assert.deepStrictEqual(sync(m.token, [sale('I-AG1-0002', 23, [['M-OW1-0002', 10, 13.37, 13.5]]), sale('I-AG1-0003', 23, [['M-OW1-0002', 10, 13.3, 13.5]])]).refused, ['I-AG1-0003'], 'given 1 %: 0.96 % below is taken, 1.5 % is not');
assert.strictEqual(post({ op: 'saveUser', token: owner, user: { id: m.me.id, off: 90 } }).users.find(u => u.id === m.me.id).off, 50, 'never more than 50 %');
assert.strictEqual(post({ op: 'saveUser', token: m.token, user: { id: m.me.id, off: 50 } }).ok, false, 'she cannot give herself a discount');
post({ op: 'saveUser', token: owner, user: { id: m.me.id, off: 1 } });
m.token = post({ op: 'login', username: 'mary', password: 'mary-pass1' }).token;
assert.ok(/^INV-\d{4}$/.test(sale('I-x', 1, []).d.no), 'she takes invoice numbers from the one series');
res = sync(m.token, [sale('I-AG1-0007', 24, [['M-OW1-0002', 10, 12, 13.5]], { ok: 'waiting', no: 'REQ-AG1-0001' })]);
assert.deepStrictEqual(res.refused, [], 'lower than 1 %: sent to an admin, waiting');

/* ---------- the ways round the 1 % rule found by the review (2 Nov 2026), each refused ---------- */
const typed = (id, u, price, extra = {}) => ({ id, k: 'I', u, d: { id, type: 'invoice', no: post({ op: 'number', token: m.token }).no, client: 'K-AG1-0001', date: ago(4), cur: 'USD', items: [{ t: 'Rebar 12 mm × 12 m', qty: 100, price, unit: 'pcs' }], tax: 0, uid: m.me.id, createdAt: ago(4) + 'T09:00:00', ...extra } });
assert.deepStrictEqual(sync(m.token, [typed('I-AG1-0020', 28, 1), typed('I-AG1-0021', 28, 0)]).refused.sort(), ['I-AG1-0020', 'I-AG1-0021'], 'a line typed by hand (not from stock) cannot carry stock at any price');
assert.deepStrictEqual(sync(m.token, [typed('I-AG1-0022', 28, 1, { ok: 'waiting', no: 'REQ-AG1-0022' })]).refused, [], '— it waits for an admin instead');
assert.deepStrictEqual(sync(m.token, [sale('I-AG1-0023', 28, [['M-OW1-0003', 1, 24.02 * 2000, 24.02 * 2000]], { cur: 'SSP', rate: 2000 }), sale('I-AG1-0024', 28, [['M-OW1-0003', 1, 1, 1]], { cur: 'SSP', rate: 1 })]).refused.sort(), ['I-AG1-0023', 'I-AG1-0024'],
  'nor in SSP at a rate she typed below the company\'s (2,000 or 1 against 2,500)');
res = sync(m.token, [{ ...sale('I-AG1-0025', 28, [['M-OW1-0002', 1, 13.5, 13.5]]), d: { ...sale('I-x', 1, []).d, id: 'I-AG1-0025', no: sale('I-AG1-0001', 1, []).d.no === 'X' ? 'X' : 'INV-0001', items: [{ t: 'x', m: 'M-OW1-0002', qty: 1, price: 13.5 }] } }]);
assert.deepStrictEqual(res.refused, ['I-AG1-0025'], 'an invoice number used twice, or one the sheet never gave her, is refused');
// an admin signed in on her phone does not push her price through; the admin's own approval does
const low = sale('I-AG1-0026', 29, [['M-OW1-0002', 10, 5, 13.5]]);
assert.deepStrictEqual(sync(m.token, [low]).refused, ['I-AG1-0026']);
assert.deepStrictEqual(sync(owner, [low]).refused, ['I-AG1-0026'], 'the same record sent by an admin: still hers, still checked');
assert.deepStrictEqual(sync(owner, [{ ...low, d: { ...low.d, ok: 'approved', okBy: 'Owner' } }]).refused, [], 'an admin approving it is the admin\'s call');

/* ---------- the second review's ways round it (3 Nov 2026), each refused ---------- */
const withLines = (id, u, items, extra = {}) => ({ id, k: 'I', u, d: { id, type: 'invoice', no: post({ op: 'number', token: m.token }).no, client: 'K-AG1-0001', date: ago(4), cur: 'USD', items, tax: 0, uid: m.me.id, createdAt: ago(0) + 'T09:00:00', ...extra } });
assert.deepStrictEqual(sync(m.token, [withLines('I-AG1-0040', 30, [{ t: 'Rebar', m: 'M-OW1-0002', qty: 1000, price: 0, dlv: true }]), withLines('I-AG1-0041', 30, [{ t: 'Rebar 12 mm', qty: 100, price: 1, dlv: true }]),
  withLines('I-AG1-0042', 30, [{ t: 'Delivery', qty: 1, price: 5, dlv: true }, { t: 'Delivery again', qty: 1, price: 5, dlv: true }])]).refused.sort(), ['I-AG1-0040', 'I-AG1-0041', 'I-AG1-0042'],
  'the delivery charge cannot carry stock, be 100 of anything, or come twice');
assert.deepStrictEqual(sync(m.token, [withLines('I-AG1-0043', 30, [{ t: 'Rebar', m: 'M-OW1-0002', qty: 1, price: 13.5 }, { t: 'Delivery to site', qty: 1, price: 25, dlv: true }])]).refused, [], 'one delivery charge on a sale at the list price: taken');
// her own expense cannot set the company's SSP rate
const myE = { id: 'E-AG1-0100', k: 'E', u: 31, d: { id: 'E-AG1-0100', cur: 'SSP', amount: 1000, rate: 1, paidTo: 'Shop', reason: 'Tea', at: ago(0) + 'T08:00', uid: m.me.id, createdAt: ago(0) + 'T08:00:00' } };
assert.deepStrictEqual(sync(m.token, [myE]).refused, []);
res = sync(m.token, [withLines('I-AG1-0044', 31, [{ t: 'Rebar', m: 'M-OW1-0002', qty: 1, price: 13.5, list: 13.5 }], { cur: 'SSP', rate: 1 })]);
assert.deepStrictEqual([res.refused, res.rate], [['I-AG1-0044'], 2500], 'an SSP rate in her own expense changes nothing: the sale at "1" is refused, and phones are told the admins\' 2,500');
assert.deepStrictEqual(sync(m.token, [withLines('I-AG1-0045', 31, [{ t: 'Rebar', m: 'M-OW1-0002', qty: 1, price: Math.round(13.5 * 0.99 * 2475), list: 13.5 * 2475 }], { cur: 'SSP', rate: 2475 })]).refused, ['I-AG1-0045'],
  'nor does a lower rate add to her 1 %: 1 % off at a 1 % lower rate is valued at the company\'s rate — 2 % below');
// a delivery note only for a real sale, no more than it sold and other notes did not take
const dnFor = (id, inv, qty, extra = {}) => ({ id, k: 'D', u: 32, d: { id, u: 32, no: 'DN-' + id.slice(2), date: ago(0), inv, to: 'X', how: 'collect', driver: 'Y', lines: [{ m: 'M-OW1-0002', qty }], status: 'out', uid: m.me.id, createdAt: ago(0) + 'T10:00:00', ...extra } });
assert.deepStrictEqual(sync(m.token, [dnFor('D-AG1-0050', 'I-NOPE', 1), dnFor('D-AG1-0051', 'I-AG1-0043', 2), dnFor('D-AG1-0052', 'I-AG1-0002', 1), dnFor('D-AG1-0053', 'I-AG1-0007', 1)]).refused.sort(), ['D-AG1-0050', 'D-AG1-0051', 'D-AG1-0053'],
  'not for an invoice that does not exist, not more than it sold (1), not one still waiting for its price; a real sale: yes');
// an approved quotation with two prices for one item: its highest stands, not its cheapest for everything
const q2 = { id: 'I-AG1-0060', k: 'I', u: 33, d: { id: 'I-AG1-0060', type: 'quote', no: 'QT-AG1-0060', client: 'K-AG1-0001', date: ago(1), cur: 'USD', items: [{ t: 'Rebar', m: 'M-OW1-0004', qty: 10, price: 30, list: 37.55 }, { t: 'Rebar', m: 'M-OW1-0004', qty: 10, price: 36, list: 37.55 }], tax: 0, ok: 'waiting', uid: m.me.id, createdAt: ago(1) + 'T10:00:00' } };
sync(m.token, [q2]); sync(owner, [{ ...q2, u: 34, d: { ...q2.d, ok: 'approved', okBy: 'Owner' } }]);
assert.deepStrictEqual(sync(m.token, [withLines('I-AG1-0061', 35, [{ t: 'Rebar', m: 'M-OW1-0004', qty: 20, price: 30, list: 37.55 }], { from: 'I-AG1-0060', ok: 'approved' })]).refused, ['I-AG1-0061'], 'not 20 at the cheaper quoted price');
// a waiting invoice never carries (or holds) a number from the series
assert.deepStrictEqual(sync(m.token, [withLines('I-AG1-0062', 35, [{ t: 'x', qty: 1, price: 1 }], { ok: 'waiting', no: 'INV-0900' })]).refused, ['I-AG1-0062'], 'a waiting invoice cannot take a number from the series');
// her own client's note is hers
sync(m.token, [{ id: 'K-AG1-0009', k: 'K', u: 36, d: { id: 'K-AG1-0009', name: 'Mine', note: 'call before 5pm', uid: m.me.id } }]);
assert.strictEqual(sync(m.token).pull.find(p => p.id === 'K-AG1-0009').d.note, 'call before 5pm', 'the note on her own client');

/* ---------- an admin approves (or refuses) the price; an approved quotation's price stands on its invoice ---------- */
const waiting = sync(owner).pull.find(p => p.id === 'I-AG1-0007');
assert.strictEqual(waiting.d.ok, 'waiting', 'the admin sees it waiting');
assert.deepStrictEqual(sync(owner, [{ ...waiting, u: 30, d: { ...waiting.d, ok: 'approved', no: post({ op: 'number', token: owner }).no, okBy: 'Owner' } }]).refused, [], 'approved, with its number');
const quote = { id: 'I-AG1-0008', k: 'I', u: 25, d: { id: 'I-AG1-0008', type: 'quote', no: 'QT-AG1-0001', client: 'K-AG1-0001', date: '2026-10-30', cur: 'USD', items: [{ t: 'Rebar', m: 'M-OW1-0004', qty: 20, price: 33, list: 37.55 }], tax: 0, ok: 'waiting', uid: m.me.id, createdAt: '2026-10-30T10:00:00' } };
assert.deepStrictEqual(sync(m.token, [quote]).refused, [], 'a quotation below the list waits too');
assert.deepStrictEqual(sync(m.token, [sale('I-AG1-0009', 26, [['M-OW1-0004', 20, 33, 37.55]], { from: 'I-AG1-0008' })]).refused, ['I-AG1-0009'], 'its invoice cannot use that price before an admin approves it');
sync(owner, [{ ...quote, u: 31, d: { ...quote.d, ok: 'approved', okBy: 'Owner' } }]);
assert.deepStrictEqual(sync(m.token, [sale('I-AG1-0011', 27, [['M-OW1-0004', 21, 33, 37.55]], { from: 'I-AG1-0008', ok: 'approved' })]).refused, ['I-AG1-0011'], 'not for more than it quoted');
assert.deepStrictEqual(sync(m.token, [sale('I-AG1-0012', 27, [['M-OW1-0004', 20, 33 * 2500, 37.55 * 2500]], { from: 'I-AG1-0008', ok: 'approved', cur: 'SSP', rate: 2500 })]).refused, ['I-AG1-0012'], 'nor in another money');
assert.deepStrictEqual(sync(m.token, [sale('I-AG1-0010', 27, [['M-OW1-0004', 20, 33, 37.55]], { from: 'I-AG1-0008', ok: 'approved' })]).refused, [], 'after: the invoice from it keeps the approved price');
assert.deepStrictEqual(sync(m.token, [sale('I-AG1-0013', 27, [['M-OW1-0004', 20, 33, 37.55]], { from: 'I-AG1-0008', ok: 'approved' })]).refused, ['I-AG1-0013'], 'once: a second invoice from the same approved quotation is refused');

/* ---------- others' sales reach her only as what left the stock ---------- */
sync(owner, [{ id: 'K-OW1-0001', k: 'K', u: 40, d: { id: 'K-OW1-0001', name: 'Big Client', uid: ownerId } },
  { id: 'I-OW1-0001', k: 'I', u: 40, d: { id: 'I-OW1-0001', type: 'invoice', no: 'INV-0099', client: 'K-OW1-0001', date: '2026-10-31', cur: 'USD', items: [{ t: 'Rebar', m: 'M-OW1-0001', qty: 50, price: 9.38 }, { t: 'Design work', qty: 1, price: 5000 }], tax: 0, uid: ownerId, createdAt: '2026-10-31T09:00:00' } },
  { id: 'I-OW1-0002', k: 'I', u: 40, d: { id: 'I-OW1-0002', type: 'invoice', no: 'INV-0100', client: 'K-OW1-0001', date: '2026-10-31', cur: 'USD', items: [{ t: 'Villa stage 2', qty: 1, price: 90000 }], tax: 0, uid: ownerId } }]);
pull = sync(m.token).pull;
const stub = pull.find(p => p.id === 'I-OW1-0001');
assert.deepStrictEqual([stub.d.stub, stub.d.items, 'client' in stub.d, 'no' in stub.d], [true, [{ m: 'M-OW1-0001', qty: 50 }], false, false], "an admin's sale: only the stock it took — no client, price, number or other lines");
assert.ok(!pull.some(p => p.id === 'I-OW1-0002'), 'an invoice with nothing from stock: not at all');
assert.ok(pull.some(p => p.id === 'I-AG1-0001') && pull.find(p => p.id === 'I-AG1-0001').d.items[0].price === 13.5, 'her own invoices in full');

/* ---------- delivery notes: made when the goods leave, completed by who received what; never changed after ---------- */
const dn = (id, u, extra = {}) => ({ id, k: 'D', u, d: { id, u, no: 'DN-AG1-0001', date: '2026-10-30', inv: 'I-AG1-0001', to: 'Builder Ltd', addr: 'Gudele block 3', how: 'deliver', driver: 'Juma (driver)', phone: '+211 900 000 001', vehicle: 'SSD 123 A',
  charge: 25, cost: 15, cur: 'USD', lines: [{ m: 'M-OW1-0002', qty: 100 }], status: 'out', check: 'AB12CD', uid: m.me.id, createdAt: '2026-10-30T11:00:00', ...extra } });
assert.deepStrictEqual(sync(m.token, [dn('D-AG1-0001', 60), dn('D-AG1-0002', 60, { status: 'done', recv: { name: 'X', at: '2026-10-30T12:00', lines: [] } }), dn('D-AG1-0003', 60, { no: 'INV-1' }), dn('D-AG1-0004', 60, { lines: [] })]).refused.sort(),
  ['D-AG1-0002', 'D-AG1-0003', 'D-AG1-0004'], 'a delivery note starts "on the way", with its number and its goods; it cannot be born received');
const todayAt = new Date().toISOString().slice(0, 10) + 'T15:40'; // received today: the morning email names it
const sent = dn('D-AG1-0001', 61, { status: 'done', recv: { name: 'Peter (site engineer)', phone: '+211 900 000 002', at: todayAt, lines: [{ m: 'M-OW1-0002', qty: 95 }], note: '5 bars fell off', geo: { lat: 4.85, lng: 31.58, acc: 20 } } });
assert.deepStrictEqual(sync(m.token, [{ ...sent, d: { ...sent.d, lines: [{ m: 'M-OW1-0002', qty: 95 }] } }]).refused, ['D-AG1-0001'], 'completing it, the goods sent cannot be made to match what arrived');
assert.deepStrictEqual(sync(m.token, [{ ...sent, d: { ...sent.d, charge: 0 } }]).refused, ['D-AG1-0001'], 'nor the delivery charge changed');
const badRecv = recv => ({ ...sent, d: { ...sent.d, recv: { ...sent.d.recv, ...recv } } });
assert.deepStrictEqual([sync(m.token, [badRecv({ lines: [{ m: 'M-OW1-0002', qty: 999 }] })]).refused, sync(m.token, [badRecv({ lines: [] })]).refused, sync(m.token, [badRecv({ lines: [{ m: 'M-OW1-0002', qty: 95 }, { m: 'M-OW1-0001', qty: 5 }] })]).refused,
  sync(m.token, [badRecv({ at: '2020-01-01T10:00' })]).refused].map(r => r.length), [1, 1, 1, 1], 'a receipt cannot say more arrived than left, leave an item out, add one, or be dated before the goods left');
assert.deepStrictEqual(sync(m.token, [sent]).refused, [], 'only who received what is added');
assert.deepStrictEqual(sync(m.token, [{ ...sent, u: 62, d: { ...sent.d, recv: { ...sent.d.recv, lines: [{ m: 'M-OW1-0002', qty: 100 }] } } }]).refused, ['D-AG1-0001'], 'and once received it stays as it was signed');
assert.deepStrictEqual(sync(s.token, [dn('D-SK1-0001', 63, { uid: s.me.id })]).refused, ['D-SK1-0001'], 'a store keeper does not make them');
const born = dn('D-AG1-0009', 64, { no: 'DN-AG1-0009', date: ago(1), inv: 'I-AG1-0002', lines: [{ m: 'M-OW1-0002', qty: 5 }], status: 'done', recv: { name: 'Site', at: ago(0) + 'T09:00', lines: [{ m: 'M-OW1-0002', qty: 5 }] } });
assert.deepStrictEqual([sync(m.token, [born]).refused, sync(m.token, [dn('D-AG1-0010', 64, { no: 'DN-AG1-0010', date: '2026-01-01' })]).refused], [[], ['D-AG1-0010']], 'made and received before the phone synced: taken at once; dated far back: refused');
assert.ok(sync(m.token).pull.some(p => p.id === 'D-AG1-0001' && p.d.recv.name === 'Peter (site engineer)'), 'the office manager has them');

/* ---------- the readable tabs (admins have the sheet): stock, every move, each import and its costs ---------- */
const st = rowOf('Stock', 'M-OW1-0002'), st10 = rowOf('Stock', 'M-OW1-0001');
assert.deepStrictEqual([st[5], st[6], st[7], st[10]], [470, 131, 339, 12.2716], '12 mm: 470 in, 100 + 10 + 10 + 1 sold and 10 at a price an admin approved, 339 on hand, at the landed cost');
assert.deepStrictEqual([st10[7], st10[9]], [227, ''], '10 mm: 280 − 3 counted short − 50 sold = 227; above its reorder level of 50');
assert.ok(tab('Stock moves').some(r => r[3] === 'Used' && r[4] === '' && r[5] === 40 && r[6] === 752 && r[10] === 'Site foreman'), 'the 40 bars used on the project, as a move: 792 − 40 = 752 left, who took them');
const lines = tab('Imports').filter(r => r[15] === 'Y-OW1-0001');
assert.deepStrictEqual(lines.map(r => r[13]), [8.5265, 12.2716, 21.8348, 34.134], 'each line with the landed cost of one');
assert.deepStrictEqual(tab('Import costs').filter(r => r[10] === 'Y-OW1-0001').map(r => [r[2], r[5], r[7], r[9]]), [['Freight / shipping', 'USD', 5837, ''], ['Customs duty', 'SSP', 2458, ''], ['Clearing agent', 'USD', 1000, 'E-OW1-0090']],
  'every cost as typed, in its currency, with its dollars at that day\'s rate and the payment it was');

// what an office manager never gets: what others' deliveries and imports cost, the admins' notes on clients
sync(owner, [{ id: 'D-OW1-0001', k: 'D', u: 70, d: { ...dn('x', 70).d, id: 'D-OW1-0001', no: 'DN-OW1-0001', cost: 40, pay: 'E-OW1-0090', uid: ownerId } }, { id: 'K-OW1-0002', k: 'K', u: 70, d: { id: 'K-OW1-0002', name: 'Late Payer', note: 'bad payer, owes 20k', uid: ownerId } }]);
saveUserFull = post({ op: 'saveUser', token: owner, user: { id: m.me.id, sees: { all: true } } });
const mary4 = post({ op: 'login', username: 'mary', password: 'mary-pass1' }).token, got4 = sync(mary4).pull;
const theirDn = got4.find(p => p.id === 'D-OW1-0001'), ownDn = got4.find(p => p.id === 'D-AG1-0001');
assert.deepStrictEqual(['cost' in theirDn.d, 'pay' in theirDn.d, ownDn.d.cost], [false, false, 15], "another's delivery note without its cost; hers with it");
assert.ok(!got4.some(p => p.id === 'E-OW1-0090'), 'an import\'s payment never reaches her, even when she may see every payment');
assert.deepStrictEqual('note' in got4.find(p => p.id === 'K-OW1-0002').d, false, 'clients without the admins\' notes');
const dRow = rowOf('Deliveries', 'D-AG1-0001');
assert.deepStrictEqual([dRow[2], dRow[5], dRow[6], dRow[8], dRow[10], dRow[11], dRow[13], dRow[14], dRow[16], dRow[17], /maps\.google\.com\/\?q=4\.85,31\.58/.test(dRow[18])],
  [sync(owner).pull.find(p => p.id === 'I-AG1-0001').d.no, 'Delivered by us', 'Juma (driver)', 'SSD 123 A', 25, 15, 'Received — NO PROOF', 'Peter (site engineer)', '95 × Rebar 12 mm × 12 m', 'SHORT', true],
  'every delivery: for which invoice, who took it in which vehicle, the charge and the cost, who received what, short, where it was signed');
gas.mails.length = 0;
post({ op: 'alerts', token: owner, email: 'owner@example.com' });
gas.morningEmail(true);
const mail = gas.mails.length ? gas.mails[0].body : '';
assert.ok(/SHORT DELIVERY: DN-AG1-0001 to Builder Ltd — received by Peter/.test(mail), 'a short delivery is in the morning email');
assert.ok(/NOT DELIVERED: INV-\d+ of \d{4}-\d\d-\d\d — 10 of 10 still in the warehouse/.test(mail), 'an invoice whose goods have no delivery note after 3 days is named (I-AG1-0002: 10 bars, none sent)');

// the signed slip comes in: the delivery is no longer "no proof"
const slipUp = post({ op: 'upload', token: mary4, name: 'slip.png', mime: 'image/png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64').toString('base64') });
assert.deepStrictEqual(sync(mary4, [{ id: 'F-AG1-0001', k: 'F', u: 80, d: { id: 'F-AG1-0001', for: 'D-AG1-0001', type: 'delivery', proof: true, fileId: slipUp.fileId, name: 'DN signed slip.png', mime: 'image/png', uid: m.me.id, createdAt: ago(0) + 'T16:00:00' } }]).refused, []);
assert.strictEqual(rowOf('Deliveries', 'D-AG1-0001')[13], 'Received', 'with its signed slip');

/* ---------- papers: an import's papers are filed under the warehouse, and are admins' only ---------- */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64').toString('base64');
const up = post({ op: 'upload', token: owner, name: 'PI.png', mime: 'image/png', data: png });
assert.deepStrictEqual(sync(owner, [{ id: 'F-OW1-0001', k: 'F', u: 50, d: { id: 'F-OW1-0001', for: 'Y-OW1-0001', type: 'attachment', fileId: up.fileId, name: 'PI.png', mime: 'image/png', uid: ownerId, createdAt: '2026-10-28T11:00:00' } }]).refused, []);
gas.organizeAll ? gas.organizeAll() : null;
assert.ok(!sync(mary4).pull.some(p => p.id === 'F-OW1-0001'), 'the supplier invoice shows costs: not for the office manager');
assert.strictEqual(post({ op: 'file', token: mary4, id: 'F-OW1-0001' }).ok, false, 'nor can she fetch it');

/* ---------- a cost paid in parts: several payments in Accounts linked to one cost, and to the goods (owner, 3 Nov 2026) ---------- */
{
  const pay = (id, amount, reason) => ({ id, k: 'E', u: 900, d: { id, cur: 'USD', amount, paidTo: 'Clearing agent', reason, at: '2026-10-29T10:00', imp: 'Y-OW1-0001', uid: ownerId } });
  const parts = { ...imp, u: 901, d: { ...imp.d, costs: imp.d.costs.map(c => (c.t === 'clearing' ? { ...c, pay: 'E-OW1-0091', pays: ['E-OW1-0091', 'E-OW1-0092', 'E-OW1-0093'] } : c)), gpay: ['E-OW1-0094', 'E-OW1-0095'], editedAt: '2026-11-03T10:00:00' } };
  const r = sync(owner, [pay('E-OW1-0091', 400, 'Clearing part 1'), pay('E-OW1-0092', 350, 'Clearing part 2'), pay('E-OW1-0093', 250, 'Clearing part 3'), pay('E-OW1-0094', 10000, 'Deposit'), pay('E-OW1-0095', 15050.54, 'Balance'), parts]);
  assert.deepStrictEqual(r.refused, [], 'an import whose clearing is three payments and whose goods are two: taken as it is');
  const back = sync(owner).pull.find(p => p.id === 'Y-OW1-0001');
  assert.deepStrictEqual([back.d.costs.find(c => c.t === 'clearing').pays, back.d.gpay], [['E-OW1-0091', 'E-OW1-0092', 'E-OW1-0093'], ['E-OW1-0094', 'E-OW1-0095']], 'every link comes back to the other phones');
  const seen = sync(mary4).pull;
  assert.deepStrictEqual(Object.keys(seen.find(p => p.id === 'Y-OW1-0001').d).sort(), ['createdAt', 'date', 'id', 'lines', 'ref', 'stub'], 'the office manager still sees none of it');
  assert.ok(!seen.some(p => /^E-OW1-009[1-5]$/.test(p.id)), 'nor the payments for the import');
}

console.log('Warehouse: all checks passed');
