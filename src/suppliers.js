/* ---------- suppliers and factories, and inspecting what was ordered from each (admins only) ---------- */
// A supplier (kind U) is a factory, trader or shop: where it is, who to talk to and how. Its page lists what it quoted and
// what was ordered there. Inspection happens per supplier (owner, 16 Oct 2026: "factory 1 and 2 separately"): every item
// ordered there that has not left yet, each detail of it (its spec lines) and the usual checks (quantity, look, sizes,
// workmanship, working, parts, packing, carton marks) ticked OK or not OK on the phone, the count, a note and photos. Saved
// on each item; the checklist (to print) and the report (with the results) are PDFs (buypdf.js).
const SUP_KINDS = { factory: 'Factory', trader: 'Trader / showroom', shop: 'Shop', agent: 'Agent', other: 'Other' };
const STD_CHECKS = [['qty', 'Quantity counted'], ['look', 'Colour, finish and look match the photo or sample'], ['size', 'Sizes measured'], ['work', 'No scratches, dents, stains, cracks or loose parts'],
  ['func', 'Works: switched on, opened and closed, test run'], ['parts', 'Accessories, spare parts, fixings and manuals'], ['pack', 'Packing strong, corners protected, wrapped against water'], ['marks', 'Cartons marked: project, room, item, carton n of m']];
const supItems = id => live(S.needs).filter(n => n.order && n.order.sup === id);
const supQuoted = id => live(S.needs).filter(n => (n.quotes || []).some(q => q.sup === id) && !(n.order && n.order.sup === id));
const toInspect = id => supItems(id).filter(n => ['ordered', 'inspected'].includes(n.status)).sort((a, b) => a.order.date.localeCompare(b.order.date) || a.t.localeCompare(b.t));

function suppliersSheet() {
  const us = live(S.suppliers).sort((a, b) => a.name.localeCompare(b.name));
  openSheet(`${head('Suppliers and factories', 'out')}
    ${buyNav('suppliers')}
    <button class="btn out" data-act="addSupplier">＋ Add a supplier</button>
    ${us.length ? `<div class="card list inset" style="margin-top:14px">${us.map(u => { const o = supItems(u.id).length, w = toInspect(u.id).length; return `<button class="row" data-act="openSupplier" data-id="${esc(u.id)}"><span class="dot">🏭</span>
      <span class="main"><span class="t"><span class="tt">${esc(u.name)}</span>${w ? `<i class="tag warn">${w} to inspect</i>` : ''}</span><span class="s">${esc([SUP_KINDS[u.kind], u.city, u.country, o && `${o} ordered`].filter(Boolean).join(' · '))}</span></span></button>`; }).join('')}</div>`
      : `<div style="height:14px"></div>${empty('No suppliers yet', 'Add each factory or shop you visit: its contacts, then its quotes on the items.')}`}`);
  comeBack(suppliersSheet);
}
function supplierDetail(id) {
  const u = supOf(id);
  if (!u) return false;
  const ordered = supItems(id), quoted = supQuoted(id), check = toInspect(id);
  openSheet(`${head(u.name, 'out', [SUP_KINDS[u.kind], u.city, u.country].filter(Boolean).join(' · '))}
    ${check.length ? `<button class="btn out" data-act="inspect" data-id="${esc(id)}">🔍 Inspection checklist (${check.length} item${check.length === 1 ? '' : 's'})</button>` : ''}
    <div class="two" style="margin-top:10px">${u.phone ? `<a class="btn ghost" href="${esc(waChat(u.phone))}" target="_blank" rel="noopener">💬 WhatsApp</a><a class="btn ghost" href="tel:${esc(u.phone.replace(/[^\d+]/g, ''))}">📞 Call</a>` : ''}</div>
    ${u.wechat ? `<button class="btn ghost" data-act="copyText" data-text="${esc(u.wechat)}" style="margin-top:10px">📋 Copy WeChat ID: ${esc(u.wechat)}</button>` : ''}
    ${facts([['Contact person', u.person], ['Phone / WhatsApp', u.phone], ['WeChat', u.wechat], ['Email', u.email], ['Market / booth / address', u.market], ['City', u.city], ['Country', u.country], ['Note', u.note]])}
    ${photoStrip(id)}
    <div class="two" style="margin-top:10px">${attachButton(id, '📷 Card or showroom photo', 'attachment', 'image/*')}${attachButton(id, '📎 Price list (PDF)', 'attachment', 'application/pdf')}</div>
    ${filesList(filesFor(id).filter(f => !isPic(f)), 'Files')}
    <h3 class="subh">Ordered here (${ordered.length})</h3>${ordered.length ? `${ckList(ordered)}` : '<p class="muted">Nothing yet.</p>'}
    ${quoted.length ? `<h3 class="subh">Quoted, not ordered (${quoted.length})</h3>${ckList(quoted)}` : ''}
    <div class="two" style="margin-top:18px"><button class="btn ghost" data-act="editSupplier" data-id="${esc(id)}">✏️ Edit</button>${ordered.length || quoted.length ? '' : `<button class="btn danger" data-act="delSupplier" data-id="${esc(id)}">🗑 Delete 🔒</button>`}</div>`);
  paintThumbs();
  comeBack(() => supplierDetail(id));
}
function supplierForm(old) {
  const d = old || { kind: 'factory', country: (currentTrip() || {}).country || '' };
  openSheet(`${head(old ? 'Edit supplier' : 'New supplier', 'out', old?.id)}
    <form data-form="supplier" data-id="${esc(old?.id || '')}">
      ${textField('name', 'Name', 'e.g. Factory One — sofas', d.name)}
      <div class="fld"><span>Kind</span><div class="chips">${Object.entries(SUP_KINDS).map(([k, t]) => `<label><input type="radio" name="kind" value="${k}" ${k === d.kind ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
      ${textField('person', 'Contact person', 'e.g. Mr Li (sales)', d.person, false)}
      <label class="fld"><span>Phone / WhatsApp <em>(optional)</em></span><input name="phone" type="tel" value="${esc(d.phone)}" maxlength="30" autocomplete="off"></label>
      ${textField('wechat', 'WeChat ID', '', d.wechat, false)}
      <label class="fld"><span>Email <em>(optional)</em></span><input name="email" type="email" value="${esc(d.email)}" maxlength="100" autocomplete="off"></label>
      ${textField('market', 'Market, booth or address', 'e.g. Lecong furniture market, hall 3, shop 12', d.market, false)}
      <div class="two">${textField('city', 'City', 'e.g. Foshan', d.city, false)}${textField('country', 'Country', 'e.g. China', d.country, false)}</div>
      ${textField('note', 'Note', 'e.g. Good quality, slow to reply', d.note, false)}
      <p class="err"></p>
      <button class="btn out">${old ? 'Save changes' : 'Add supplier'}</button>
    </form>`);
}
const SUP_LABELS = { name: 'Name', kind: 'Kind', person: 'Contact person', phone: 'Phone', wechat: 'WeChat', email: 'Email', market: 'Address', city: 'City', country: 'Country', note: 'Note' };
function newSupplier(rec) {
  const [[id], seq] = nextIds('U', 1, S.seq), by = myName() || S.lastBy || '';
  update({ suppliers: [...S.suppliers, { id, ...rec, by, createdAt: stampSec() }], seq, log: logWith([['Added', id, `Supplier: ${rec.name}`]], by) });
  return id;
}
function saveSupplier(f) {
  const v = Object.fromEntries(new FormData(f)), old = supOf(f.dataset.id);
  const rec = Object.fromEntries(Object.keys(SUP_LABELS).map(k => [k, clean(v[k])]));
  if (!rec.name) return formErr(f, 'name', 'Type the supplier’s name');
  if (!SUP_KINDS[rec.kind]) rec.kind = 'other';
  if (!old) { const id = newSupplier(rec); toast('Supplier added ✓'); return supplierDetail(id); }
  const changes = changedOf(old, rec, SUP_LABELS), by = myName() || S.lastBy || '';
  if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
  update({ suppliers: S.suppliers.map(u => (u.id === old.id ? { ...u, ...rec, editedAt: stampSec(), editedBy: by } : u)), log: logWith([['Edited', old.id, `${rec.name}: ${changes.join(', ')} changed`]], by) });
  toast('Changes saved ✓');
  supplierDetail(old.id);
}
async function deleteSupplier(id) {
  const u = supOf(id);
  if (!u || supItems(id).length || supQuoted(id).length || !await unlock('Enter the password to delete this supplier.')) return;
  const by = confirmBy(`Delete the supplier "${u.name}"?`);
  if (!by) return;
  update({ suppliers: S.suppliers.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Supplier: ${u.name}`]], by) });
  toast('Deleted ✓'); closeAll(); suppliersSheet();
}

/* ---------- the inspection: ticked on the phone at the factory ---------- */
// What is ticked is kept on this phone while the screen is open (a photo taken in between redraws it); Save writes only the
// items changed on it, so an item inspected on an earlier day keeps its date and inspector.
let inspDraft = {};
const okRow = (name, label, val, na) => `<div class="okrow"><span>${esc(label)}</span><div class="okbad">
  <label><input type="radio" name="${name}" value="ok" ${val === 'ok' ? 'checked' : ''}><span aria-label="OK">✓</span></label><label class="no"><input type="radio" name="${name}" value="bad" ${val === 'bad' ? 'checked' : ''}><span aria-label="Not OK">✗</span></label>
  ${na ? `<label><input type="radio" name="${name}" value="na" ${val === 'na' ? 'checked' : ''}><span>n/a</span></label>` : ''}</div></div>`;
// the results so far for one item: the draft, else its last inspection, else nothing ticked
const inspOf = n => inspDraft[n.id] || { inc: true, specs: (n.insp && n.insp.specs) || [], std: (n.insp && n.insp.std) || {}, counted: n.insp && n.insp.counted !== undefined ? String(n.insp.counted) : '', note: (n.insp && n.insp.note) || '' };
function inspCard(n) {
  const r = inspOf(n), id = n.id;
  return `<section class="insp card pad">
    <label class="fld check"><input type="checkbox" name="i|${esc(id)}" ${r.inc ? 'checked' : ''}> <b>${esc(n.t)}</b></label>
    <p class="muted">${esc([`${plain(n.order.qty)} ${n.unit || ''} ordered ${fmtDate(n.order.date)}`, n.project && projName(n.project), n.area].filter(Boolean).join(' · '))}${n.insp ? ` · last check ${esc(fmtDate(n.insp.date))}: ${n.insp.result === 'fail' ? '<b>NOT OK</b>' : INSP_TEXT[n.insp.result]}` : ''}</p>
    ${photoStrip(id)}
    <div class="checks">${(n.specs || []).map(([k, v], i) => okRow(`c|${id}|s|${i}`, `${k}: ${v}`, r.specs[i])).join('')}
      ${STD_CHECKS.map(([k, label]) => okRow(`c|${id}|d|${k}`, label, r.std[k], true)).join('')}</div>
    <div class="two"><label class="fld"><span>Counted</span><input name="n|${esc(id)}" inputmode="decimal" value="${esc(r.counted)}" placeholder="${esc(plain(n.order.qty))}" autocomplete="off"></label><div></div></div>
    <label class="fld"><span>Note <em>(what is wrong, what was agreed)</em></span><textarea class="plain" name="t|${esc(id)}" rows="2" maxlength="600">${esc(r.note)}</textarea></label>
    ${attachButton(id, '📷 Photo of what you see', 'attachment', 'image/*')}
  </section>`;
}
function inspectSheet(supId) {
  const u = supOf(supId), items = toInspect(supId);
  if (!u) return;
  openSheet(`${head(`Inspection — ${u.name}`, 'out', [u.market, u.city, u.country].filter(Boolean).join(', '))}
    ${items.length ? `<p class="hint">At the factory, tick each line ✓ OK or ✗ not OK, count what is there and add photos. Untick an item to leave it out. The checklist PDF can be printed before; the report has the results.</p>
    <div class="two"><button class="btn ghost" data-act="inspPdf" data-id="${esc(supId)}" data-blank="1">📄 Checklist to print</button><button class="btn ghost" data-act="inspPdf" data-id="${esc(supId)}">📄 Report with results</button></div>
    <form data-form="inspect" data-id="${esc(supId)}" style="margin-top:14px">
      ${items.map(inspCard).join('')}
      <label class="fld"><span>Inspected by</span><input name="by" value="${esc(myName() || S.lastBy || '')}" maxlength="60" autocomplete="off" required></label>
      <p class="err"></p>
      <button class="btn out">Save the inspection</button>
    </form>` : empty('Nothing to inspect', 'Items ordered from this supplier show here until they are loaded.')}`);
  paintThumbs();
  comeBack(() => inspectSheet(supId));
}
// what the form says now, item by item
function readInspection(f) {
  const out = {};
  toInspect(f.dataset.id).forEach(n => {
    const val = name => { const el = f.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; };
    out[n.id] = { inc: !!f.elements[`i|${n.id}`]?.checked, specs: (n.specs || []).map((_, i) => val(`c|${n.id}|s|${i}`)), std: Object.fromEntries(STD_CHECKS.map(([k]) => [k, val(`c|${n.id}|d|${k}`)]).filter(([, x]) => x)),
      counted: (f.elements[`n|${n.id}`]?.value || '').trim(), note: (f.elements[`t|${n.id}`]?.value || '').trim() };
  });
  return out;
}
// the item a changed field belongs to (its name is "c|N-…|s|0", "n|N-…" …)
function keepInspDraft(f, field) {
  const id = String(field && field.name || '').split('|')[1];
  if (!id) return;
  const r = readInspection(f)[id];
  if (r) inspDraft = { ...inspDraft, [id]: r };
}
// how many were counted: a number ("1,200" too), 0, or null when nothing (or nonsense) was typed
const countOf = r => (r.counted === '' ? null : /^0+([.,]0*)?$/.test(r.counted) ? 0 : parseAmount(r.counted));
// fail: a line not OK, or fewer counted than ordered; pass: every line ticked OK (or n/a) and none short; else checked in part
function inspResult(r, n) {
  const c = countOf(r);
  if (r.specs.includes('bad') || Object.values(r.std).includes('bad') || (c !== null && c < n.order.qty)) return 'fail';
  return (n.specs || []).every((_, i) => r.specs[i]) && STD_CHECKS.every(([k]) => r.std[k]) ? 'pass' : 'open';
}
const INSP_TEXT = { pass: 'all good', fail: 'NOT OK', open: 'checked in part' };
const inspTouched = r => r.specs.some(Boolean) || Object.keys(r.std).length || r.counted !== '' || r.note;
function saveInspection(f) {
  const res = readInspection(f), by = clean(f.elements.by.value), items = toInspect(f.dataset.id).filter(n => res[n.id].inc && inspDraft[n.id] && inspTouched(res[n.id]));
  if (!by) return formErr(f, 'by', 'Who inspected?');
  if (!items.length) return formErr(f, null, 'Tick at least one line of an item first.');
  const bad = items.find(n => res[n.id].counted !== '' && countOf(res[n.id]) === null);
  if (bad) return formErr(f, `n|${bad.id}`, 'Type how many were counted, like 2');
  const at = stampSec(), day = today(), lines = [];
  const done = new Map(items.map(n => {
    const r = res[n.id], result = inspResult(r, n);
    lines.push(['Edited', n.id, `${n.t}: inspected at ${supOf(n.order.sup).name} — ${INSP_TEXT[result]}`]);
    return [n.id, { date: day, by, specs: r.specs, std: r.std, ...(countOf(r) !== null ? { counted: countOf(r) } : {}), note: r.note.slice(0, 600), result }];
  }));
  update({ needs: S.needs.map(x => { const i = done.get(x.id); return i ? { ...x, insp: i, status: i.result === 'pass' ? 'inspected' : 'ordered', steps: { ...(x.steps || {}), ...(i.result === 'pass' ? { inspected: day } : {}) }, editedAt: at, editedBy: by } : x; }),
    log: logWith(lines, by), lastBy: by });
  items.forEach(n => { delete inspDraft[n.id]; });
  const fails = [...done.values()].filter(i => i.result === 'fail').length, open = [...done.values()].filter(i => i.result === 'open').length;
  toast(fails ? `Saved — ${fails} item${fails === 1 ? '' : 's'} NOT OK` : open ? `Saved — ${open} not fully checked yet` : 'Saved ✓ — all OK');
  inspectSheet(f.dataset.id);
}
