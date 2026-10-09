/* ---------- files: photos, PDFs, signatures and slips ---------- */
// A file is kept on this phone first (IndexedDB: localStorage is far too small), then uploaded to the company
// Google Drive through the sheet script. Its record (kind F) is made only once the upload worked, so the sheet
// never holds a record whose file it can't give back. Uploaded files stay on the phone as an offline copy.
const FILE_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE = 8 * 1024 * 1024; // the sheet script refuses bigger files
const PHOTO_SIDE = 1600; // photos are shrunk on the phone: quicker to upload, still sharp on a slip
const FILE_ICON = { voucher: '🧾', receipt: '🧾', slip: '🧾', photo: '📷', attachment: '📎', profile: '🙂', idphoto: '🪪', letterhead: '📄' };
const FILE_NAME = { voucher: 'Payment voucher', receipt: 'Receipt', slip: 'Salary slip', photo: 'Photo', attachment: 'Attachment', profile: 'Profile photo', idphoto: 'ID photo', letterhead: 'Letterhead' };
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
async function prepareFile(file, side = PHOTO_SIDE, quality = 0.82) {
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
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
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

// Upload what's waiting, one file at a time; each one's record then goes out with the next sync.
// ponytail: an upload whose reply is lost is sent again, leaving a spare copy in Drive; harmless, never a lost file.
async function uploadFiles() {
  if (uploading || !S || !S.link || mustSignIn() || !outbox.length || (S.link.v || 2) < 4) return;
  uploading = true;
  try {
    for (const meta of outbox) {
      const rec = await fileGet(meta.id);
      if (!rec || !rec.pending) { outbox = outbox.filter(x => x.id !== meta.id); continue; }
      let res;
      try { res = await callServer(S.link, { op: 'upload', name: rec.name, mime: rec.mime, data: toB64(rec.data) }); }
      catch (e) { uploadErr = e.offline || e.code === 'LOGIN' ? '' : `A file could not be uploaded: ${e.message}`; break; }
      const { data, pending, ...d } = rec;
      update({ files: [...S.files, { ...d, fileId: res.fileId }] });
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
const fileMeta = id => S.files.find(f => f.id === id) || outbox.find(f => f.id === id);
const filesFor = (id, type) => [...live(S.files), ...outbox.map(f => ({ ...f, pending: true }))]
  .filter(f => f.for === id && (!type || f.type === type)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
const latestFile = (id, type) => filesFor(id, type).pop();
function filesBlock(id) {
  const list = filesFor(id).filter(f => f.type !== 'profile');
  if (!list.length) return '';
  return `<h3 class="subh">Files (${list.length})</h3><div class="card list inset">${list.map(f => `<button class="row" data-act="showFile" data-id="${esc(f.id)}">
    <span class="dot">${FILE_ICON[f.type] || '📎'}</span>
    <span class="main"><span class="t"><span class="tt">${esc(f.no || FILE_NAME[f.type] || f.name)}</span>${f.pending ? '<i class="tag warn">Not uploaded yet</i>' : ''}</span>
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
    const p = type === 'letterhead' ? await prepareFile(file, SLIP_H, 0.92) : await prepareFile(file);
    await keepFile({ for: forId, type, name: p.name, mime: p.mime }, p.data);
  } catch (e) { return alert(e.message); }
  toast(`${FILE_NAME[type] || 'File'} added ✓`);
  reopenHere();
}

async function showFile(id) {
  const f = fileMeta(id);
  if (!f) return;
  let blob;
  try { blob = await fileBlob(id); } catch (e) { return toast(e.offline ? 'No internet — this file is not on this phone yet.' : e.message); }
  shown = { blob, name: f.name };
  const title = f.no || FILE_NAME[f.type] || 'File';
  openSheet(`${head(title, '', f.name)}
    ${f.mime === 'application/pdf' ? '<p class="filebig">📄</p>' : `<img class="viewimg" src="${URL.createObjectURL(blob)}" alt="${esc(title)}">`}
    <button class="btn in" data-act="shareShown">📤 Send or save</button>
    ${f.pending ? '<p class="muted center">Kept on this phone. It uploads to the company Drive when the internet is on.</p>' : ''}`);
}
const shareShown = () => shown && download(shown.blob, shown.name);

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
const photoField = who => `<label class="fld"><span>Photo of ${esc(who)} with the money <em>(optional)</em></span><input type="file" name="photo" accept="image/*" capture="environment"></label>`;

/* ---------- slips: an A4 page drawn on a canvas, saved as a one-page PDF ---------- */
const SLIP_W = 1240, SLIP_H = 1754; // A4 at 150 dots per inch
const SLIP_FONT = 'Helvetica, Arial, sans-serif';
const SLIP_TITLE = { voucher: 'PAYMENT VOUCHER', receipt: 'RECEIPT', salary: 'SALARY SLIP', advance: 'ADVANCE VOUCHER', settlement: 'FINAL SETTLEMENT' };
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
const boxPath = (g, x, y, w, h) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, 18); else g.rect(x, y, w, h); };
async function letterheadImage() {
  const f = latestFile('settings', 'letterhead');
  if (!f) return null;
  try { return await imgFrom(await fileBlob(f.id)); } catch { return null; } // offline and never fetched: a plain page
}
// keep the letterhead on the phone, so slips made offline still carry it
function warmLetterhead() { const f = latestFile('settings', 'letterhead'); if (f && !f.pending) fileBlob(f.id).catch(() => {}); }

// s = { title, no, date, rows: [[label, value]], amount, cur, signLabel, signName, sig: canvas, photo: image|null, by }
async function renderSlip(s) {
  const c = document.createElement('canvas');
  c.width = SLIP_W; c.height = SLIP_H;
  const g = c.getContext('2d'), INK = '#1B2232', MUTED = '#6A6458', L = 100, R = SLIP_W - 100;
  g.fillStyle = '#fff'; g.fillRect(0, 0, SLIP_W, SLIP_H);
  const lh = await letterheadImage();
  let top, bottom;
  if (lh) { g.drawImage(lh, 0, 0, SLIP_W, SLIP_H); top = 270; bottom = 1570; } // the letterhead's own header and footer stay clear
  else {
    g.fillStyle = INK; g.font = `800 44px ${SLIP_FONT}`; g.fillText(S.company || 'Company', L, 120);
    g.fillRect(L, 145, R - L, 3); top = 180; bottom = SLIP_H - 90;
  }
  g.textAlign = 'center'; g.fillStyle = INK; g.font = `800 52px ${SLIP_FONT}`;
  g.fillText(s.title, SLIP_W / 2, top + 50);
  g.textAlign = 'left'; g.font = `700 28px ${SLIP_FONT}`;
  g.fillText(`No. ${s.no}`, L, top + 110);
  g.textAlign = 'right'; g.fillText(`Date: ${s.date}`, R, top + 110);
  g.textAlign = 'left';
  let y = top + 180;
  for (const [label, value] of s.rows) {
    g.fillStyle = MUTED; g.font = `600 26px ${SLIP_FONT}`; g.fillText(label, L, y);
    g.fillStyle = INK; g.font = `600 30px ${SLIP_FONT}`;
    const lines = wrapText(g, value, R - 400);
    lines.forEach((t, i) => g.fillText(t, 400, y + i * 40));
    y += lines.length * 40 + 16;
  }
  // the amount, in figures and in words, so it can't be quietly changed
  g.font = `italic 26px ${SLIP_FONT}`;
  const words = wrapText(g, amountInWords(s.amount, s.cur), R - L - 60);
  const boxH = 140 + words.length * 36;
  y += 10;
  boxPath(g, L, y, R - L, boxH); g.fillStyle = '#F3EFE7'; g.fill();
  g.fillStyle = MUTED; g.font = `600 26px ${SLIP_FONT}`; g.fillText('Amount', L + 30, y + 44);
  g.fillStyle = INK; g.font = `800 60px ${SLIP_FONT}`; g.fillText(money(s.amount, s.cur), L + 30, y + 108);
  g.font = `italic 26px ${SLIP_FONT}`; words.forEach((t, i) => g.fillText(t, L + 30, y + 150 + i * 36));
  y += boxH + 30;
  // signature box (and the photo beside it)
  const boxY = Math.max(y, bottom - 330), signW = s.photo ? 620 : R - L;
  boxPath(g, L, boxY, signW, 260); g.strokeStyle = '#B8B0A0'; g.lineWidth = 2; g.stroke();
  g.fillStyle = MUTED; g.font = `600 24px ${SLIP_FONT}`; g.fillText(s.signLabel, L + 20, boxY + 36);
  if (s.sig) fitInto(g, s.sig, L + 20, boxY + 50, signW - 40, 150, false);
  g.fillStyle = INK; g.font = `700 26px ${SLIP_FONT}`; g.fillText(s.signName || '', L + 20, boxY + 238);
  if (s.photo) {
    const px = L + signW + 30, pw = R - px;
    fitInto(g, s.photo, px, boxY, pw, 260, true);
    boxPath(g, px, boxY, pw, 260); g.stroke();
  }
  g.fillStyle = MUTED; g.font = `500 22px ${SLIP_FONT}`;
  g.fillText(`Paid / entered by ${s.by || '—'} · made in the company app ${fmtAbs(stamp())}`, L, boxY + 300);
  const jpeg = new Uint8Array(await (await canvasJpeg(c, 0.88)).arrayBuffer());
  return new Blob([jpegToPdf(jpeg, SLIP_W, SLIP_H)], { type: 'application/pdf' });
}

// rate line for an SSP entry: what it was worth in dollars that day
const usdOf = r => (r.cur === 'SSP' && r.rate > 0 ? Math.round(r.amount / r.rate * 100) / 100 : null);
const rateRow = r => (usdOf(r) === null ? [] : [['Rate', `1 USD = ${plain(r.rate)} SSP · about ${money(usdOf(r), 'USD')}`]]);
const slipDate = r => `${fmtDate(r.at.slice(0, 10))}, ${fmtTime(r.at)}`;
function voucherSpec(r) {
  return { title: SLIP_TITLE.voucher, rows: [['Paid to', r.paidTo], ['For', r.reason], ['Project', r.project ? projName(r.project) : ''], ['Location', r.location], ['Paid from', accountOf(r.mode)], ...rateRow(r)].filter(x => x[1]),
    signLabel: 'Received by', signName: r.paidTo };
}
function receiptSpec(r, party) {
  return { title: SLIP_TITLE.receipt, rows: [['Received from', party], ['For', projName(r.project)], ['Note', r.note], ['Received into', accountOf(r.mode)], ...rateRow(r)].filter(x => x[1]),
    signLabel: 'Received by (for the company)', signName: myName() || r.by };
}

// Make a voucher (expense), receipt (money received) or salary slip (a payment to an employee) for an entry.
function slipSheet(k, id) {
  const r = S[COLL[k]].find(x => x.id === id);
  if (!r) return;
  const isR = k === 'R', who = isR ? (myName() || r.by || 'the person receiving') : r.paidTo;
  const title = isR ? 'Receipt' : r.pay ? { salary: 'Salary slip', advance: 'Advance voucher', settlement: 'Final settlement' }[r.pay] : 'Payment voucher';
  openSheet(`${head(title, isR ? 'in' : 'out', r.id)}
    <p class="hint">${esc(money(r.amount, r.cur))} · ${esc(isR ? projName(r.project) : `${r.paidTo} — ${r.reason}`)}</p>
    <form data-form="slip" data-kind="${k}" data-id="${esc(id)}">
      ${isR ? textField('party', 'Received from', 'Who paid the money?', '', false) : ''}
      ${sigField(who)}
      ${isR ? '' : photoField(who)}
      <p class="err"></p>
      <button class="btn ${isR ? 'in' : 'out'}">Make the ${title.toLowerCase()} (PDF)</button>
    </form>`);
  sigPad($('#sheet canvas.sig'));
}
async function saveSlip(f) {
  const k = f.dataset.kind, r = S[COLL[k]].find(x => x.id === f.dataset.id), cv = $('canvas.sig', f);
  if (!cv.dataset.ink) return formErr(f, null, 'Please sign in the box first.');
  const btn = $('button.btn', f);
  btn.disabled = true; $('.err', f).textContent = 'Making the PDF…';
  try {
    const p = f.elements.photo && f.elements.photo.files[0];
    const photo = p ? await imgFrom(new Blob([(await prepareFile(p)).data], { type: 'image/jpeg' })) : null;
    const type = k === 'R' ? 'receipt' : r.pay ? 'slip' : 'voucher';
    const spec = k === 'R' ? receiptSpec(r, clean(f.elements.party.value)) : r.pay ? payslipSpec(r) : voucherSpec(r);
    const [[no], seq] = nextIds(k === 'R' ? 'RC' : 'PV', 1, S.seq);
    update({ seq });
    const blob = await renderSlip({ ...spec, no, date: slipDate(r), amount: r.amount, cur: r.cur, sig: cv, photo, by: r.by });
    const name = `${no} ${fileSafe(spec.signName || '')}.pdf`;
    await keepFile({ for: r.id, type, no, name, mime: 'application/pdf' }, await blob.arrayBuffer());
    readySheet(spec.title, no, blob, name);
  } catch (e) { btn.disabled = false; formErr(f, null, e.message); }
}
function readySheet(title, no, blob, name) {
  shown = { blob, name };
  openSheet(`${head(title[0] + title.slice(1).toLowerCase(), 'in', no)}
    <p class="okbig">✓ Ready</p>
    <p class="hint center">Kept with the entry${S.link ? ' and saved to the company Google Drive' : ''}. Send it on WhatsApp now, or open it later from the entry.</p>
    <button class="btn in" data-act="shareShown">📤 Send on WhatsApp or save</button>
    <button class="btn ghost" data-act="close" style="margin-top:10px">Done</button>`);
}

/* ---------- the company letterhead (admins, Settings) ---------- */
function letterheadSheet() {
  const f = latestFile('settings', 'letterhead');
  openSheet(`${head('Letterhead')}
    <p class="hint">Vouchers, receipts and salary slips are printed on this. Use a picture of the whole A4 page (PNG or JPG), with empty space in the middle.</p>
    ${f ? `<p class="muted">Now: <b>${esc(f.name)}</b>${f.pending ? ' (not uploaded yet)' : ''}</p><button class="btn ghost" data-act="showFile" data-id="${esc(f.id)}" style="margin-bottom:10px">See the letterhead</button>` : '<p class="muted">No letterhead yet — slips get a plain heading with the company name.</p>'}
    ${attachButton('settings', f ? 'Choose a new letterhead' : 'Choose the letterhead', 'letterhead', 'image/png,image/jpeg')}`);
  here = letterheadSheet;
}
