// Questions and alerts in the real apps-script/Code.gs on fake Google services: an admin asks anyone, staff ask the admins, a
// reply belongs to its question, nobody else receives it, nobody changes a message, and the morning email chases what is
// unanswered. Usage: node tools/test-questions.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadGas } = require('./fake-gas');

const gas = loadGas(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'));
gas.setup();
const key = gas.props.KEY;
const post = body => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
post({ key, since: 0, push: [{ id: 'settings', k: 'S', u: 1, d: { company: 'Test Builders', pass: { salt: 's', hash: 'h' } } }] });
const owner = post({ op: 'setup', key, setupCode: gas.props.SETUP_CODE, name: 'Owner', username: 'owner', newPassword: 'owner-pass' }).token;
post({ op: 'saveUser', token: owner, user: { name: 'Mary', username: 'mary', role: 'manager', password: 'mary-pass1' } });
post({ op: 'saveUser', token: owner, user: { name: 'Store One', username: 'store1', role: 'store', password: 'store-pass1' } });
const users = post({ op: 'users', token: owner }).users, id = n => users.find(u => u.username === n).id;
const mary = post({ op: 'login', username: 'mary', password: 'mary-pass1' }).token, store = post({ op: 'login', username: 'store1', password: 'store-pass1' }).token;
const sync = (tok, push = []) => post({ token: tok, since: 0, push, sees: 1 });
const ago = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 19);
const q = (qid, uid, d, at = ago(0)) => ({ id: qid, k: 'Q', u: Date.now(), d: { id: qid, uid, createdAt: at, ...d } });

/* ---------- an admin asks Mary about a payment ---------- */
const pay = { id: 'E-OW1-0001', k: 'E', u: 1, d: { id: 'E-OW1-0001', cur: 'USD', amount: 120, paidTo: 'Hardware', reason: 'Nails', at: '2026-11-01T10:00', uid: id('owner') } };
let r = sync(owner, [pay, q('Q-OW1-0001', id('owner'), { to: id('mary'), text: 'Which site were the nails for?', about: { k: 'E', id: 'E-OW1-0001', what: 'Payment 1 Nov · $120 · Hardware' } }, ago(3))]);
assert.deepStrictEqual(r.refused, [], 'an admin asks a login about an entry');
assert.deepStrictEqual(sync(owner, [q('Q-OW1-0009', id('owner'), { to: 'U-NOBODY1', text: 'Hello?' })]).refused, ['Q-OW1-0009'], 'not to someone without a login');
let m = sync(mary).pull;
assert.deepStrictEqual(m.filter(p => p.k === 'Q').map(p => p.id), ['Q-OW1-0001'], 'Mary receives the question asked of her');
assert.ok(!m.some(p => p.id === 'E-OW1-0001'), "the admin's payment itself stays hidden from her: the question says what it is");
assert.ok(!sync(store).pull.some(p => p.k === 'Q'), 'the store keeper does not');

/* ---------- Mary answers; she cannot change what was said, nor answer for others ---------- */
r = sync(mary, [q('Q-MRY-0001', id('mary'), { re: 'Q-OW1-0001', text: 'Gudele site, block 3.' }, ago(2))]);
assert.deepStrictEqual(r.refused, [], 'she answers the question she was asked');
const root = sync(owner).pull.find(p => p.id === 'Q-OW1-0001');
assert.deepStrictEqual(sync(mary, [{ ...root, u: Date.now(), d: { ...root.d, text: 'Nothing was asked' } }]).refused, ['Q-OW1-0001'], 'she cannot change the question');
assert.deepStrictEqual(sync(store, [q('Q-ST1-0001', id('store1'), { re: 'Q-OW1-0001', text: 'Me too' })]).refused, ['Q-ST1-0001'], 'nor can someone who was not asked answer it');
assert.deepStrictEqual(sync(mary, [q('Q-MRY-0002', id('mary'), { re: 'Q-MRY-0001', text: 'A reply to a reply' })]).refused, ['Q-MRY-0002'], 'a reply answers the question itself');
assert.deepStrictEqual(sync(mary, [q('Q-MRY-0003', id('mary'), { re: 'Q-NOPE-01', text: 'To nothing' })]).refused, ['Q-MRY-0003'], 'nor a question that is not there');
assert.deepStrictEqual(sync(mary, [q('Q-MRY-0004', id('owner'), { re: 'Q-OW1-0001', text: 'Pretending to be the owner' })]).refused, ['Q-MRY-0004'], 'nor in somebody else\'s name');
assert.strictEqual(sync(owner).pull.find(p => p.id === 'Q-MRY-0001').d.by, 'Mary', 'her answer is signed by her login');

/* ---------- staff ask the admins, never one another ---------- */
assert.deepStrictEqual(sync(store, [q('Q-ST1-0002', id('store1'), { to: 'admins', text: 'The cement store is leaking' })]).refused, [], 'the store keeper raises a problem with the admins');
assert.deepStrictEqual(sync(store, [q('Q-ST1-0003', id('store1'), { to: id('mary'), text: 'Psst' })]).refused, ['Q-ST1-0003'], 'but not to another member of staff');
assert.ok(!sync(mary).pull.some(p => p.id === 'Q-ST1-0002'), "Mary does not receive the store keeper's question to the admins");
assert.ok(sync(store).pull.some(p => p.id === 'Q-ST1-0002'), 'the store keeper keeps his own');
assert.deepStrictEqual(sync(owner, [q('Q-OW1-0002', id('owner'), { re: 'Q-ST1-0002', text: 'A plumber comes tomorrow.' })]).refused, [], 'an admin answers it');
assert.ok(sync(store).pull.some(p => p.id === 'Q-OW1-0002'), 'and the store keeper receives the answer');
assert.deepStrictEqual(sync(owner, [q('Q-OW1-0003', id('owner'), { to: 'admins', text: 'x'.repeat(2001) })]).refused, ['Q-OW1-0003'], 'a message has at most 2,000 letters');

/* ---------- the morning email: unanswered questions ---------- */
sync(owner, [q('Q-OW1-0004', id('owner'), { to: id('store1'), text: 'Count the rebars please' }, ago(2)), q('Q-ST1-0004', id('store1'), { to: 'admins', text: 'Can I take Friday off?' }, ago(1))]);
post({ op: 'alerts', token: owner, email: 'owner@example.com' });
const mail = () => { gas.mails.length = 0; gas.morningEmail(true); return gas.mails.length ? gas.mails[0].body : ''; };
let body = mail();
assert.ok(/NO ANSWER YET from Store One, asked .*Count the rebars/.test(body), "an admin's question two days without answer: chased");
assert.ok(/QUESTION from Store One, .*Friday off/.test(body), 'a question from staff the admins have not answered');
assert.ok(!/nails|leaking/.test(body), 'answered ones are not');
sync(owner, [q('Q-OW1-0005', id('owner'), { re: 'Q-OW1-0004', text: 'Never mind, done', state: 'done' })]);
assert.ok(!/Count the rebars/.test(mail()), 'a question marked sorted is not chased');

/* ---------- several transactions on one question (owner, 9 Nov 2026) ---------- */
const link = (n, k = 'E') => ({ k, id: `${k}-OW1-${String(n).padStart(4, '0')}`, what: `Payment ${n} of $10 to Hardware, 1 Nov 2026` });
assert.deepStrictEqual(sync(owner, [q('Q-OW1-0020', id('owner'), { to: id('mary'), text: 'Which site were these three for?', about: [link(1), link(2), link(3, 'I')] })]).refused, [], 'a question about three transactions');
assert.deepStrictEqual(sync(mary).pull.find(p => p.id === 'Q-OW1-0020').d.about.map(a => a.id), ['E-OW1-0001', 'E-OW1-0002', 'I-OW1-0003'], 'Mary receives all three');
assert.deepStrictEqual(sync(owner, [q('Q-OW1-0021', id('owner'), { to: id('mary'), text: 'Too many', about: Array.from({ length: 21 }, (_, i) => link(i + 1)) })]).refused, ['Q-OW1-0021'], 'at most 20');
assert.deepStrictEqual(sync(owner, [q('Q-OW1-0022', id('owner'), { to: id('mary'), text: 'A bad one', about: [link(1), { k: 'Z', id: 'x' }] })]).refused, ['Q-OW1-0022'], 'each one must be a real kind and id');
assert.deepStrictEqual(sync(owner, [q('Q-OW1-0023', id('owner'), { to: id('mary'), text: 'Empty', about: [] })]).refused, ['Q-OW1-0023'], 'not an empty list');
assert.deepStrictEqual(sync(store, [q('Q-ST1-0020', id('store1'), { to: 'admins', text: 'x'.repeat(1900), about: Array.from({ length: 20 }, (_, i) => link(i + 1)) })]).refused, [], 'staff may link 20 to a long question (the bigger size allowance)');
body = mail();
assert.ok(/QUESTION from Store One, .*\(about Payment 1 of \$10 to Hardware, 1 Nov 2026 and 19 more\)/.test(body), 'the morning email names the first and how many more');

console.log('Questions: all checks passed');
