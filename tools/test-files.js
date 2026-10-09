// Employees, files (photos/PDFs in Drive) and the new kinds of approval: runs the real apps-script/Code.gs
// on fake Google services. Usage: node tools/test-files.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadGas } = require('./fake-gas');

const gas = loadGas(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'));
gas.setup();
const key = gas.props.KEY;
const post = body => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const rows = name => { const sh = gas.ss.getSheetByName(name); return sh.getRange(1, 1, sh.getLastRow(), 20).getValues(); };

post({ key, since: 0, push: [{ id: 'settings', k: 'S', u: 1, d: { company: 'Test Builders', pass: { salt: 's', hash: 'h' } } }] });
const owner = post({ op: 'setup', key, setupCode: gas.props.SETUP_CODE, name: 'Owner', username: 'owner', newPassword: 'owner-pass' }).token;
post({ op: 'saveUser', token: owner, user: { name: 'Mary', username: 'mary', role: 'manager', password: 'mary-pass1' } });
post({ op: 'saveUser', token: owner, user: { name: 'Store One', username: 'store1', role: 'store', password: 'store-pass1' } });
const m = post({ op: 'login', username: 'mary', password: 'mary-pass1' }), s = post({ op: 'login', username: 'store1', password: 'store-pass1' });
const exp = (id, u, uid, extra = {}) => ({ id, k: 'E', u, d: { id, cur: 'USD', amount: 50, paidTo: 'Shop', reason: 'Nails', at: '2026-10-08T09:00', uid, ...extra } });
const worker = (id, u, uid, extra = {}) => ({ id, k: 'W', u, d: { id, name: 'John', wage: 300, cur: 'USD', start: '2026-08-01', status: 'active', uid, ...extra } });

/* ---------- employees: admins and the office manager add them; store keepers never see them ---------- */
let res = post({ token: m.token, since: 0, push: [worker('W-AG1-0001', 10, m.me.id)] });
assert.deepStrictEqual(res.refused, [], 'the office manager registers an employee');
assert.deepStrictEqual(post({ token: s.token, since: 0, push: [worker('W-SK1-0001', 11, s.me.id)] }).refused, ['W-SK1-0001'], 'store keepers do not');
assert.ok(!post({ token: s.token, since: 0, push: [] }).pull.some(p => p.k === 'W'), 'store keepers never receive employees');
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [worker('W-AG1-0002', 12, m.me.id, { wage: -5 }), worker('W-AG1-0003', 12, m.me.id, { start: '1 Aug' })] }).refused.sort(), ['W-AG1-0002', 'W-AG1-0003'], 'wage and start date are checked');
// added on an old date: "salary cleared up to" is a date (the office manager may correct it through an edit request)
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [worker('W-AG1-0004', 12, m.me.id, { clearedTo: '2026-09-30' }), worker('W-AG1-0005', 12, m.me.id, { clearedTo: 'Sept' })] }).refused, ['W-AG1-0005']);

/* ---------- salary and advance payments are expenses that name the employee ---------- */
res = post({ token: m.token, since: 0, push: [exp('E-AG1-0001', 13, m.me.id, { worker: 'W-AG1-0001', pay: 'salary', month: '2026-09', daysOff: 2, cur: 'SSP', amount: 1200000, rate: 4500 })] });
assert.deepStrictEqual(res.refused, []);
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [exp('E-AG1-0002', 14, m.me.id, { pay: 'bonus' }), exp('E-AG1-0003', 14, m.me.id, { rate: -1 }), exp('E-AG1-0004', 14, m.me.id, { daysOff: 40 })] }).refused.sort(), ['E-AG1-0002', 'E-AG1-0003', 'E-AG1-0004']);

/* ---------- the office manager asks for deletes, leavers and big advances; only admins decide ---------- */
const ask = (id, extra) => ({ id, k: 'C', u: 20, d: { id, kind: 'E', target: 'E-AG1-0001', before: {}, after: {}, text: 'x', at: '2026-10-08T12:00', createdAt: '2026-10-08T12:00:00', status: 'waiting', uid: m.me.id, ...extra } });
res = post({ token: m.token, since: 0, push: [
  ask('C-AG1-0001', { action: 'delete' }),
  ask('C-AG1-0002', { action: 'delete', after: { amount: 1 } }),                                   // a delete changes nothing else
  ask('C-AG1-0003', { action: 'advance', kind: 'W', target: 'W-AG1-0001', after: { amount: 150, cur: 'USD' } }),
  ask('C-AG1-0004', { action: 'advance', kind: 'W', target: 'W-AG1-0001', after: { amount: 150, cur: 'USD', deleted: 'x' } }),
  ask('C-AG1-0005', { kind: 'W', target: 'W-AG1-0001', after: { status: 'left', left: '2026-10-15' } }), // marking someone as left
  ask('C-AG1-0008', { kind: 'W', target: 'W-AG1-0001', after: { clearedTo: '2026-09-30' } }),
  ask('C-AG1-0006', { action: 'pay' }),
] });
assert.deepStrictEqual(res.refused.sort(), ['C-AG1-0002', 'C-AG1-0004', 'C-AG1-0006']);

/* ---------- days not worked: one dated record per day, by admins and the office manager ---------- */
const absent = (id, u, uid, extra = {}) => ({ id, k: 'A', u, d: { id, worker: 'W-AG1-0001', date: '2026-09-03', note: 'Sick', uid, ...extra } });
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [absent('A-AG1-0001', 15, m.me.id), absent('A-AG1-0002', 15, m.me.id, { date: '3 Sep' }), absent('A-AG1-0003', 15, m.me.id, { worker: 'W-NOPE-0001' })] }).refused.sort(), ['A-AG1-0002', 'A-AG1-0003'], 'a real date, for an employee the sheet has');
assert.deepStrictEqual(post({ token: s.token, since: 0, push: [absent('A-SK1-0001', 16, s.me.id)] }).refused, ['A-SK1-0001'], 'store keepers do not record them');
assert.ok(!post({ token: s.token, since: 0, push: [] }).pull.some(p => p.k === 'A'), 'nor receive them');
assert.ok(post({ token: m.token, since: 0, push: [] }).pull.some(p => p.id === 'A-AG1-0001'), 'the office manager does');
// a day recorded by mistake: the office manager asks an admin to delete it
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [ask('C-AG1-0009', { kind: 'A', target: 'A-AG1-0001', action: 'delete' })] }).refused, []);

/* ---------- files: uploaded to Drive, then a file record ties them to an entry ---------- */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64').toString('base64');
const up = post({ op: 'upload', token: s.token, name: 'receipt.png', mime: 'image/png', data: png });
assert.ok(up.ok && /^file[0-9a-f]{32}$/.test(up.fileId), up.error);
assert.strictEqual(post({ op: 'upload', token: s.token, name: 'x.exe', mime: 'application/x-msdownload', data: png }).ok, false, 'only photos and PDFs');
assert.strictEqual(post({ op: 'upload', name: 'x.png', mime: 'image/png', data: png }).ok, false, 'needs a login or the company code');
// once the company has logins, an old invite (company code only) can't send or open files, nor see staff
assert.strictEqual(post({ op: 'upload', key, name: 'x.png', mime: 'image/png', data: png }).code, 'LOGIN', 'company-code phones of a company with logins send no files');
// a file must be what it says it is, and its name follows its type
const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
assert.strictEqual(post({ op: 'upload', token: s.token, name: 'invoice.pdf.exe', mime: 'image/png', data: html }).ok, false, 'not a real picture');
const named = post({ op: 'upload', token: s.token, name: 'invoice.pdf.exe', mime: 'image/png', data: png });
assert.strictEqual(gas.dump().drive.files[named.fileId].name, 'invoice.pdf.png', 'the extension comes from the type');
const folder = gas.dump().drive.folders;
assert.ok(Object.values(folder).some(f => f.name === 'Company app files (do not share)'), 'kept in a private folder');

const file = (id, u, uid, extra) => ({ id, k: 'F', u, d: { id, fileId: up.fileId, name: 'receipt.png', mime: 'image/png', type: 'attachment', uid, ...extra } });
post({ token: s.token, since: 0, push: [exp('E-SK1-0001', 30, s.me.id)] });
res = post({ token: s.token, since: 0, push: [file('F-SK1-0001', 31, s.me.id, { for: 'E-SK1-0001' }), file('F-SK1-0002', 31, s.me.id, { for: 'E-AG1-0001' }), file('F-SK1-0003', 31, s.me.id, { for: 'settings', type: 'letterhead' })] });
assert.deepStrictEqual(res.refused.sort(), ['F-SK1-0002', 'F-SK1-0003'], 'store keepers attach files only to their own entries; never the letterhead');
const upM = post({ op: 'upload', token: m.token, name: 'id.png', mime: 'image/png', data: png });
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [file('F-AG1-0001', 32, m.me.id, { for: 'settings', type: 'letterhead', fileId: upM.fileId }), file('F-AG1-0002', 32, m.me.id, { for: 'W-AG1-0001', type: 'idphoto', fileId: upM.fileId })] }).refused, ['F-AG1-0001'], 'only admins set the letterhead');
// a file record may only name a file this script uploaded — never any other file in the owner's Drive —
// and a non-admin only one they uploaded themselves
gas.dump().drive.files.OWNERPRIVATEFILE0123456789 = { folder: 'root', name: 'plans.pdf', mime: 'application/pdf', b64: Buffer.from('%PDF secret').toString('base64') };
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [file('F-AG1-0009', 34, m.me.id, { for: 'W-AG1-0001', fileId: 'OWNERPRIVATEFILE0123456789' })] }).refused, ['F-AG1-0009'], 'a Drive file the script did not make');
assert.deepStrictEqual(post({ token: owner, since: 0, push: [file('F-OW1-0009', 34, 'x', { for: 'settings', type: 'letterhead', fileId: 'OWNERPRIVATEFILE0123456789' })] }).refused, ['F-OW1-0009'], 'not even from an admin');
assert.deepStrictEqual(post({ token: s.token, since: 0, push: [file('F-SK1-0009', 34, s.me.id, { for: 'E-SK1-0001', fileId: upM.fileId })] }).refused, ['F-SK1-0009'], "someone else's upload");
assert.strictEqual(post({ op: 'file', token: m.token, id: 'F-AG1-0009' }).ok, false);
assert.deepStrictEqual(post({ token: owner, since: 0, push: [file('F-OW1-0001', 33, 'x', { for: 'settings', type: 'letterhead' })] }).refused, []);
// the company stamp works the same way: admins set it (with where its date goes), everyone's slips carry it
const upS = post({ op: 'upload', token: s.token, name: 'stamp.png', mime: 'image/png', data: png });
assert.deepStrictEqual(post({ token: s.token, since: 0, push: [file('F-SK1-0005', 35, s.me.id, { for: 'E-SK1-0001', type: 'stamp', fileId: upS.fileId })] }).refused, ['F-SK1-0005'], 'only admins set the stamp');
const upO = post({ op: 'upload', token: owner, name: 'stamp.png', mime: 'image/png', data: png });
assert.deepStrictEqual(post({ token: owner, since: 0, push: [file('F-OW1-0002', 36, 'x', { for: 'settings', type: 'stamp', fileId: upO.fileId, place: { a: 70, r: 0.75, s: 0.12 } })] }).refused, []);
// a signed final settlement statement is kept with the employee
const upF = post({ op: 'upload', token: m.token, name: 'final.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') });
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [file('F-AG1-0007', 37, m.me.id, { for: 'W-AG1-0001', type: 'statement', mime: 'application/pdf', name: 'final.pdf', fileId: upF.fileId })] }).refused, []);

// reading a file back goes through its record: whoever may see the record may download it
const got = post({ op: 'file', token: s.token, id: 'F-SK1-0001' });
assert.deepStrictEqual([got.ok, got.mime, got.data], [true, 'image/png', png], 'the bytes come back unchanged');
assert.strictEqual(post({ op: 'file', token: s.token, id: 'F-AG1-0002' }).ok, false, "a store keeper can't fetch an employee's ID photo");
assert.ok(post({ op: 'file', token: m.token, id: 'F-AG1-0002' }).ok);
assert.strictEqual(post({ op: 'file', token: m.token, id: 'F-NOPE-1' }).ok, false);
// the letterhead goes to everyone (store keepers make vouchers too), the ID photo still doesn't
const sPull = post({ token: s.token, since: 0, push: [] }).pull.filter(p => p.k === 'F').map(p => p.id).sort();
assert.deepStrictEqual(sPull, ['F-OW1-0001', 'F-OW1-0002', 'F-SK1-0001'], 'a store keeper receives the letterhead, the stamp and their own files only');
assert.ok(post({ op: 'file', token: s.token, id: 'F-OW1-0001' }).ok, 'and can download the letterhead');

// a phone with only the company code gets no employees or files once the company has logins
const codePull = post({ key, since: 0, push: [] }).pull;
assert.ok(codePull.some(p => p.k === 'E') && !codePull.some(p => p.k === 'W' || p.k === 'F'), 'old invite links see no staff or files');
assert.deepStrictEqual(post({ key, since: 0, push: [worker('W-KEY-0001', 40, undefined)] }).refused, ['W-KEY-0001']);
// an edit request must leave its entry valid, so approving it can't make a record the sheet refuses
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [ask('C-AG1-0010', { after: { rate: 'abc' } }), ask('C-AG1-0011', { after: { rate: 4600 } })] }).refused, ['C-AG1-0010']);

/* ---------- readable tabs ---------- */
const staff = rows('Employees');
assert.deepStrictEqual(staff[3].slice(0, 2), ['W-AG1-0001', 'John']);
assert.strictEqual(staff[3][11], 1200000, 'SSP paid to the employee');
const e = rows('Expenses');
assert.deepStrictEqual(e[2].slice(15, 17), ['SSP per USD', 'Employee']);
assert.deepStrictEqual(e.find(r => r[0] === 'E-AG1-0001').slice(15, 17), [4500, 'John']);

console.log('Employees and files: all checks passed');
