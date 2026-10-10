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
// everything lives in one company folder ("<first word of the company> Super App"), the Google Sheet too
const drv = () => gas.dump().drive;
const pathOf = id => { const d = drv(), out = []; for (let f = d.files[id].folder; f && f !== 'root'; f = d.folders[f].parent) out.unshift(d.folders[f].name); return out.join(' / '); };
assert.ok(pathOf(up.fileId).startsWith('Test Super App / Payments & receipts / '), 'kept in the company folder: ' + pathOf(up.fileId));
assert.strictEqual(pathOf('SHEET'), 'Test Super App', 'the Google Sheet is moved into the company folder');

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
assert.strictEqual(pathOf('SHEET'), 'Test Super App', 'allowFiles files everything into the company folder');

// every file in its place (see "Drive" in Code.gs), worked out from its record; nothing is thrown away
const pdf = Buffer.from('%PDF-1.4 voucher').toString('base64'), TOP = 'Test Super App';
const upload = (name, mime = 'image/png', data = png) => post({ op: 'upload', token: owner, name, mime, data }).fileId;
const vId = upload('PV-OW1-0001 Shop.pdf', 'application/pdf', pdf), pId = upload('photo.png');
const voucher = (u, extra = {}) => file('F-OW1-0100', u, 'x', { for: 'E-OW1-0100', type: 'voucher', mime: 'application/pdf', name: 'PV-OW1-0001 Shop.pdf', fileId: vId, createdAt: '2026-10-08T09:00:00', ...extra });
assert.deepStrictEqual(post({ token: owner, since: 0, push: [exp('E-OW1-0100', 50, 'x'), voucher(50), file('F-OW1-0101', 50, 'x', { for: 'E-OW1-0100', type: 'photo', fileId: pId })] }).refused, []);
assert.deepStrictEqual([pathOf(vId), pathOf(pId)], [`${TOP} / Payments & receipts / 2026-10`, `${TOP} / Payments & receipts / 2026-10`], "by the payment's month");
post({ token: owner, since: 0, push: [voucher(51, { cancelled: '2026-10-09T21:00:00', cancelledBy: 'Owner' })] });
assert.deepStrictEqual([pathOf(vId), drv().files[vId].name], [`${TOP} / Payments & receipts / Cancelled`, 'CANCELLED PV-OW1-0001 Shop.pdf'], 'a cancelled voucher is kept, renamed');
assert.strictEqual(pathOf(pId), `${TOP} / Payments & receipts / 2026-10`, 'the photo of an entry that only changed stays');
// the stamped copy replaces the unstamped original, which goes to the bin
const sId = upload('PV-OW1-0001 Shop.pdf', 'application/pdf', pdf);
post({ token: owner, since: 0, push: [voucher(52, { cancelled: '2026-10-09T21:00:00', cancelledBy: 'Owner', stamped: true, fileId: sId })] });
assert.deepStrictEqual([drv().files[vId].trashed, pathOf(sId), drv().files[sId].name], [true, `${TOP} / Payments & receipts / Cancelled`, 'CANCELLED PV-OW1-0001 Shop.pdf']);
post({ token: owner, since: 0, push: [exp('E-OW1-0100', 53, 'x', { deleted: '2026-10-09T21:05:00', deletedBy: 'Owner' })] });
assert.deepStrictEqual([pathOf(sId), pathOf(pId)], [`${TOP} / Deleted entries`, `${TOP} / Deleted entries`], "a deleted entry's files");
// an employee: one folder with everything (profile, ID, their payments' slips); replaced photos go to Changes;
// renamed, the folder follows; deleted by an admin, the whole folder goes to Deleted employees
const prof1 = upload('profile.png'), prof2 = upload('profile.png'), idp = upload('id.png'), slip = upload('PV-OW1-0002 John.pdf', 'application/pdf', pdf);
const john = (u, extra = {}) => worker('W-OW1-0100', u, 'x', { name: 'John Doe', ...extra }), JOHN = `${TOP} / Employees / John Doe (W-OW1-0100)`;
assert.deepStrictEqual(post({ token: owner, since: 0, push: [john(60), file('F-OW1-0110', 60, 'x', { for: 'W-OW1-0100', type: 'profile', fileId: prof1, createdAt: '2026-10-08T09:00:00' }),
  file('F-OW1-0111', 60, 'x', { for: 'W-OW1-0100', type: 'idphoto', fileId: idp, createdAt: '2026-10-08T09:00:00' }),
  exp('E-OW1-0102', 60, 'x', { worker: 'W-OW1-0100', pay: 'advance' }), file('F-OW1-0112', 60, 'x', { for: 'E-OW1-0102', type: 'slip', mime: 'application/pdf', name: 'PV-OW1-0002 John.pdf', fileId: slip })] }).refused, []);
assert.deepStrictEqual([pathOf(prof1), pathOf(idp), pathOf(slip)], [JOHN, JOHN, JOHN], 'everything about one employee in their folder');
post({ token: owner, since: 0, push: [file('F-OW1-0113', 61, 'x', { for: 'W-OW1-0100', type: 'profile', fileId: prof2, createdAt: '2026-10-09T09:00:00' })] });
assert.deepStrictEqual([pathOf(prof1), pathOf(prof2)], [`${JOHN} / Changes`, JOHN], 'a replaced profile photo goes to Changes');
post({ token: owner, since: 0, push: [john(62, { name: 'John D. Doe' })] });
assert.strictEqual(pathOf(idp), `${TOP} / Employees / John D. Doe (W-OW1-0100)`, 'renamed: the folder follows');
post({ token: owner, since: 0, push: [john(63, { name: 'John D. Doe', deleted: '2026-10-09T22:00:00', deletedBy: 'Owner' })] });
const GONE = `${TOP} / Deleted employees / John D. Doe (W-OW1-0100)`;
assert.deepStrictEqual([pathOf(idp), pathOf(slip), pathOf(prof1)], [GONE, GONE, `${GONE} / Changes`], 'a deleted employee: the whole folder');
// the company letterhead: the newest in Company, older ones in Company / Changes
const lh1 = upload('letterhead.png'), lh2 = upload('letterhead.png');
post({ token: owner, since: 0, push: [file('F-OW1-0120', 70, 'x', { for: 'settings', type: 'letterhead', fileId: lh1, createdAt: '2026-10-09T10:00:00' }), file('F-OW1-0121', 70, 'x', { for: 'settings', type: 'letterhead', fileId: lh2, createdAt: '2026-10-09T11:00:00' })] });
assert.deepStrictEqual([pathOf(lh1), pathOf(lh2)], [`${TOP} / Company / Changes`, `${TOP} / Company`]);
// the Files tab lists every file with its status and folder
const ftab = rows('Files');
assert.ok(ftab.some(r => r[3] === 'PV-OW1-0001 Shop.pdf' && r[6] === 'Cancelled' && r[7] === 'Deleted entries' && r[9].endsWith(sId + '/view')), 'the Files tab shows the cancelled voucher of a deleted entry');
assert.ok(ftab.some(r => r[2] === 'Profile photo' && r[6] === 'Replaced by a newer one' && r[7] === 'Deleted employees / John D. Doe (W-OW1-0100) / Changes'), 'and where a replaced photo is');
// once per layout: everything is refiled and emptied old folders are removed
drv().files[pId].folder = drv().files.SHEET.folder; gas.props.FILES_LAYOUT = '0';
const oldMonth = Object.keys(drv().folders).find(k => drv().folders[k].name === TOP);
drv().folders.oldfolder = { name: '2026-09', parent: oldMonth };
post({ token: owner, since: 0, push: [] });
assert.deepStrictEqual([pathOf(pId), drv().folders.oldfolder.trashed], [`${TOP} / Deleted entries`, true], 'refiled once; the emptied old folder removed');
// a Drive problem (the file was removed by hand) never stops a sync
const upX = post({ op: 'upload', token: owner, name: 'x.png', mime: 'image/png', data: png });
post({ token: owner, since: 0, push: [exp('E-OW1-0101', 53, 'x'), file('F-OW1-0102', 53, 'x', { for: 'E-OW1-0101', fileId: upX.fileId })] });
delete drv().files[upX.fileId];
const gone = post({ token: owner, since: 0, push: [exp('E-OW1-0101', 54, 'x', { deleted: '2026-10-09T21:06:00', deletedBy: 'Owner' })] });
assert.ok(gone.ok && !gone.refused.length, 'sync still works when a file cannot be moved');

console.log('Employees and files: all checks passed');
