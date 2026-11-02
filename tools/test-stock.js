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
const sale = (id, u, lines, extra = {}) => ({ id, k: 'I', u, d: { id, type: 'invoice', no: post({ op: 'number', token: m.token }).no || 'X', client: 'K-AG1-0001', date: ago(4), cur: 'USD', items: lines.map(([mm, qty, price, list]) => ({ t: 'Rebar', m: mm, qty, price, list, unit: 'pcs' })), tax: 0, uid: m.me.id, createdAt: '2026-10-30T09:00:00', ...extra } });
res = sync(m.token, [client, sale('I-AG1-0001', 23, [['M-OW1-0002', 100, 13.5, 13.5]]), sale('I-AG1-0002', 23, [['M-OW1-0002', 10, 13.37, 13.5]]), sale('I-AG1-0003', 23, [['M-OW1-0002', 10, 13.3, 13.5]]),
  sale('I-AG1-0004', 23, [['M-OW1-0002', 10, 13.3, 13.3]]), sale('I-AG1-0005', 23, [['M-OW1-0004', 5, 37.55, 37.55]], { ok: 'approved' }), sale('I-AG1-0006', 23, [['M-OW1-0003', 10, 60750, 24.02 * 2500]], { cur: 'SSP', rate: 2500 })]);
assert.deepStrictEqual(res.refused.sort(), ['I-AG1-0003', 'I-AG1-0004', 'I-AG1-0005'], 'the list price, or 0.96 % below; not 1.5 % below — even claiming a lower list price — and she cannot approve her own price; an SSP sale at its rate is checked in dollars');
assert.ok(/^INV-\d{4}$/.test(sale('I-x', 1, []).d.no), 'she takes invoice numbers from the one series');
res = sync(m.token, [sale('I-AG1-0007', 24, [['M-OW1-0002', 10, 12, 13.5]], { ok: 'waiting', no: 'REQ-AG1-0001' })]);
assert.deepStrictEqual(res.refused, [], 'lower than 1 %: sent to an admin, waiting');

/* ---------- an admin approves (or refuses) the price; an approved quotation's price stands on its invoice ---------- */
const waiting = sync(owner).pull.find(p => p.id === 'I-AG1-0007');
assert.strictEqual(waiting.d.ok, 'waiting', 'the admin sees it waiting');
assert.deepStrictEqual(sync(owner, [{ ...waiting, u: 30, d: { ...waiting.d, ok: 'approved', no: post({ op: 'number', token: owner }).no, okBy: 'Owner' } }]).refused, [], 'approved, with its number');
const quote = { id: 'I-AG1-0008', k: 'I', u: 25, d: { id: 'I-AG1-0008', type: 'quote', no: 'QT-AG1-0001', client: 'K-AG1-0001', date: '2026-10-30', cur: 'USD', items: [{ t: 'Rebar', m: 'M-OW1-0004', qty: 20, price: 33, list: 37.55 }], tax: 0, ok: 'waiting', uid: m.me.id, createdAt: '2026-10-30T10:00:00' } };
assert.deepStrictEqual(sync(m.token, [quote]).refused, [], 'a quotation below the list waits too');
assert.deepStrictEqual(sync(m.token, [sale('I-AG1-0009', 26, [['M-OW1-0004', 20, 33, 37.55]], { from: 'I-AG1-0008' })]).refused, ['I-AG1-0009'], 'its invoice cannot use that price before an admin approves it');
sync(owner, [{ ...quote, u: 31, d: { ...quote.d, ok: 'approved', okBy: 'Owner' } }]);
assert.deepStrictEqual(sync(m.token, [sale('I-AG1-0010', 27, [['M-OW1-0004', 20, 33, 37.55]], { from: 'I-AG1-0008', ok: 'approved' })]).refused, [], 'after: the invoice from it keeps the approved price');

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
assert.deepStrictEqual(sync(m.token, [sent]).refused, [], 'only who received what is added');
assert.deepStrictEqual(sync(m.token, [{ ...sent, u: 62, d: { ...sent.d, recv: { ...sent.d.recv, lines: [{ m: 'M-OW1-0002', qty: 100 }] } } }]).refused, ['D-AG1-0001'], 'and once received it stays as it was signed');
assert.deepStrictEqual(sync(s.token, [dn('D-SK1-0001', 63, { uid: s.me.id })]).refused, ['D-SK1-0001'], 'a store keeper does not make them');
assert.ok(sync(m.token).pull.some(p => p.id === 'D-AG1-0001' && p.d.recv.name === 'Peter (site engineer)'), 'the office manager has them');

/* ---------- the readable tabs (admins have the sheet): stock, every move, each import and its costs ---------- */
const st = rowOf('Stock', 'M-OW1-0002'), st10 = rowOf('Stock', 'M-OW1-0001');
assert.deepStrictEqual([st[5], st[6], st[7], st[10]], [470, 120, 350, 12.2716], '12 mm: 470 in, 100 + 10 + 10 sold, 350 on hand, at the landed cost');
assert.deepStrictEqual([st10[7], st10[9]], [227, ''], '10 mm: 280 − 3 counted short − 50 sold = 227; above its reorder level of 50');
assert.ok(tab('Stock moves').some(r => r[3] === 'Used' && r[4] === '' && r[5] === 40 && r[6] === 752 && r[10] === 'Site foreman'), 'the 40 bars used on the project, as a move: 792 − 40 = 752 left, who took them');
const lines = tab('Imports').filter(r => r[15] === 'Y-OW1-0001');
assert.deepStrictEqual(lines.map(r => r[13]), [8.5265, 12.2716, 21.8348, 34.134], 'each line with the landed cost of one');
assert.deepStrictEqual(tab('Import costs').filter(r => r[10] === 'Y-OW1-0001').map(r => [r[2], r[5], r[7], r[9]]), [['Freight / shipping', 'USD', 5837, ''], ['Customs duty', 'SSP', 2458, ''], ['Clearing agent', 'USD', 1000, 'E-OW1-0090']],
  'every cost as typed, in its currency, with its dollars at that day\'s rate and the payment it was');

const dRow = rowOf('Deliveries', 'D-AG1-0001');
assert.deepStrictEqual([dRow[2], dRow[5], dRow[6], dRow[8], dRow[10], dRow[11], dRow[13], dRow[14], dRow[16], dRow[17], /maps\.google\.com\/\?q=4\.85,31\.58/.test(dRow[18])],
  [sync(owner).pull.find(p => p.id === 'I-AG1-0001').d.no, 'Delivered by us', 'Juma (driver)', 'SSD 123 A', 25, 15, 'Received', 'Peter (site engineer)', '95 × Rebar 12 mm × 12 m', 'SHORT', true],
  'every delivery: for which invoice, who took it in which vehicle, the charge and the cost, who received what, short, where it was signed');
gas.mails.length = 0;
post({ op: 'alerts', token: owner, email: 'owner@example.com' });
gas.morningEmail(true);
const mail = gas.mails.length ? gas.mails[0].body : '';
assert.ok(/SHORT DELIVERY: DN-AG1-0001 to Builder Ltd — received by Peter/.test(mail), 'a short delivery is in the morning email');
assert.ok(/NOT DELIVERED: INV-\d+ of \d{4}-\d\d-\d\d — 10 of 10 still in the warehouse/.test(mail), 'an invoice whose goods have no delivery note after 3 days is named (I-AG1-0002: 10 bars, none sent)');

/* ---------- papers: an import's papers are filed under the warehouse, and are admins' only ---------- */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64').toString('base64');
const up = post({ op: 'upload', token: owner, name: 'PI.png', mime: 'image/png', data: png });
assert.deepStrictEqual(sync(owner, [{ id: 'F-OW1-0001', k: 'F', u: 50, d: { id: 'F-OW1-0001', for: 'Y-OW1-0001', type: 'attachment', fileId: up.fileId, name: 'PI.png', mime: 'image/png', uid: ownerId, createdAt: '2026-10-28T11:00:00' } }]).refused, []);
gas.organizeAll ? gas.organizeAll() : null;
assert.ok(!sync(m.token).pull.some(p => p.id === 'F-OW1-0001'), 'the supplier invoice shows costs: not for the office manager');
assert.strictEqual(post({ op: 'file', token: m.token, id: 'F-OW1-0001' }).ok, false, 'nor can she fetch it');

console.log('Warehouse: all checks passed');
