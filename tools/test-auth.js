// Logins and roles: runs the real apps-script/Code.gs on fake Google services.
// Usage: node tools/test-auth.js
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadGas } = require('./fake-gas');

const code = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
const gas = loadGas(code);
gas.setup();
const key = gas.props.KEY;
const post = body => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const get = () => JSON.parse(gas.doGet().getContent());
const tab = name => gas.ss.getSheetByName(name);

// the company as it is today: settings with the company password (hashed the way the app does it)
const appHash = (salt, pw) => crypto.createHash('sha256').update(salt + '|' + pw).digest('hex');
const settings = { id: 'settings', k: 'S', u: 1, d: { company: 'Test Builders', pass: { salt: 'abc', hash: appHash('abc', 'company-pw') } } };
const exp = (id, u, extra = {}) => ({ id, k: 'E', u, d: { id, cur: 'USD', amount: 50, paidTo: 'Shop', reason: 'Nails', location: '', project: '', mode: 'Cash', at: '2026-10-08T09:00', by: 'Someone', createdAt: '2026-10-08T09:00:00', ...extra } });
const old = exp('E-OLD-0001', 2);
const income = { id: 'R-OLD-0001', k: 'R', u: 3, d: { id: 'R-OLD-0001', cur: 'USD', amount: 900, project: '', mode: 'Bank', note: '', at: '2026-10-08T10:00', by: 'Owner', createdAt: '2026-10-08T10:00:00' } };
let res = post({ key, since: 0, push: [settings, old, income] });
assert.ok(res.ok, res.error);

/* ---------- before logins: everything works exactly as before ---------- */
assert.deepStrictEqual([get().version, get().logins, get().required], [3, false, false]);
res = post({ key, since: 0, push: [] });
assert.strictEqual(res.pull.length, 3, 'company code still gives everything');
assert.deepStrictEqual([res.logins, res.me, res.refused], [false, null, []]);
assert.strictEqual(post({ op: 'login', username: 'owner', password: 'whatever1' }).ok, false, 'no logins yet');

/* ---------- the owner sets up logins with today's company password ---------- */
const setup = (pw, extra = {}) => post({ op: 'setup', key, password: pw, name: 'Owner', username: 'Owner', newPassword: 'owner-pass', ...extra });
assert.strictEqual(setup('wrong').ok, false, 'wrong company password');
assert.strictEqual(post({ op: 'setup', key: 'WRONGKEY', password: 'company-pw', name: 'Owner', username: 'owner', newPassword: 'owner-pass' }).ok, false, 'wrong company code');
assert.strictEqual(setup('company-pw', { newPassword: '123' }).ok, false, 'password too short');
res = setup('company-pw');
assert.ok(res.ok, res.error);
assert.deepStrictEqual([res.me.username, res.me.role, res.me.name], ['owner', 'admin', 'Owner']);
assert.ok(res.me.lastLogin > 0, 'setting up counts as signing in');
const ownerTok = res.token;
assert.match(ownerTok, /^[0-9a-f]{64}$/);
assert.strictEqual(setup('company-pw', { username: 'other' }).ok, false, 'setup only works once');
assert.strictEqual(get().logins, true);
assert.strictEqual(post({ key, since: 0, push: [] }).logins, true, 'phones without a login learn that logins exist');
const ownerId = res.me.id;

// passwords and tokens are stored only as hashes, in hidden tabs
assert.ok(tab('_users').hidden && tab('_sessions').hidden);
const sheetText = JSON.stringify(gas.dump());
assert.ok(!sheetText.includes('owner-pass') && !sheetText.includes(ownerTok), 'no plain passwords or tokens in the sheet');

/* ---------- admins add logins ---------- */
const saveUser = (tok, user) => post({ op: 'saveUser', token: tok, user });
res = saveUser(ownerTok, { name: 'Managing Director', username: 'md', role: 'admin', password: 'md-pass1' });
assert.ok(res.ok, res.error);
assert.ok(saveUser(ownerTok, { name: 'Mary', username: 'mary', role: 'manager', password: 'mary-pass' }).ok);
res = saveUser(ownerTok, { name: 'Store Keeper', username: 'store1', role: 'store', password: 'store-pass' });
assert.ok(res.ok, res.error);
assert.deepStrictEqual(res.users.map(u => u.username).sort(), ['mary', 'md', 'owner', 'store1']);
assert.ok(res.users.every(u => !('hash' in u) && !('salt' in u)), 'password hashes never leave the sheet');
assert.strictEqual(saveUser(ownerTok, { name: 'X', username: 'Mary', role: 'store', password: 'xxxxxx' }).ok, false, 'usernames are unique (any case)');
assert.strictEqual(saveUser(ownerTok, { name: 'X', username: 'x y', role: 'store', password: 'xxxxxx' }).ok, false, 'no spaces in usernames');
assert.strictEqual(saveUser(ownerTok, { name: 'X', username: 'boss', role: 'king', password: 'xxxxxx' }).ok, false, 'unknown role');
assert.strictEqual(saveUser(ownerTok, { name: 'X', username: 'newbie', role: 'store' }).ok, false, 'a new login needs a password');

const login = (username, password) => post({ op: 'login', username, password, device: 'TEST' });
const maryTok = login('mary', 'mary-pass').token;
const storeRes = login(' STORE1 ', 'store-pass');
assert.ok(storeRes.ok, 'usernames ignore case and spaces');
const storeTok = storeRes.token, storeId = storeRes.me.id;
const mdTok = login('md', 'md-pass1').token;
assert.ok(maryTok && mdTok);
assert.strictEqual(saveUser(maryTok, { name: 'Y', username: 'yy', role: 'admin', password: 'yyyyyy' }).ok, false, 'only admins give logins');
assert.strictEqual(saveUser(storeTok, { name: 'Y', username: 'yy', role: 'admin', password: 'yyyyyy' }).ok, false);
assert.ok(saveUser(mdTok, { name: 'Driver Test', username: 'driver', role: 'store', password: 'drive-pass' }).ok, 'the second admin can give logins too');
assert.strictEqual(post({ op: 'users', token: maryTok }).ok, false, 'only admins see the login list');

/* ---------- wrong passwords lock the login for a while ---------- */
assert.strictEqual(login('mary', 'nope').error, 'Wrong username or password.');
assert.strictEqual(login('nobody', 'nope').error, 'Wrong username or password.', 'same message for unknown names');
for (let i = 0; i < 4; i++) login('mary', 'nope');
res = login('mary', 'mary-pass');
assert.strictEqual(res.ok, false, 'locked after 5 wrong tries');
assert.match(res.error, /15 minutes/);
// an admin resetting the password unlocks it
const maryId = post({ op: 'users', token: ownerTok }).users.find(u => u.username === 'mary').id;
assert.ok(saveUser(ownerTok, { id: maryId, password: 'mary-new1' }).ok);
assert.strictEqual(post({ token: maryTok, since: 0, push: [] }).code, 'LOGIN', 'a reset signs the person out everywhere');
const mary2 = login('mary', 'mary-new1').token;
assert.ok(mary2);

/* ---------- store keeper: own entries only, no company money ---------- */
const mine = exp('E-SK1-0001', 10, { uid: storeId, by: 'Store Keeper' });
const logMine = { id: 'L-SK1-a', k: 'L', u: 10, d: { lid: 'L-SK1-a', at: '2026-10-08T11:00:00', action: 'Note', id: 'E-SK1-0001', text: 'x', by: 'Store Keeper', uid: storeId } };
res = post({ token: storeTok, since: 0, push: [mine, logMine] });
assert.ok(res.ok, res.error);
assert.deepStrictEqual(res.refused, []);
assert.deepStrictEqual(res.pull.map(p => p.id).sort(), ['E-SK1-0001', 'L-SK1-a', 'settings'], 'only own entries + the company name');
assert.deepStrictEqual(res.pull.find(p => p.k === 'S').d, { company: 'Test Builders' }, 'no company password');
assert.strictEqual(res.me.role, 'store');
res = post({ token: storeTok, since: 0, push: [
  exp('E-SK1-0002', 11, { uid: ownerId }),                 // pretending to be someone else
  { ...old, u: 12, d: { ...old.d, amount: 1 } },            // changing someone else's entry
  { ...settings, u: 13, d: { ...settings.d, company: 'Hacked' } },
  { ...income, u: 14, d: { ...income.d, uid: storeId } },   // money received is not theirs to add
  { ...mine, u: 15, d: { ...mine.d, deleted: '2026-10-08T12:00:00' } }, // deleting
] });
assert.deepStrictEqual(res.refused.sort(), ['E-OLD-0001', 'E-SK1-0002', 'R-OLD-0001', 'settings', 'E-SK1-0001'].sort());
res = post({ key, since: 0, push: [] });
assert.strictEqual(res.pull.find(p => p.id === 'E-OLD-0001').d.amount, 50, 'nothing refused was saved');
assert.strictEqual(res.pull.find(p => p.k === 'S').d.company, 'Test Builders');
assert.ok(post({ token: storeTok, since: 0, push: [{ ...mine, u: 16, d: { ...mine.d, amount: 55 } }] }).refused.length === 0, 'may correct own entry');

/* ---------- office manager: sees everything; her edits wait for an admin's approval ---------- */
res = post({ token: mary2, since: 0, push: [] });
assert.deepStrictEqual(res.pull.map(p => p.id).sort(), ['E-OLD-0001', 'E-SK1-0001', 'L-SK1-a', 'R-OLD-0001', 'settings']);
assert.ok(!res.pull.find(p => p.k === 'S').d.pass, 'no company password for non-admins');
res = post({ token: mary2, since: 0, push: [{ ...old, u: 20, d: { ...old.d, amount: 60, editedBy: 'Mary' } }, { ...income, u: 21, d: { ...income.d, deleted: 'x' } }] });
assert.deepStrictEqual(res.refused.sort(), ['E-OLD-0001', 'R-OLD-0001'], 'no direct edits, no deletes');
const ask = { id: 'C-AG1-0001', k: 'C', u: 22, d: { id: 'C-AG1-0001', kind: 'E', target: 'E-OLD-0001', before: { amount: 50 }, after: { amount: 60 }, text: 'Amount: $50 → $60', by: 'Mary', at: '2026-10-08T12:00', createdAt: '2026-10-08T12:00:00', status: 'waiting', uid: maryId } };
const maryNew = exp('E-AG1-0001', 23, { uid: maryId, by: 'Mary' });
res = post({ token: mary2, since: 0, push: [ask, maryNew] });
assert.deepStrictEqual(res.refused, [], 'she asks for the change and adds new entries directly');
assert.deepStrictEqual(post({ token: mary2, since: 0, push: [maryNew] }).refused, [], 'sending the same entry twice (a lost reply) is not an edit');
res = post({ token: mary2, since: 0, push: [{ ...ask, u: 24, d: { ...ask.d, status: 'approved' } }, { id: 'C-AG1-0002', k: 'C', u: 25, d: { ...ask.d, id: 'C-AG1-0002', status: 'approved' } }] });
assert.deepStrictEqual(res.refused.sort(), ['C-AG1-0001', 'C-AG1-0002'], 'only admins approve');
assert.strictEqual(post({ key, since: 0, push: [] }).pull.find(p => p.id === 'E-OLD-0001').d.amount, 50, 'the entry keeps its old amount until approved');
res = post({ token: storeTok, since: 0, push: [{ ...ask, id: 'C-SK1-0001', u: 26, d: { ...ask.d, id: 'C-SK1-0001', uid: storeId } }] });
assert.deepStrictEqual(res.refused, ['C-SK1-0001'], 'store keepers do not ask for changes');
assert.ok(!res.pull.some(p => p.k === 'C'), "store keepers don't see change requests");

/* ---------- admins: everything ---------- */
res = post({ token: mdTok, since: 0, push: [
  { ...old, u: 29, d: { ...old.d, amount: 60, editedBy: 'Mary (approved by MD)' } },
  { ...ask, u: 29, d: { ...ask.d, status: 'approved', decidedBy: 'MD' } },
  { ...income, u: 30, d: { ...income.d, deleted: '2026-10-08T13:00:00', deletedBy: 'MD' } },
] });
assert.deepStrictEqual(res.refused, []);
assert.strictEqual(res.pull.find(p => p.id === 'E-OLD-0001').d.amount, 60, 'approved: the change is applied');
assert.ok(res.pull.find(p => p.k === 'S').d.pass.hash, 'admins get the full settings');

/* ---------- the last admin can never be removed ---------- */
const mdId = post({ op: 'users', token: ownerTok }).users.find(u => u.username === 'md').id;
assert.ok(saveUser(ownerTok, { id: mdId, active: false }).ok, 'one admin can disable another');
assert.strictEqual(post({ token: mdTok, since: 0, push: [] }).code, 'LOGIN', 'disabled: signed out at the next sync');
assert.strictEqual(login('md', 'md-pass1').ok, false, 'disabled: cannot sign in');
assert.strictEqual(saveUser(ownerTok, { id: ownerId, role: 'manager' }).ok, false, 'cannot demote the last admin');
assert.strictEqual(saveUser(ownerTok, { id: ownerId, active: false }).ok, false, 'cannot disable the last admin');
assert.ok(saveUser(ownerTok, { id: mdId, active: true }).ok);

/* ---------- own password ---------- */
assert.strictEqual(post({ op: 'password', token: storeTok, old: 'bad', password: 'store-new1' }).ok, false);
assert.ok(post({ op: 'password', token: storeTok, old: 'store-pass', password: 'store-new1' }).ok);
assert.strictEqual(login('store1', 'store-pass').ok, false);
assert.ok(login('store1', 'store-new1').ok);

/* ---------- require logins: the company code stops working ---------- */
assert.strictEqual(post({ op: 'require', token: mary2, on: true }).ok, false, 'only admins');
assert.ok(post({ op: 'require', token: ownerTok, on: true }).ok);
assert.strictEqual(get().required, true);
res = post({ key, since: 0, push: [] });
assert.deepStrictEqual([res.ok, res.code], [false, 'LOGIN'], 'old invite links stop working');
assert.ok(post({ token: ownerTok, since: 0, push: [] }).ok, 'signed-in phones keep syncing');
assert.ok(post({ op: 'require', token: ownerTok, on: false }).ok);
assert.ok(post({ key, since: 0, push: [] }).ok, 'switching it off brings the company code back');

/* ---------- sign out, and sessions unused for 30 days end ---------- */
assert.ok(post({ op: 'logout', token: mary2 }).ok);
assert.strictEqual(post({ token: mary2, since: 0, push: [] }).code, 'LOGIN');
const sessions = tab('_sessions').grid;
const ownerRow = sessions.findIndex((r, i) => i > 0 && r[1] === ownerId);
sessions[ownerRow][3] = Date.now() - 31 * 864e5;
assert.strictEqual(post({ token: ownerTok, since: 0, push: [] }).code, 'LOGIN', 'expired after 30 days unused');

console.log('Logins: all checks passed');
