/* ---------- buying: what to buy and ideas, suppliers' quotes, orders and their steps (admins only) ---------- */
// Everything the company means to buy, for any project, venture or business: an idea typed in a second, or an item with
// every detail (colour, sizes, seating…) as spec lines, which become its inspection checklist (suppliers.js). An item goes
// idea → to buy → ordered → inspected → on the way → received (each step dated) or is dropped. Suppliers (factories,
// traders, shops) give quotes and one is ordered from. Prices are in any currency (CNY, UGX…); what was paid for it goes
// into the accounts as a USD payment that names it (need) and its trip. Trips are in trips.js, the PDFs in buypdf.js.
// Owner, 16 Oct 2026: admins only; offer the payment; compare quotes; trips carry their costs.
const BUY_STATES = ['idea', 'tobuy', 'ordered', 'inspected', 'shipped', 'received', 'dropped'];
const BUY_STATE = { idea: ['💡', 'Idea', ''], tobuy: ['🛒', 'To buy', 'warn'], ordered: ['🧾', 'Ordered', 'warn'], inspected: ['🔍', 'Inspected', ''], shipped: ['🚢', 'On the way', 'warn'], received: ['✅', 'Received', ''], dropped: ['✖', 'Dropped', 'bad'] };
const BUY_VIEWS = { open: ['Ideas and to buy', ['idea', 'tobuy']], ordered: ['Ordered', ['ordered', 'inspected']], shipped: ['On the way', ['shipped']], received: ['Received', ['received']], dropped: ['Dropped', ['dropped']], all: ['Everything', BUY_STATES] };
const PRI = { 1: 'Urgent', 2: 'Normal', 3: 'Some day' };
const BUY_CURS = ['USD', 'CNY', 'UGX', 'KES', 'AED', 'INR', 'EUR', 'SSP'];
const BUY_SYM = { USD: '$', CNY: '¥', EUR: '€', INR: '₹' };
const cost = (n, cur) => `${BUY_SYM[cur] || `${cur} `}${plain(n)}`;
const BUY_UNITS = ['pcs', 'sets', 'pairs', 'm', 'm²', 'm³', 'kg', 'tonnes', 'boxes', 'cartons', 'bags', 'rolls', 'litres'];
const AREAS = ['Living room', 'Master bedroom', 'Bedroom', 'Kitchen', 'Dining', 'Bathroom', 'Toilet', 'Corridor', 'Balcony', 'Outdoor', 'Office', 'Reception', 'Store', 'Whole building'];
const WHERES = ['China', 'Uganda', 'Kenya', 'Dubai', 'India', 'Turkey', 'Juba', 'Anywhere'];

const needOf = id => S.needs.find(x => x.id === id && !x.deleted);
const supOf = id => S.suppliers.find(x => x.id === id && !x.deleted);
const tripOf = id => S.trips.find(x => x.id === id && !x.deleted);
const catOf = name => BUY_CATS.find(c => c[0] === name);
// every category: the usual ones, then any typed on an item
const catNames = () => [...new Set([...BUY_CATS.map(c => c[0]), ...live(S.needs).map(n => n.cat).filter(Boolean)])];
const needTotal = n => (n.order ? Math.round(n.order.qty * n.order.price * 100) / 100 : 0);
const bestQuote = n => (n.quotes || []).filter(q => supOf(q.sup)).sort((a, b) => a.price - b.price)[0];
const qtyText = n => (n.qty ? `${plain(n.qty)} ${n.unit || ''}`.trim() : '');
// what a line of the list says under the item's name
const needLine = n => [n.under && needOf(n.under) && `for: ${needOf(n.under).t}`, qtyText(n), n.project && projName(n.project), n.area, n.where !== 'Anywhere' && n.where, ...(n.tags || []).map(t => `#${t}`)].filter(Boolean).join(' · ');
// ideas and add-ons kept under an item (blackout film for the windows)
const kidsOf = id => live(S.needs).filter(n => n.under === id && n.status !== 'dropped');
// rows of a list with each item's add-ons right under it (indented); an add-on whose item is not in the list shows on its own
function needRows(list) {
  const here = new Set(list.map(n => n.id)), top = list.filter(n => !n.under || !here.has(n.under));
  const under = (id, depth) => (depth > 4 ? '' : list.filter(k => k.under === id).map(k => needRow(k).replace('class="row"', `class="row sub" style="padding-left:${18 + depth * 16}px"`) + under(k.id, depth + 1)).join(''));
  return top.map(n => needRow(n) + under(n.id, 1)).join('');
}
const needAmt = n => (n.order ? cost(needTotal(n), n.order.cur) : n.target ? `<small>target</small>${esc(cost(n.target, n.cur || 'USD'))}` : '');
const stateTag = n => { const [, text, tone] = BUY_STATE[n.status]; return `<i class="tag ${tone}">${text}</i>`; };
function needRow(n) {
  return `<button class="row" data-act="openNeed" data-id="${esc(n.id)}"><span class="dot">${BUY_STATE[n.status][0]}</span>
    <span class="main"><span class="t"><span class="tt">${esc(n.t)}</span>${n.pri === 1 ? '<i class="tag bad">Urgent</i>' : ''}${['idea', 'tobuy'].includes(n.status) ? '' : stateTag(n)}${n.insp && n.insp.result === 'fail' ? '<i class="tag bad">Failed check</i>' : ''}</span>
    <span class="s">${esc(needLine(n) || n.sub || '')}</span></span><span class="amt">${needAmt(n)}</span></button>`;
}
// grouped by category (in the usual order), then by sub-category and name
function needGroups(list) {
  const order = catNames();
  return order.map(c => [c, list.filter(n => (n.cat || 'Other') === c).sort((a, b) => String(a.sub || '').localeCompare(String(b.sub || '')) || a.t.localeCompare(b.t))]).filter(([, l]) => l.length);
}

/* ---------- the list ---------- */
let buyView = { view: 'open', project: '', q: '' };
const buyMatches = n => BUY_VIEWS[buyView.view][1].includes(n.status) && (!buyView.project || n.project === buyView.project)
  && (!buyView.q || [n.t, n.cat, n.sub, n.area, n.where, n.notes, ...(n.tags || []), ...(n.specs || []).flat()].join(' ').toLowerCase().includes(buyView.q.toLowerCase()));
function buyingSheet() {
  const all = live(S.needs), list = all.filter(buyMatches), groups = needGroups(list), ps = live(S.projects);
  const count = v => all.filter(n => BUY_VIEWS[v][1].includes(n.status)).length;
  openSheet(`${head('Buying', 'out')}
    <form data-form="idea" class="idea-box"><input name="t" placeholder="💡 What do we need, or an idea?" maxlength="160" autocomplete="off" aria-label="What to buy, or an idea"><button class="btn out small">Add</button></form>
    <p class="hint">Type it the moment you think of it: the app puts it in a category. Add the details later. <button type="button" class="link" data-act="pasteList">📋 Paste a whole list</button></p>
    <div class="two"><button class="btn ghost" data-act="addNeed">＋ With all details</button><button class="btn ghost" data-act="trips">✈️ Trips (${live(S.trips).length})</button></div>
    <div class="two" style="margin-top:10px"><button class="btn ghost" data-act="suppliers">🏭 Suppliers (${live(S.suppliers).length})</button><button class="btn ghost" data-act="budgets">💰 Budgets & spending</button></div>
    <form class="buy-filter" data-form="buyFilter" style="margin-top:16px">
      <select name="view" aria-label="Which items">${Object.entries(BUY_VIEWS).map(([k, [t]]) => `<option value="${k}" ${k === buyView.view ? 'selected' : ''}>${t} (${count(k)})</option>`).join('')}</select>
      ${ps.length ? `<select name="project" aria-label="Project"><option value="">All projects</option>${ps.map(p => `<option value="${esc(p.id)}" ${p.id === buyView.project ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
      <input name="q" type="search" placeholder="Search: name, colour, tag…" value="${esc(buyView.q)}" autocomplete="off" aria-label="Search">
    </form>
    ${groups.length ? groups.map(([c, l]) => `<details class="buy-cat" open><summary>${esc(c)} <small>${l.length}</small></summary><div class="card list inset">${needRows(l)}</div></details>`).join('')
      : empty('Nothing here', buyView.view === 'open' ? 'Type what you need above.' : 'Nothing in this list yet.')}
    ${list.length ? `<button class="btn ghost" data-act="buyListPdf" style="margin-top:16px">📄 This list as a PDF</button>` : ''}`);
  comeBack(buyingSheet);
}
function filterBuying(f) {
  buyView = { view: f.elements.view.value, project: f.elements.project ? f.elements.project.value : '', q: f.elements.q.value.trim() };
  const at = f.elements.q === document.activeElement;
  buyingSheet();
  if (at) { const q = $('#sheet [name=q]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}
// an idea or add-on for an item: in the item's category, for the same project, room and trip
function saveSubIdea(f) {
  const up = needOf(f.dataset.id), t = clean(f.elements.t.value);
  if (!up) return closeSheet();
  if (!t) return f.elements.t.focus();
  newNeed({ t, cat: up.cat, sub: up.sub || '', status: 'idea', pri: up.pri || 2, where: up.where || 'Anywhere', project: up.project || '', area: up.area || '', under: up.id, ...(up.trip ? { trip: up.trip } : {}) });
  toast('Idea added ✓');
  needDetail(up.id);
}
// an idea in one line: its category is guessed from the words; the details come later
function saveIdea(f) {
  const t = clean(f.elements.t.value);
  if (!t) return f.elements.t.focus();
  const n = newNeed({ t, cat: guessCat(t), status: 'idea', pri: 2, where: 'Anywhere' });
  toast(`Added to ${n.cat} ✓`);
  buyingSheet();
}
// A list pasted at once (a checklist from WhatsApp or notes): one idea per line, each in its guessed category. Ticks,
// bullets and numbers at the start of a line are left out; the words stay as typed, to tidy up later.
const listLines = text => String(text || '').split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•▪◦–]\s*)?(?:\[[ xX✓]?\]\s*)?(?:\d{1,3}[.)]\s+)?/, '').replace(/\s+/g, ' ').trim()).filter(l => /[\p{L}\p{N}]/u.test(l)).map(l => l.slice(0, 160));
function pasteListSheet(text = '') {
  openSheet(`${head('Paste a list', 'out')}
    <form data-form="pasteList">
      <p class="hint">One thing per line. Each becomes an idea on the buying list, in its own category.</p>
      <label class="fld"><span>The list</span><textarea class="plain" name="list" rows="12" maxlength="20000" placeholder="TV 55 inch\nCeiling fans\nRoofing tiles…">${esc(text)}</textarea></label>
      <p class="note list-count"></p>
      ${projectSelect('', true)}
      ${tripPick('')}
      <p class="err"></p>
      <button class="btn out">Add them</button>
    </form>`);
  countPasted($('#sheet form'));
}
function countPasted(f) {
  const lines = listLines(f.elements.list.value), groups = needGroups(lines.map(t => ({ t, cat: guessCat(t) })));
  $('.list-count', f).innerHTML = lines.length ? `<b>${lines.length}</b> item${lines.length === 1 ? '' : 's'}: ${groups.map(([c, l]) => `${esc(c)} ${l.length}`).join(' · ')}` : 'Paste or type the list above.';
}
function savePasteList(f) {
  const lines = listLines(f.elements.list.value), by = myName() || S.lastBy || '', at = stampSec(), project = f.elements.project ? f.elements.project.value : '', trip = f.elements.trip && tripOf(f.elements.trip.value) ? f.elements.trip.value : '';
  if (!lines.length) return formErr(f, 'list', 'Paste the list: one thing per line.');
  if (lines.length > 300) return formErr(f, 'list', 'That is more than 300 lines: add it in parts.');
  const [ids, seq] = nextIds('N', lines.length, S.seq);
  const items = lines.map((t, i) => ({ id: ids[i], t, cat: guessCat(t), status: 'idea', pri: 2, where: 'Anywhere', project, ...(trip ? { trip } : {}), steps: { idea: today() }, by, createdAt: at }));
  update({ needs: [...S.needs, ...items], seq, log: logWith([['Added', ids[0], `Buying list: ${items.length} ideas pasted at once (${items.map(n => n.t).slice(0, 5).join(', ')}${items.length > 5 ? '…' : ''})`]], by) });
  toast(`${items.length} added ✓`);
  buyView = { view: 'open', project: '', q: '' };
  buyingSheet();
}
function newNeed(rec) {
  const [[id], seq] = nextIds('N', 1, S.seq), by = myName() || S.lastBy || '', n = { id, ...rec, steps: { [rec.status]: today(), ...(rec.steps || {}) }, by, createdAt: stampSec() };
  update({ needs: [...S.needs, n], seq, log: logWith([['Added', id, `Buying list: ${rec.t} (${rec.cat})`]], by) });
  return n;
}

/* ---------- one item: every detail ---------- */
const specRow = ([k, v] = ['', '']) => `<div class="spec-row"><input name="sk" placeholder="e.g. Colour" value="${esc(k)}" maxlength="60" autocomplete="off" aria-label="Detail"><input name="sv" placeholder="e.g. Beige, velvet" value="${esc(v)}" maxlength="200" autocomplete="off" aria-label="Value"><button type="button" class="x" data-act="delSpec" aria-label="Remove this detail">×</button></div>`;
const specChips = cat => `<div class="spec-sugg">${((catOf(cat) || BUY_CATS[BUY_CATS.length - 1])[3]).map(k => `<button type="button" class="chip-btn" data-act="addSpec" data-k="${esc(k)}">＋ ${esc(k)}</button>`).join('')}</div>`;
const listFrom = (id, values) => `<datalist id="${id}">${[...new Set(values.filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
function needForm(old, preset = {}) {
  const d = old || { t: '', cat: 'Other', status: 'tobuy', pri: 2, where: 'Anywhere', unit: 'pcs', cur: 'USD', specs: [], ...preset }, cats = catNames(), all = live(S.needs);
  const subs = [...((catOf(d.cat) || [])[1] || []), ...all.filter(n => n.cat === d.cat).map(n => n.sub)];
  openSheet(`${head(old ? 'Edit item' : 'New item to buy', 'out', old?.id)}
    <form data-form="need" data-id="${esc(old?.id || '')}">
      ${textField('t', 'What is it?', 'e.g. Sofa, L-shape for the living room', d.t)}
      <label class="fld"><span>Category</span><select name="cat">${cats.map(c => `<option ${c === d.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">＋ New category…</option></select></label>
      <label class="fld newcat" hidden><span>New category</span><input name="newCat" placeholder="e.g. Hotel equipment, Water bottling" maxlength="60" autocomplete="off"></label>
      <label class="fld"><span>Sub-category <em>(optional)</em></span><input name="sub" value="${esc(d.sub)}" list="dl-sub" maxlength="60" autocomplete="off" placeholder="e.g. Sofas & seating"></label>${listFrom('dl-sub', subs)}
      ${projectSelect(d.project || '', true)}
      <label class="fld"><span>Area / room <em>(optional)</em></span><input name="area" value="${esc(d.area)}" list="dl-area" maxlength="60" autocomplete="off" placeholder="e.g. Master bedroom"></label>${listFrom('dl-area', [...AREAS, ...all.map(n => n.area)])}
      <div class="two"><label class="fld"><span>Quantity <em>(optional)</em></span><input name="qty" inputmode="decimal" value="${esc(d.qty ?? '')}" autocomplete="off"></label>
        <label class="fld"><span>Unit</span><input name="unit" value="${esc(d.unit)}" list="dl-unit" maxlength="20" autocomplete="off"></label></div>${listFrom('dl-unit', [...BUY_UNITS, ...all.map(n => n.unit)])}
      <div class="fld"><span>Every detail <em>(colour, sizes, seating… each becomes a line of the inspection checklist)</em></span>
        <div class="specs">${(d.specs && d.specs.length ? d.specs : [['', '']]).map(specRow).join('')}</div>${specChips(d.cat)}
        <button type="button" class="btn small ghost" data-act="addSpec">＋ Add a detail</button></div>
      <label class="fld"><span>Notes <em>(optional — anything to remember)</em></span><textarea class="plain" name="notes" rows="3" maxlength="2000" placeholder="e.g. Same fabric as the sample in the office; must fit through a 90 cm door.">${esc(d.notes)}</textarea></label>
      <label class="fld"><span>Link <em>(optional — a product page, an Alibaba listing)</em></span><input name="link" type="url" value="${esc(d.link)}" maxlength="500" autocomplete="off" placeholder="https://"></label>
      <div class="two"><label class="fld"><span>Target price per unit <em>(optional)</em></span><input name="target" inputmode="decimal" value="${esc(d.target ?? '')}" autocomplete="off"></label>
        <label class="fld"><span>In</span>${curSelect(d.cur || 'USD', 'tcur')}</label></div>
      <label class="fld"><span>Where to buy it</span><input name="where" value="${esc(d.where)}" list="dl-where" maxlength="60" autocomplete="off"></label>${listFrom('dl-where', [...WHERES, ...all.map(n => n.where)])}
      <div class="fld"><span>How soon?</span><div class="chips">${Object.entries(PRI).map(([k, t]) => `<label><input type="radio" name="pri" value="${k}" ${+k === (d.pri || 2) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
      <label class="fld"><span>Tags <em>(optional — words to find it by, with commas: villa, new hotel, gift)</em></span><input name="tags" value="${esc((d.tags || []).join(', '))}" maxlength="200" autocomplete="off"></label>
      ${old ? '' : `<div class="fld"><span>Is it decided?</span><div class="chips"><label><input type="radio" name="status" value="tobuy" ${d.status !== 'idea' ? 'checked' : ''}><span>🛒 To buy</span></label><label><input type="radio" name="status" value="idea" ${d.status === 'idea' ? 'checked' : ''}><span>💡 Just an idea</span></label></div></div>`}
      ${old ? '' : tripPick(d.trip)}
      <p class="err"></p>
      <button class="btn out">${old ? 'Save changes' : 'Add to the list'}</button>
    </form>`);
}
const tripPick = cur => { const js = live(S.trips).filter(j => !j.back || j.back >= today() || j.id === cur); return js.length ? `<label class="fld"><span>On a trip’s list <em>(optional)</em></span><select name="trip"><option value="">— not yet —</option>${js.map(j => `<option value="${esc(j.id)}" ${j.id === cur ? 'selected' : ''}>${esc(tripName(j))}</option>`).join('')}</select></label>` : ''; };
const specsFrom = f => $$('.spec-row', f).map(r => [clean($('[name=sk]', r).value), clean($('[name=sv]', r).value)]).filter(([k, v]) => k || v).map(([k, v]) => [k || 'Detail', v]);
const tagsFrom = v => [...new Set(String(v || '').split(',').map(t => clean(t).replace(/^#/, '')).filter(Boolean))].slice(0, 20);
// the fields that changed, by name (the Change Log)
const NEED_LABELS = { t: 'Item', cat: 'Category', sub: 'Sub-category', project: 'Project', area: 'Area', qty: 'Quantity', unit: 'Unit', specs: 'Details', notes: 'Notes', link: 'Link', target: 'Target price', cur: 'Currency', where: 'Where', pri: 'Priority', tags: 'Tags' };
const changedOf = (a, b, labels) => Object.keys(labels).filter(k => k in b && JSON.stringify(a[k] ?? '') !== JSON.stringify(b[k] ?? '')).map(k => labels[k]);
function saveNeed(f) {
  const v = Object.fromEntries(new FormData(f)), old = needOf(f.dataset.id);
  const cat = v.cat === '__new' ? clean(v.newCat) : v.cat, qty = v.qty.trim() ? parseAmount(v.qty) : undefined, target = v.target.trim() ? parseAmount(v.target) : undefined;
  if (!clean(v.t)) return formErr(f, 't', 'What is it?');
  if (!cat) return formErr(f, 'newCat', 'Type the new category');
  if (qty === null) return formErr(f, 'qty', 'Type a quantity, like 4 — or leave it empty');
  if (target === null) return formErr(f, 'target', 'Type a price, like 250 — or leave it empty');
  if (v.link && !/^https?:\/\//i.test(v.link.trim())) return formErr(f, 'link', 'A link starts with https://');
  const rec = { t: clean(v.t), cat, sub: clean(v.sub), project: v.project || '', area: clean(v.area), qty, unit: clean(v.unit), specs: specsFrom(f), notes: String(v.notes || '').trim().slice(0, 2000),
    link: String(v.link || '').trim(), target, cur: BUY_CURS.includes(v.tcur) ? v.tcur : 'USD', where: clean(v.where) || 'Anywhere', pri: +v.pri || 2, tags: tagsFrom(v.tags) };
  if (!old) { const n = newNeed({ ...rec, status: v.status === 'idea' ? 'idea' : 'tobuy', ...(tripOf(v.trip) ? { trip: v.trip } : {}) }); toast('Added to the list ✓'); return needDetail(n.id); }
  const changes = changedOf(old, rec, NEED_LABELS), by = myName() || S.lastBy || '';
  if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
  update({ needs: S.needs.map(n => (n.id === old.id ? { ...n, ...rec, editedAt: stampSec(), editedBy: by } : n)), log: logWith([['Edited', old.id, `${rec.t}: ${changes.join(', ')} changed`]], by) });
  toast('Changes saved ✓');
  needDetail(old.id);
}

// the item's photos as pictures (product photos, the sample, the factory's own); a PDF stays a row
const isPic = f => f.mime && f.mime.startsWith('image/');
const photoStrip = id => { const ps = filesFor(id).filter(f => isPic(f) && !f.removed && !f.replaced); return ps.length ? `<div class="thumbs">${ps.map(f => `<button type="button" data-act="showFile" data-id="${esc(f.id)}" aria-label="Open the photo"><img alt="" data-thumb="${esc(f.id)}"></button>`).join('')}</div>` : ''; };
function paintThumbs() {
  $$('#sheet img[data-thumb]').forEach(img => { const id = img.dataset.thumb; img.removeAttribute('data-thumb'); fileBlob(id).then(b => { img.src = URL.createObjectURL(b); }).catch(() => { img.alt = 'Not on this phone yet'; }); });
}
const facts = rows => `<dl class="facts">${rows.filter(r => r[1]).map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>`;
function needDetail(id) {
  const n = needOf(id);
  if (!n) return false;
  const o = n.order, sup = o && supOf(o.sup), t = tripOf(n.trip || (o && o.trip)), pays = live(S.expenses).filter(e => e.need === id).sort(byAt), kids = kidsOf(id), up = n.under && needOf(n.under);
  const steps = BUY_STATES.filter(s => n.steps && n.steps[s]).map(s => `${BUY_STATE[s][1]} ${fmtDate(n.steps[s])}`).join(' → ');
  openSheet(`${head(n.t, 'out', `${n.cat}${n.sub ? ` › ${n.sub}` : ''}`)}
    <p>${stateTag(n)} ${n.pri === 1 ? '<i class="tag bad">Urgent</i>' : n.pri === 3 ? '<i class="tag">Some day</i>' : ''}</p>
    ${steps ? `<p class="muted">${esc(steps)}</p>` : ''}
    ${up ? `<button class="btn ghost" data-act="openNeed" data-id="${esc(up.id)}" style="margin-bottom:10px">↳ An idea for: ${esc(up.t)}</button>` : ''}
    ${photoStrip(id)}
    ${facts([['Quantity', qtyText(n)], ['Project', n.project && projName(n.project)], ['Area / room', n.area], ['Where to buy', n.where], ['Target price', n.target && `${cost(n.target, n.cur || 'USD')} each`], ['Trip', t && tripName(t)], ['Tags', (n.tags || []).join(', ')]])}
    ${n.specs && n.specs.length ? `<h3 class="subh">Details</h3><dl class="facts">${n.specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    ${n.notes ? `<h3 class="subh">Notes</h3><p class="pre">${esc(n.notes)}</p>` : ''}
    ${n.link ? `<a class="btn ghost" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer" style="margin-bottom:10px">🔗 Open the link</a>` : ''}
    ${o ? `<div class="note">🧾 <b>Ordered from ${esc(sup ? sup.name : 'a supplier')}</b> on ${esc(fmtDate(o.date))}: ${esc(plain(o.qty))} × ${esc(cost(o.price, o.cur))} = <b>${esc(cost(needTotal(n), o.cur))}</b>${o.cur !== 'USD' && o.rate ? ` ≈ ${esc(money(inUsd(needTotal(n), o), 'USD'))}` : ''}
      <br>${orderShares(o, n.project).map(sh => `${esc(sh.p ? projName(sh.p) : EXTRA)}: ${esc(plain(sh.q))} = ${esc(cost(sh.cost, o.cur))}`).join(' · ')}${o.note ? `<br>${esc(o.note)}` : ''}</div>` : ''}
    ${n.insp ? `<div class="note">🔍 Inspected on ${esc(fmtDate(n.insp.date))}${n.insp.by ? ` by ${esc(n.insp.by)}` : ''}: <b>${INSP_TEXT[n.insp.result] || ''}</b>${n.insp.note ? ` — ${esc(n.insp.note)}` : ''}</div>` : ''}
    ${n.ship ? `<p class="muted">🚢 Shipment: ${esc(n.ship)}</p>` : ''}
    ${needActions(n)}
    <h3 class="subh">Ideas and add-ons for it (${kids.length})</h3>
    ${kids.length ? `<div class="card list inset">${kids.map(needRow).join('')}</div>` : ''}
    <form data-form="subIdea" data-id="${esc(id)}" class="idea-box" style="margin-top:8px"><input name="t" placeholder="💡 e.g. Blackout security film for these" maxlength="160" autocomplete="off" aria-label="An idea or add-on for this item"><button class="btn small ghost">Add</button></form>
    <h3 class="subh">Quotes (${(n.quotes || []).length})</h3>
    ${(n.quotes || []).length ? `<div class="card list inset">${n.quotes.slice().sort((a, b) => a.price - b.price).map(q => quoteRow(n, q)).join('')}</div>` : '<p class="muted">None yet. Each supplier’s price, so you can compare.</p>'}
    <button class="btn ghost" data-act="addQuote" data-id="${esc(id)}" style="margin-top:10px">＋ Add a quote</button>
    ${pays.length ? `<h3 class="subh">Paid for it (${pays.length})</h3><div class="card list inset">${pays.map(x => itemRow(x, 'E', true)).join('')}</div>` : ''}
    ${filesList(filesFor(id).filter(f => !isPic(f)), 'Files')}
    <div class="two" style="margin-top:14px">${attachButton(id, '📷 Add a photo', 'attachment', 'image/*')}${attachButton(id, '📎 Add a PDF', 'attachment', 'application/pdf')}</div>
    <div class="two" style="margin-top:18px"><button class="btn ghost" data-act="editNeed" data-id="${esc(id)}">✏️ Edit</button><button class="btn ghost" data-act="copyNeed" data-id="${esc(id)}">⧉ Copy as new</button></div>
    <div class="two" style="margin-top:10px">${n.status === 'dropped' ? `<button class="btn ghost" data-act="needStep" data-id="${esc(id)}" data-to="tobuy">↩️ Back on the list</button>` : `<button class="btn ghost" data-act="needStep" data-id="${esc(id)}" data-to="dropped">✖ Drop it</button>`}<button class="btn danger" data-act="delNeed" data-id="${esc(id)}">🗑 Delete 🔒</button></div>`);
  paintThumbs();
  comeBack(() => needDetail(id));
}
const EXTRA = 'Extra / no project'; // bought beyond what the projects need, or for no project
const quoteRow = (n, q) => { const u = supOf(q.sup); return `<div class="sugg"><div><b>${esc(cost(q.price, q.cur))}</b> · ${esc(u ? u.name : 'A deleted supplier')}<br><span class="muted">${esc([q.moq && `minimum ${q.moq}`, q.lead && `ready in ${q.lead}`, q.at && fmtDate(q.at), q.note].filter(Boolean).join(' · '))}</span></div>
  <div class="two">${['idea', 'tobuy'].includes(n.status) && u ? `<button class="btn small out" data-act="orderNeed" data-id="${esc(n.id)}" data-q="${esc(q.id)}">🧾 Order from them</button>` : ''}<button class="btn small ghost" data-act="delQuote" data-id="${esc(n.id)}" data-q="${esc(q.id)}">Remove</button></div></div>`; };
// what can be done next, step by step
function needActions(n) {
  const a = (act, label, cls = 'ghost', to = '') => `<button class="btn ${cls}" data-act="${act}" data-id="${esc(n.id)}"${to ? ` data-to="${to}"` : ''}>${label}</button>`;
  const o = n.order;
  const next = {
    idea: [a('needStep', '🛒 Decided: to buy', 'out', 'tobuy'), a('orderNeed', '🧾 Ordered / bought')],
    tobuy: [a('orderNeed', '🧾 Ordered / bought', 'out')],
    ordered: [o && supOf(o.sup) ? `<button class="btn out" data-act="inspect" data-id="${esc(o.sup)}">🔍 Inspect at ${esc(supOf(o.sup).name)}</button>` : '', a('shipNeed', '🚢 Loaded / on the way')],
    inspected: [a('shipNeed', '🚢 Loaded / on the way', 'out'), o && supOf(o.sup) ? `<button class="btn ghost" data-act="inspect" data-id="${esc(o.sup)}">🔍 The inspection</button>` : ''],
    shipped: [a('needStep', '✅ Received', 'out', 'received')],
    received: [], dropped: [],
  }[n.status].filter(Boolean);
  return next.length ? `<div class="two" style="margin:12px 0">${next.join('')}</div>` : '';
}
function needStep(id, to) {
  const n = needOf(id);
  if (!n || !BUY_STATES.includes(to)) return;
  const by = myName() || S.lastBy || '', back = to === 'tobuy' && n.status === 'dropped';
  update({ needs: S.needs.map(x => (x.id === id ? { ...x, status: back && n.order ? 'ordered' : to, steps: { ...(x.steps || {}), [to]: today() }, editedAt: stampSec(), editedBy: by } : x)), log: logWith([['Edited', id, `${n.t}: ${BUY_STATE[n.status][1]} → ${BUY_STATE[to][1]}`]], by) });
  toast(`${BUY_STATE[to][1]} ✓`);
  needDetail(id);
}
async function deleteNeed(id) {
  const n = needOf(id);
  if (!n || !await unlock('Enter the password to delete this item.')) return;
  const by = confirmBy(`Delete "${n.t}" from the buying list?${live(S.expenses).some(e => e.need === id) ? '\n\nWhat was paid for it stays in the accounts.' : ''}`);
  if (!by) return;
  update({ needs: S.needs.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Buying list: ${n.t}`]], by) });
  toast('Deleted ✓'); closeAll(); buyingSheet();
}
// another one like it (a second sofa in another colour): every detail copied, no quotes, order or photos
function copyNeed(id) {
  const n = needOf(id);
  if (n) needForm(null, { t: n.t, cat: n.cat, sub: n.sub, project: n.project, area: n.area, qty: n.qty, unit: n.unit, specs: n.specs, notes: n.notes, link: n.link, target: n.target, cur: n.cur, where: n.where, pri: n.pri, tags: n.tags, status: 'tobuy', trip: n.trip });
}

/* ---------- quotes: what each supplier asks ---------- */
const supPick = (cur, label = 'Supplier') => { const us = live(S.suppliers).sort((a, b) => a.name.localeCompare(b.name)); return `<label class="fld"><span>${label}</span><select name="sup">${us.map(u => `<option value="${esc(u.id)}" ${u.id === cur ? 'selected' : ''}>${esc(u.name)}${u.city ? ` — ${esc(u.city)}` : ''}</option>`).join('')}<option value="__new" ${us.length ? '' : 'selected'}>＋ New supplier…</option></select></label>
  <div class="newsup" ${us.length ? 'hidden' : ''}>${textField('supName', 'Supplier or factory name', 'e.g. Factory One, Foshan', '', false)}<label class="fld"><span>Their phone / WhatsApp <em>(optional)</em></span><input name="supPhone" type="tel" maxlength="30" autocomplete="off"></label></div>`; };
// the supplier chosen, or a new one made from its name
function supFrom(f) {
  const v = f.elements.sup.value;
  if (v !== '__new') return supOf(v) ? v : '';
  const name = clean(f.elements.supName.value);
  return name ? newSupplier({ name, kind: 'factory', phone: clean(f.elements.supPhone.value), city: '', country: '' }) : '';
}
// prices abroad: any currency; never named "cur", which belongs to the payment fields (USD / SSP, their symbol and preview)
const curSelect = (cur, name = 'pcur') => `<select name="${name}" aria-label="Currency">${BUY_CURS.map(c => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
function quoteForm(id) {
  const n = needOf(id);
  if (!n) return;
  openSheet(`${head('Add a quote', 'out', n.t)}
    <form data-form="quote" data-id="${esc(id)}">
      ${supPick('')}
      <div class="fld"><span>Price per ${esc(n.unit || 'unit')}</span><div class="price-in"><input name="price" inputmode="decimal" required autocomplete="off">${curSelect(n.cur || 'USD')}</div></div>
      <div class="two"><label class="fld"><span>Minimum order <em>(optional)</em></span><input name="moq" maxlength="40" autocomplete="off" placeholder="e.g. 10 pcs"></label>
        <label class="fld"><span>Ready in <em>(optional)</em></span><input name="lead" maxlength="40" autocomplete="off" placeholder="e.g. 25 days"></label></div>
      ${textField('note', 'Note', 'e.g. Includes cushions; price before discount', '', false)}
      <p class="muted">Add a photo of their sample or price list on the item after saving.</p>
      <p class="err"></p>
      <button class="btn out">Save the quote</button>
    </form>`);
}
const newQid = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
function saveQuote(f) {
  const n = needOf(f.dataset.id), v = Object.fromEntries(new FormData(f)), price = parseAmount(v.price);
  if (!n) return closeSheet();
  if (price === null) return formErr(f, 'price', 'Type their price, like 250');
  const sup = supFrom(f);
  if (!sup) return formErr(f, f.elements.sup.value === '__new' ? 'supName' : 'sup', 'Which supplier?');
  const by = myName() || S.lastBy || '', trip = currentTrip();
  const q = { id: newQid(), sup, price, cur: BUY_CURS.includes(v.pcur) ? v.pcur : 'USD', moq: clean(v.moq), lead: clean(v.lead), note: clean(v.note), at: today(), ...(trip ? { trip: trip.id } : {}) };
  update({ needs: S.needs.map(x => (x.id === n.id ? { ...x, quotes: [...(x.quotes || []), q], editedAt: stampSec(), editedBy: by } : x)), log: logWith([['Edited', n.id, `${n.t}: quote ${cost(price, q.cur)} from ${supOf(sup).name}`]], by) });
  toast('Quote saved ✓');
  needDetail(n.id);
}
function deleteQuote(id, qid) {
  const n = needOf(id), q = n && (n.quotes || []).find(x => x.id === qid);
  if (!q || !confirm(`Remove the quote of ${cost(q.price, q.cur)}?`)) return;
  const by = myName() || S.lastBy || '';
  update({ needs: S.needs.map(x => (x.id === id ? { ...x, quotes: x.quotes.filter(y => y.id !== qid), editedAt: stampSec(), editedBy: by } : x)), log: logWith([['Edited', id, `${n.t}: quote ${cost(q.price, q.cur)} removed`]], by) });
  needDetail(id);
}
// the trip someone is on today, to file quotes and orders under (one with no return day counts for 30 days)
const currentTrip = () => live(S.trips).filter(j => j.out <= today() && (j.back || plusDays(j.out, 30)) >= today()).sort((a, b) => b.out.localeCompare(a.out))[0];

/* ---------- ordering: from one supplier, at a price; the payment offered filled in ---------- */
function orderForm(id, qid) {
  const n = needOf(id);
  if (!n) return;
  const q = (n.quotes || []).find(x => x.id === qid) || bestQuote(n), trip = tripOf(n.trip) || currentTrip();
  openSheet(`${head('Ordered / bought', 'out', n.t)}
    <form data-form="order" data-id="${esc(id)}" data-need="${esc(n.project ? n.qty ?? '' : '')}" data-cur="${esc(q ? q.cur : n.cur || 'USD')}">
      ${supPick(q ? q.sup : '', 'From')}
      <div class="fld"><span>Price per ${esc(n.unit || 'unit')}</span><div class="price-in"><input name="price" inputmode="decimal" value="${esc(q ? q.price : n.target ?? '')}" required autocomplete="off">${curSelect(q ? q.cur : n.cur || 'USD')}</div></div>
      <label class="fld rate-f" ${(q ? q.cur : n.cur || 'USD') === 'USD' ? 'hidden' : ''}><span>1 US dollar = how many <b class="rate-cur">${esc(q ? q.cur : n.cur || 'USD')}</b>? <em>(budgets are kept in dollars)</em></span><input name="orate" inputmode="decimal" value="${esc(lastRate(q ? q.cur : n.cur || 'USD'))}" autocomplete="off"></label>
      <label class="fld"><span>How many bought</span><input name="qty" inputmode="decimal" value="${esc(n.qty ?? '')}" required autocomplete="off"></label>
      ${n.qty ? `<p class="muted">Fewer than ${esc(qtyText(n))}? The rest stays on the list to buy later. More? The extra is counted apart below.</p>` : ''}
      ${live(S.projects).length ? `<div class="fld"><span>Who is it for? <em>(what is left over is extra: stock, or another use later)</em></span>
        <div class="allocs">${allocRow(n.project, n.project ? n.qty ?? '' : '', true)}</div><button type="button" class="btn small ghost" data-act="addAlloc">＋ Another project</button></div>` : ''}
      <p class="note order-sum"></p>
      <label class="fld"><span>Ordered on</span><input type="date" name="date" value="${today()}" max="${today()}" required></label>
      ${tripPick(trip ? trip.id : '')}
      ${textField('note', 'Note', 'e.g. 30% deposit paid, balance before loading', '', false)}
      <label class="fld check"><input type="checkbox" name="pay" checked> 💵 Also add what was paid now as a payment (Accounts)</label>
      <div class="payf"><input type="hidden" name="cur" value="USD">${amountField('', 'USD', 'paid', 'Paid now, in US dollars', false)}${accountChips('Cash', 'Paid from')}<p class="muted">Leave it empty if nothing was paid yet. Paid later or in another currency? Add it in Accounts, then on the trip tap 🔗 Link payments and choose this item, so it is not counted twice.</p></div>
      <p class="err"></p>
      <button class="btn out">Save the order</button>
    </form>`);
  refreshOrder($('#sheet form'));
}
// one project's share of an order
const allocRow = (p = '', q = '', auto = false) => `<div class="alloc-row"${auto ? ' data-auto="1"' : ''}><select name="ap" aria-label="Project"><option value="">— a project —</option>${live(S.projects).map(x => `<option value="${esc(x.id)}" ${x.id === p ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
  <input name="aq" inputmode="decimal" value="${esc(q)}" placeholder="How many" autocomplete="off" aria-label="How many for it"><button type="button" class="x" data-act="delAlloc" aria-label="Remove">×</button></div>`;
// the last rate typed for a currency, to start from
const lastRate = cur => (cur === 'USD' ? '' : (live(S.needs).filter(n => n.order && n.order.cur === cur && n.order.rate).sort((a, b) => b.order.date.localeCompare(a.order.date))[0] || { order: {} }).order.rate || '');
// each project's share as typed (same project twice: added up; a project with no number takes what is left); bad: a number
// that is not one, or a number with no project chosen (those pieces would quietly become extra)
function allocsFrom(f) {
  const out = new Map(), qty = parseAmount(f.elements.qty.value) || 0, all = $$('.alloc-row', f).map(r => ({ r, p: $('[name=ap]', r).value, raw: $('[name=aq]', r).value.trim() }));
  const rows = all.filter(x => live(S.projects).some(p => p.id === x.p));
  let bad = all.find(x => x.raw && !rows.includes(x)) ? all.find(x => x.raw && !rows.includes(x)).r : null;
  rows.filter(x => x.raw).forEach(x => { const q = parseAmount(x.raw); if (q === null) bad = x.r; else if (q > 0) out.set(x.p, round3((out.get(x.p) || 0) + q)); });
  const rest = round3(qty - [...out.values()].reduce((t, q) => t + q, 0)), open = rows.find(x => !x.raw);
  if (open && rest > 0) out.set(open.p, round3((out.get(open.p) || 0) + rest));
  return { alloc: [...out].map(([p, q]) => ({ p, q })), bad };
}
// as it is typed: who gets how many, the extra, and what each costs. The share filled in at the start follows "how many
// bought" (up to what the project needs) until it is typed in; another currency starts from its own last rate.
function refreshOrder(f, field) {
  const cur = f.elements.pcur.value, price = parseAmount(f.elements.price.value), qty = parseAmount(f.elements.qty.value);
  if (field && field.name === 'aq') field.closest('.alloc-row').removeAttribute('data-auto');
  const auto = $('.alloc-row[data-auto] [name=aq]', f), need = parseAmount(f.dataset.need);
  if (field && field.name === 'qty' && auto && need && qty) auto.value = plain(Math.min(need, qty)).replace(/,/g, '');
  if (f.dataset.cur !== cur) { f.dataset.cur = cur; f.elements.orate.value = lastRate(cur); }
  const rate = parseAmount(f.elements.orate.value);
  $('.rate-f', f).hidden = cur === 'USD'; $('.rate-cur', f).textContent = cur;
  const el = $('.order-sum', f);
  if (!price || !qty) { el.textContent = 'Type the price and how many to see what it costs.'; return; }
  const { alloc } = allocsFrom(f), o = { price, qty, cur, rate, alloc }, used = alloc.reduce((t, a) => t + a.q, 0), usd = x => (cur !== 'USD' && rate ? ` ≈ ${money(Math.round(x / rate * 100) / 100, 'USD')}` : '');
  if (used > qty + 1e-9) { el.innerHTML = `<b>More shared out (${esc(plain(used))}) than bought (${esc(plain(qty))}).</b>`; return; }
  el.innerHTML = `${orderShares(o, '').map(sh => `${esc(sh.p ? projName(sh.p) : EXTRA)}: ${esc(plain(sh.q))} × ${esc(cost(price, cur))} = <b>${esc(cost(sh.cost, cur))}</b>${esc(usd(sh.cost))}`).join('<br>')}<br>Total: <b>${esc(cost(Math.round(qty * price * 100) / 100, cur))}</b>${esc(usd(qty * price))}`;
}
function saveOrder(f) {
  const n = needOf(f.dataset.id), v = Object.fromEntries(new FormData(f)), price = parseAmount(v.price), qty = parseAmount(v.qty);
  if (!n) return closeSheet();
  if (price === null) return formErr(f, 'price', 'Type the price per unit, like 880');
  if (!qty) return formErr(f, 'qty', 'Type how many, like 2');
  if (!DATE_RE.test(v.date)) return formErr(f, 'date', 'Choose the date');
  const paid = v.pay && v.paid.trim() ? parseAmount(v.paid) : 0, cur0 = BUY_CURS.includes(v.pcur) ? v.pcur : 'USD', rate = cur0 !== 'USD' && v.orate.trim() ? parseAmount(v.orate) : undefined;
  if (paid === null) return formErr(f, 'paid', 'Type what was paid in dollars, like 500 — or leave it empty');
  if (cur0 !== 'USD' && !rate) return formErr(f, 'orate', `Type how many ${cur0} make one dollar, like 7.1: budgets are kept in dollars`);
  const { alloc, bad: badShare } = allocsFrom(f);
  if (badShare) { $('[name=aq]', badShare).focus(); return formErr(f, null, 'For each project: choose it and type how many, like 10'); }
  if (alloc.reduce((t, a) => t + a.q, 0) > qty + 1e-9) return formErr(f, null, `More shared out than the ${plain(qty)} bought.`);
  const sup = supFrom(f);
  if (!sup) return formErr(f, f.elements.sup.value === '__new' ? 'supName' : 'sup', 'Who was it ordered from?');
  const by = myName() || S.lastBy || '', trip = tripOf(v.trip) ? v.trip : '', at = stampSec(), cur = BUY_CURS.includes(v.pcur) ? v.pcur : 'USD';
  const order = { sup, price, cur, qty, date: v.date, note: clean(v.note), ...(trip ? { trip } : {}), ...(rate ? { rate } : {}), ...(alloc.length ? { alloc } : {}) };
  let ids = S.seq, rest = null, pay = null;
  if (n.qty && qty < n.qty) { // part of it: the rest stays to buy, with every detail
    const [[rid], s1] = nextIds('N', 1, ids); ids = s1;
    rest = { ...n, id: rid, qty: Math.round((n.qty - qty) * 1000) / 1000, status: 'tobuy', steps: { tobuy: today() }, from: n.id, by, createdAt: at };
    ['order', 'insp', 'ship', 'editedAt', 'editedBy', 'u', 'uid'].forEach(k => delete rest[k]);
  }
  if (paid) {
    const [[eid], s2] = nextIds('E', 1, ids); ids = s2;
    pay = { id: eid, cur: 'USD', amount: paid, paidTo: supOf(sup).name, reason: `${n.t} — ${plain(qty)} ${n.unit || ''}`.trim(), location: '', project: n.project || '', mode: v.mode === 'Bank' ? 'Bank' : 'Cash',
      at: `${v.date}T${stamp().slice(11, 16)}`, manualDate: v.date !== today(), need: n.id, ...(trip ? { trip } : {}), by, createdAt: at, batch: null };
  }
  const lines = [['Edited', n.id, `${n.t}: ordered ${plain(qty)} × ${cost(price, cur)} from ${supOf(sup).name}`], ...(rest ? [['Added', rest.id, `Buying list: the rest of ${n.t} (${plain(rest.qty)})`]] : []), ...(pay ? [['Added', pay.id, describe('E', pay)]] : [])];
  update({ needs: [...S.needs.map(x => (x.id === n.id ? { ...x, status: 'ordered', qty, order, ...(trip ? { trip } : {}), steps: { ...(x.steps || {}), ordered: v.date }, editedAt: at, editedBy: by } : x)), ...(rest ? [rest] : [])],
    ...(pay ? { expenses: [...S.expenses, pay] } : {}), seq: ids, log: logWith(lines, by), lastBy: by });
  toast(pay ? 'Order saved ✓ — and the payment' : 'Order saved ✓');
  needDetail(n.id);
}
// loaded into a container or a truck: which shipment (the same words group them)
function shipForm(id) {
  const n = needOf(id), ships = [...new Set(live(S.needs).map(x => x.ship).filter(Boolean))];
  if (!n) return;
  openSheet(`${head('Loaded / on the way', 'out', n.t)}
    <form data-form="ship" data-id="${esc(id)}">
      <label class="fld"><span>Shipment <em>(container or truck: the same name for everything in it)</em></span><input name="ship" value="${esc(n.ship || ships[ships.length - 1] || '')}" list="dl-ship" maxlength="80" autocomplete="off" placeholder="e.g. Container 1 — MSKU 123456 7"></label>${listFrom('dl-ship', ships)}
      <label class="fld"><span>Loaded on</span><input type="date" name="date" value="${today()}" max="${today()}" required></label>
      <p class="err"></p>
      <button class="btn out">On the way</button>
    </form>`);
}
function saveShip(f) {
  const n = needOf(f.dataset.id), ship = clean(f.elements.ship.value), date = f.elements.date.value;
  if (!n) return closeSheet();
  if (!DATE_RE.test(date)) return formErr(f, 'date', 'Choose the date');
  const by = myName() || S.lastBy || '';
  update({ needs: S.needs.map(x => (x.id === n.id ? { ...x, status: 'shipped', ship, steps: { ...(x.steps || {}), shipped: date }, editedAt: stampSec(), editedBy: by } : x)), log: logWith([['Edited', n.id, `${n.t}: on the way${ship ? ` (${ship})` : ''}`]], by) });
  toast('On the way ✓');
  needDetail(n.id);
}
// on a payment's page: the item it paid for and its trip
function buyLinks(r) {
  if (!can('settings')) return '';
  const n = r.need && needOf(r.need), t = r.trip && tripOf(r.trip);
  return `${n ? `<button class="btn ghost" data-act="openNeed" data-id="${esc(n.id)}" style="margin-bottom:10px">🛒 For: ${esc(n.t)}</button>` : ''}${t ? `<button class="btn ghost" data-act="openTrip" data-id="${esc(t.id)}" style="margin-bottom:10px">✈️ Trip: ${esc(tripName(t))}</button>` : ''}`;
}

/* ---------- budgets: what each project may spend on buying, and what its orders cost so far ---------- */
// In dollars (an order in yuan counts at the rate typed on it). Extra — bought beyond what a project needed — is its own
// line, so a project's cost is only what is for it (owner, 17 Oct 2026: "10 toilets for the project, 15 bought").
const usdText = t => [t.usd ? money(t.usd, 'USD') : '', ...Object.entries(t.unrated).map(([c, v]) => `${cost(v, c)} (no rate)`)].filter(Boolean).join(' + ') || money(0, 'USD');
function budgetsSheet() {
  const by = spendByProject(live(S.needs)), ps = live(S.projects), extra = by[''];
  openSheet(`${head('Budgets & spending', 'out')}
    <p class="hint">What each project may spend on buying, in dollars, and what its orders come to. Bought beyond what a project needed counts as <b>extra</b>.</p>
    <form data-form="budgets">
      ${ps.length ? ps.map(p => { const t = by[p.id] || { usd: 0, unrated: {}, items: 0 }, left = p.buyBudget ? Math.round((p.buyBudget - t.usd) * 100) / 100 : null;
        return `<section class="card pad" style="margin-bottom:12px"><b>${esc(p.name)}</b>
          <p class="muted">${t.items} order line${t.items === 1 ? '' : 's'} · spent <b>${esc(usdText(t))}</b>${left === null ? '' : ` · <b class="${left < 0 ? 'out-c' : ''}">${left < 0 ? `${esc(money(-left, 'USD'))} over` : `${esc(money(left, 'USD'))} left`}</b>${Object.keys(t.unrated).length ? ' (not counting the orders with no dollar rate)' : ''}`}</p>
          <label class="fld"><span>Buying budget, in US dollars <em>(optional)</em></span><input name="b|${esc(p.id)}" inputmode="decimal" value="${esc(p.buyBudget ?? '')}" autocomplete="off"></label></section>`; }).join('')
        : empty('No projects yet', 'Add a project in Accounts first.')}
      <div class="note">${EXTRA} (bought beyond what projects need): <b>${esc(extra ? usdText(extra) : money(0, 'USD'))}</b></div>
      <p class="err"></p>
      ${ps.length ? '<button class="btn out" style="margin-top:12px">Save the budgets 🔒</button>' : ''}
    </form>`);
  comeBack(budgetsSheet);
}
async function saveBudgets(f) {
  const changes = [];
  for (const p of live(S.projects)) {
    const raw = (f.elements[`b|${p.id}`]?.value || '').trim(), b = raw ? parseAmount(raw) : undefined;
    if (b === null) return formErr(f, `b|${p.id}`, 'Type the budget in dollars, like 50000 — or leave it empty');
    if ((p.buyBudget ?? undefined) !== b) changes.push([p.id, b]);
  }
  if (!changes.length) return toast('Nothing changed');
  if (!await unlock('Enter the password to change the budgets.')) return;
  const by = myName() || S.lastBy || '', to = new Map(changes);
  update({ projects: S.projects.map(p => (to.has(p.id) ? { ...p, buyBudget: to.get(p.id), editedAt: stampSec(), editedBy: by } : p)),
    log: logWith(changes.map(([id, b]) => ['Edited', id, `Buying budget of ${projName(id)}: ${b === undefined ? 'none' : money(b, 'USD')}`]), by) });
  toast('Budgets saved ✓');
  budgetsSheet();
}
