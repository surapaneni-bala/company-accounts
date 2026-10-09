/* ---------- files: photos, PDFs, signatures and slips ---------- */
// A file is kept on this phone first (IndexedDB: localStorage is far too small), then uploaded to the company
// Google Drive through the sheet script. Its record (kind F) is made only once the upload worked, so the sheet
// never holds a record whose file it can't give back. Uploaded files stay on the phone as an offline copy.
const FILE_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE = 8 * 1024 * 1024; // the sheet script refuses bigger files
const PHOTO_SIDE = 1600; // photos are shrunk on the phone: quicker to upload, still sharp on a slip
const FILE_ICON = { voucher: '🧾', receipt: '🧾', slip: '🧾', photo: '📷', attachment: '📎', profile: '🙂', idphoto: '🪪', letterhead: '📄', stamp: '🔵' };
const FILE_NAME = { voucher: 'Payment voucher', receipt: 'Receipt', slip: 'Salary slip', photo: 'Photo', attachment: 'Attachment', profile: 'Profile photo', idphoto: 'ID photo', letterhead: 'Letterhead', stamp: 'Company stamp' };
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
    const p = type === 'letterhead' || type === 'stamp' ? await prepareFile(file, SLIP_H, 0.92) : await prepareFile(file);
    if (type === 'stamp') stampPrev = null;
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
// Laid out like the company's paper voucher (paid to | date, being payment for | amount, amount in words,
// received by, prepared / checked / approved), printed on the letterhead, with the company stamp and its date.
const SLIP_W = 1240, SLIP_H = 1754; // A4 at 150 dots per inch
const SANS = '"Avenir Next", "Helvetica Neue", Helvetica, Roboto, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", "Noto Serif", serif';
const SLIP_C = { navy: '#26306B', accent: '#C8501E', ink: '#1B2232', label: '#6B7190', rule: '#C9CDDD', tint: '#F4F5FA', stampInk: '#1D3FC4' };
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
const letterheadImage = () => brandImage('letterhead');
// keep the letterhead and stamp on the phone, so slips made offline still carry them
function warmLetterhead() { ['letterhead', 'stamp'].forEach(t => { const f = latestFile('settings', t); if (f && !f.pending) fileBlob(f.id).catch(() => {}); }); }

// The stamp's ring: the box around its ink (anything not near-white), so any photo or scan of it lines up.
function inkCircle(img) {
  const n = 240, k = n / Math.max(img.naturalWidth, img.naturalHeight), w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (px[i + 3] > 60 && px[i] + px[i + 1] + px[i + 2] < 600) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (x1 <= x0) return { cx: img.naturalWidth / 2, cy: img.naturalHeight / 2, R: Math.min(img.naturalWidth, img.naturalHeight) / 2 };
  return { cx: (x0 + x1 + 1) / 2 / k, cy: (y0 + y1 + 1) / 2 / k, R: Math.max(x1 - x0 + 1, y1 - y0 + 1) / 2 / k };
}
// The stamp, its ring `size` across and centred on (x, y), with the date written along its dotted line.
function drawStamp(g, img, x, y, size, dateText, place) {
  const c = img.circle || (img.circle = inkCircle(img)), k = size / (2 * c.R), p = { ...STAMP_PLACE, ...(place || {}) };
  g.save();
  g.globalCompositeOperation = 'multiply'; // the paper of the scan disappears, the ink stays
  g.drawImage(img, x - c.cx * k, y - c.cy * k, img.naturalWidth * k, img.naturalHeight * k);
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

/* s = { title, no, date, stampDate, party: [label, value], when: [label, value], forLabel, lines: [{ t, v, strong, muted }],
         amount, cur, extra: [[label, value]], signLabel, signName, sig: canvas, photo: image|null, preparedBy, ref } */
async function renderSlip(s) {
  const c = document.createElement('canvas');
  c.width = SLIP_W; c.height = SLIP_H;
  const g = c.getContext('2d'), C = SLIP_C, L = 90, R = SLIP_W - 90, CX = L + 660;
  g.fillStyle = '#fff'; g.fillRect(0, 0, SLIP_W, SLIP_H);
  const [lh, stampImg] = await Promise.all([letterheadImage(), brandImage('stamp')]);
  let y;
  if (lh) { g.drawImage(lh, 0, 0, SLIP_W, SLIP_H); y = 268; } // the letterhead's own header and footer stay clear
  else {
    g.fillStyle = C.navy; g.font = `700 46px ${SERIF}`; g.fillText(S.company || 'Company', L, 120);
    g.fillStyle = C.accent; g.fillRect(L, 142, 90, 5); y = 200;
  }
  // title and number
  g.fillStyle = C.navy; g.font = `700 46px ${SERIF}`; spaced(g, s.title, L, y + 46, 4);
  g.fillStyle = C.accent; g.fillRect(L, y + 66, 90, 5);
  g.font = `600 18px ${SANS}`; g.fillStyle = SLIP_C.label; spaced(g, 'NO.', R, y + 16, 1.6, 'right');
  g.fillStyle = C.accent; g.font = `700 36px ${SANS}`; g.textAlign = 'right'; g.fillText(s.no, R, y + 52); g.textAlign = 'left';
  y += 110;
  // measure first: a long slip (many pay lines) is set tighter, so it always ends above the letterhead's footer
  const measure = tight => {
    const m = { tight, lineH: tight ? 40 : 46, lineFont: tight ? 26 : 28, h4: tight ? 210 : 270, gap: tight ? 170 : 200 };
    g.font = `700 32px ${SANS}`; m.party = wrapText(g, s.party[1] || '—', CX - L - 50); m.h1 = 76 + m.party.length * 40;
    g.font = `500 ${m.lineFont}px ${SANS}`; m.lines = s.lines.flatMap(l => wrapText(g, l.t, CX - L - 220).map((t, i) => ({ ...l, t, v: i ? '' : l.v })));
    m.h2 = Math.max(tight ? 220 : 250, 70 + m.lines.length * m.lineH + 20);
    g.font = `italic 28px ${SERIF}`; m.words = wrapText(g, amountInWords(s.amount, s.cur), CX - L - 50);
    m.h3 = Math.max(76 + m.words.length * 38, 70 + s.extra.length * (tight ? 56 : 64));
    m.end = y + m.h1 + m.h2 + m.h3 + m.h4 + m.gap + 90;
    return m;
  };
  const limit = lh ? 1570 : SLIP_H - 60, normal = measure(false), M = normal.end <= limit ? normal : measure(true);
  // the form: a ruled box like the paper voucher; white under it so the letterhead's watermark stays faint
  const top = y, cells = [];
  const row = (h, draw) => { cells.push([y, h]); draw(y, h); y += h; };
  const box = (h) => { g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(L, y, R - L, h); };
  // row 1: paid to | date
  const { party, h1, lines, lineH, h2, words, h3, h4 } = M;
  box(h1);
  row(h1, (t) => {
    slipLabel(g, s.party[0], L + 24, t + 34);
    g.fillStyle = C.ink; g.font = `700 32px ${SANS}`; party.forEach((p, i) => g.fillText(p, L + 24, t + 78 + i * 40));
    slipLabel(g, s.when[0], CX + 24, t + 34);
    g.fillStyle = C.ink; g.font = `700 30px ${SANS}`; wrapText(g, s.when[1], R - CX - 48).forEach((p, i) => g.fillText(p, CX + 24, t + 78 + i * 36));
  });
  // row 2: being payment for | amount in
  box(h2);
  row(h2, (t) => {
    slipLabel(g, s.forLabel || 'Being payment for', L + 24, t + 34);
    lines.forEach((l, i) => {
      const ly = t + 82 + i * lineH;
      g.fillStyle = l.muted ? C.label : C.ink; g.font = `${l.strong ? 700 : 500} ${l.muted ? M.lineFont - 4 : M.lineFont}px ${SANS}`;
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
    let fs = 44; g.font = `800 ${fs}px ${SANS}`;
    while (g.measureText(text).width > aw - 36 && fs > 22) { fs -= 2; g.font = `800 ${fs}px ${SANS}`; }
    g.fillStyle = C.ink; g.textAlign = 'right'; g.fillText(text, ax + aw - 18, ay + ah / 2 + fs * 0.36); g.textAlign = 'left';
  });
  // row 3: amount in words | paid from (and the day's rate)
  box(h3);
  row(h3, (t) => {
    slipLabel(g, 'Amount in words', L + 24, t + 34);
    g.fillStyle = C.ink; g.font = `italic 28px ${SERIF}`; words.forEach((w, i) => g.fillText(w, L + 24, t + 76 + i * 38));
    const step = M.tight ? 56 : 64;
    s.extra.forEach(([lab, val], i) => {
      slipLabel(g, lab, CX + 24, t + 34 + i * step);
      g.fillStyle = C.ink; g.font = `600 24px ${SANS}`; g.fillText(val, CX + 24, t + 64 + i * step);
    });
  });
  // row 4: received by (name, signature) | photo
  const split = s.photo ? CX : R;
  box(h4);
  row(h4, (t) => {
    slipLabel(g, s.signLabel, L + 24, t + 34);
    g.fillStyle = C.ink; g.font = `700 28px ${SANS}`; g.fillText(s.signName || '', L + 24, t + 74);
    if (s.sig) fitInto(g, s.sig, L + 24, t + 86, split - L - 48, h4 - 140, false);
    g.fillStyle = C.rule; g.fillRect(L + 24, t + h4 - 44, Math.min(460, split - L - 48), 1.5);
    g.fillStyle = C.label; g.font = `500 18px ${SANS}`; g.fillText('Signature', L + 24, t + h4 - 20);
    if (s.photo) { fitInto(g, s.photo, CX + 14, t + 14, R - CX - 28, h4 - 28, true); slipLabel(g, 'Photo', CX + 24, t + h4 - 22); }
  });
  // the ruling: outer box, the column line and the lines between rows
  g.strokeStyle = C.navy; g.lineWidth = 2.5; g.strokeRect(L, top, R - L, y - top);
  g.fillStyle = C.navy;
  cells.slice(1).forEach(([cy]) => g.fillRect(L, cy - 0.75, R - L, 1.5));
  cells.forEach(([cy, ch], i) => { if (i < 3 || s.photo) g.fillRect(CX - 0.75, cy, 1.5, ch); });
  // prepared / checked / approved; the company stamp goes over "approved", the way it is stamped on paper
  y += M.gap;
  const colW = (R - L) / 3;
  if (stampImg) drawStamp(g, stampImg, R - 112, y - Math.min(82, M.gap - 115), 216, s.stampDate, stampImg.place); // at the right edge, clear of the words and the box
  [['Prepared by', s.preparedBy || ''], ['Checked by', ''], ['Approved by', '']].forEach(([lab, name], i) => {
    const x = L + i * colW;
    g.fillStyle = C.ink; g.font = `600 24px ${SANS}`; if (name) g.fillText(name, x, y - 14);
    g.fillStyle = C.ink; g.fillRect(x, y, colW - 40, 1.5);
    slipLabel(g, lab, x, y + 30); // drawn after the stamp, so the words stay readable
  });
  g.fillStyle = C.label; g.font = `500 18px ${SANS}`;
  g.fillText(`Ref ${s.ref} · made in the company app on ${fmtAbs(stamp())}`, L, Math.min(y + 80, limit));
  const jpeg = new Uint8Array(await (await canvasJpeg(c, 0.9)).arrayBuffer());
  return new Blob([jpegToPdf(jpeg, SLIP_W, SLIP_H)], { type: 'application/pdf' });
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
    const blob = await renderSlip({ ...spec, no, stampDate: stampDate(r), amount: r.amount, cur: r.cur, sig: cv, photo, preparedBy: r.by, ref: r.id });
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
  const f = latestFile('settings', 'stamp'), place = stampEdit;
  if (f.pending) { // not uploaded yet: the position goes up with it
    const rec = await fileGet(f.id);
    if (rec) await filePut({ ...rec, place });
    outbox = outbox.map(x => (x.id === f.id ? { ...x, place } : x));
  } else update({ files: S.files.map(x => (x.id === f.id ? { ...x, place } : x)) });
  toast('Stamp position saved ✓');
}
