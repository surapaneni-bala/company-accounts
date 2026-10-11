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
// everything lives in one company folder ("<FIRST WORD OF THE COMPANY> SUPER APP"), the Google Sheet too
const drv = () => gas.dump().drive;
const pathOf = id => { const d = drv(), out = []; for (let f = d.files[id].folder; f && f !== 'root'; f = d.folders[f].parent) out.unshift(d.folders[f].name); return out.join(' / '); };
assert.strictEqual(pathOf(up.fileId), 'TEST SUPER APP', 'a new upload waits in the company folder until its record files it');
assert.strictEqual(pathOf('SHEET'), 'TEST SUPER APP', 'the Google Sheet is moved into the company folder');

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
// the company's contacts ride on the letterhead's record: an admin sets them, every login (store keepers too) gets them
const contact = { whatsapp: '@testco', phone: '+211 900 000 000', web: 'test.example', email: 'info@test.example' };
assert.deepStrictEqual(post({ token: owner, since: 0, push: [file('F-OW1-0001', 38, 'x', { for: 'settings', type: 'letterhead', contact })] }).refused, []);
assert.deepStrictEqual(post({ token: s.token, since: 0, push: [] }).pull.find(p => p.id === 'F-OW1-0001').d.contact, contact, 'a store keeper gets the contacts');
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [file('F-OW1-0001', 39, m.me.id, { for: 'settings', type: 'letterhead', contact: { phone: 'x' } })] }).refused, ['F-OW1-0001'], 'only admins change them');

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

// a script error comes back as a readable answer, not Google's error page (which the phone takes for "no internet")
const nd = loadGas(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), {}, { noDrive: true });
nd.setup();
const ndUp = JSON.parse(nd.doPost({ postData: { contents: JSON.stringify({ op: 'upload', key: nd.props.KEY, name: 'a.png', mime: 'image/png', data: png }) } }).getContent());
assert.ok(!ndUp.ok && /allowFiles/.test(ndUp.error) && /DriveApp/.test(ndUp.error), 'a sheet without Drive permission says so: ' + ndUp.error);
// allowFiles proves Drive works by making the files folder: without Drive it fails in the editor, not later on the phones
assert.throws(() => nd.allowFiles(), /DriveApp/, 'allowFiles fails loudly without Drive');
gas.allowFiles();
assert.strictEqual(pathOf('SHEET'), 'TEST SUPER APP', 'allowFiles files everything into the company folder');

// every file in its place (see "Drive" in Code.gs), worked out from its record; nothing is thrown away
const pdf = Buffer.from('%PDF-1.4 voucher').toString('base64'), TOP = 'TEST SUPER APP';
const upload = (name, mime = 'image/png', data = png) => post({ op: 'upload', token: owner, name, mime, data }).fileId;
const vId = upload('PV-OW1-0001 Shop.pdf', 'application/pdf', pdf), pId = upload('photo.png');
const voucher = (u, extra = {}) => file('F-OW1-0100', u, 'x', { for: 'E-OW1-0100', type: 'voucher', mime: 'application/pdf', name: 'PV-OW1-0001 Shop.pdf', fileId: vId, createdAt: '2026-10-08T09:00:00', ...extra });
assert.deepStrictEqual(post({ token: owner, since: 0, push: [exp('E-OW1-0100', 50, 'x'), voucher(50), file('F-OW1-0101', 50, 'x', { for: 'E-OW1-0100', type: 'photo', fileId: pId })] }).refused, []);
const PAY = `${TOP} / 01 PAYMENTS / 2026 / 2026-10 OCTOBER / 2026-10-08 SHOP (E-OW1-0100)`;
assert.deepStrictEqual([pathOf(vId), pathOf(pId)], [PAY, PAY], 'one folder per payment: voucher and photo together, by year and month');
post({ token: owner, since: 0, push: [voucher(51, { cancelled: '2026-10-09T21:00:00', cancelledBy: 'Owner' })] });
const PAY_OLD = `${TOP} / 01 PAYMENTS / CHANGES / 2026 / 2026-10 OCTOBER / 2026-10-08 SHOP (E-OW1-0100)`;
assert.deepStrictEqual([pathOf(vId), drv().files[vId].name], [PAY_OLD, 'CANCELLED PV-OW1-0001 Shop.pdf'], 'a cancelled voucher: the same folders under CHANGES, renamed');
assert.strictEqual(pathOf(pId), PAY, 'the photo of an entry that only changed stays');
// the stamped copy replaces the unstamped original, which goes to the bin
const sId = upload('PV-OW1-0001 Shop.pdf', 'application/pdf', pdf);
post({ token: owner, since: 0, push: [voucher(52, { cancelled: '2026-10-09T21:00:00', cancelledBy: 'Owner', stamped: true, fileId: sId })] });
assert.deepStrictEqual([drv().files[vId].trashed, pathOf(sId), drv().files[sId].name], [true, PAY_OLD, 'CANCELLED PV-OW1-0001 Shop.pdf']);
post({ token: owner, since: 0, push: [exp('E-OW1-0100', 53, 'x', { deleted: '2026-10-09T21:05:00', deletedBy: 'Owner' })] });
const PAY_GONE = `${TOP} / 09 DELETED ENTRIES / 01 PAYMENTS / 2026 / 2026-10 OCTOBER / 2026-10-08 SHOP (E-OW1-0100)`;
assert.deepStrictEqual([pathOf(sId), pathOf(pId)], [PAY_GONE, PAY_GONE], "a deleted entry's files: the same folders under DELETED ENTRIES");
assert.strictEqual(Object.values(drv().folders).filter(f => f.name === '2026-10-08 SHOP (E-OW1-0100)' && !f.trashed).length, 1, 'the folders the move emptied went to the bin');
// an employee: one folder, a folder per kind of document; their payments' slips by year, one folder per payment;
// replaced photos in CHANGES (the same folders); renamed, the folder follows; deleted by an admin, the whole folder moves
const prof1 = upload('profile.png'), prof2 = upload('profile.png'), idp = upload('id.png'), slip = upload('PV-OW1-0002 John.pdf', 'application/pdf', pdf);
const john = (u, extra = {}) => worker('W-OW1-0100', u, 'x', { name: 'John Doe', ...extra }), JOHN = `${TOP} / 03 EMPLOYEES / JOHN DOE (W-OW1-0100)`;
assert.deepStrictEqual(post({ token: owner, since: 0, push: [john(60), file('F-OW1-0110', 60, 'x', { for: 'W-OW1-0100', type: 'profile', fileId: prof1, createdAt: '2026-10-08T09:00:00' }),
  file('F-OW1-0111', 60, 'x', { for: 'W-OW1-0100', type: 'idphoto', fileId: idp, createdAt: '2026-10-08T09:00:00' }),
  exp('E-OW1-0102', 60, 'x', { worker: 'W-OW1-0100', pay: 'advance' }), file('F-OW1-0112', 60, 'x', { for: 'E-OW1-0102', type: 'slip', mime: 'application/pdf', name: 'PV-OW1-0002 John.pdf', fileId: slip })] }).refused, []);
assert.deepStrictEqual([pathOf(prof1), pathOf(idp), pathOf(slip)], [`${JOHN} / PROFILE PHOTO`, `${JOHN} / ID DOCUMENT`, `${JOHN} / PAYMENT SLIPS / 2026 / 2026-10-08 ADVANCE (E-OW1-0102)`]);
assert.deepStrictEqual([drv().files[prof1].name, drv().files[idp].name], ['PROFILE PHOTO 2026-10-08.png', 'ID DOCUMENT 2026-10-08.png'], 'named by kind and date');
post({ token: owner, since: 0, push: [file('F-OW1-0113', 61, 'x', { for: 'W-OW1-0100', type: 'profile', fileId: prof2, createdAt: '2026-10-09T09:00:00' })] });
assert.deepStrictEqual([pathOf(prof1), pathOf(prof2), drv().files[prof2].name], [`${JOHN} / CHANGES / PROFILE PHOTO`, `${JOHN} / PROFILE PHOTO`, 'PROFILE PHOTO 2026-10-09.png'], 'a replaced photo goes to CHANGES');
post({ token: owner, since: 0, push: [john(62, { name: 'John D. Doe' })] });
assert.strictEqual(pathOf(idp), `${TOP} / 03 EMPLOYEES / JOHN D. DOE (W-OW1-0100) / ID DOCUMENT`, 'renamed: the folder follows');
post({ token: owner, since: 0, push: [john(63, { name: 'John D. Doe', deleted: '2026-10-09T22:00:00', deletedBy: 'Owner' })] });
const GONE = `${TOP} / 08 DELETED EMPLOYEES / JOHN D. DOE (W-OW1-0100)`;
assert.deepStrictEqual([pathOf(idp), pathOf(slip), pathOf(prof1)], [`${GONE} / ID DOCUMENT`, `${GONE} / PAYMENT SLIPS / 2026 / 2026-10-08 ADVANCE (E-OW1-0102)`, `${GONE} / CHANGES / PROFILE PHOTO`], 'a deleted employee: the whole folder');
// the company letterhead: the newest in COMPANY / LETTERHEAD, older ones in COMPANY / CHANGES / LETTERHEAD
const lh1 = upload('letterhead.png'), lh2 = upload('letterhead.png');
post({ token: owner, since: 0, push: [file('F-OW1-0120', 70, 'x', { for: 'settings', type: 'letterhead', fileId: lh1, createdAt: '2026-10-09T10:00:00' }), file('F-OW1-0121', 70, 'x', { for: 'settings', type: 'letterhead', fileId: lh2, createdAt: '2026-10-09T11:00:00' })] });
assert.deepStrictEqual([pathOf(lh1), pathOf(lh2), drv().files[lh2].name], [`${TOP} / 04 COMPANY / CHANGES / LETTERHEAD`, `${TOP} / 04 COMPANY / LETTERHEAD`, 'LETTERHEAD 2026-10-09.png']);
// the Files tab lists every file with its status and folder, in the folders' order
const ftab = rows('Files');
assert.ok(ftab.some(r => r[3] === 'CANCELLED PV-OW1-0001 Shop.pdf' && r[6] === 'Cancelled' && r[7] === PAY_GONE.slice(TOP.length + 3) && r[9].endsWith(sId + '/view')), 'the Files tab shows the cancelled voucher of a deleted entry');
assert.ok(ftab.some(r => r[3] === 'PROFILE PHOTO 2026-10-08.png' && r[6] === 'Replaced by a newer one' && r[7] === '08 DELETED EMPLOYEES / JOHN D. DOE (W-OW1-0100) / CHANGES / PROFILE PHOTO'), 'and where a replaced photo is');
const order = ftab.slice(3).map(r => r[7]).filter(Boolean);
assert.deepStrictEqual(order, order.slice().sort((a, b) => a.localeCompare(b)), 'in the order of the folders');
// once per layout: everything is refiled and empty folders go to the bin
drv().files[pId].folder = drv().files.SHEET.folder; gas.props.FILES_LAYOUT = '0';
const top = Object.keys(drv().folders).find(k => drv().folders[k].name === TOP);
drv().folders.oldfolder = { name: 'Payments & receipts', parent: top }; drv().folders.oldmonth = { name: '2026-10', parent: 'oldfolder' };
post({ token: owner, since: 0, push: [] });
assert.deepStrictEqual([pathOf(pId), drv().folders.oldmonth.trashed, drv().folders.oldfolder.trashed], [PAY_GONE, true, true], 'refiled once; old empty folders binned');
// an attachment replaced or removed: the old one is kept, filed under CHANGES in the same folders
const att1 = upload('invoice.pdf', 'application/pdf', pdf), att2 = upload('invoice2.pdf', 'application/pdf', pdf), att3 = upload('note.png');
const attach = (id, fileId, u, extra = {}) => file(id, u, 'x', { for: 'E-OW1-0103', type: 'attachment', fileId, createdAt: '2026-10-08T12:00:00', ...extra });
post({ token: owner, since: 0, push: [exp('E-OW1-0103', 90, 'x'), attach('F-OW1-0130', att1, 90), attach('F-OW1-0132', att3, 90)] });
const PAY3 = `${TOP} / 01 PAYMENTS / 2026 / 2026-10 OCTOBER / 2026-10-08 SHOP (E-OW1-0103)`, PAY3_OLD = `${TOP} / 01 PAYMENTS / CHANGES / 2026 / 2026-10 OCTOBER / 2026-10-08 SHOP (E-OW1-0103)`;
post({ token: owner, since: 0, push: [attach('F-OW1-0131', att2, 91, { replaces: 'F-OW1-0130', createdAt: '2026-10-09T12:00:00' }), attach('F-OW1-0130', att1, 91, { replaced: '2026-10-09T12:00:00', replacedBy: 'Owner' }), attach('F-OW1-0132', att3, 91, { removed: '2026-10-09T12:01:00', removedBy: 'Owner' })] });
assert.deepStrictEqual([pathOf(att2), pathOf(att1), pathOf(att3)], [PAY3, PAY3_OLD, PAY3_OLD], 'the new attachment in place; the replaced and the removed ones under CHANGES');
assert.ok(rows('Files').some(r => r[9].endsWith(att3 + '/view') && r[6] === 'Removed') && rows('Files').some(r => r[9].endsWith(att1 + '/view') && r[6] === 'Replaced by a newer one'), 'the Files tab says so');
// an admin takes a cancel back (the change did not touch the money): the original comes out of the bin and is filed as in
// use again; the stamped copy goes to the bin
const v2 = upload('PV-OW1-0003 Shop.pdf', 'application/pdf', pdf), s2 = upload('PV-OW1-0003 Shop.pdf', 'application/pdf', pdf);
const v2rec = (u, extra = {}) => file('F-OW1-0200', u, 'x', { for: 'E-OW1-0200', type: 'voucher', mime: 'application/pdf', name: 'PV-OW1-0003 Shop.pdf', no: 'PV-OW1-0003', fileId: v2, createdAt: '2026-10-08T09:00:00', ...extra });
post({ token: owner, since: 0, push: [exp('E-OW1-0200', 95, 'x'), v2rec(95)] });
post({ token: owner, since: 0, push: [v2rec(96, { cancelled: '2026-10-10T21:00:00', cancelledBy: 'Owner', stamped: true, fileId: s2 })] });
assert.strictEqual(drv().files[v2].trashed, true, 'the stamped copy replaced the original');
assert.strictEqual(post({ op: 'original', token: m.token, id: 'F-OW1-0200' }).ok, false, 'only an admin brings it back');
assert.strictEqual(post({ op: 'original', token: owner, id: 'F-OW1-0100' }).ok, false, 'not a paper whose cancel stands with no number');
assert.strictEqual(post({ op: 'original', token: owner, id: 'F-OW1-0200' }).fileId, v2, 'the original comes out of the bin');
post({ token: owner, since: 0, push: [v2rec(97)] });
const PAY4 = `${TOP} / 01 PAYMENTS / 2026 / 2026-10 OCTOBER / 2026-10-08 SHOP (E-OW1-0200)`;
assert.deepStrictEqual([drv().files[v2].trashed, pathOf(v2), drv().files[v2].name, drv().files[s2].trashed], [false, PAY4, 'PV-OW1-0003 Shop.pdf', true], 'in use again, not renamed CANCELLED; the stamped copy in the bin');
assert.strictEqual(post({ op: 'original', token: owner, id: 'F-OW1-0200' }).ok, false, 'nothing more to bring back');
assert.strictEqual(post({ op: 'file', token: owner, id: 'F-OW1-0200' }).fileId, v2, 'a fetched file says which Drive file it is');
/* ---------- regular payments and the company's bank accounts ---------- */
const reg = (id, u, extra = {}) => ({ id, k: 'G', u, d: { id, name: 'Land rent', paidTo: 'Landlord', amount: 500, cur: 'USD', every: 1, first: '2026-01-01', mode: 'Bank', ...extra } });
const bank = (id, u, extra = {}) => ({ id, k: 'B', u, d: { id, bank: 'Test Bank', accName: 'Test Builders Ltd', number: '0011223344', cur: 'USD', ...extra } });
assert.deepStrictEqual(post({ token: owner, since: 0, push: [reg('G-OW1-0001', 100), bank('B-OW1-0001', 100), reg('G-OW1-0002', 100, { every: 2 }), bank('B-OW1-0002', 100, { number: '' })] }).refused.sort(),
  ['B-OW1-0002', 'G-OW1-0002'], 'an admin adds them; every 1, 3, 6 or 12 months; an account has a number');
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [reg('G-AG1-0001', 101, { uid: m.me.id }), bank('B-AG1-0001', 101, { uid: m.me.id })] }).refused.sort(), ['B-AG1-0001', 'G-AG1-0001'], 'the office manager does not');
assert.deepStrictEqual(post({ token: s.token, since: 0, push: [bank('B-SK1-0001', 101, { uid: s.me.id })] }).refused, ['B-SK1-0001'], 'nor the store keeper');
const kindsFor = t => post({ token: t, since: 0, push: [] }).pull.map(p => p.k);
assert.ok(kindsFor(m.token).includes('G') && kindsFor(m.token).includes('B'), 'the office manager sees the regular payments (she pays them) and the bank details');
assert.ok(!kindsFor(s.token).includes('G') && kindsFor(s.token).includes('B'), 'the store keeper sees only the bank details');
// paying one: an expense that names it and the due date it pays; the tab works out the next due date
assert.deepStrictEqual(post({ token: owner, since: 0, push: [exp('E-OW1-0300', 102, 'x', { regular: 'G-OW1-0001', period: '2026-01-01' }), exp('E-OW1-0301', 102, 'x', { regular: 'G-OW1-0001', period: 'January' })] }).refused, ['E-OW1-0301'], 'the period is a date');
const regRow = rows('Regular payments').find(r => r[0] === 'G-OW1-0001');
assert.deepStrictEqual([regRow[9], regRow[11]], ['2026-02-01', 1], 'next due after January is paid; paid once');
assert.ok(rows('Bank accounts').some(r => r[0] === 'B-OW1-0001' && r[3] === '0011223344'), 'the Bank accounts tab');

/* ---------- the vault: company and vehicle papers for admins and the office manager, personal ones for admins only ---------- */
const doc = (id, u, uid, extra = {}) => ({ id, k: 'V', u, d: { id, title: 'Trading licence', kind: 'company', expires: '2027-01-10', remind: 30, uid, ...extra } });
const docFile = (id, forId, u, uid, fileId, extra = {}) => file(id, u, uid, { for: forId, type: 'document', fileId, name: 'scan.pdf', mime: 'application/pdf', createdAt: '2026-10-11T09:00:00', ...extra });
const lic = upload('scan.pdf', 'application/pdf', pdf), pass = upload('scan.pdf', 'application/pdf', pdf);
assert.deepStrictEqual(post({ token: owner, since: 0, push: [doc('V-OW1-0001', 110, 'x'), doc('V-OW1-0002', 110, 'x', { title: 'Passport', kind: 'personal', owner: 'Test Shareholder' }), doc('V-OW1-0003', 110, 'x', { kind: 'boat' }), doc('V-OW1-0004', 110, 'x', { expires: 'next year' }),
  docFile('F-OW1-0400', 'V-OW1-0001', 110, 'x', lic), docFile('F-OW1-0401', 'V-OW1-0002', 110, 'x', pass)] }).refused.sort(), ['V-OW1-0003', 'V-OW1-0004'], 'a kind the vault knows; a real expiry date');
const mPull = post({ token: m.token, since: 0, push: [] }).pull.map(p => p.id);
assert.ok(mPull.includes('V-OW1-0001') && mPull.includes('F-OW1-0400'), 'the office manager sees company papers and their files');
assert.ok(!mPull.includes('V-OW1-0002') && !mPull.includes('F-OW1-0401'), 'but not a personal document, nor its file');
assert.strictEqual(post({ op: 'file', token: m.token, id: 'F-OW1-0401' }).ok, false, 'nor can she fetch its file');
assert.strictEqual(post({ op: 'file', token: owner, id: 'F-OW1-0401' }).ok, true, 'an admin can');
assert.ok(!post({ token: s.token, since: 0, push: [] }).pull.some(p => p.k === 'V'), 'the store keeper sees no documents');
const vehM = upload('car.pdf', 'application/pdf', pdf);
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [doc('V-AG1-0001', 111, m.me.id, { title: 'Truck insurance', kind: 'vehicle', owner: 'TEST 123A' }), doc('V-AG1-0002', 111, m.me.id, { kind: 'personal' })] }).refused, ['V-AG1-0002'], 'she adds vehicle papers, not personal ones');
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [doc('V-AG1-0001', 112, m.me.id, { title: 'Changed' })] }).refused, ['V-AG1-0001'], 'only admins change a document');
// filed in Drive: 05 DOCUMENTS / <kind> / <TITLE> (V-…), named by the day it was added; a renewal sends the old one to CHANGES
assert.deepStrictEqual([pathOf(lic), drv().files[lic].name], [`${TOP} / 05 DOCUMENTS / COMPANY / TRADING LICENCE (V-OW1-0001)`, 'TRADING LICENCE 2026-10-11.pdf']);
assert.strictEqual(pathOf(pass), `${TOP} / 05 DOCUMENTS / PERSONAL / PASSPORT (V-OW1-0002)`);
const lic2 = upload('scan2.pdf', 'application/pdf', pdf);
post({ token: owner, since: 0, push: [doc('V-OW1-0001', 113, 'x', { expires: '2028-01-10' }), docFile('F-OW1-0402', 'V-OW1-0001', 113, 'x', lic2, { replaces: 'F-OW1-0400', createdAt: '2026-10-12T09:00:00' }), docFile('F-OW1-0400', 'V-OW1-0001', 113, 'x', lic, { replaced: '2026-10-12T09:00:00' })] });
assert.deepStrictEqual([pathOf(lic2), pathOf(lic)], [`${TOP} / 05 DOCUMENTS / COMPANY / TRADING LICENCE (V-OW1-0001)`, `${TOP} / 05 DOCUMENTS / CHANGES / COMPANY / TRADING LICENCE (V-OW1-0001)`], 'renewed: the new one in place, the old one under CHANGES');
assert.ok(rows('Documents').some(r => r[0] === 'V-OW1-0001' && r[6] === '2028-01-10' && r[8] === 'Valid' && String(r[11]).endsWith(lic2 + '/view')), 'the Documents tab links the current file');

/* ---------- the morning email ---------- */
assert.strictEqual(post({ op: 'alerts', token: m.token, email: 'x@example.com' }).ok, false, 'only an admin chooses where it goes');
assert.strictEqual(post({ op: 'alerts', token: owner, email: 'not an email' }).ok, false);
gas.allowFiles();
assert.deepStrictEqual(post({ op: 'alerts', token: owner, email: 'office@example.com' }), { ok: true, email: 'office@example.com', running: true, sent: '' }, 'allowFiles started the morning trigger');
gas.allowFiles();
assert.strictEqual(gas.triggers.length, 1, 'only once');
const tday = new Date().toISOString().slice(0, 10), inDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
post({ token: owner, since: 0, push: [doc('V-OW1-0005', 120, 'x', { title: 'Road licence', kind: 'vehicle', owner: 'TEST 999B', expires: inDays(7) }), doc('V-OW1-0006', 120, 'x', { title: 'Fire certificate', expires: inDays(12) }),
  reg('G-OW1-0003', 120, { name: 'Internet', paidTo: 'ISP', amount: 120, first: tday })] });
gas.mails.length = 0;
gas.morningEmail();
const mail = gas.mails[0];
assert.strictEqual(mail.to, 'office@example.com');
assert.ok(/LATE: Land rent/.test(mail.body) && /Due today: Internet/.test(mail.body) && /Expires in 7 days: Road licence \(TEST 999B\)/.test(mail.body), 'late rent, internet due today, a road licence a week before');
assert.ok(!/Fire certificate/.test(mail.body), 'not every day of the reminder: 12 days is no reminder day');
gas.mails.length = 0;
post({ op: 'alerts', token: owner, email: '' });
gas.morningEmail();
assert.strictEqual(gas.mails.length, 0, 'no address: no email');

/* ---------- invoices and quotations: admins only; the sheet numbers invoices in one series ---------- */
assert.deepStrictEqual([post({ op: 'number', token: owner }).no, post({ op: 'number', token: owner }).no], ['INV-0001', 'INV-0002'], 'one unbroken series');
assert.strictEqual(post({ op: 'number', token: m.token }).ok, false, 'only admins take a number');
const client = (id, u, extra = {}) => ({ id, k: 'K', u, d: { id, name: 'Test Client Ltd', phone: '+000 111', ...extra } });
const invoice = (id, u, extra = {}) => ({ id, k: 'I', u, d: { id, type: 'invoice', no: 'INV-0001', client: 'K-OW1-0001', date: '2026-10-11', due: '2026-10-25', cur: 'USD', items: [{ t: 'Cement 42.5', qty: 20, unit: 'bags', price: 15 }], tax: 0, ...extra } });
const invPdf = upload('INV-0001.pdf', 'application/pdf', pdf), qtPdf = upload('QT-OW1-0001.pdf', 'application/pdf', pdf);
assert.deepStrictEqual(post({ token: owner, since: 0, push: [client('K-OW1-0001', 130), invoice('I-OW1-0001', 130), invoice('I-OW1-0002', 130, { type: 'quote', no: 'QT-OW1-0001', due: '' }),
  invoice('I-OW1-0003', 130, { items: [] }), invoice('I-OW1-0004', 130, { items: [{ t: 'x', qty: 0, price: 1 }] }), invoice('I-OW1-0005', 130, { type: 'bill' }),
  file('F-OW1-0500', 130, 'x', { for: 'I-OW1-0001', type: 'invoice', fileId: invPdf, no: 'INV-0001', mime: 'application/pdf', name: 'INV-0001.pdf' }), file('F-OW1-0501', 130, 'x', { for: 'I-OW1-0002', type: 'quote', fileId: qtPdf, no: 'QT-OW1-0001', mime: 'application/pdf', name: 'QT.pdf' })] }).refused.sort(),
  ['I-OW1-0003', 'I-OW1-0004', 'I-OW1-0005'], 'an invoice has lines, each with a quantity; invoice or quotation');
assert.ok(!post({ token: m.token, since: 0, push: [] }).pull.some(p => ['K', 'I'].includes(p.k) || p.id === 'F-OW1-0500'), 'the office manager sees no clients, invoices or their PDFs');
assert.ok(!post({ token: s.token, since: 0, push: [] }).pull.some(p => ['K', 'I'].includes(p.k)), 'nor the store keeper');
assert.deepStrictEqual(post({ token: m.token, since: 0, push: [client('K-AG1-0001', 131, { uid: m.me.id })] }).refused, ['K-AG1-0001'], 'nor adds them');
assert.deepStrictEqual([pathOf(invPdf), drv().files[invPdf].name, pathOf(qtPdf)], [`${TOP} / 06 INVOICES / 2026 / 2026-10 OCTOBER`, 'INV-0001 TEST CLIENT LTD.pdf', `${TOP} / 07 QUOTATIONS / 2026 / 2026-10 OCTOBER`], 'by year and month, named by number and client');
// a payment names the invoice; the tab shows what is paid and still owed
post({ token: owner, since: 0, push: [{ id: 'R-OW1-0100', k: 'R', u: 132, d: { id: 'R-OW1-0100', cur: 'USD', amount: 120, at: '2026-10-12T10:00', project: '', mode: 'Bank', invoice: 'I-OW1-0001' } }] });
const invRow = rows('Invoices').find(r => r[0] === 'INV-0001');
assert.deepStrictEqual(invRow.slice(6, 10), [300, 120, 180, 'Part paid'], 'total 20 × 15, paid 120, 180 still owed');
assert.strictEqual(rows('Invoices').find(r => r[0] === 'QT-OW1-0001')[9], 'Quotation');
post({ token: owner, since: 0, push: [invoice('I-OW1-0001', 133, { cancelled: '2026-10-13T09:00:00' }), file('F-OW1-0500', 133, 'x', { for: 'I-OW1-0001', type: 'invoice', fileId: invPdf, no: 'INV-0001', mime: 'application/pdf', name: 'INV-0001.pdf', cancelled: '2026-10-13T09:00:00' })] });
assert.deepStrictEqual([pathOf(invPdf), drv().files[invPdf].name, rows('Invoices').find(r => r[0] === 'INV-0001')[9]], [`${TOP} / 06 INVOICES / CHANGES / 2026 / 2026-10 OCTOBER`, 'CANCELLED INV-0001 TEST CLIENT LTD.pdf', 'Cancelled'], 'a cancelled invoice: kept under CHANGES, renamed');

// the company folder follows the company's name
post({ token: owner, since: 0, push: [{ id: 'settings', k: 'S', u: 80, d: { company: 'Acme Works Ltd', pass: { salt: 's', hash: 'h' } } }] });
assert.strictEqual(pathOf('SHEET'), 'ACME SUPER APP', 'renamed with the company');
// a Drive problem (the file was removed by hand) never stops a sync
const upX = post({ op: 'upload', token: owner, name: 'x.png', mime: 'image/png', data: png });
post({ token: owner, since: 0, push: [exp('E-OW1-0101', 53, 'x'), file('F-OW1-0102', 53, 'x', { for: 'E-OW1-0101', fileId: upX.fileId })] });
delete drv().files[upX.fileId];
const gone = post({ token: owner, since: 0, push: [exp('E-OW1-0101', 54, 'x', { deleted: '2026-10-09T21:06:00', deletedBy: 'Owner' })] });
assert.ok(gone.ok && !gone.refused.length, 'sync still works when a file cannot be moved');

console.log('Employees and files: all checks passed');
