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
assert.deepStrictEqual([get().version, get().logins, get().required], [9, false, false]);
res = post({ key, since: 0, push: [] });
assert.strictEqual(res.pull.length, 3, 'company code still gives everything');
assert.deepStrictEqual([res.logins, res.me, res.refused], [false, null, []]);
assert.strictEqual(post({ op: 'login', username: 'owner', password: 'whatever1' }).ok, false, 'no logins yet');

/* ---------- the owner sets up logins with a one-time code that only appears inside the Google Sheet ---------- */
const setupCode = gas.props.SETUP_CODE;
assert.match(setupCode, /^[0-9A-F]{8}$/, 'a sync without logins prepares the setup code');
const readMe = () => tab('Read me').grid.map(r => r[0]).join('\n');
assert.ok(readMe().includes(setupCode), 'it is written in the Read me tab, which only the sheet owner can open');
assert.ok(!JSON.stringify(post({ key, since: 0, push: [] })).includes(setupCode) && !JSON.stringify(get()).includes(setupCode), 'and is never sent to phones');
const setup = (code, extra = {}) => post({ op: 'setup', key, setupCode: code, name: 'Owner', username: 'Owner', newPassword: 'owner-pass', ...extra });
// someone with only the company code changes the company password, then tries to become the first admin
post({ key, since: 0, push: [{ ...settings, u: 1.5, d: { ...settings.d, pass: { salt: 'x', hash: appHash('x', 'attacker') } } }] });
assert.strictEqual(post({ op: 'setup', key, password: 'attacker', name: 'Eve', username: 'eve', newPassword: 'eve-pass1' }).ok, false, 'the company password is not enough');
assert.strictEqual(setup('WRONG123').ok, false, 'wrong setup code');
assert.strictEqual(post({ op: 'setup', key: 'WRONGKEY', setupCode, name: 'Owner', username: 'owner', newPassword: 'owner-pass' }).ok, false, 'wrong company code');
assert.strictEqual(setup(setupCode, { newPassword: 'short7c' }).ok, false, 'passwords need 8 characters');
res = setup(setupCode.toLowerCase());
assert.ok(res.ok, res.error);
assert.ok(!gas.props.SETUP_CODE && !readMe().includes(setupCode), 'the setup code is used up');
assert.deepStrictEqual([res.me.username, res.me.role, res.me.name], ['owner', 'admin', 'Owner']);
assert.ok(res.me.lastLogin > 0, 'setting up counts as signing in');
const ownerTok = res.token;
assert.match(ownerTok, /^[0-9a-f]{64}$/);
assert.strictEqual(setup(setupCode, { username: 'other' }).ok, false, 'setup only works once');
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
assert.strictEqual(saveUser(ownerTok, { name: 'X', username: 'Mary', role: 'store', password: 'xxxxxxxx' }).ok, false, 'usernames are unique (any case)');
assert.strictEqual(saveUser(ownerTok, { name: 'X', username: 'x y', role: 'store', password: 'xxxxxxxx' }).ok, false, 'no spaces in usernames');
assert.strictEqual(saveUser(ownerTok, { name: 'X', username: 'boss', role: 'king', password: 'xxxxxxxx' }).ok, false, 'unknown role');
assert.strictEqual(saveUser(ownerTok, { name: 'X', username: 'newbie', role: 'store' }).ok, false, 'a new login needs a password');

const login = (username, password) => post({ op: 'login', username, password, device: 'TEST' });
const maryTok = login('mary', 'mary-pass').token;
const storeRes = login(' STORE1 ', 'store-pass');
assert.ok(storeRes.ok, 'usernames ignore case and spaces');
const storeTok = storeRes.token, storeId = storeRes.me.id;
const mdTok = login('md', 'md-pass1').token;
const mdId = post({ op: 'users', token: ownerTok }).users.find(u => u.username === 'md').id;
assert.ok(maryTok && mdTok);
assert.strictEqual(saveUser(maryTok, { name: 'Y', username: 'yy', role: 'admin', password: 'yyyyyyyy' }).ok, false, 'only admins give logins');
assert.strictEqual(saveUser(storeTok, { name: 'Y', username: 'yy', role: 'admin', password: 'yyyyyyyy' }).ok, false);
assert.ok(saveUser(mdTok, { name: 'Driver Test', username: 'driver', role: 'store', password: 'drive-pass' }).ok, 'the second admin can give logins too');
assert.strictEqual(post({ op: 'users', token: maryTok }).ok, false, 'only admins see the login list');

/* ---------- wrong passwords lock the login for a while ---------- */
const WRONG = 'Wrong username or password. After 5 wrong tries, wait 15 minutes.';
assert.strictEqual(login('mary', 'nope').error, WRONG);
assert.strictEqual(login('nobody', 'nope').error, WRONG, 'same message for unknown names');
for (let i = 0; i < 4; i++) login('mary', 'nope');
res = login('mary', 'mary-pass');
assert.deepStrictEqual([res.ok, res.error], [false, WRONG], 'locked after 5 wrong tries — and the message gives nothing away');
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
assert.deepStrictEqual(post({ token: storeTok, since: 0, push: [{ ...mine, u: 16, d: { ...mine.d, amount: 55 } }] }).refused, ['E-SK1-0001'], 'corrections go through the office');

/* ---------- what the security review found (8 Oct 2026): each one must stay closed ---------- */
const sk = (id, u, extra = {}) => exp(id, u, { uid: storeId, ...extra });
// a record without a date (or with junk fields) is refused, so it can't break the tabs on every later change
res = post({ token: storeTok, since: 0, push: [{ id: 'E-SK1-BAD', k: 'E', u: 50, d: { id: 'E-SK1-BAD', uid: storeId } }, { ...sk('E-SK1-BAD2', 50), d: { ...sk('E-SK1-BAD2', 50).d, amount: '5' } }] });
assert.deepStrictEqual(res.refused.sort(), ['E-SK1-BAD', 'E-SK1-BAD2']);
assert.ok(post({ key, since: 0, push: [exp('E-OLD-0002', 51)] }).ok, 'the sheet keeps working');
// a record never changes kind (an expense turned into a log line would drop out of the totals)
assert.deepStrictEqual(post({ token: storeTok, since: 0, push: [{ id: 'E-SK1-0001', k: 'L', u: 52, d: { lid: 'E-SK1-0001', text: 'x', at: '2026-10-08T12:00:00', uid: storeId } }] }).refused, ['E-SK1-0001']);
// ids like "constructor" can't crash the merge
assert.deepStrictEqual(post({ token: storeTok, since: 0, push: [sk('constructor', 53, { id: 'constructor' }), sk('__proto__', 53, { id: '__proto__' })] }).ok, true);
// non-admins can't sign entries as someone else
post({ token: storeTok, since: 0, push: [sk('E-SK1-0010', 54, { by: 'Owner' })] });
assert.strictEqual(post({ key, since: 0, push: [] }).pull.find(p => p.id === 'E-SK1-0010').d.by, 'Store Keeper', 'author comes from the login');
// a copy stamped far in the future can't block an admin's later correction
post({ token: storeTok, since: 0, push: [sk('E-SK1-0011', 9e15)] });
post({ token: ownerTok, since: 0, push: [{ ...sk('E-SK1-0011', Date.now() + 1000), d: { ...sk('E-SK1-0011', 0).d, amount: 1 } }] });
assert.strictEqual(post({ key, since: 0, push: [] }).pull.find(p => p.id === 'E-SK1-0011').d.amount, 1);
// at most 200 records at once, and no giant records, from non-admins
res = post({ token: storeTok, since: 0, push: Array.from({ length: 205 }, (_, i) => sk('E-SK1-M' + i, 60)) });
assert.strictEqual(res.refused.length, 5, 'only the first 200 are taken; the app sends the rest next time');
assert.deepStrictEqual(post({ token: storeTok, since: 0, push: [sk('E-SK1-BIG', 61, { reason: 'x'.repeat(6000) })] }).refused, ['E-SK1-BIG']);

/* ---------- record ids are plain letters, digits and dashes (they end up inside the app's pages) ---------- */
const evil = 'E-X"><img src=x onerror=alert(1)>';
res = post({ token: storeTok, since: 0, push: [exp(evil, 40, { uid: storeId }), { ...exp('E-SK1-0009', 41, { uid: storeId }), d: { ...exp('E-SK1-0009', 41, { uid: storeId }).d, id: 'E-OTHER-1' } }] });
assert.deepStrictEqual(res.refused.sort(), ['E-SK1-0009', evil].sort(), 'odd ids, or an id that differs inside the record, are refused');
assert.ok(!post({ key, since: 0, push: [] }).pull.some(p => p.id === evil || p.id === 'E-SK1-0009'), 'and never stored');

/* ---------- office manager: sees everything; her edits wait for an admin's approval ---------- */
res = post({ token: mary2, since: 0, push: [] });
assert.deepStrictEqual(res.pull.map(p => p.id).sort(), post({ key, since: 0, push: [] }).pull.map(p => p.id).sort(), 'she sees every record');
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
// a change request may only touch the fields an edit can change, and must point at an existing entry of its kind
res = post({ token: mary2, since: 0, push: [
  { id: 'C-AG1-0003', k: 'C', u: 26, d: { ...ask.d, id: 'C-AG1-0003', after: { amount: 0, deleted: 'x', id: 'E-OTHER' } } },
  { id: 'C-AG1-0004', k: 'C', u: 26, d: { ...ask.d, id: 'C-AG1-0004', target: 'E-NOPE-0001' } },
  { id: 'C-AG1-0005', k: 'C', u: 26, d: { ...ask.d, id: 'C-AG1-0005', kind: 'R' } },
  { id: 'C-AG1-0006', k: 'C', u: 26, d: { ...ask.d, id: 'C-AG1-0006', text: undefined } },
] });
assert.deepStrictEqual(res.refused.sort(), ['C-AG1-0003', 'C-AG1-0004', 'C-AG1-0005', 'C-AG1-0006']);
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
assert.ok(saveUser(ownerTok, { id: mdId, active: false }).ok, 'one admin can disable another');
assert.strictEqual(post({ token: mdTok, since: 0, push: [] }).code, 'LOGIN', 'disabled: signed out at the next sync');
assert.strictEqual(login('md', 'md-pass1').ok, false, 'disabled: cannot sign in');
assert.strictEqual(saveUser(ownerTok, { id: ownerId, role: 'manager' }).ok, false, 'cannot demote the last admin');
assert.strictEqual(saveUser(ownerTok, { id: ownerId, active: false }).ok, false, 'cannot disable the last admin');
assert.ok(saveUser(ownerTok, { id: mdId, active: true }).ok);

/* ---------- own password: wrong guesses count towards the lock too ---------- */
assert.strictEqual(post({ op: 'password', token: storeTok, old: 'bad', password: 'store-new1' }).ok, false);
const driverTok = login('driver', 'drive-pass').token;
for (let i = 0; i < 5; i++) post({ op: 'password', token: driverTok, old: 'guess' + i, password: 'whatever1' });
assert.strictEqual(post({ op: 'password', token: driverTok, old: 'drive-pass', password: 'whatever1' }).ok, false, 'locked after 5 wrong guesses');
assert.strictEqual(login('driver', 'drive-pass').ok, false);
// at most 10 signed-in phones per person
for (let i = 0; i < 12; i++) login('md', 'md-pass1');
assert.ok(tab('_sessions').grid.filter((r, i) => i > 0 && r[1] === mdId).length <= 10);
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

// a company name that looks like a formula stays plain text in the readable tabs
post({ key, since: 0, push: [{ ...settings, u: Date.now(), d: { ...settings.d, company: '=IMPORTXML("http://x","//a")' } }] });
assert.strictEqual(tab('Summary').grid[0][0], '\'=IMPORTXML("http://x","//a")');

console.log('Logins: all checks passed');
