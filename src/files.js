/* ---------- files: photos, PDFs, signatures and slips ---------- */
// A file is kept on this phone first (IndexedDB: localStorage is far too small), then uploaded to the company
// Google Drive through the sheet script. Its record (kind F) is made only once the upload worked, so the sheet
// never holds a record whose file it can't give back. Uploaded files stay on the phone as an offline copy.
const FILE_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE = 8 * 1024 * 1024; // the sheet script refuses bigger files
const PHOTO_SIDE = 1600; // photos are shrunk on the phone: quicker to upload, still sharp on a slip
const PDF_Q = 0.8; // slips and statements: side by side at 2× it looks the same as 0.9, and is a quarter smaller (quicker to upload)
const TAKEN_PHOTO = [1280, 0.8]; // the payment photo as taken: a person and money, not small print — a third smaller than other photos
const FILE_ICON = { voucher: '🧾', receipt: '🧾', slip: '🧾', photo: '📷', attachment: '📎', profile: '🙂', idphoto: '🪪', letterhead: '📄', stamp: '🔵', statement: '📑' };
const FILE_NAME = { voucher: 'Payment voucher', receipt: 'Receipt', slip: 'Salary slip', photo: 'Photo', attachment: 'Attachment', profile: 'Profile photo', idphoto: 'ID photo', letterhead: 'Letterhead', stamp: 'Company stamp', statement: 'Statement' };
let outbox = [];          // files waiting to upload (their details; the bytes stay in IndexedDB)
let uploading = false, uploadErr = '';
let shown = null;         // the file on screen, kept in memory so "Send" opens the share sheet straight from the tap

/* IndexedDB: one store per app copy (the test copy has its own KEY) */
function idb(mode, fn) {
  return new Promise((ok, no) => {
    const open = indexedDB.open(KEY + '-files', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files', { keyPath: 'id' });
    open.onerror = () => no(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('files', mode), req = fn(tx.objectStore('files'));
      tx.oncomplete = () => { db.close(); ok(req.result); };
      tx.onerror = tx.onabort = () => { db.close(); no(tx.error || new Error('Could not keep the file on this phone')); };
    };
  });
}
const fileGet = id => idb('readonly', s => s.get(id));
const filePut = rec => idb('readwrite', s => s.put(rec));
const fileDel = id => idb('readwrite', s => s.delete(id));
const fileAll = () => idb('readonly', s => s.getAll());
async function loadOutbox() {
  try { outbox = (await fileAll()).filter(f => f.pending).map(({ data, ...meta }) => meta); }
  catch { outbox = []; } // storage blocked (private browsing): nothing can be waiting
}
// a phone that lost access keeps only what it hasn't uploaded yet
async function dropFileCopies() {
  try { await idb('readwrite', s => { const req = s.openCursor(); req.onsuccess = () => { const c = req.result; if (!c) return; if (!c.value.pending) c.delete(); c.continue(); }; return req; }); }
  catch { /* nothing kept */ }
}

const toB64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const imgFrom = blob => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('This picture could not be read.')); i.src = URL.createObjectURL(blob); });
const canvasJpeg = (c, q) => new Promise(ok => c.toBlob(ok, 'image/jpeg', q));

// A picked or photographed file → { data, mime, name }: photos become a smaller JPEG, PDFs pass as they are.
async function prepareFile(file, side = PHOTO_SIDE, quality = 0.82, png = false) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    if (file.size > MAX_FILE) throw new Error('This PDF is bigger than 8 MB.');
    return { data: await file.arrayBuffer(), mime: 'application/pdf', name: file.name };
  }
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|heic|webp)$/i.test(file.name)) throw new Error('Only photos and PDF files can be added.');
  const img = await imgFrom(file);
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext('2d');
  if (png) { g.drawImage(img, 0, 0, c.width, c.height); const b = await new Promise(ok => c.toBlob(ok, 'image/png')); return { data: await b.arrayBuffer(), mime: 'image/png', name: (file.name || 'stamp').replace(/\.\w+$/, '') + '.png' }; }
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // a see-through part turns white, not black
  g.drawImage(img, 0, 0, c.width, c.height);
  const blob = await canvasJpeg(c, quality);
  return { data: await blob.arrayBuffer(), mime: 'image/jpeg', name: (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg' };
}

// Keep a file for a record ('for' = its id, or 'settings' for the letterhead). Returns the file's id.
async function keepFile(meta, data) {
  const [[id], seq] = nextIds('F', 1, S.seq);
  const rec = { id, ...meta, by: myName() || S.lastBy || '', createdAt: stampSec() };
  await filePut({ ...rec, data, pending: true });
  update({ seq });
  outbox = [...outbox, rec];
  uploadFiles();
  return id;
}

// Why files are still only on this phone, in plain words (shown wherever a waiting file is).
function uploadWhy() {
  if (!S.link) return 'connect the Google Sheet to upload them.';
  if ((S.link.v || 2) < 4) return can('settings') ? `they upload once the Google Sheet script is updated to version ${NEWEST_SCRIPT} (see "Show me how" below).` : "they upload once the company's Google Sheet script is updated — tell the owner.";
  if (mustSignIn()) return 'sign in to upload them.';
  if (uploading) return 'uploading now…';
  return uploadErr || 'they upload by themselves when the internet is on.';
}
const SLOW_MSG = 'no internet, or it is very slow — they try again by themselves.';
// A script error comes back as a page the phone cannot read, which looks like "no internet". If the sheet does answer,
// the failure is the sheet's: almost always a sheet that was never allowed to use Google Drive (allowFiles not run).
const DRIVE_MSG = "the Google Sheet answers but cannot save files — it has no permission to use Google Drive yet. In Apps Script choose allowFiles at the top and press Run; on Google's permission screen tick every box (Select all) and press Continue.";
async function uploadFailure(e) {
  if (e.code === 'LOGIN') return '';
  if (!e.offline) return `a file could not be uploaded: ${e.message}`;
  if (e.timedOut || !await answers(S.link.u)) return SLOW_MSG;
  return can('settings') ? DRIVE_MSG : 'the Google Sheet cannot save files yet — tell the owner (it needs permission to use Google Drive).';
}
/* ---------- cancelled papers: an entry changed after its voucher, receipt or slip was signed ---------- */
// The paper no longer matches what was signed, so it is cancelled — kept as proof (the sheet renames it "CANCELLED …" into a
// Cancelled folder; the app stamps it whenever it is opened or sent) — and a new one is made and signed again.
const SIGNED_TYPES = ['voucher', 'receipt', 'slip'];
// What the person signed for: the paper's main lines and boxes. Muted lines (project, location, a note, the balance after)
// are the office's own filing, so moving an expense to a project never cancels its voucher.
function signedFacts(k, r) {
  try {
    const s = k === 'R' ? receiptSpec(r, '') : r.pay ? payslipSpec(r) : voucherSpec(r);
    return JSON.stringify([s.title, s.party, s.when, s.lines.filter(l => !l.muted), s.extra, r.amount, r.cur, stampDate(r)]);
  } catch { return ''; }
}
function cancelSigned(was) {
  const changed = new Map(); // entry id → the entry as it was signed
  [['E', 'expenses'], ['R', 'credits']].forEach(([k, key]) => {
    const old = new Map(was[key].map(r => [r.id, r]));
    S[key].forEach(r => { const o = old.get(r.id); if (o && o !== r && !r.deleted && signedFacts(k, o) !== signedFacts(k, r)) changed.set(r.id, o); });
  });
  const at = stampSec(), by = myName() || S.lastBy || '';
  // the amount the person signed for is kept with the cancelled paper, so a correction can say it
  changed.forEach((o, id) => filesFor(id).filter(f => SIGNED_TYPES.includes(f.type) && !f.cancelled)
    .forEach(f => patchFile(f, { cancelled: at, cancelledBy: by, was: { amount: o.amount, cur: o.cur } })));
}
// a change to a file's record, whether it has gone up already or still waits on this phone (then it goes up with it)
async function patchFile(f, patch) {
  if (!f.pending) return update({ files: S.files.map(x => (x.id === f.id ? { ...x, ...patch } : x)) });
  const rec = await fileGet(f.id);
  if (rec) await filePut({ ...rec, ...patch });
  outbox = outbox.map(x => (x.id === f.id ? { ...x, ...patch } : x));
}
const cancelledWhy = f => `Cancelled on ${fmtAbs(String(f.cancelled).slice(0, 16))}${f.cancelledBy ? ` by ${f.cancelledBy}` : ''} — ${f.cancelReason || 'the entry was changed after it was signed'}`;
// the pages of a PDF this app made: each page is one JPEG picture
async function pdfJpegs(blob) {
  const b = new Uint8Array(await blob.arrayBuffer()), find = (seq, from) => { for (let i = from; i <= b.length - seq.length; i++) if (seq.every((x, j) => b[i + j] === x)) return i; return -1; };
  const pages = [];
  for (let s = find([0xFF, 0xD8, 0xFF], 0); s >= 0; s = find([0xFF, 0xD8, 0xFF], s + 2)) {
    const e = find([0xFF, 0xD9], s) + 2;
    if (e < s) break; // not a whole picture: leave the rest
    const data = b.slice(s, e), img = await imgFrom(new Blob([data], { type: 'image/jpeg' }));
    pages.push({ data, img, w: img.naturalWidth, h: img.naturalHeight });
    s = e - 2;
  }
  return pages;
}
// every page with a large stamp turned across it: the word, and a line saying why
function stampPages(pages, word, why) {
  return Promise.all(pages.map(async ({ img, w, h }) => {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = w; c.height = h;
    g.drawImage(img, 0, 0);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-0.4);
    g.textAlign = 'center'; g.fillStyle = g.strokeStyle = 'rgba(198,40,40,.8)';
    const big = `800 ${Math.round(w * 0.11)}px ${SANS}`, small = `600 ${Math.round(w * 0.017)}px ${SANS}`;
    g.font = big; const ww = g.measureText(word).width; g.font = small; const rw = g.measureText(why).width;
    const bw = Math.max(ww, rw) + w * 0.06; // the frame holds both lines and, turned, stays on the page
    g.lineWidth = w * 0.01; g.strokeRect(-bw / 2, -w * 0.11, bw, w * 0.185);
    g.font = big; g.fillText(word, 0, 0);
    g.font = small; g.fillText(why, 0, w * 0.045);
    g.restore();
    return { data: new Uint8Array(await (await canvasJpeg(c, PDF_Q)).arrayBuffer()), w, h };
  }));
}
// a cancelled paper as opened or sent from the app: every page carries a large CANCELLED stamp and why
async function stampCancelled(blob, f) {
  const pages = await pdfJpegs(blob);
  return pages.length ? new Blob([pdfPages(await stampPages(pages, 'CANCELLED', cancelledWhy(f)))], { type: 'application/pdf' }) : blob;
}

/* ---------- a correction by an admin, instead of a new signature ----------
   The person signed for the old amount, so their signature is never put under the new one. Page 1 is the voucher with the
   new details and the same photo, marked CORRECTED; its signature box says who signed, when and for how much, and that an
   admin approved the change. Page 2 is the original as they signed it (stamped CANCELLED). */
async function correctPaper(k, id) {
  if (!can('settings')) return;
  if (!await unlock('Enter your code to correct the voucher.')) return;
  const r = S[COLL[k]].find(x => x.id === id), old = filesFor(id).filter(f => SIGNED_TYPES.includes(f.type) && f.cancelled).pop();
  if (!r || !old) return;
  toast('Making the corrected PDF…');
  try {
    const original = await fileBlob(old.id), oldPages = await pdfJpegs(old.stamped ? original : await stampCancelled(original, old));
    const shot = filesFor(id, 'photo').filter(f => !f.removed && !f.replaced).pop();
    const photo = shot ? await fileBlob(shot.id).then(imgFrom).catch(() => null) : null;
    const type = k === 'R' ? 'receipt' : r.pay ? 'slip' : 'voucher';
    const [[no], seq] = nextIds(k === 'R' ? 'RC' : 'PV', 1, S.seq);
    update({ seq });
    const spec = k === 'R' ? receiptSpec(r, '') : r.pay ? payslipSpec(r) : voucherSpec(r);
    const me = myName() || S.lastBy || 'an admin', was = old.was ? slipMoney(old.was.amount, old.was.cur) : 'the amount on the original';
    const page1 = await renderSlip({ ...spec, no, stampDate: stampDate(r), amount: r.amount, cur: r.cur, sig: null, photo, preparedBy: r.by, ref: r.id,
      badge: `CORRECTED — REPLACES ${old.no || ''}`.trim(), approvedBy: me, ...await mySignature().then(sig => { const a = sig ? { sig, name: me, date: fmtDate(today()) } : null; return { approval: a, preparedSign: a && r.by === me ? a : null }; }),
      signNote: [`Signed by ${paperSigner(k, r)} on ${fmtDate(String(old.createdAt).slice(0, 10))} for ${was}.`, 'The signed original is on page 2.',
        `Corrected by ${me} (admin) on ${fmtDate(today())}:`, `${was} → ${slipMoney(r.amount, r.cur)}`] });
    const blob = new Blob([pdfPages([...await pdfJpegs(page1), ...oldPages])], { type: 'application/pdf' });
    const name = `${no} ${fileSafe(spec.signName || '')} corrected.pdf`;
    await keepFile({ for: r.id, type, no, name, mime: 'application/pdf', corrects: old.id }, await blob.arrayBuffer());
    readySheet(`${spec.title} — corrected`, no, blob, name);
  } catch (e) { toast(e.offline ? 'No internet — the original is not on this phone yet.' : e.message); }
}
// the paper an entry gets: a payment voucher, a salary slip, an advance voucher, a final settlement, or a receipt
const paperTitle = (k, r) => (k === 'R' ? 'Receipt' : r.pay ? { salary: 'Salary slip', advance: 'Advance voucher', settlement: 'Final settlement' }[r.pay] : 'Payment voucher');
const paperSigner = (k, r) => (k === 'R' ? (myName() || r.by || 'the person receiving') : r.paidTo);
// an entry whose signed paper was cancelled (it changed after signing) and not made again yet
const needsNewPaper = id => { const fs = filesFor(id).filter(f => SIGNED_TYPES.includes(f.type)); return fs.length > 0 && fs.every(f => f.cancelled); };
const cancelledWhyNote = (k, r) => `The old ${paperTitle(k, r).toLowerCase()} was cancelled because this payment changed after it was signed. ${esc(paperSigner(k, r))} signs again for <b>${esc(money(r.amount, r.cur))}</b>.`;
const cancelledNote = id => {
  if (!needsNewPaper(id)) return '';
  const e = S.expenses.find(x => x.id === id), k = e ? 'E' : 'R', r = e || S.credits.find(x => x.id === id);
  return r ? `<p class="note">🧾 ${cancelledWhyNote(k, r)} Make the new one below.</p>` : '';
};

// A cancelled paper already in Drive gets a stamped copy, sent up in its place (an admin's phone; the sheet bins the
// unstamped original). Tried once per opening of the app: a file this phone can't fetch now waits for the next time.
const stampTried = new Set();
async function queueStamps() {
  for (const f of live(S.files)) {
    if (!f.cancelled || f.stamped || !SIGNED_TYPES.includes(f.type) || stampTried.has(f.id) || outbox.some(o => o.id === f.id)) continue;
    stampTried.add(f.id);
    try {
      const data = await (await stampCancelled(await fileBlob(f.id), f)).arrayBuffer();
      await filePut({ ...f, data, pending: true, stamped: true });
      outbox = [...outbox, { ...f, stamped: true }];
    } catch { /* not on this phone and no internet: next time the app is opened */ }
  }
}
// A file record the sheet refuses (an admin's: never for the login) either names a Drive file the sheet has no note of
// uploading, or has no Drive number at all (saved by an app version that trusted a reply without one). Either way the file
// is sent again from this phone — once per opening of the app — so its record carries a file the sheet knows.
const resent = new Set();
async function resendRefused(ids) {
  if (!can('settings')) return;
  for (const f of S.files.filter(x => ids.has(x.id) && (VALID.F(x) || !x.fileId) && !resent.has(x.id))) {
    resent.add(f.id);
    const rec = await fileGet(f.id).catch(() => null);
    if (!rec || !rec.data) continue; // not on this phone: the message says which file it is
    await filePut({ ...rec, pending: true });
    outbox = [...outbox, { ...f }];
  }
  uploadFiles();
}
// Deleting is for good (nothing brings a record back), so files still waiting for a deleted record are never sent.
const forDeleted = id => Object.keys(SYNC_KEYS).some(k => (S[k] || []).some(r => r.id === id && r.deleted));
// Upload what's waiting, one file at a time; each one's record then goes out with the next sync.
// ponytail: an upload whose reply is lost is sent again, leaving a spare copy in Drive; harmless, never a lost file.
async function uploadFiles() {
  if (uploading || !S || !S.link || mustSignIn() || (S.link.v || 2) < 4) return;
  uploading = true;
  try {
    if (can('settings') && S.link.v >= 9) await queueStamps(); // the sheet bins the unstamped original from script v9
    if (!outbox.length) return;
    paintSync();
    for (const meta of outbox) {
      let rec = await fileGet(meta.id);
      if (rec && rec.pending && forDeleted(rec.for)) await fileDel(meta.id); // its entry was deleted before it went up
      if (!rec || !rec.pending || forDeleted(rec.for)) { outbox = outbox.filter(x => x.id !== meta.id); continue; }
      if (rec.cancelled && !rec.stamped && SIGNED_TYPES.includes(rec.type)) { // cancelled before it went up: it goes up stamped
        rec = { ...rec, data: await (await stampCancelled(new Blob([rec.data], { type: rec.mime }), rec)).arrayBuffer(), stamped: true };
        await filePut(rec);
      }
      let res;
      try { res = await callServer(S.link, { op: 'upload', name: rec.name, mime: rec.mime, data: toB64(rec.data) }); }
      catch (e) { uploadErr = await uploadFailure(e); break; }
      // a reply without the file's Drive number is not an upload (a record without one could never be filed): try again later
      if (!/^[\w-]{10,100}$/.test(String(res.fileId || ''))) { uploadErr = 'the Google Sheet did not give the file its Drive number — it tries again by itself.'; break; }
      const { data, pending, ...d } = rec, fresh = { ...d, fileId: res.fileId };
      update({ files: S.files.some(x => x.id === d.id) ? S.files.map(x => (x.id === d.id ? { ...x, ...fresh } : x)) : [...S.files, fresh] });
      await filePut({ ...rec, fileId: res.fileId, pending: false });
      outbox = outbox.filter(x => x.id !== meta.id);
      uploadErr = '';
    }
  } catch (e) { uploadErr = e.message; } finally { uploading = false; paintSync(); }
}

// The file's bytes: the copy on this phone, or fetched from the company Drive (and kept for next time).
async function fileBlob(id) {
  const hit = await fileGet(id).catch(() => null);
  if (hit) return new Blob([hit.data], { type: hit.mime });
  const rec = S.files.find(f => f.id === id);
  if (!rec || !S.link) throw new Error('This file is not on this phone.');
  const res = await callServer(S.link, { op: 'file', id });
  const data = fromB64(res.data).buffer;
  filePut({ ...rec, data, pending: false }).catch(() => {});
  return new Blob([data], { type: res.mime });
}
// a file waiting to go up wins over its record (a stamped copy of a cancelled paper replaces the one in Drive)
const fileMeta = id => outbox.find(f => f.id === id) || S.files.find(f => f.id === id);
const filesFor = (id, type) => [...live(S.files).filter(f => !outbox.some(o => o.id === f.id)), ...outbox.map(f => ({ ...f, pending: true }))]
  .filter(f => f.for === id && (!type || f.type === type)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
const latestFile = (id, type) => filesFor(id, type).pop();
const filesBlock = id => filesList(filesFor(id).filter(f => f.type !== 'profile'));
function filesList(list, title = 'Files') {
  if (!list.length) return '';
  return `<h3 class="subh">${esc(title)} (${list.length})</h3><div class="card list inset">${list.map(f => `<button class="row" data-act="showFile" data-id="${esc(f.id)}">
    <span class="dot">${FILE_ICON[f.type] || '📎'}</span>
    <span class="main"><span class="t"><span class="tt">${esc(f.no || FILE_NAME[f.type] || f.name)}</span>${f.cancelled ? '<i class="tag bad">Cancelled</i>' : f.removed ? '<i class="tag">Removed</i>' : f.replaced ? '<i class="tag">Replaced</i>' : f.pending ? '<i class="tag warn">Not uploaded yet</i>' : ''}</span>
    <span class="s">${esc([f.name, fmtAbs(String(f.createdAt).slice(0, 16)), f.by && 'by ' + f.by].filter(Boolean).join(' · '))}</span></span></button>`).join('')}</div>`;
}
// an "attach" button: a file box styled as a button (data-type says what it is)
const attachButton = (id, label = '📎 Attach photo/PDF', type = 'attachment', accept = 'image/*,application/pdf') =>
  `<label class="btn ghost">${label}<input type="file" hidden accept="${accept}" data-attach="${esc(id)}" data-type="${esc(type)}"></label>`;
async function attachPicked(input) {
  const file = input.files[0], forId = input.dataset.attach, type = input.dataset.type;
  input.value = '';
  if (!file) return;
  try {
    const p = type === 'stamp' ? await prepareFile(file, 900, 0.92, true) : type === 'letterhead' ? await prepareFile(file, SLIP_H, 0.92) : await prepareFile(file);
    if (type === 'stamp') stampPrev = null;
    const keep = type === 'letterhead' && (latestFile('settings', 'letterhead') || {}).contact; // a new letterhead keeps the contacts
    await keepFile({ for: forId, type, name: p.name, mime: p.mime, ...(keep ? { contact: keep } : {}) }, p.data);
  } catch (e) { return alert(e.message); }
  toast(`${FILE_NAME[type] || 'File'} added ✓`);
  reopenHere();
}

async function showFile(id) {
  const f = fileMeta(id);
  if (!f) return;
  let blob;
  try { blob = await fileBlob(id); if (f.cancelled && !f.stamped && f.mime === 'application/pdf') blob = await stampCancelled(blob, f); } catch (e) { return toast(e.offline ? 'No internet — this file is not on this phone yet.' : e.message); }
  shown = { blob, name: f.cancelled ? `CANCELLED ${f.name}` : f.name };
  const title = f.no || FILE_NAME[f.type] || 'File';
  openSheet(`${head(title, '', f.name)}
    ${f.cancelled ? `<p class="note">${esc(cancelledWhy(f))}. It is kept as proof and always sent with a CANCELLED stamp.</p>` : ''}
    ${f.mime === 'application/pdf' ? '<p class="filebig">📄</p>' : `<img class="viewimg" src="${URL.createObjectURL(blob)}" alt="${esc(title)}">`}
    <button class="btn in" data-act="shareShown">📤 Send or save</button>
    ${can('edit') && isOldVersion(f) && currentOf(f) ? `<button class="btn danger" data-act="deleteOld" data-id="${esc(id)}" style="margin-top:10px">🗑 Delete this old version</button>
      <p class="muted center">The current one (${esc(currentOf(f).no || currentOf(f).name)}) stays. A copy of this one stays in Drive, folder CHANGES.</p>` : ''}
    ${f.removed || f.replaced ? `<p class="note">${f.removed ? 'Removed' : 'Replaced by a newer one'} on ${esc(fmtAbs(String(f.removed || f.replaced).slice(0, 16)))}${f.removedBy || f.replacedBy ? ` by ${esc(f.removedBy || f.replacedBy)}` : ''}. Kept in the company Google Drive, folder CHANGES.</p>`
      : can('edit') && CHANGEABLE.includes(f.type) ? `<label class="btn ghost" style="margin-top:10px">🔄 Delete and replace<input type="file" hidden accept="image/*,application/pdf" data-replace="${esc(id)}"></label>
        <p class="muted center">Choose the new one: only then is this one taken off (a copy is kept in Drive, folder CHANGES).</p>`
      : can('edit') && SIGNED_TYPES.includes(f.type) && !f.cancelled && entryOf(f.for) ? `<button class="btn ghost" data-act="replacePaper" data-id="${esc(id)}" style="margin-top:10px">🔄 Delete and make a new one</button>
        <p class="muted center">This one is cancelled only when the new one is made; until then it stays as it is.</p>` : ''}
    ${f.pending ? `<p class="muted center">Kept on this phone, not uploaded yet: ${esc(uploadWhy())}</p>` : ''}`);
}
// A file on an entry is only ever deleted by putting a new one in its place (owner, 10 Oct 2026): nothing changes until
// the new one is there. An attachment or payment photo is replaced by a new upload (the old one is kept in Drive under
// CHANGES, script v12, and marked Replaced); a signed voucher, receipt or slip by a newly made one (the old one cancelled).
const CHANGEABLE = ['attachment', 'photo'];
const entryOf = id => { const e = S.expenses.find(x => x.id === id && !x.deleted); if (e) return ['E', e]; const r = S.credits.find(x => x.id === id && !x.deleted); return r ? ['R', r] : null; };
async function replacePaper(id) {
  const f = fileMeta(id), en = f && entryOf(f.for);
  if (!en || !await unlock('Enter your code to replace it.')) return;
  slipSheet(en[0], en[1].id, f.id);
}
async function replaceFile(input) {
  const file = input.files[0], old = fileMeta(input.dataset.replace);
  input.value = '';
  if (!file || !old || !await unlock('Enter your code to replace the file.')) return;
  try {
    const p = await prepareFile(file);
    await keepFile({ for: old.for, type: old.type, name: p.name, mime: p.mime, replaces: old.id }, p.data);
    await setAside(old, 'replaced');
    toast(`${FILE_NAME[old.type] || 'File'} replaced ✓ — the old one is kept`);
    closeSheet();
  } catch (e) { alert(e.message); }
}
// An old version (a cancelled paper, a replaced attachment) can be deleted from the app once the current one is there;
// its copy stays in Drive under CHANGES (owner: "delete a receipt if it has changed").
const isOldVersion = f => !!(f.cancelled || f.replaced || f.removed);
const currentOf = f => filesFor(f.for).filter(x => !isOldVersion(x) && (SIGNED_TYPES.includes(f.type) ? SIGNED_TYPES.includes(x.type) : x.type === f.type)).pop();
async function deleteOld(id) {
  const f = fileMeta(id);
  if (!f || !isOldVersion(f) || !currentOf(f) || !await unlock('Enter your code to delete the old version.')) return;
  if (!confirm(`Delete the old "${f.no || f.name}" from this entry?\n\nThe current one stays. A copy stays in the company Google Drive, folder CHANGES.`)) return;
  if (outbox.some(o => o.id === f.id)) { await fileDel(f.id).catch(() => {}); outbox = outbox.filter(o => o.id !== f.id); }
  else update({ files: S.files.map(x => (x.id === f.id ? { ...x, deleted: stampSec(), deletedBy: myName() || S.lastBy || '' } : x)) });
  toast('Old version deleted ✓');
  closeSheet();
}
// set a file aside: one not uploaded yet is simply dropped; one in Drive is kept there and marked
async function setAside(f, how) {
  if (outbox.some(o => o.id === f.id)) { await fileDel(f.id).catch(() => {}); outbox = outbox.filter(o => o.id !== f.id); return; }
  await patchFile(f, { [how]: stampSec(), [`${how}By`]: myName() || S.lastBy || '' });
}
const shareShown = () => shown && download(shown.blob, shown.name);

/* ---------- my signature: an admin's own, kept on this phone only (never in the sheet), for "Approved by" ----------
   Added once from a photo; the paper is made see-through (cleanStamp) and cut to the ink. It leaves the phone with the
   other file copies when the person signs out. Each slip asks, ticked by default, whether to sign with it. */
const mySigId = () => (signedIn() ? `mysig-${session.user.id}` : '');
let mySigCache = null;
async function mySignature() {
  const id = mySigId();
  if (!id || !can('settings')) return null;
  if (mySigCache && mySigCache.id === id) return mySigCache.canvas;
  const rec = await fileGet(id).catch(() => null);
  if (!rec) return null;
  const img = await imgFrom(new Blob([rec.data], { type: 'image/png' })), c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
  mySigCache = { id, canvas: c };
  return c;
}
async function mySigSheet() {
  const sig = await mySignature();
  openSheet(`${head('My signature')}
    <p class="hint">Saved on this phone only. Vouchers, slips and receipts you make can carry it under <b>Approved by</b>, with "Digitally signed by ${esc(myName())}". Use a photo of your signature on white paper — the paper is removed.</p>
    ${sig ? `<img class="viewimg" src="${sig.toDataURL('image/png')}" alt="My signature" style="background:#fff;padding:12px;border-radius:12px">` : '<p class="muted">No signature saved yet.</p>'}
    <label class="btn ghost">${sig ? 'Choose a new photo' : '✍️ Choose a photo of my signature'}<input type="file" hidden accept="image/*" data-mysig></label>
    ${sig ? '<button class="btn danger" data-act="mySigRemove" style="margin-top:10px">Remove my signature</button>' : ''}`);
  here = mySigSheet;
}
async function saveMySig(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const ink = inkOnly(cleanStamp(await imgFrom(file))); // see-through paper, cut to the ink
    if (!ink) return alert('No signature found in that photo. Use a dark pen on white paper.');
    const k = Math.min(1, 900 / ink.width), c = document.createElement('canvas');
    c.width = Math.round(ink.width * k); c.height = Math.round(ink.height * k); c.getContext('2d').drawImage(ink, 0, 0, c.width, c.height);
    await filePut({ id: mySigId(), mime: 'image/png', data: await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer(), pending: false, mine: true });
    mySigCache = null;
    toast('Signature saved ✓');
    mySigSheet();
  } catch (e) { alert(e.message); }
}
async function removeMySig() {
  if (!confirm('Remove your saved signature from this phone?')) return;
  await fileDel(mySigId()).catch(() => {});
  mySigCache = null;
  mySigSheet();
}
// on a slip form: sign "Approved by" with my saved signature (shown only when there is one)
const mySigField = (receipt = false) => `<label class="fld check approve-sig" hidden><input type="checkbox" name="mysig" checked> ✍️ Sign with my saved signature where I sign — prepared, ${receipt ? 'received (no need to draw above)' : 'approved'} (digitally signed)</label>`;
// an admin may name who checked it (remembered for next time)
const checkedField = () => (can('settings') ? `<label class="fld"><span>Checked by <em>(optional — a name)</em></span><input name="checkedBy" value="${esc(S.lastChecked || '')}" maxlength="60" autocomplete="off"></label>` : '');
function checkedFrom(f) {
  const v = f.elements.checkedBy ? clean(f.elements.checkedBy.value) : '';
  if (f.elements.checkedBy && v !== (S.lastChecked || '')) update({ lastChecked: v });
  return v;
}
const showMySigField = () => mySignature().then(sig => { const l = $('#sheet .approve-sig'); if (sig && l) l.hidden = false; }).catch(() => {});
async function approvalFrom(f) {
  const box = f.elements.mysig;
  if (!box || !box.checked || box.closest('label').hidden) return null;
  const sig = await mySignature();
  return sig ? { sig, name: myName(), date: fmtDate(today()) } : null;
}
// a saved signature above a Prepared / Approved by line, and a note under it that it was signed digitally
function drawSigned(g, x, y, w, a) {
  if (!a || !a.sig) return;
  const s = a.sig, k = Math.min(w / s.width, 90 / s.height, 1);
  g.save(); g.globalCompositeOperation = 'multiply'; // like ink: the stamp under it still shows
  g.drawImage(s, x, y - 36 - s.height * k, s.width * k, s.height * k);
  g.restore();
  g.fillStyle = SLIP_C.label; g.font = `italic 400 16px ${SANS}`; g.fillText(`Digitally signed by ${a.name} · ${a.date}`, x, y + 52);
}

/* ---------- signature pad ---------- */
function sigPad(cv) {
  const box = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr); g.lineWidth = 3; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = g.fillStyle = '#1B2232';
  delete cv.dataset.ink;
  let last = null;
  const at = e => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); last = at(e); g.beginPath(); g.arc(last[0], last[1], 1.5, 0, 7); g.fill(); cv.dataset.ink = '1'; };
  cv.onpointermove = e => { if (!last) return; const p = at(e); g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke(); last = p; };
  cv.onpointerup = cv.onpointercancel = () => { last = null; };
}
const sigField = who => `<div class="fld"><span>Signature of ${esc(who)} <em>(sign with a finger)</em></span><canvas class="sig"></canvas><button type="button" class="link" data-act="sigClear">Clear and sign again</button></div>`;
/* ---------- the payment photo: framed by hand in a 3 : 2 box (drag, pinch or slide to zoom); exactly that goes on the slip ---------- */
const PHOTO_RATIO = 1.5, PHOTO_OUT = 900;
const photoField = who => `<div class="fld photo-fld"><span>Photo of ${esc(who)} with the money <em>(optional)</em></span>
  <label class="btn ghost">📷 Take or choose a photo<input type="file" name="photo" accept="image/*" capture="environment" hidden></label>
  <div class="framer" hidden><canvas></canvas><i class="frame-guide"></i></div>
  <div class="framer-tools" hidden><b aria-hidden="true">−</b><input type="range" name="zoom" min="1" max="4" step="0.01" value="1" aria-label="Zoom the photo"><b aria-hidden="true">＋</b></div>
  <p class="muted framer-hint" hidden>Move the photo with your finger and zoom in or out (all the way out shows the whole photo) — it goes on the slip exactly like this.</p></div>`;
async function startFramer(input) {
  const f = input.form, file = input.files[0];
  if (!file) return;
  try {
    const img = await imgFrom(file), a = img.naturalWidth / img.naturalHeight;
    f._frame = { file, img, zoom: 1, min: Math.min(a / PHOTO_RATIO, PHOTO_RATIO / a), x: 0, y: 0, fresh: true }; // zoom 1 fills the box, min shows the whole photo
  } catch (e) { return alert(e.message); }
  const box = input.closest('.photo-fld');
  ['.framer', '.framer-tools', '.framer-hint'].forEach(sel => { $(sel, box).hidden = false; });
  $('label.btn', box).firstChild.textContent = '📷 Take another photo';
  f.elements.zoom.min = f._frame.min; f.elements.zoom.value = 1;
  framerEvents(f); drawFramer(f);
}
function drawFramer(f) {
  const fr = f._frame, cv = $('.framer canvas', f);
  if (!fr || !cv) return;
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1, cw = r.width, ch = r.height;
  if (cv.width !== Math.round(cw * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  if (fr.cw && cw !== fr.cw) { fr.x *= cw / fr.cw; fr.y *= cw / fr.cw; } // the box changed size (phone turned): keep the framing
  const iw = fr.img.naturalWidth, ih = fr.img.naturalHeight, s = Math.max(cw / iw, ch / ih) * fr.zoom;
  if (fr.fresh) { fr.x = (cw - iw * s) / 2; fr.y = (ch - ih * s) / 2; fr.fresh = false; } // starts centred
  const keep = (v, room) => Math.min(Math.max(0, room), Math.max(Math.min(0, room), v)); // larger than the box: no gaps; smaller: stays inside it
  fr.x = keep(fr.x, cw - iw * s); fr.y = keep(fr.y, ch - ih * s);
  fr.cw = cw; fr.s = s;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  g.drawImage(fr.img, fr.x, fr.y, iw * s, ih * s);
}
// zoom around a point of the box (its centre for the slider, between the fingers for a pinch)
function zoomFramer(f, zoom, cx, cy) {
  const fr = f._frame, cv = $('.framer canvas', f);
  if (!fr || !cv) return;
  const r = cv.getBoundingClientRect(), z = Math.min(4, Math.max(fr.min, zoom)), k = z / fr.zoom;
  cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
  fr.x = cx - (cx - fr.x) * k; fr.y = cy - (cy - fr.y) * k; fr.zoom = z;
  if (+f.elements.zoom.value !== z) f.elements.zoom.value = z;
  drawFramer(f);
}
function framerEvents(f) {
  const cv = $('.framer canvas', f), pts = new Map();
  let pinch = null;
  cv.onpointerdown = e => {
    try { cv.setPointerCapture(e.pointerId); } catch { /* a finger that already left */ }
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z: f._frame.zoom }; }
  };
  cv.onpointermove = e => {
    if (!pts.has(e.pointerId)) return;
    const was = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) { f._frame.x += e.clientX - was[0]; f._frame.y += e.clientY - was[1]; drawFramer(f); }
    else if (pinch) { const [a, b] = [...pts.values()], r = cv.getBoundingClientRect(); zoomFramer(f, pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); }
  };
  cv.onpointerup = cv.onpointercancel = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
}
// the photo exactly as framed, as a 3 : 2 picture for the slip (zoomed out, the box's empty parts stay see-through)
function framedPhoto(f) {
  const fr = f._frame;
  if (!fr || !fr.cw) return null;
  const c = document.createElement('canvas'), k = PHOTO_OUT / fr.cw;
  c.width = PHOTO_OUT; c.height = Math.round(PHOTO_OUT / PHOTO_RATIO);
  const g = c.getContext('2d');
  g.drawImage(fr.img, fr.x * k, fr.y * k, fr.img.naturalWidth * fr.s * k, fr.img.naturalHeight * fr.s * k);
  return c;
}
// the photo as taken (whole, not framed) is kept with the entry too, to open or send later
async function keepTakenPhoto(f, forId, no) {
  if (!f._frame) return;
  const p = await prepareFile(f._frame.file, ...TAKEN_PHOTO);
  await keepFile({ for: forId, type: 'photo', name: `${no} photo.jpg`, mime: p.mime }, p.data);
}
// a photo box on a slip or statement: exactly 3 : 2, centred in its cell, so the framing is kept as it was
function photoInto(g, photo, x, y, w, h) {
  const ph = Math.min(h, w / PHOTO_RATIO), pw = ph * PHOTO_RATIO;
  fitInto(g, photo, x + (w - pw) / 2, y + (h - ph) / 2, pw, ph, true);
}

/* ---------- slips: an A4 page drawn on a canvas, saved as a one-page PDF ---------- */
// Laid out like the company's paper voucher (paid to | date, being payment for | amount, amount in words,
// received by, prepared / checked / approved), printed on the letterhead, with the company stamp and its date.
const SLIP_W = 1240, SLIP_H = 1754; // A4 at 150 dots per inch
// one plain corporate family everywhere (Helvetica on iPhones and Macs, Arial or Roboto elsewhere); no heavy weights
const SANS = '"Helvetica Neue", Helvetica, Arial, Roboto, sans-serif';
const SLIP_C = { navy: '#26306B', accent: '#C8501E', ink: '#1B2232', label: '#6B7190', rule: '#C9CDDD', tint: 'rgba(38,48,107,.05)', stripe: 'rgba(38,48,107,.025)', stampInk: '#1D3FC4' };
const SLIP_TITLE = { voucher: 'PAYMENT VOUCHER', receipt: 'RECEIPT', salary: 'SALARY SLIP', advance: 'ADVANCE VOUCHER', settlement: 'FINAL SETTLEMENT' };
const STAMP_PLACE = { a: 72, r: 0.76, s: 0.12 }; // the date on the stamp: angle of the dotted line's middle (0 = right, 90 = down), its distance and letter size as parts of the stamp's radius
const slipMoney = (n, cur) => `${cur} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function wrapText(g, text, width) {
  const lines = [];
  let line = '';
  for (const w of String(text).split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (line && g.measureText(t).width > width) { lines.push(line); line = w; } else line = t;
  }
  return line ? [...lines, line] : lines;
}
function fitInto(g, img, x, y, w, h, cover) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = cover ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih), dw = iw * k, dh = ih * k;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  g.restore();
}
// the signature pad cut down to the ink, so it can be set on the signature line at a proper size
function inkOnly(cv) {
  const w = cv.width, h = cv.height, px = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const c = document.createElement('canvas'), m = 4;
  c.width = x1 - x0 + 1 + 2 * m; c.height = y1 - y0 + 1 + 2 * m;
  c.getContext('2d').drawImage(cv, x0 - m, y0 - m, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}
// set on the line at (x, lineY): as big as fits in maxW × maxH, its bottom just above the line — but never blown up so
// far that the pen line turns thick (the pad draws 3 screen points wide, i.e. 3 × the screen's pixel density)
function placeSignature(g, sig, x, lineY, maxW, maxH) {
  const ink = sig && inkOnly(sig);
  if (!ink) return;
  const k = Math.min(maxW / ink.width, Math.min(maxH, 130) / ink.height, 1.4 / (devicePixelRatio || 1));
  g.drawImage(ink, x, lineY - 4 - ink.height * k, ink.width * k, ink.height * k);
}
const boxPath = (g, x, y, w, h, r = 14) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
// letter-spaced text, drawn one letter at a time (works on every phone); align 'left' | 'right' | 'center'
function spaced(g, text, x, y, gap, align = 'left') {
  const ws = [...text].map(ch => g.measureText(ch).width), total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
  let at = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const was = g.textAlign;
  g.textAlign = 'left';
  [...text].forEach((ch, i) => { g.fillText(ch, at, y); at += ws[i] + gap; });
  g.textAlign = was;
}
const slipLabel = (g, text, x, y) => { g.fillStyle = SLIP_C.label; g.font = `600 18px ${SANS}`; spaced(g, text.toUpperCase(), x, y, 1.6); };
async function brandImage(type) {
  const f = latestFile('settings', type);
  if (!f) return null;
  try { return Object.assign(await imgFrom(await fileBlob(f.id)), { place: f.place }); } catch { return null; } // offline and never fetched: left out
}
// pictures shipped with the app: the company's logo (slips made before a letterhead is set) and the watermark
const shipped = {};
const shippedImage = src => shipped[src] || (shipped[src] = new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; }));
const wideLogo = () => shippedImage('logo-wide.png'), watermark = () => shippedImage('watermark.png');
const logoOrName = (g, logo) => { if (logo) g.drawImage(logo, 90, 52, 110 * logo.naturalWidth / logo.naturalHeight, 110); else { g.fillStyle = SLIP_C.navy; g.font = `700 46px ${SANS}`; g.fillText(S.company || 'Company', 90, 120); } };
const letterheadImage = () => brandImage('letterhead');
// keep the letterhead and stamp on the phone, so slips made offline still carry them
function warmLetterhead() { ['letterhead', 'stamp'].forEach(t => { const f = latestFile('settings', t); if (f && !f.pending) fileBlob(f.id).catch(() => {}); }); }

// The stamp's ink alone: the background colour (read from the corners: white paper, a black square, or already
// see-through) is made see-through, with soft edges, so the stamp sits on the page like real ink.
function cleanStamp(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h), px = d.data;
  const at = (x, y) => (y * w + x) * 4, corners = [at(2, 2), at(w - 3, 2), at(2, h - 3), at(w - 3, h - 3)];
  if (corners.every(i => px[i + 3] < 20)) return c; // already see-through
  const bg = [0, 1, 2].map(k => corners.reduce((t, i) => t + px[i + k], 0) / 4);
  for (let i = 0; i < px.length; i += 4) {
    const dist = Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2]));
    px[i + 3] = Math.round(px[i + 3] * Math.min(1, Math.max(0, (dist - 40) / 70)));
  }
  g.putImageData(d, 0, 0);
  return c;
}
// The stamp's ring: the box around its ink, so any photo or scan of it lines up.
function inkCircle(img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const n = 240, k = n / Math.max(iw, ih), w = Math.round(iw * k), h = Math.round(ih * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (px[i + 3] > 60 && px[i] + px[i + 1] + px[i + 2] < 600) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (x1 <= x0) return { cx: iw / 2, cy: ih / 2, R: Math.min(iw, ih) / 2 };
  return { cx: (x0 + x1 + 1) / 2 / k, cy: (y0 + y1 + 1) / 2 / k, R: Math.max(x1 - x0 + 1, y1 - y0 + 1) / 2 / k };
}
// The stamp, its ring `size` across and centred on (x, y), with the date written along its dotted line.
function drawStamp(g, img, x, y, size, dateText, place) {
  const ink = img.ink || (img.ink = cleanStamp(img)), c = img.circle || (img.circle = inkCircle(ink)), k = size / (2 * c.R), p = { ...STAMP_PLACE, ...(place || {}) };
  g.save();
  g.globalCompositeOperation = 'multiply'; // like real ink: the printing under it still shows
  g.drawImage(ink, x - c.cx * k, y - c.cy * k, ink.width * k, ink.height * k);
  g.globalCompositeOperation = 'source-over';
  const R = size / 2, r = p.r * R, fs = Math.max(8, p.s * R);
  g.font = `700 ${fs}px ${SANS}`; g.fillStyle = SLIP_C.stampInk; g.textAlign = 'center';
  const chars = [...dateText], ws = chars.map(ch => g.measureText(ch).width), gap = fs * 0.06;
  let ang = p.a * Math.PI / 180 + (ws.reduce((a, b) => a + b, 0) + gap * (chars.length - 1)) / 2 / r; // from the left end, going round
  chars.forEach((ch, i) => {
    ang -= ws[i] / 2 / r;
    g.save(); g.translate(x + r * Math.cos(ang), y + r * Math.sin(ang)); g.rotate(ang - Math.PI / 2); g.fillText(ch, 0, 0); g.restore();
    ang -= (ws[i] / 2 + gap) / r;
  });
  g.restore();
}

// The company's contacts (Settings → Letterhead), kept on the letterhead's record: the sheet sends that to every login,
// so every phone's PDFs carry them, and the numbers stay out of the app's (public) code.
const CONTACT_FIELDS = [['whatsapp', 'WhatsApp', 'e.g. @yourcompany', 'text'], ['phone', 'Phone', 'e.g. +211 900 000 000', 'tel'], ['web', 'Website', 'e.g. yourcompany.com', 'url'], ['email', 'Email', 'e.g. info@yourcompany.com', 'email']];
const companyContacts = () => { const c = (latestFile('settings', 'letterhead') || {}).contact || {}; return CONTACT_FIELDS.filter(([k]) => c[k]).map(([k, label]) => [label, String(c[k])]); };
// top right of every page, level with the logo: a thin accent line, then label and value on each row
function drawContacts(p, rows) {
  if (!rows.length) return;
  const R = SLIP_W - 90, lineH = 34, labW = 118, top = 122 - rows.length * lineH / 2;
  p.font = `500 22px ${SANS}`;
  const vals = rows.map(([, v]) => fitText(p, v, 400)), x = R - labW - Math.max(...vals.map(v => p.measureText(v).width));
  p.fillStyle = SLIP_C.accent; p.fillRect(x - 22, top + 2, 3, rows.length * lineH - 4);
  rows.forEach(([lab], i) => {
    const y = top + i * lineH + 25;
    p.fillStyle = SLIP_C.label; p.font = `600 15px ${SANS}`; spaced(p, lab.toUpperCase(), x, y - 1, 1.4);
    p.fillStyle = SLIP_C.navy; p.font = `500 22px ${SANS}`; p.fillText(vals[i], x + labW, y);
  });
}

/* s = { title, no, stampDate, party: [label, value], when: [label, value], forLabel, lines: [{ t, v, strong, muted }],
         amount, cur, extra: [[label, value]], signLabel, signName, sig: canvas, photo: image|null, preparedBy, ref } */
// A page is as tall as what it holds (A4 width). Only the letterhead's header (top LH_TOP) is used — its address strip is
// left off (the owner's choice); the company's contacts are printed at the top right instead. The company's "B"
// (watermark.png, cut from the letterhead by tools/make-icons.py) fills the room below the header: as on the printed
// letterhead on a full A4 page, shrunk to fit a shorter one. It is drawn with or without a letterhead.
const LH_TOP = 0.18, WM = { h: 1065, right: 1229, fill: 0.9 }; // its height and right edge on A4; the part of the room it may take
function drawLetterhead(p, lh, wm, H) {
  const topH = lh ? lh.naturalHeight * LH_TOP * SLIP_W / lh.naturalWidth : 180;
  if (lh) p.drawImage(lh, 0, 0, lh.naturalWidth, lh.naturalHeight * LH_TOP, 0, 0, SLIP_W, topH);
  drawContacts(p, companyContacts());
  if (!wm) return;
  const room = H - topH, dh = Math.min(WM.h, room * WM.fill), dw = dh * wm.naturalWidth / wm.naturalHeight;
  p.save(); p.globalCompositeOperation = 'multiply'; // its white paper doesn't cover anything
  p.drawImage(wm, WM.right - dw, topH + (room - dh) / 2, dw, dh); // kept to the right edge, as printed
  p.restore();
}
async function renderSlip(s) {
  const C = SLIP_C, L = 90, R = SLIP_W - 90, CX = L + 660;
  const [lh, stampImg, logo, wm] = await Promise.all([letterheadImage(), brandImage('stamp'), wideLogo(), watermark()]);
  const c = document.createElement('canvas'); // the form, on a see-through layer as tall as it needs
  c.width = SLIP_W; c.height = 2600;
  const g = c.getContext('2d');
  let y = lh ? 268 : 200;
  if (!lh) { logoOrName(g, logo); y = 220; }
  // title and number
  g.fillStyle = C.navy; g.font = `700 46px ${SANS}`; spaced(g, s.title, L, y + 46, 4);
  g.fillStyle = C.accent; g.fillRect(L, y + 66, 90, 5);
  if (s.badge) { g.font = `700 20px ${SANS}`; spaced(g, s.badge, L + 110, y + 75, 1.6); } // e.g. CORRECTED — REPLACES PV-…
  g.font = `600 18px ${SANS}`; g.fillStyle = C.label; spaced(g, 'NO.', R, y + 16, 1.6, 'right');
  g.fillStyle = C.accent; g.font = `700 36px ${SANS}`; g.textAlign = 'right'; g.fillText(s.no, R, y + 52); g.textAlign = 'left';
  y += 110;
  const lineFont = 28, lineH = 46, h4 = 270;
  const lineFontOf = l => `${l.strong ? 700 : 500} ${l.muted ? lineFont - 4 : lineFont}px ${SANS}`;
  // each pay line wraps only where its own amount leaves no room
  const lines = s.lines.flatMap(l => { g.font = lineFontOf(l); const room = CX - L - 48 - (l.v ? g.measureText(l.v).width + 28 : 0); return wrapText(g, l.t, room).map((t, i) => ({ ...l, t, v: i ? '' : l.v })); });
  g.font = `700 32px ${SANS}`; const party = wrapText(g, s.party[1] || '—', CX - L - 50), h1 = 76 + party.length * 40;
  const h2 = Math.max(250, 70 + lines.length * lineH + 20);
  g.font = `italic 28px ${SANS}`; const words = wrapText(g, amountInWords(s.amount, s.cur), CX - L - 50);
  const h3 = Math.max(76 + words.length * 38, 70 + s.extra.length * 64);
  const top = y, cells = [];
  const row = (h, draw) => { cells.push([y, h]); draw(y, h); y += h; };
  // row 1: paid to | date
  row(h1, t => {
    slipLabel(g, s.party[0], L + 24, t + 34);
    g.fillStyle = C.ink; g.font = `700 32px ${SANS}`; party.forEach((p, i) => g.fillText(p, L + 24, t + 78 + i * 40));
    slipLabel(g, s.when[0], CX + 24, t + 34);
    g.fillStyle = C.ink; g.font = `700 30px ${SANS}`; wrapText(g, s.when[1], R - CX - 48).forEach((p, i) => g.fillText(p, CX + 24, t + 78 + i * 36));
  });
  // row 2: being payment for | amount in
  row(h2, t => {
    slipLabel(g, s.forLabel || 'Being payment for', L + 24, t + 34);
    lines.forEach((l, i) => {
      const ly = t + 82 + i * lineH;
      g.fillStyle = l.muted ? C.label : C.ink; g.font = lineFontOf(l);
      g.fillText(l.t, L + 24, ly);
      if (l.v) { g.textAlign = 'right'; g.fillText(l.v, CX - 24, ly); g.textAlign = 'left'; }
      if (l.strong) { g.fillStyle = C.rule; g.fillRect(L + 24, ly - 36, CX - L - 48, 1); }
    });
    slipLabel(g, 'Amount in', CX + 24, t + 34);
    ['SSP', 'USD'].forEach((cur, i) => {
      const bx = CX + 24 + i * 130, by = t + 52;
      g.strokeStyle = C.navy; g.lineWidth = 2; g.strokeRect(bx, by, 28, 28);
      if (cur === s.cur) { g.beginPath(); g.moveTo(bx + 6, by + 15); g.lineTo(bx + 12, by + 22); g.lineTo(bx + 23, by + 6); g.lineWidth = 4; g.stroke(); }
      g.fillStyle = C.ink; g.font = `700 24px ${SANS}`; g.fillText(cur, bx + 38, by + 24);
    });
    const ax = CX + 24, aw = R - CX - 48, ay = t + 104, ah = Math.min(140, Math.max(96, h2 - 130));
    boxPath(g, ax, ay, aw, ah); g.fillStyle = C.tint; g.fill(); g.strokeStyle = C.navy; g.lineWidth = 2.5; g.stroke();
    const text = slipMoney(s.amount, s.cur);
    let fs = 44; g.font = `700 ${fs}px ${SANS}`;
    while (g.measureText(text).width > aw - 36 && fs > 22) { fs -= 2; g.font = `700 ${fs}px ${SANS}`; }
    g.fillStyle = C.ink; g.textAlign = 'right'; g.fillText(text, ax + aw - 18, ay + ah / 2 + fs * 0.36); g.textAlign = 'left';
  });
  // row 3: amount in words | paid from (and the day's rate)
  row(h3, t => {
    slipLabel(g, 'Amount in words', L + 24, t + 34);
    g.fillStyle = C.ink; g.font = `italic 28px ${SANS}`; words.forEach((w, i) => g.fillText(w, L + 24, t + 76 + i * 38));
    s.extra.forEach(([lab, val], i) => {
      slipLabel(g, lab, CX + 24, t + 34 + i * 64);
      g.fillStyle = C.ink; g.font = `600 24px ${SANS}`; g.fillText(val, CX + 24, t + 64 + i * 64);
    });
  });
  // row 4: received by (signature on its line, the name under it) | photo
  const split = s.photo ? CX : R;
  row(h4, t => {
    const lineY = t + h4 - 52, lineW = Math.min(520, split - L - 48);
    slipLabel(g, s.signLabel, L + 24, t + 34);
    if (s.signNote) { // a correction: what was signed, and who approved the change (never the signature under new figures)
      let ny = t + 74;
      s.signNote.forEach((line, i) => { g.fillStyle = i >= 2 ? C.accent : C.ink; g.font = `${i === 3 ? 700 : 500} 22px ${SANS}`; wrapText(g, line, split - L - 48).forEach(w => { g.fillText(w, L + 24, ny); ny += 32; }); });
    } else {
      placeSignature(g, s.receivedSign ? s.receivedSign.sig : s.sig, L + 24, lineY, lineW, lineY - t - 52);
      g.fillStyle = C.ink; g.fillRect(L + 24, lineY, lineW, 1.5);
      g.font = `600 24px ${SANS}`; g.fillText(s.signName || '', L + 24, lineY + 30);
      g.fillStyle = C.label; g.font = `400 18px ${SANS}`; g.textAlign = 'right'; g.fillText(s.receivedSign ? `Digitally signed · ${s.receivedSign.date}` : 'Signature', L + 24 + lineW, lineY + 30); g.textAlign = 'left';
    }
    if (s.photo) photoInto(g, s.photo, CX + 14, t + 14, R - CX - 28, h4 - 28);
  });
  // the ruling: outer box, the column line and the lines between rows (see-through: the watermark shows behind)
  g.strokeStyle = C.navy; g.lineWidth = 2.5; g.strokeRect(L, top, R - L, y - top);
  g.fillStyle = C.navy;
  cells.slice(1).forEach(([cy]) => g.fillRect(L, cy - 0.75, R - L, 1.5));
  cells.forEach(([cy, ch], i) => { if (i < 3 || s.photo) g.fillRect(CX - 0.75, cy, 1.5, ch); });
  // prepared / checked / approved; the company stamp goes over "approved", the way it is stamped on paper
  y += 200;
  const colW = (R - L) / 3;
  if (stampImg) drawStamp(g, stampImg, R - 112, y - 82, 216, s.stampDate, stampImg.place);
  [['Prepared by', s.preparedBy || '', s.preparedSign], ['Checked by', s.checkedBy || '', null], ['Approved by', s.approvedBy || (s.approval ? s.approval.name : ''), s.approval]].forEach(([lab, name, sign], i) => {
    const x = L + i * colW;
    drawSigned(g, x, y, colW - 40, sign);
    g.fillStyle = C.ink; g.font = `600 24px ${SANS}`; if (name) g.fillText(name, x, y - 14);
    g.fillRect(x, y, colW - 40, 1.5);
    slipLabel(g, lab, x, y + 30); // drawn after the stamp, so the words stay readable
  });
  g.fillStyle = C.label; g.font = `400 18px ${SANS}`;
  g.fillText(`Ref ${s.ref} · made in the company app on ${fmtAbs(stamp())}`, L, y + 76);
  // the page: exactly as tall as the slip, on the letterhead's header with the watermark behind the form
  const H = y + 104;
  const page = document.createElement('canvas');
  page.width = SLIP_W; page.height = H;
  const p = page.getContext('2d');
  p.fillStyle = '#fff'; p.fillRect(0, 0, SLIP_W, H);
  drawLetterhead(p, lh, wm, H);
  p.drawImage(c, 0, 0);
  const jpeg = new Uint8Array(await (await canvasJpeg(page, PDF_Q)).arrayBuffer());
  return new Blob([jpegToPdf(jpeg, SLIP_W, H)], { type: 'application/pdf' });
}

/* ---------- statements: every entry for one person or project, on as many pages as it takes ---------- */
/* st = { title, no, date, info: [[label, value]], sections: [{ title, cols: [{ h, w, right }], rows: [[cell]], total: [label, value] }],
          summary: [[label, value, strong]], verdict: { text, good } | null, sign: { label, name, sig, photo } | null, preparedBy, ref } */
const fitText = (g, t, w) => { t = String(t ?? ''); if (g.measureText(t).width <= w) return t; while (t && g.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; };
async function renderStatement(st) {
  const [lh, stampImg, logo, wm] = await Promise.all([letterheadImage(), st.sign ? brandImage('stamp') : null, wideLogo(), watermark()]);
  const C = SLIP_C, L = 90, R = SLIP_W - 90, W = R - L, top = lh ? 268 : 200, limit = SLIP_H - 80, pages = [];
  let g, y;
  const page = () => {
    const c = document.createElement('canvas');
    c.width = SLIP_W; c.height = SLIP_H; pages.push(c);
    g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, SLIP_W, SLIP_H);
    drawLetterhead(g, lh, wm, SLIP_H);
    if (!lh) logoOrName(g, logo);
    y = top;
    if (pages.length > 1) { g.fillStyle = C.navy; g.font = `700 28px ${SANS}`; spaced(g, `${st.title} — CONTINUED`, L, y + 30, 2); g.fillStyle = C.label; g.font = `600 22px ${SANS}`; g.textAlign = 'right'; g.fillText(st.no, R, y + 30); g.textAlign = 'left'; y += 64; }
  };
  page();
  g.fillStyle = C.navy; g.font = `700 44px ${SANS}`; spaced(g, st.title, L, y + 46, 3);
  g.fillStyle = C.accent; g.fillRect(L, y + 66, 90, 5);
  g.font = `600 18px ${SANS}`; g.fillStyle = C.label; spaced(g, 'NO.', R, y + 16, 1.6, 'right');
  g.fillStyle = C.accent; g.font = `700 34px ${SANS}`; g.textAlign = 'right'; g.fillText(st.no, R, y + 52);
  g.fillStyle = C.ink; g.font = `500 22px ${SANS}`; g.fillText(st.date, R, y + 84); g.textAlign = 'left';
  y += 112;
  // who it is about: a ruled box of label / value pairs, two to a row
  const rowsN = Math.ceil(st.info.length / 2), ih = 70;
  g.strokeStyle = C.navy; g.lineWidth = 2; g.strokeRect(L, y, W, rowsN * ih);
  st.info.forEach(([lab, val], i) => {
    const x = L + (i % 2) * (W / 2), ry = y + Math.floor(i / 2) * ih;
    if (i % 2) { g.fillStyle = C.rule; g.fillRect(x, ry, 1.5, ih); }
    if (i >= 2 && i % 2 === 0) { g.fillStyle = C.rule; g.fillRect(L, ry, W, 1.5); }
    slipLabel(g, lab, x + 20, ry + 28);
    g.fillStyle = C.ink; g.font = `700 26px ${SANS}`; g.fillText(fitText(g, val, W / 2 - 40), x + 20, ry + 58);
  });
  y += rowsN * ih + 30;
  // tables: a header band, rows with a light stripe, a total line; they carry on to the next page when full
  const colX = cols => { let x = L; return cols.map(c => { const at = x; x += c.w; return at; }); };
  for (const sec of st.sections) {
    const xs = colX(sec.cols);
    const headRow = () => {
      g.fillStyle = C.tint; g.fillRect(L, y, W, 44); g.fillStyle = C.navy; g.fillRect(L, y + 43, W, 1.5);
      sec.cols.forEach((c, i) => { g.fillStyle = C.label; g.font = `700 17px ${SANS}`; spaced(g, c.h.toUpperCase(), c.right ? xs[i] + c.w - 14 : xs[i] + 14, y + 28, 1.2, c.right ? 'right' : 'left'); });
      y += 44;
    };
    if (y + 170 > limit) page();
    g.fillStyle = C.navy; g.font = `700 24px ${SANS}`; g.fillText(sec.title, L, y + 24); y += 40;
    headRow();
    if (!sec.rows.length) { g.fillStyle = C.label; g.font = `italic 22px ${SANS}`; g.fillText('Nothing yet.', L + 14, y + 30); y += 44; }
    sec.rows.forEach((row, ri) => {
      if (y + 40 > limit - 60) { page(); headRow(); }
      if (ri % 2) { g.fillStyle = C.stripe; g.fillRect(L, y, W, 40); }
      row.forEach((cell, i) => {
        const c = sec.cols[i];
        g.fillStyle = C.ink; g.font = `${c.right ? 600 : 500} 22px ${SANS}`;
        const t = fitText(g, cell, c.w - 28);
        if (c.right) { g.textAlign = 'right'; g.fillText(t, xs[i] + c.w - 14, y + 27); g.textAlign = 'left'; } else g.fillText(t, xs[i] + 14, y + 27);
      });
      y += 40;
    });
    if (sec.total) {
      g.fillStyle = C.navy; g.fillRect(L, y, W, 1.5);
      g.fillStyle = C.ink; g.font = `700 24px ${SANS}`; g.fillText(sec.total[0], L + 14, y + 34);
      g.textAlign = 'right'; g.fillText(sec.total[1], R - 14, y + 34); g.textAlign = 'left';
      y += 50;
    }
    y += 24;
  }
  // the totals and the verdict stay together; the signature block follows (on the next page only if it must)
  if (y + st.summary.length * 44 + 24 + (st.verdict ? 100 : 0) > limit) page();
  const sx = L + W / 2 - 20, sw = R - sx;
  st.summary.forEach(([lab, val, strong], i) => {
    const ry = y + i * 44;
    if (strong) { g.fillStyle = C.navy; g.fillRect(sx, ry, sw, 1.5); }
    g.fillStyle = strong ? C.ink : C.label; g.font = `${strong ? 700 : 500} ${strong ? 26 : 24}px ${SANS}`; g.fillText(lab, sx + 10, ry + 33);
    g.fillStyle = C.ink; g.textAlign = 'right'; g.fillText(val, R - 10, ry + 33); g.textAlign = 'left';
  });
  y += st.summary.length * 44 + 20;
  if (st.verdict) {
    const tone = st.verdict.good ? '#0E7C57' : C.accent;
    boxPath(g, L, y, W, 76); g.fillStyle = st.verdict.good ? 'rgba(14,124,87,.08)' : 'rgba(200,80,30,.08)'; g.fill(); g.strokeStyle = tone; g.lineWidth = 3; g.stroke();
    g.fillStyle = tone; g.font = `700 30px ${SANS}`; spaced(g, st.verdict.text, L + W / 2, y + 49, 2, 'center');
    y += 100;
  }
  if (st.sign && y + 200 + 120 + 40 > limit) page();
  if (st.sign) {
    const s = st.sign, h = 200, split = s.photo ? L + 660 : R;
    g.strokeStyle = C.navy; g.lineWidth = 2.5; g.strokeRect(L, y, W, h);
    if (s.photo) { g.fillStyle = C.navy; g.fillRect(split, y, 1.5, h); photoInto(g, s.photo, split + 14, y + 14, R - split - 28, h - 28); }
    const lineY = y + h - 50, lineW = Math.min(520, split - L - 48);
    slipLabel(g, s.label, L + 24, y + 34);
    placeSignature(g, s.sig, L + 24, lineY, lineW, lineY - y - 50);
    g.fillStyle = C.ink; g.fillRect(L + 24, lineY, lineW, 1.5);
    g.fillStyle = C.ink; g.font = `600 24px ${SANS}`; g.fillText(s.name, L + 24, lineY + 30);
    g.fillStyle = C.label; g.font = `400 18px ${SANS}`; g.textAlign = 'right'; g.fillText('Signature', L + 24 + lineW, lineY + 30); g.textAlign = 'left';
    y += h + 120;
    const colW = W / 3;
    if (stampImg) drawStamp(g, stampImg, R - 104, y - 45, 180, st.stampDate, stampImg.place); // clear of the page number below
    [['Prepared by', st.preparedBy || '', st.preparedSign], ['Checked by', st.checkedBy || '', null], ['Approved by', st.approval ? st.approval.name : '', st.approval]].forEach(([lab, name, sign], i) => {
      const x = L + i * colW;
      drawSigned(g, x, y, colW - 40, sign);
      g.fillStyle = C.ink; g.font = `600 24px ${SANS}`; if (name) g.fillText(name, x, y - 14);
      g.fillRect(x, y, colW - 40, 1.5);
      slipLabel(g, lab, x, y + 30);
    });
    y += 40;
  }
  // on every page's bottom edge: where it came from (left) and the page number (right)
  const made = `${st.ref ? `Ref ${st.ref} · ` : ''}made in the company app on ${fmtAbs(stamp())}`;
  pages.forEach((c, i) => {
    const p = c.getContext('2d'); p.fillStyle = C.label; p.font = `500 18px ${SANS}`;
    p.fillText(made, L, limit + 20); p.textAlign = 'right'; p.fillText(`Page ${i + 1} of ${pages.length}`, R, limit + 20);
  });
  const jpegs = await Promise.all(pages.map(async c => ({ data: new Uint8Array(await (await canvasJpeg(c, PDF_Q)).arrayBuffer()), w: SLIP_W, h: SLIP_H })));
  return new Blob([pdfPages(jpegs)], { type: 'application/pdf' });
}
// the voucher or receipt number made for an entry, if any
const docNo = id => (filesFor(id).filter(f => f.no && !f.cancelled).pop() || {}).no || '';
const sumByCur = items => CURS.filter(c => items.some(x => x.cur === c)).map(c => slipMoney(total(items.filter(x => x.cur === c)), c));
// a statement that isn't kept: made, then offered for sending (it can be made again any time)
async function shareStatement(st, fileName) {
  toast('Making the statement…');
  try { const blob = await renderStatement(st); readySheet(st.title, st.no, blob, fileName); }
  catch (e) { alert(`The statement could not be made: ${e.message}`); }
}
const statementNo = () => { const [[no], seq] = nextIds('ST', 1, S.seq); update({ seq }); return no; };
// all money received for a project (for its client), with the receipt numbers
function projectStatement(pid) {
  const p = S.projects.find(x => x.id === pid), list = live(S.credits).filter(c => c.project === pid).sort(byAt), s = projStats(pid);
  const st = { title: 'STATEMENT OF PAYMENTS', no: statementNo(), date: fmtDate(stamp().slice(0, 10)),
    info: [['Project', p.name], ['Project value', p.value ? slipMoney(p.value, p.valueCur || 'USD') : '—'], ['Payments', String(list.length)], ['Period', list.length ? `${fmtDate(list[0].at.slice(0, 10))} – ${fmtDate(list[list.length - 1].at.slice(0, 10))}` : '—']],
    sections: [{ title: 'Money received', cols: [{ h: 'Date', w: 190 }, { h: 'Receipt / ref', w: 210 }, { h: 'Note', w: 410 }, { h: 'Amount', w: 250, right: true }],
      rows: list.map(c => [fmtDate(c.at.slice(0, 10)), docNo(c.id) || c.id, c.note || `Into ${accountOf(c.mode)}`, slipMoney(c.amount, c.cur)]) }],
    summary: sumByCur(list).map(t => ['Total received', t, true]),
    verdict: p.value ? (s.pending ? { text: `STILL TO RECEIVE ${slipMoney(s.pending, s.vc)}`, good: false } : { text: 'FULLY PAID', good: true }) : null, sign: null };
  shareStatement(st, `${st.no} ${fileSafe(p.name)}.pdf`);
}
// all payments to one name ("Paid to"), with the voucher numbers
function payeeStatement(name) {
  const key = clean(name).toLowerCase(), list = live(S.expenses).filter(e => clean(e.paidTo).toLowerCase() === key).sort(byAt);
  const st = { title: 'STATEMENT OF PAYMENTS', no: statementNo(), date: fmtDate(stamp().slice(0, 10)),
    info: [['Paid to', name], ['Payments', String(list.length)], ['From', list.length ? fmtDate(list[0].at.slice(0, 10)) : '—'], ['To', list.length ? fmtDate(list[list.length - 1].at.slice(0, 10)) : '—']],
    sections: [{ title: 'Payments', cols: [{ h: 'Date', w: 190 }, { h: 'Voucher / ref', w: 210 }, { h: 'For', w: 410 }, { h: 'Amount', w: 250, right: true }],
      rows: list.map(e => [fmtDate(e.at.slice(0, 10)), docNo(e.id) || e.id, e.reason, slipMoney(e.amount, e.cur)]) }],
    summary: sumByCur(list).map(t => ['Total paid', t, true]), verdict: null, sign: null };
  shareStatement(st, `${st.no} ${fileSafe(name)}.pdf`);
}

// the day's rate for an SSP entry, and what it was worth in dollars
const usdOf = r => (r.cur === 'SSP' && r.rate > 0 ? Math.round(r.amount / r.rate * 100) / 100 : null);
const rateRow = r => (usdOf(r) === null ? [] : [['Rate', `1 USD = ${plain(r.rate)} SSP · ≈ ${money(usdOf(r), 'USD')}`]]);
const slipDay = r => { const [y, m, d] = r.at.slice(0, 10).split('-').map(Number); return `${DAYS[new Date(y, m - 1, d).getDay()]}, ${fmtDate(r.at.slice(0, 10))}`; };
const stampDate = r => r.at.slice(0, 10).split('-').reverse().join('-'); // 09-10-2026, as written on the paper vouchers
function voucherSpec(r) {
  return { title: SLIP_TITLE.voucher, party: ['Paid to', r.paidTo], when: ['Date', slipDay(r)], forLabel: 'Being payment for',
    lines: [{ t: r.reason, v: slipMoney(r.amount, r.cur) }, r.project && { t: `Project: ${projName(r.project)}`, muted: true }, r.location && { t: `Location: ${r.location}`, muted: true }].filter(Boolean),
    extra: [['Paid from', accountOf(r.mode)], ...rateRow(r)], signLabel: 'Received by', signName: r.paidTo };
}
function receiptSpec(r, party) {
  return { title: SLIP_TITLE.receipt, party: ['Received from', party || '—'], when: ['Date', slipDay(r)], forLabel: 'Being payment for',
    lines: [{ t: projName(r.project), v: slipMoney(r.amount, r.cur) }, r.note && { t: r.note, muted: true }].filter(Boolean),
    extra: [['Received into', accountOf(r.mode)], ...rateRow(r)], signLabel: 'Received by (for the company)', signName: myName() || r.by };
}

// Make a voucher (expense), receipt (money received) or salary slip (a payment to an employee) for an entry.
function slipSheet(k, id, replaces = '') {
  const r = S[COLL[k]].find(x => x.id === id);
  if (!r) return;
  const isR = k === 'R', who = paperSigner(k, r), title = paperTitle(k, r), old = replaces && fileMeta(replaces);
  openSheet(`${head(title, isR ? 'in' : 'out', r.id)}
    ${needsNewPaper(id) ? `<p class="note">${cancelledWhyNote(k, r)}</p>` : ''}
    ${old ? `<p class="note">This new ${title.toLowerCase()} replaces ${esc(old.no || old.name)}. The old one is cancelled when this one is made — close this screen and it stays as it is.</p>` : ''}
    <p class="hint">${esc(money(r.amount, r.cur))} · ${esc(isR ? projName(r.project) : `${r.paidTo} — ${r.reason}`)}</p>
    <form data-form="slip" data-kind="${k}" data-id="${esc(id)}" data-replaces="${esc(old ? old.id : '')}">
      ${isR ? textField('party', 'Received from', 'Who paid the money?', '', false) : ''}
      ${sigField(who)}
      ${isR ? '' : photoField(who)}
      ${mySigField(isR)}
      ${checkedField()}
      <p class="err"></p>
      <button class="btn ${isR ? 'in' : 'out'}">Make the ${title.toLowerCase()} (PDF)</button>
    </form>
    ${needsNewPaper(id) && can('settings') && r.pay !== 'settlement' ? `<p class="hint center" style="margin-top:14px">Or, as an admin, correct the old one without a new signature: their signature stays with the amount they signed for, and you approve the change.</p>
    <button class="btn ghost" data-act="correctPaper" data-kind="${k}" data-id="${esc(id)}">✏️ Correct the old ${title.toLowerCase()} (admin)</button>` : ''}`);
  sigPad($('#sheet canvas.sig'));
  showMySigField();
}
async function saveSlip(f) {
  const k = f.dataset.kind, r = S[COLL[k]].find(x => x.id === f.dataset.id), cv = $('canvas.sig', f);
  // my saved signature signs wherever I sign: a receipt is received by whoever makes it (then not also approved by
  // them), and Prepared by is mine when I entered it
  const mine = await approvalFrom(f), receiving = k === 'R' && !!mine;
  if (!cv.dataset.ink && !receiving) return formErr(f, null, 'Please sign in the box first.');
  const btn = $('button.btn', f);
  btn.disabled = true; $('.err', f).textContent = 'Making the PDF…';
  try {
    const photo = framedPhoto(f);
    const type = k === 'R' ? 'receipt' : r.pay ? 'slip' : 'voucher';
    const [[no], seq] = nextIds(k === 'R' ? 'RC' : 'PV', 1, S.seq);
    update({ seq });
    // a final settlement payment: its slip is the whole statement (every wage and payment), signed as fully settled
    const w = r.pay === 'settlement' && workerOf(r.worker);
    const spec = w ? workerStatementSpec(w, { final: true, no, sig: cv, photo, date: r.at.slice(0, 10), docs: { [r.id]: no } })
      : k === 'R' ? receiptSpec(r, clean(f.elements.party.value)) : r.pay ? payslipSpec(r) : voucherSpec(r);
    if (w) spec.signName = w.name;
    const signs = { approval: receiving ? null : mine, preparedSign: mine && (w ? spec.preparedBy : r.by) === mine.name ? mine : null, checkedBy: checkedFrom(f) };
    if (w) Object.assign(spec, signs);
    const blob = w ? await renderStatement(spec) : await renderSlip({ ...spec, no, stampDate: stampDate(r), amount: r.amount, cur: r.cur, sig: cv, photo, preparedBy: r.by, ref: r.id, receivedSign: receiving ? mine : null, ...signs });
    const name = `${no} ${fileSafe(spec.signName || '')}.pdf`;
    await keepFile({ for: r.id, type, no, name, mime: 'application/pdf', ...(f.dataset.replaces ? { replaces: f.dataset.replaces } : {}) }, await blob.arrayBuffer());
    const replaced = f.dataset.replaces && fileMeta(f.dataset.replaces);
    if (replaced && !replaced.cancelled) await patchFile(replaced, { cancelled: stampSec(), cancelledBy: myName() || S.lastBy || '', cancelReason: `replaced by ${no}`, was: { amount: r.amount, cur: r.cur } });
    await keepTakenPhoto(f, r.id, no);
    readySheet(spec.title, no, blob, name);
  } catch (e) { btn.disabled = false; formErr(f, null, e.message); }
}
function readySheet(title, no, blob, name) {
  shown = { blob, name };
  openSheet(`${head(title[0] + title.slice(1).toLowerCase(), 'in', no)}
    <p class="okbig">✓ Ready</p>
    <p class="hint center">Kept with the entry${S.link ? ', and it goes to the company Google Drive by itself (the Sheet tab shows any file still waiting)' : ''}. Send it on WhatsApp now, or open it later from the entry.</p>
    <button class="btn in" data-act="shareShown">📤 Send on WhatsApp or save</button>
    <button class="btn ghost" data-act="close" style="margin-top:10px">Done</button>`);
}

/* ---------- the company letterhead (admins, Settings) ---------- */
function letterheadSheet() {
  const f = latestFile('settings', 'letterhead');
  openSheet(`${head('Letterhead')}
    <p class="hint">Vouchers, receipts and salary slips are printed on this. Use a picture of the whole A4 page (PNG or JPG), with empty space in the middle.</p>
    ${f ? `<p class="muted">Now: <b>${esc(f.name)}</b>${f.pending ? ' (not uploaded yet)' : ''}</p><button class="btn ghost" data-act="showFile" data-id="${esc(f.id)}" style="margin-bottom:10px">See the letterhead</button>` : '<p class="muted">No letterhead yet — slips get a plain heading with the company name.</p>'}
    ${attachButton('settings', f ? 'Choose a new letterhead' : 'Choose the letterhead', 'letterhead', 'image/png,image/jpeg')}
    ${f ? `<form data-form="contacts" class="contacts-form">
      <h3>Contacts on every PDF</h3>
      <p class="hint">Printed at the top right, beside the logo. Leave a box empty to leave it off.</p>
      ${CONTACT_FIELDS.map(([k, label, ph, type]) => `<label class="fld"><span>${label}</span><input name="${k}" type="${type === 'url' ? 'text' : type}" ${type === 'url' ? 'inputmode="url"' : ''} value="${esc((f.contact || {})[k] || '')}" placeholder="${ph}" maxlength="60" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>`).join('')}
      <button class="btn primary">Save the contacts</button>
    </form>` : ''}`);
  here = letterheadSheet;
}
async function saveContacts(f) {
  const contact = Object.fromEntries(CONTACT_FIELDS.map(([k]) => [k, clean(f.elements[k].value)]).filter(([, v]) => v));
  await setBrand('letterhead', { contact });
  toast('Contacts saved ✓ — they are on every new PDF');
}

/* ---------- the company stamp (admins, Settings): its picture, and where the date goes on it ---------- */
let stampEdit = null, stampPrev = null; // the position being adjusted, and the stamp picture shown while adjusting
function stampSheet() {
  const f = latestFile('settings', 'stamp');
  openSheet(`${head('Company stamp')}
    <p class="hint">Printed on every voucher, receipt and salary slip, with the slip's date written on its dotted line. Use a clear picture of the stamp on white paper (PNG or JPG).</p>
    ${f ? `<canvas id="stampPrev" class="stampprev" width="600" height="600"></canvas>
      <p class="muted center">Move the date until it sits on the dotted line</p>
      <div class="nudge"><button type="button" data-act="nudge" data-k="a" data-d="3" aria-label="Move left">◀</button><button type="button" data-act="nudge" data-k="a" data-d="-3" aria-label="Move right">▶</button><button type="button" data-act="nudge" data-k="r" data-d="-0.012" aria-label="Move up">▲</button><button type="button" data-act="nudge" data-k="r" data-d="0.012" aria-label="Move down">▼</button><button type="button" data-act="nudge" data-k="s" data-d="-0.008" aria-label="Smaller">A−</button><button type="button" data-act="nudge" data-k="s" data-d="0.008" aria-label="Bigger">A+</button></div>
      <button class="btn primary" data-act="stampSave" style="margin-bottom:10px">Save the position</button>` : '<p class="muted">No stamp yet — slips have empty "Approved by" lines.</p>'}
    ${attachButton('settings', f ? 'Choose a new stamp picture' : 'Choose the stamp picture', 'stamp', 'image/png,image/jpeg')}`);
  here = stampSheet;
  if (f) { stampEdit = { ...STAMP_PLACE, ...(f.place || {}) }; drawStampPreview(); }
}
async function drawStampPreview() {
  const cv = $('#stampPrev');
  if (!cv) return;
  stampPrev = stampPrev || await brandImage('stamp');
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  if (stampPrev) drawStamp(g, stampPrev, 300, 300, 560, stampDate({ at: stamp() }), stampEdit);
  else { g.fillStyle = SLIP_C.label; g.font = `600 26px ${SANS}`; g.textAlign = 'center'; g.fillText('Connect to the internet to see it', 300, 300); }
}
function nudgeStamp(k, d) { stampEdit = { ...stampEdit, [k]: Math.round((stampEdit[k] + Number(d)) * 1000) / 1000 }; drawStampPreview(); }
async function saveStampPlace() {
  await setBrand('stamp', { place: stampEdit });
  toast('Stamp position saved ✓');
}
// a setting kept on the latest letterhead or stamp record (the contacts, where the date goes on the stamp)
const setBrand = (type, patch) => patchFile(latestFile('settings', type), patch);
