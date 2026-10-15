/* ---------- the documents vault: licences, vehicle papers, passports — and when they expire ---------- */
// A document (kind V) is its details; its scan is a file of type 'document' (kept in Drive under 05 DOCUMENTS). Renewing
// one puts a new scan in place (the old one goes to CHANGES) and moves the dates. Company and vehicle papers are for
// admins and the office manager; personal ones (IDs, passports) for admins only — the sheet never sends them to anyone
// else (owner, 11 Oct 2026). The office manager may add papers; only admins change, renew or delete them.
const DOC_KIND = { company: ['🏢', 'Company documents', 'Licences, certificates, contracts'], vehicle: ['🚚', 'Vehicle documents', 'Registration, insurance, road licence'], personal: ['🪪', 'Personal documents', 'Shareholders’ and staff IDs and passports — admins only'] };
const DOC_OWNER = { company: ['Belongs to', 'e.g. the company, the Lologo warehouse'], vehicle: ['Vehicle', 'Number plate and type, e.g. KAA 123B truck'], personal: ['Person', 'Whose document is it?'] };
const docOf = id => S.docs.find(v => v.id === id && !v.deleted);
const docKinds = () => Object.keys(DOC_KIND).filter(k => k !== 'personal' || can('settings'));
const remindOf = v => (Number.isFinite(v.remind) ? v.remind : 30);
// how a document stands: expired, expiring within its reminder days, valid, or no expiry date
function docState(v) {
  if (!v.expires) return { tag: '', text: 'No expiry date', soon: false };
  const n = daysTo(v.expires);
  if (n < 0) return { tag: '<i class="tag bad">Expired</i>', text: `Expired ${fmtDate(v.expires)}`, soon: true };
  if (n <= remindOf(v)) return { tag: '<i class="tag warn">Expires soon</i>', text: n === 0 ? 'Expires today' : `Expires in ${n} day${n === 1 ? '' : 's'} — ${fmtDate(v.expires)}`, soon: true };
  return { tag: '', text: `Valid until ${fmtDate(v.expires)}`, soon: false };
}
const scanOf = id => filesFor(id, 'document').filter(f => !isOldVersion(f)).pop();

// on the first page: what has expired or will within its reminder days, and a word about payments due
function docBanners() {
  if (!can('staff')) return '';
  const due = live(S.docs).filter(v => docState(v).soon).sort((a, b) => a.expires.localeCompare(b.expires));
  const pays = dueList().filter(([, d]) => isDueSoon(d)).length;
  return due.slice(0, 3).map(v => `<div class="banner${daysTo(v.expires) < 0 ? '' : ' new'}"><span>${DOC_KIND[v.kind][0]} <b>${esc(v.title)}</b>${v.owner ? ` · ${esc(v.owner)}` : ''} — ${esc(docState(v).text)}</span><button class="btn small" data-act="openDoc" data-id="${esc(v.id)}">Open</button></div>`).join('')
    + (due.length > 3 ? `<div class="banner"><span>📄 ${due.length - 3} more documents expire soon.</span><button class="btn small" data-act="docs">See all</button></div>` : '')
    + (pays ? `<div class="banner new"><span>🔁 ${pays} regular payment${pays === 1 ? ' is' : 's are'} due or late.</span><button class="btn small" data-act="tab" data-tab="home">See</button></div>` : '');
}

function docsSheet() {
  const all = live(S.docs);
  openSheet(`${head('Documents', '')}
    <p class="hint">Every paper the company must keep and renew. You get a reminder before each one expires.</p>
    <button class="btn primary" data-act="addDoc">＋ Add a document</button>
    ${docKinds().map(k => {
      const list = all.filter(v => v.kind === k).sort((a, b) => (a.expires || '9').localeCompare(b.expires || '9') || a.title.localeCompare(b.title));
      return `<h3 class="subh">${DOC_KIND[k][0]} ${DOC_KIND[k][1]} (${list.length})</h3>${list.length ? `<div class="card list inset">${list.map(docRow).join('')}</div>` : `<p class="muted">${DOC_KIND[k][2]}.</p>`}`;
    }).join('')}`);
  comeBack(docsSheet);
}
function docRow(v) {
  const st = docState(v);
  return `<button class="row" data-act="openDoc" data-id="${esc(v.id)}"><span class="dot">${DOC_KIND[v.kind][0]}</span>
    <span class="main"><span class="t"><span class="tt">${esc(v.title)}</span>${st.tag}</span><span class="s">${esc([v.owner, st.text].filter(Boolean).join(' · '))}</span></span></button>`;
}
function docDetail(id) {
  const v = docOf(id);
  if (!v) return false;
  const st = docState(v), scan = scanOf(id), [ownerLabel] = DOC_OWNER[v.kind];
  const facts = [['Kind', DOC_KIND[v.kind][1]], [ownerLabel, v.owner], ['Number', v.docNo], ['Issued', v.issued && fmtDate(v.issued)], ['Expires', v.expires ? fmtDate(v.expires) : 'No expiry date'], ['Reminder', v.expires ? `${remindOf(v)} days before` : ''], ['Note', v.note]];
  openSheet(`${head(v.title, '', id)}
    ${st.soon ? `<p class="note">⚠️ ${esc(st.text)}.${can('settings') ? ' Renew it below once you have the new one.' : ' Tell an admin.'}</p>` : ''}
    ${scan ? `<button class="btn in" data-act="showFile" data-id="${esc(scan.id)}">📄 Open the document</button>` : '<p class="muted">No scan yet.</p>'}
    <dl class="facts" style="margin-top:16px">${facts.filter(f => f[1]).map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    ${can('settings') ? `<button class="btn out" data-act="renewDoc" data-id="${esc(id)}">🔄 Renew — the new document and its dates 🔒</button>
      <div class="two" style="margin-top:10px"><button class="btn ghost" data-act="editDoc" data-id="${esc(id)}">✏️ Edit 🔒</button><button class="btn danger" data-act="delDoc" data-id="${esc(id)}">🗑 Delete 🔒</button></div>` : ''}
    ${filesList(filesFor(id, 'document').filter(isOldVersion), 'Earlier versions')}`);
  comeBack(() => docDetail(id));
}

const dateField = (name, label, val, req) => `<label class="fld"><span>${label}${req ? '' : ' <em>(optional)</em>'}</span><input type="date" name="${name}" value="${esc(val || '')}" ${req ? 'required' : ''}></label>`;
const scanField = label => `<label class="fld"><span>${label}</span><input type="file" name="scan" accept="image/*,application/pdf" required></label>`;
function docForm(old, kind) {
  const d = old || { kind: kind || 'company', remind: 30 }, kinds = old ? [d.kind] : docKinds();
  openSheet(`${head(old ? 'Edit document' : 'New document', '', old?.id)}
    <form data-form="doc" data-id="${esc(old?.id || '')}">
      <div class="fld"><span>What kind?</span><div class="curseg">${kinds.map(k => `<label><input type="radio" name="kind" value="${k}" ${k === d.kind ? 'checked' : ''}><span><b>${DOC_KIND[k][0]} ${DOC_KIND[k][1].split(' ')[0]}</b><small>${k === 'personal' ? 'Admins only' : DOC_KIND[k][2].split(',')[0]}</small></span></label>`).join('')}</div></div>
      ${textField('title', 'Document', 'e.g. Trading licence, Insurance, Passport', d.title)}
      <label class="fld"><span class="ownl">${DOC_OWNER[d.kind][0]} <em>(optional)</em></span><input name="owner" value="${esc(d.owner)}" placeholder="${esc(DOC_OWNER[d.kind][1])}" maxlength="120" autocomplete="off"></label>
      ${textField('docNo', 'Document number', '', d.docNo, false)}
      ${dateField('issued', 'Issued on', d.issued, false)}
      ${dateField('expires', 'Expires on', d.expires, false)}
      <label class="fld"><span>Remind me this many days before it expires</span><input name="remind" inputmode="numeric" value="${esc(remindOf(d))}" maxlength="3" autocomplete="off"></label>
      ${textField('note', 'Note', 'e.g. where the original paper is kept', d.note, false)}
      ${old ? '' : scanField('Photo or PDF of the document')}
      <p class="err"></p>
      <button class="btn primary">${old ? 'Save changes' : 'Add document'}</button>
    </form>`);
}
// the "Vehicle" / "Person" label follows the kind chosen
function refreshDocKind(f) {
  const k = f.elements.kind.value, [label, ph] = DOC_OWNER[k] || DOC_OWNER.company;
  $('.ownl', f).innerHTML = `${esc(label)} <em>(optional)</em>`;
  f.elements.owner.placeholder = ph;
}
function docFields(f) {
  const v = Object.fromEntries(new FormData(f)), remind = v.remind === '' ? 30 : Number(v.remind);
  const rec = { kind: v.kind, title: clean(v.title), owner: clean(v.owner), docNo: clean(v.docNo), issued: v.issued || '', expires: v.expires || '', remind, note: clean(v.note) };
  if (!DOC_KIND[rec.kind] || (rec.kind === 'personal' && !can('settings'))) return [null, 'Choose what kind of document it is'];
  if (!rec.title) return [null, 'What is the document called?', 'title'];
  if (!Number.isInteger(remind) || remind < 0 || remind > 365) return [null, 'Type the number of days, like 30', 'remind'];
  if (rec.issued && rec.expires && rec.expires < rec.issued) return [null, 'It cannot expire before it was issued', 'expires'];
  return [rec];
}
async function saveDoc(f) {
  const old = docOf(f.dataset.id), [rec, err, field] = docFields(f);
  if (!rec) return formErr(f, field || null, err);
  const by = myName() || S.lastBy || '';
  if (old) {
    const changes = diff(old, rec);
    if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
    update({ docs: S.docs.map(v => (v.id === old.id ? { ...v, ...rec, editedAt: stampSec(), editedBy: by } : v)), log: logWith([['Edited', old.id, changes.join(' ; ')]], by) });
    toast('Changes saved ✓');
    return closeSheet();
  }
  const file = f.elements.scan.files[0];
  if (!file) return formErr(f, 'scan', 'Choose the photo or PDF of the document');
  $('.err', f).textContent = 'Saving…';
  let p;
  try { p = await prepareFile(file); } catch (e) { return formErr(f, 'scan', e.message); }
  const [[id], seq] = nextIds('V', 1, S.seq);
  update({ docs: [...S.docs, { id, ...rec, by, createdAt: stampSec() }], seq, log: logWith([['Added', id, `Document: ${rec.title}${rec.owner ? ` (${rec.owner})` : ''}${rec.expires ? `, expires ${fmtDate(rec.expires)}` : ''}`]], by) });
  await keepFile({ for: id, type: 'document', name: p.name, mime: p.mime }, p.data);
  toast('Document added ✓');
  docDetail(id);
}
function renewForm(id) {
  const v = docOf(id);
  if (!v) return;
  openSheet(`${head(`Renew ${v.title}`, '', id)}
    <p class="hint">The new document takes the old one's place. The old one is kept in Drive (folder CHANGES).</p>
    <form data-form="renew" data-id="${esc(id)}">
      ${scanField('Photo or PDF of the new document')}
      ${dateField('issued', 'Issued on', '', false)}
      ${dateField('expires', 'Expires on', '', !!v.expires)}
      <p class="err"></p>
      <button class="btn out">Renew</button>
    </form>`);
}
async function saveRenew(f) {
  const v = docOf(f.dataset.id), file = f.elements.scan.files[0], issued = f.elements.issued.value, expires = f.elements.expires.value;
  if (!v) return;
  if (!file) return formErr(f, 'scan', 'Choose the photo or PDF of the new document');
  if (v.expires && expires <= v.expires) return formErr(f, 'expires', `The new one should expire after ${fmtDate(v.expires)}`);
  $('.err', f).textContent = 'Saving…';
  let p;
  try { p = await prepareFile(file); } catch (e) { return formErr(f, 'scan', e.message); }
  const old = scanOf(v.id), by = myName() || S.lastBy || '', rec = { issued: issued || '', expires: expires || '' };
  update({ docs: S.docs.map(x => (x.id === v.id ? { ...x, ...rec, editedAt: stampSec(), editedBy: by } : x)),
    log: logWith([['Renewed', v.id, `${v.title}: ${v.expires ? `expired ${fmtDate(v.expires)} → ` : ''}${expires ? `expires ${fmtDate(expires)}` : 'no expiry date'}`]], by) });
  await keepFile({ for: v.id, type: 'document', name: p.name, mime: p.mime, ...(old ? { replaces: old.id } : {}) }, p.data);
  if (old) await setAside(old, 'replaced');
  toast('Renewed ✓ — the old one is kept');
  docDetail(v.id);
}
async function deleteDoc(id) {
  const v = docOf(id);
  if (!v || !await unlock('Enter the password to delete this document.')) return;
  const by = confirmBy(`Delete "${v.title}" from the documents?\n\nIts scans move to the Drive folder DELETED ENTRIES.`);
  if (!by) return;
  update({ docs: S.docs.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Document: ${v.title}`]], by) });
  toast('Deleted ✓'); closeAll(); docsSheet();
}

/* ---------- the morning email (admins): where it goes; the sheet sends it every day at about 7 ---------- */
async function alertsSheet() {
  openSheet(`${head('Morning email', '')}<p class="muted">Asking the Google Sheet…</p>`);
  let res;
  try { res = await callServer(S.link, { op: 'alerts' }); } catch (e) { return openSheet(`${head('Morning email', '')}<p class="note">${esc(e.offline ? 'No internet. Try again when it is on.' : e.message)}</p>`); }
  const suggest = res.email || (companyContacts().find(([k]) => /mail/i.test(k)) || [])[1] || '';
  openSheet(`${head('Morning email', '')}
    <p class="hint">Every morning the Google Sheet emails one list: regular payments due or late, and documents about to expire. Nothing to say — no email.</p>
    ${res.running ? '<p class="note">✅ It runs every morning at about 7.</p>' : `<p class="note">⚠️ Not running yet. In Apps Script choose <b>allowFiles</b> and press <b>Run</b> once (tick every box on Google's screen). Then come back here.</p>`}
    <form data-form="alerts">
      <label class="fld"><span>Send it to</span><input name="email" type="email" value="${esc(suggest)}" placeholder="e.g. office@yourcompany.com" autocomplete="off"></label>
      <p class="err"></p>
      <button class="btn primary">Save</button>
    </form>
    <button class="btn ghost" data-act="testAlerts" style="margin-top:10px">✉️ Send a test email now</button>`);
}
async function saveAlerts(f, test = false) {
  const email = clean(f.elements.email.value);
  $('.err', f).textContent = test ? 'Sending…' : 'Saving…';
  try {
    const res = await callServer(S.link, { op: 'alerts', email, test });
    $('.err', f).textContent = '';
    toast(test ? (res.sent || 'Sent ✓') : res.email ? `Saved ✓ — it goes to ${res.email}` : 'Saved ✓ — no morning email');
  } catch (e) { formErr(f, 'email', e.offline ? 'No internet. Try again when it is on.' : e.message); }
}
