// Phone notifications in the real apps-script/Code.gs on fake Google services: the admin's set-up is checked with Google, phones
// register, only the person who must act hears about a thing, never at night, at most 6 a day, never amounts on the lock
// screen, and phones that left are forgotten. Usage: node tools/test-push.js
'use strict';
const assert = require('assert');
const crypto = require('crypto');
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
const sends = () => gas.fetches.filter(f => /messages:send$/.test(f.url)).map(f => JSON.parse(f.payload).message);
const fresh = () => { gas.fetches.length = 0; };
const stamp = () => new Date().toISOString().slice(0, 19);
let n = 0;
const rec = (k, uid, d) => { const rid = `${k}-T-${String(++n).padStart(4, '0')}`; return { id: rid, k, u: Date.now() + n, d: { id: rid, uid, createdAt: stamp(), ...d } }; };

/* ---------- the admin's set-up, checked with Google before it is kept ---------- */
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const web = { apiKey: 'AIzaSyTestTestTestTestTestTestTestTest12', authDomain: 'brookfield-1.firebaseapp.com', projectId: 'brookfield-1', storageBucket: 'brookfield-1.appspot.com', messagingSenderId: '123456789012', appId: '1:123456789012:web:abc123def456' };
const vapid = 'B' + 'x'.repeat(86);
const sa = { type: 'service_account', project_id: 'brookfield-1', client_email: 'firebase-adminsdk-x@brookfield-1.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), private_key_id: 'k1' };
const setup = (tok, o = {}) => post({ op: 'pushSetup', token: tok, web, vapid, key: JSON.stringify(sa), ...o });
assert.strictEqual(setup(mary).ok, false, 'only an admin sets it up');
assert.match(setup(owner, { web: { ...web, appId: '' } }).error, /firebaseConfig is not complete/);
assert.match(setup(owner, { vapid: 'short' }).error, /Web Push key/);
assert.match(setup(owner, { key: '{"type":"authorized_user"}' }).error, /service-account key/);
assert.match(setup(owner, { key: 'not json' }).error, /not the one Firebase downloads/);
assert.match(setup(owner, { key: JSON.stringify({ ...sa, project_id: 'other' }) }).error, /another Firebase project/);
const usual = gas.fetchReply.fn;
gas.fetchReply.fn = () => [400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }];
assert.match(setup(owner).error, /Google did not accept the key: Invalid JWT Signature/, 'a key Google refuses');
assert.ok(!gas.props.PUSH_KEY, 'is not kept');
gas.fetchReply.fn = usual;
fresh();
let r = setup(owner);
assert.deepStrictEqual([r.ok, r.push], [true, { web, vapid }], 'a key Google accepts is kept');
const [h, c, sig] = gas.fetches[0].payload.assertion.split('.'), claims = JSON.parse(Buffer.from(c, 'base64url'));
assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, 'base64url')), 'the request to Google is signed with the key');
assert.deepStrictEqual([claims.iss, claims.scope, claims.aud, claims.exp - claims.iat], [sa.client_email, 'https://www.googleapis.com/auth/firebase.messaging', 'https://oauth2.googleapis.com/token', 3600]);
assert.deepStrictEqual(Object.keys(JSON.parse(gas.props.PUSH_KEY)).sort(), ['client_email', 'private_key', 'project_id'], 'only what sending needs is kept');
assert.deepStrictEqual(sync(mary).push, { web, vapid }, 'signed-in phones learn how to register');
assert.strictEqual(post({ key, since: 0, push: [] }).push, null, 'a phone with only the company code does not');

/* ---------- phones register ---------- */
assert.strictEqual(post({ op: 'pushToken', token: mary }).ok, false, 'a token is needed');
assert.strictEqual(post({ op: 'pushToken', token: mary, fcm: 'bad token!' }).ok, false, 'and it must look like one');
assert.strictEqual(post({ op: 'pushToken', fcm: 'tok-anyone-0000000000000' }).ok, false, 'only someone signed in registers');
['tok-mary-11111111111111111', 'tok-owner-2222222222222222'].forEach((t, i) => assert.ok(post({ op: 'pushToken', token: [mary, owner][i], fcm: t, device: 'Android' }).ok));
assert.ok(post({ op: 'pushToken', token: owner, fcm: 'tok-owner-2222222222222222', device: 'Android' }).ok, 'the same phone again: one row');
const tab = () => gas.ss.getSheetByName('_push').getRange(2, 1, gas.ss.getSheetByName('_push').getLastRow() - 1, 2).getValues();
assert.deepStrictEqual(tab().map(x => x[1]).sort(), [id('mary'), id('owner')].sort(), 'one row a phone, with its login');

/* ---------- who hears what ---------- */
const to = t => sends().filter(m => m.token === t).map(m => m.data);
fresh();
const pay = rec('E', id('owner'), { cur: 'USD', amount: 1250.5, paidTo: 'Sample Hardware', reason: 'Cement', at: '2026-11-01T10:00' });
const ask = rec('Q', id('owner'), { to: id('mary'), text: 'Which site was the $1,250.50 for?', about: { k: 'E', id: pay.id, what: 'Payment of $1,250.50 to Sample Hardware, 1 Nov 2026' } });
sync(owner, [pay, ask]);
assert.deepStrictEqual(to('tok-mary-11111111111111111'), [{ title: 'A question for you', body: 'Owner asked you a question about a payment', tag: 'q', url: '/?bell=1' }], 'Mary hears she was asked — without the amount or the text');
assert.deepStrictEqual(to('tok-owner-2222222222222222'), [], 'the one who asked does not');
fresh();
sync(mary, [rec('Q', id('mary'), { re: ask.id, text: 'Gudele block 3' })]);
assert.deepStrictEqual(to('tok-owner-2222222222222222').map(d => [d.title, d.body]), [['An answer', 'Mary answered']], 'her answer reaches the admin who asked');
assert.deepStrictEqual(to('tok-mary-11111111111111111'), [], 'not Mary herself');
fresh();
const ch = rec('C', id('mary'), { kind: 'E', target: pay.id, before: { reason: 'Cement' }, after: { reason: 'Cement 42.5' }, text: 'Reason', by: 'Mary', at: '2026-11-03T10:00', status: 'waiting' });
sync(mary, [ch]);
assert.deepStrictEqual(to('tok-owner-2222222222222222').map(d => [d.title, d.body, d.tag]), [['Waiting for your approval', '1 change or price is waiting for you.', 'approvals']], 'a change waiting: the admins, with how many');
fresh();
const stored = sync(owner).pull.find(p => p.id === ch.id);
sync(owner, [{ ...stored, u: Date.now() + 999, d: { ...stored.d, status: 'approved', decidedBy: 'Owner', decidedAt: stamp() } }]);
assert.deepStrictEqual(to('tok-mary-11111111111111111').map(d => d.title), ['Your change was approved'], 'the decision reaches the one who asked');
fresh();
sync(store, [rec('Q', id('store1'), { to: 'admins', text: 'The store roof leaks' })]);
assert.deepStrictEqual([to('tok-owner-2222222222222222').map(d => d.body), to('tok-mary-11111111111111111')], [['Store One asked you a question'], []], 'staff asking the admins: the admins only');

fresh();
const dayCount = gas.props.PUSH_COUNT; // this check leaves the day's counts as they were
sync(owner, [rec('Q', id('owner'), { to: id('mary'), text: 'These three?', about: [{ k: 'E', id: pay.id, what: 'a' }, { k: 'E', id: 'E-T-9998', what: 'b' }, { k: 'I', id: 'I-T-9999', what: 'c' }] })]);
assert.deepStrictEqual(to('tok-mary-11111111111111111').map(d => d.body), ['Owner asked you a question about 3 entries'], 'several transactions: how many, not what');
fresh();
sync(owner, [rec('Q', id('owner'), { to: id('mary'), text: 'Change the dates', fix: 'date', about: [{ k: 'E', id: pay.id, what: 'a' }, { k: 'E', id: 'E-T-9998', what: 'b' }] })]);
assert.deepStrictEqual(to('tok-mary-11111111111111111').map(d => [d.title, d.body]), [['Please fix', 'Owner asked you to fix 2 entries (wrong date)']], 'a fix says what kind, never amounts');
gas.props.PUSH_COUNT = dayCount;

/* ---------- never at night; at most 6 a day ---------- */
fresh();
gas.clock.hour = 22;
sync(owner, [rec('Q', id('owner'), { to: id('mary'), text: 'Late question' })]);
assert.deepStrictEqual(sends(), [], 'nothing between 9 pm and 7 am');
gas.clock.hour = 6;
sync(owner, [rec('Q', id('owner'), { to: id('mary'), text: 'Early question' })]);
assert.deepStrictEqual(sends(), [], 'nor before 7');
gas.clock.hour = 10;
fresh();
for (let i = 0; i < 8; i += 1) sync(owner, [rec('Q', id('owner'), { to: id('mary'), text: `Question ${i}` })]);
assert.strictEqual(to('tok-mary-11111111111111111').length, 4, 'Mary had 2 today already: 4 more, then no more (6 a day)');

/* ---------- a test from Settings; phones that left ---------- */
fresh();
assert.deepStrictEqual(post({ op: 'pushTest', token: mary }), { ok: true, sent: 1, phones: 1 }, 'a test reaches her phone even past the day\'s limit');
assert.match(post({ op: 'pushTest', token: store }).error, /^No phone of yours is registered yet/, 'someone with no phone registered is told so');
const usual2 = gas.fetchReply.fn;
gas.fetchReply.fn = req => (/messages:send$/.test(req.url) ? [403, { error: { code: 403, message: 'Firebase Cloud Messaging API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED' } }] : usual2(req));
assert.deepStrictEqual(post({ op: 'pushTest', token: mary }), { ok: false, error: 'Google did not deliver it: Firebase Cloud Messaging API has not been used in project 123 before or it is disabled.' }, 'Google refusing is reported in its own words, not as "no phone registered" (owner, 9 Nov 2026)');
assert.ok(tab().some(x => x[0] === 'tok-mary-11111111111111111'), 'and her phone is kept: it was Google, not the phone');
gas.fetchReply.fn = usual2;
let st = post({ op: 'pushStatus', token: mary });
assert.deepStrictEqual([st.set, st.mine.map(m => m.device), st.all, st.zone], [true, ['Android'], undefined, 'Africa/Juba'], 'the status: on, her phones, not the company count (admins only), Juba time');
st = post({ op: 'pushStatus', token: owner });
assert.deepStrictEqual([st.mine.length, st.all, st.quiet], [1, 2, false], 'an admin sees how many phones the company has; 10 am is not quiet');
gas.clock.hour = 23;
assert.strictEqual(post({ op: 'pushStatus', token: owner }).quiet, true, '11 pm by the sheet\'s clock is quiet');
gas.clock.hour = 10;
assert.strictEqual(post({ op: 'pushStatus', fcm: 'x' }).ok, false, 'only someone signed in asks');
post({ op: 'pushToken', token: owner, fcm: 'gone-owner-333333333333333', device: 'Old phone' });
fresh();
post({ op: 'pushTest', token: owner });
assert.ok(!tab().some(x => String(x[0]).startsWith('gone')), 'a phone Google no longer knows is forgotten');
assert.ok(tab().some(x => x[0] === 'tok-owner-2222222222222222'), 'the others stay');

/* ---------- the morning ---------- */
fresh();
gas.morningEmail();
assert.deepStrictEqual(to('tok-owner-2222222222222222').map(d => [d.title, /^\d+ things? to see to today/.test(d.body), d.tag]), [['Good morning', true, 'morning']], 'admins get one morning line with how many things');
assert.deepStrictEqual(to('tok-mary-11111111111111111'), [], 'office managers do not');

/* ---------- a closed login gets nothing ---------- */
const m = post({ op: 'users', token: owner }).users.find(u => u.username === 'mary');
post({ op: 'saveUser', token: owner, user: { ...m, active: false } });
fresh();
gas.props.PUSH_COUNT = '{}';
sync(owner, [rec('Q', id('owner'), { to: id('mary'), text: 'Still there?' })]);
assert.deepStrictEqual(to('tok-mary-11111111111111111'), [], "a closed login's phone hears nothing");

console.log('Phone notifications: all checks passed');
