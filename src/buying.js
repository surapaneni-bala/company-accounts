/* ---------- buying: what to buy and ideas, suppliers' quotes, orders and their steps (admins only) ---------- */
// Everything the company means to buy, for any project, venture or business: an idea typed in a second, or an item with
// every detail (colour, sizes, seating…) as spec lines, which become its inspection checklist (suppliers.js). An item goes
// idea → to buy → ordered → inspected → on the way → received (each step dated) or is dropped. Suppliers (factories,
// traders, shops) give quotes and one is ordered from. Prices are in any currency (CNY, UGX…); what was paid for it goes
// into the accounts as a USD payment that names it (need) and its trip. Trips are in trips.js, the PDFs in buypdf.js.
// Owner, 16 Oct 2026: admins only; offer the payment; compare quotes; trips carry their costs.
const BUY_STATES = ['idea', 'tobuy', 'ordered', 'inspected', 'shipped', 'received', 'dropped'];
const BUY_STATE = { idea: ['💡', 'Idea', ''], tobuy: ['🛒', 'To buy', 'warn'], ordered: ['🧾', 'Ordered', 'warn'], inspected: ['🔍', 'Inspected', ''], shipped: ['🚢', 'On the way', 'warn'], received: ['✅', 'Received', ''], dropped: ['✖', 'Dropped', 'bad'] };
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
// what a row says under the item's name
const needLine = n => [n.under && needOf(n.under) && `for: ${needOf(n.under).t}`, qtyText(n), n.project && projName(n.project), n.area, n.where !== 'Anywhere' && n.where, ...(n.tags || []).map(t => `#${t}`)].filter(Boolean).join(' · ');
// ideas and add-ons kept under an item (blackout film for the windows)
const kidsOf = id => live(S.needs).filter(n => n.under === id && n.status !== 'dropped');
const isOpen = n => ['idea', 'tobuy'].includes(n.status);
const firstPic = id => filesFor(id).find(f => isPic(f) && !f.removed && !f.replaced);
// A row of the checklist, as in a shopping-list app (owner, 17 Oct 2026: "like a checklist, simple"): a circle to tick when
// it is bought, the name, one grey line, its price once ordered, its photo. The circle ticks and unticks; the rest opens it.
function needRow(n, depth = 0, struck = false) {
  const done = !isOpen(n), pic = firstPic(n.id), line = [done && n.status !== 'received' && n.status !== 'ordered' ? BUY_STATE[n.status][1] : '', needLine(n)].filter(Boolean).join(' · ');
  return `<div class="ck-row${done ? ' done' : ''}${struck ? ' struck' : ''}"${depth ? ` style="--depth:${depth}"` : ''}>
    <button class="ck" data-act="tickNeed" data-id="${esc(n.id)}" aria-pressed="${done}" aria-label="${done ? `${esc(n.t)} is bought: tap to undo` : `Tick ${esc(n.t)} when it is bought`}">${done ? '✓' : ''}</button>
    <button class="ck-main" data-act="openNeed" data-id="${esc(n.id)}"><span class="ck-t">${n.pri === 1 ? '<i class="ck-pri" aria-label="Urgent">!</i>' : ''}${esc(n.t)}${n.status === 'idea' ? ' <i class="ck-idea">idea</i>' : ''}</span>${line ? `<span class="ck-s">${esc(line)}</span>` : ''}</button>
    ${n.order ? `<span class="ck-amt">${esc(cost(needTotal(n), n.order.cur))}</span>` : ''}${pic ? `<img class="ck-img" alt="" data-thumb="${esc(pic.id)}">` : ''}
  </div>`;
}
// rows with each item's add-ons right under it, every level indented
function needRows(list, struck = false) {
  const here = new Set(list.map(n => n.id)), top = list.filter(n => !n.under || !here.has(n.under));
  const under = (id, depth) => (depth > 4 ? '' : list.filter(k => k.under === id).map(k => needRow(k, depth, struck) + under(k.id, depth + 1)).join(''));
  return top.map(n => needRow(n, 0, struck) + under(n.id, 1)).join('');
}
const ckList = (list, struck) => `<div class="ck-list">${needRows(list, struck)}</div>`;
const ckSections = list => needGroups(list).map(([c, l]) => `<details class="ck-sec" open><summary>${esc(c)}<span>${l.length}</span></summary>${ckList(l)}</details>`).join('');
// grouped by category (in the usual order), then by sub-category and name
function needGroups(list) {
  const order = catNames();
  return order.map(c => [c, list.filter(n => (n.cat || 'Other') === c).sort((a, b) => String(a.sub || '').localeCompare(String(b.sub || '')) || a.t.localeCompare(b.t))]).filter(([, l]) => l.length);
}

/* ---------- the list ---------- */
// Buying's tabs: the checklist, trips, suppliers, budgets
const buyNav = active => `<nav class="subnav" aria-label="Buying">${[['buying', '✓ List'], ['trips', '✈️ Trips'], ['suppliers', '🏭 Suppliers'], ['budgets', '💰 Budgets']].map(([a, t]) => `<button type="button" data-act="${a}"${a === active ? ' aria-current="page"' : ''}>${t}</button>`).join('')}</nav>`;
// three tabs, as simple as a shopping list: still to buy, bought (on its way), received; dropped ones apart
const BUY_TABS = { open: ['To buy', ['idea', 'tobuy']], bought: ['Bought', ['ordered', 'inspected', 'shipped']], received: ['Received', ['received']], dropped: ['Dropped', ['dropped']] };
let buyView = { view: 'open', project: '', q: '' };
const inProject = n => !buyView.project || n.project === buyView.project;
const buyMatches = n => (BUY_TABS[buyView.view] || BUY_TABS.open)[1].includes(n.status) && inProject(n)
  && (!buyView.q || [n.t, n.cat, n.sub, n.area, n.where, n.notes, ...(n.tags || []), ...(n.specs || []).flatMap(x => x.slice(0, 2))].join(' ').toLowerCase().includes(buyView.q.toLowerCase()));
function buyingSheet() {
  const all = live(S.needs), list = all.filter(buyMatches), ps = live(S.projects), count = v => all.filter(n => BUY_TABS[v][1].includes(n.status) && inProject(n)).length;
  // ticked in the last two days: they stay at the foot of the list, crossed out, to undo a slip
  const ticked = buyView.view === 'open' && !buyView.q ? all.filter(n => !isOpen(n) && n.status !== 'dropped' && inProject(n) && ((n.steps || {}).ordered || (n.steps || {}).received || '') >= plusDays(today(), -2)) : [];
  const dropped = count('dropped'), search = all.length > 12 || buyView.q;
  openSheet(`${head('Buying', 'out')}
    ${buyNav('buying')}
    <form data-form="idea" class="qadd"><input name="t" placeholder="Add an item or an idea…" maxlength="160" autocomplete="off" aria-label="Add an item or an idea"><button class="btn small primary">Add</button></form>
    <p class="qadd-hint">It finds its category by itself. <button type="button" class="link" data-act="pasteList">Paste a whole list</button></p>
    <form class="buy-filter" data-form="buyFilter">
      <div class="segs" role="radiogroup" aria-label="Which items">${['open', 'bought', 'received'].map(k => `<label><input type="radio" name="view" value="${k}" ${k === buyView.view ? 'checked' : ''}><span>${BUY_TABS[k][0]} <b>${count(k)}</b></span></label>`).join('')}</div>
      ${ps.length || search ? `<div class="filter-row">${ps.length ? `<select name="project" aria-label="Project"><option value="">All projects</option>${ps.map(p => `<option value="${esc(p.id)}" ${p.id === buyView.project ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}${search ? `<input name="q" type="search" placeholder="Search" value="${esc(buyView.q)}" autocomplete="off" aria-label="Search">` : ''}</div>` : ''}
    </form>
    ${buyView.view === 'dropped' ? '<p class="note">Dropped: not buying these. Open one to put it back on the list. <button class="link" data-act="buyTab" data-tab="open">Back to the list</button></p>' : ''}
    ${list.length ? ckSections(list) : `<div class="ck-empty">${buyView.view === 'open' ? (all.length ? '🎉 Nothing left to buy here.' : 'Type the first thing you need above.') : 'Nothing here yet.'}</div>`}
    ${ticked.length ? `<details class="ck-sec ck-done" open><summary>✓ Just bought<span>${ticked.length}</span></summary>${ckList(ticked, true)}</details>` : ''}
    <div class="buy-foot">${list.length ? '<button class="link" data-act="buyListPdf">📄 This list as a PDF</button>' : ''}${dropped && buyView.view !== 'dropped' ? `<button class="link" data-act="buyTab" data-tab="dropped">Dropped (${dropped})</button>` : ''}</div>`);
  paintThumbs();
  comeBack(buyingSheet);
}
function filterBuying(f) {
  buyView = { view: f.elements.view.value || buyView.view, project: f.elements.project ? f.elements.project.value : '', q: f.elements.q ? f.elements.q.value.trim() : '' };
  const at = f.elements.q && f.elements.q === document.activeElement;
  buyingSheet();
  if (at) { const q = $('#sheet [name=q]'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}
// The circle: bought (ticked), or back on the list (unticked). Once it has a price, an inspection or has moved on, the
// circle opens it instead: what was recorded is kept.
function tickNeed(id) {
  const n = needOf(id);
  if (!n) return;
  if (!isOpen(n) && (n.order || n.status !== 'ordered')) return needDetail(id);
  const by = myName() || S.lastBy || '', back = !isOpen(n);
  const steps = back ? Object.fromEntries(Object.entries(n.steps || {}).filter(([k]) => k !== 'ordered')) : { ...(n.steps || {}), ordered: today() };
  update({ needs: S.needs.map(x => (x.id === id ? { ...x, status: back ? 'tobuy' : 'ordered', steps, editedAt: stampSec(), editedBy: by } : x)), log: logWith([['Edited', id, `${n.t}: ${back ? 'back on the list' : 'bought'}`]], by) });
  toast(back ? 'Back on the list' : '✓ Bought — open it to add the price');
  reopenHere();
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
// A detail line: what (colour), its value (beige velvet) and, if wanted, a photo of it (the swatch) — picked, taken or
// pasted (owner, 17 Oct 2026). The photo is kept with the item; the line holds its file id. A photo picked on the form waits
// in specPics (by the row's key) until the item is saved.
let specPics = {};
const specKey = () => `k${Math.random().toString(36).slice(2, 9)}`;
const specPicBox = (fid, key) => `<label class="spec-pic" title="A photo of this detail">${fid ? `<img alt="" data-thumb="${esc(fid)}">` : specPics[key] ? `<img alt="" src="${specPics[key].url}">` : '📷'}<input type="file" accept="image/*" hidden data-specpic aria-label="Add a photo of this detail"></label>`;
const specRow = ([k, v, fid] = ['', '', ''], key = specKey()) => `<div class="spec-row" data-key="${key}"><input name="sk" placeholder="e.g. Colour" value="${esc(k)}" maxlength="60" autocomplete="off" aria-label="Detail"><input name="sv" placeholder="e.g. Beige, velvet" value="${esc(v)}" maxlength="200" autocomplete="off" aria-label="Value">${specPicBox(fid || '', key)}<input type="hidden" name="sf" value="${esc(fid || '')}"><button type="button" class="x" data-act="delSpec" aria-label="Remove this detail">×</button></div>`;
// a photo for a detail line: from the picker or pasted; shown at once, saved with the item
async function specPicked(row, file) {
  if (!row || !file) return;
  try {
    const p = await prepareFile(file);
    specPics = { ...specPics, [row.dataset.key]: { ...p, url: URL.createObjectURL(file) } };
    row.querySelector('[name=sf]').value = '';
    row.querySelector('.spec-pic').outerHTML = specPicBox('', row.dataset.key);
  } catch (e) { alert(e.message); }
}
const specChips = cat => `<div class="spec-sugg">${((catOf(cat) || BUY_CATS[BUY_CATS.length - 1])[3]).map(k => `<button type="button" class="chip-btn" data-act="addSpec" data-k="${esc(k)}">＋ ${esc(k)}</button>`).join('')}</div>`;
const listFrom = (id, values) => `<datalist id="${id}">${[...new Set(values.filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
function needForm(old, preset = {}) {
  specPics = {}; // photos picked on a form left without saving are forgotten
  const d = old || { t: '', cat: 'Other', status: 'tobuy', pri: 2, where: 'Anywhere', unit: 'pcs', cur: 'USD', specs: [], ...preset }, cats = catNames(), all = live(S.needs);
  const subs = [...((catOf(d.cat) || [])[1] || []), ...all.filter(n => n.cat === d.cat).map(n => n.sub)];
  const more = !!(d.notes || d.area || d.sub || d.link || d.target || (d.tags || []).length || d.pri !== 2 || (d.where && d.where !== 'Anywhere'));
  openSheet(`${head(old ? 'Edit item' : 'New item', 'out', old?.id)}
    <form data-form="need" data-id="${esc(old?.id || '')}"${old || preset.cat ? ' data-cat-set="1"' : ''}>
      ${textField('t', 'What is it?', 'e.g. Sofa, L-shape', d.t)}
      <div class="two"><label class="fld"><span>How many <em>(optional)</em></span><input name="qty" inputmode="decimal" value="${esc(d.qty ?? '')}" autocomplete="off"></label>
        <label class="fld"><span>Unit</span><input name="unit" value="${esc(d.unit)}" list="dl-unit" maxlength="20" autocomplete="off"></label></div>${listFrom('dl-unit', [...BUY_UNITS, ...all.map(n => n.unit)])}
      ${projectSelect(d.project || '', true)}
      <label class="fld"><span>Category</span><select name="cat">${cats.map(c => `<option ${c === d.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">＋ New category…</option></select></label>
      <label class="fld newcat" hidden><span>New category</span><input name="newCat" placeholder="e.g. Hotel equipment, Water bottling" maxlength="60" autocomplete="off"></label>
      <div class="fld"><span>Details <em>(colour, sizes, seating… each one is a line to check when it arrives)</em></span>
        <div class="specs">${(d.specs && d.specs.length ? d.specs : [['', '']]).map(x => specRow(x)).join('')}</div>${specChips(d.cat)}
        <button type="button" class="btn small ghost" data-act="addSpec">＋ Another detail</button></div>
      <details class="more" ${more ? 'open' : ''}><summary>More: notes, room, where to buy, price, link, tags</summary>
        <label class="fld"><span>Notes <em>(anything to remember)</em></span><textarea class="plain" name="notes" rows="3" maxlength="2000" placeholder="e.g. Same fabric as the sample in the office; must fit through a 90 cm door.">${esc(d.notes)}</textarea></label>
        <label class="fld"><span>Room / area</span><input name="area" value="${esc(d.area)}" list="dl-area" maxlength="60" autocomplete="off" placeholder="e.g. Master bedroom"></label>${listFrom('dl-area', [...AREAS, ...all.map(n => n.area)])}
        <label class="fld"><span>Where to buy it</span><input name="where" value="${esc(d.where)}" list="dl-where" maxlength="60" autocomplete="off"></label>${listFrom('dl-where', [...WHERES, ...all.map(n => n.where)])}
        <div class="two"><label class="fld"><span>Target price, each</span><input name="target" inputmode="decimal" value="${esc(d.target ?? '')}" autocomplete="off"></label>
          <label class="fld"><span>In</span>${curSelect(d.cur || 'USD', 'tcur')}</label></div>
        <label class="fld"><span>Link <em>(a product page)</em></span><input name="link" type="url" value="${esc(d.link)}" maxlength="500" autocomplete="off" placeholder="https://"></label>
        <div class="fld"><span>How soon?</span><div class="chips">${Object.entries(PRI).map(([k, t]) => `<label><input type="radio" name="pri" value="${k}" ${+k === (d.pri || 2) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></div>
        <label class="fld"><span>Sub-category</span><input name="sub" value="${esc(d.sub)}" list="dl-sub" maxlength="60" autocomplete="off" placeholder="e.g. Sofas & seating"></label>${listFrom('dl-sub', subs)}
        <label class="fld"><span>Tags <em>(words to find it by, with commas)</em></span><input name="tags" value="${esc((d.tags || []).join(', '))}" maxlength="200" autocomplete="off" placeholder="e.g. villa, gift"></label>
        ${old ? '' : tripPick(d.trip)}
      </details>
      ${old ? '' : `<div class="fld"><span>Is it decided?</span><div class="chips"><label><input type="radio" name="status" value="tobuy" ${d.status !== 'idea' ? 'checked' : ''}><span>🛒 To buy</span></label><label><input type="radio" name="status" value="idea" ${d.status === 'idea' ? 'checked' : ''}><span>💡 Just an idea</span></label></div></div>`}
      <p class="err"></p>
      <button class="btn out">${old ? 'Save changes' : 'Add to the list'}</button>
    </form>`);
}
const tripPick = cur => { const js = live(S.trips).filter(j => !j.back || j.back >= today() || j.id === cur); return js.length ? `<label class="fld"><span>On a trip’s list <em>(optional)</em></span><select name="trip"><option value="">— not yet —</option>${js.map(j => `<option value="${esc(j.id)}" ${j.id === cur ? 'selected' : ''}>${esc(tripName(j))}</option>`).join('')}</select></label>` : ''; };
// the lines as typed: each with its photo's file id, or waiting for its photo to be kept (key)
const specsFrom = f => $$('.spec-row', f).map(r => ({ k: clean($('[name=sk]', r).value), v: clean($('[name=sv]', r).value), fid: $('[name=sf]', r).value, key: r.dataset.key }))
  .filter(x => x.k || x.v || x.fid || specPics[x.key]).map(x => ({ ...x, k: x.k || (x.v ? 'Detail' : 'Photo') }));
const specList = rows => rows.map(x => (x.fid ? [x.k, x.v, x.fid] : [x.k, x.v]));
const tagsFrom = v => [...new Set(String(v || '').split(',').map(t => clean(t).replace(/^#/, '')).filter(Boolean))].slice(0, 20);
// the fields that changed, by name (the Change Log)
const NEED_LABELS = { t: 'Item', cat: 'Category', sub: 'Sub-category', project: 'Project', area: 'Area', qty: 'Quantity', unit: 'Unit', specs: 'Details', notes: 'Notes', link: 'Link', target: 'Target price', cur: 'Currency', where: 'Where', pri: 'Priority', tags: 'Tags' };
const changedOf = (a, b, labels) => Object.keys(labels).filter(k => k in b && JSON.stringify(a[k] ?? '') !== JSON.stringify(b[k] ?? '')).map(k => labels[k]);
async function saveNeed(f) {
  const v = Object.fromEntries(new FormData(f)), old = needOf(f.dataset.id), rows = specsFrom(f);
  const cat = v.cat === '__new' ? clean(v.newCat) : v.cat, qty = v.qty.trim() ? parseAmount(v.qty) : undefined, target = v.target.trim() ? parseAmount(v.target) : undefined;
  if (!clean(v.t)) return formErr(f, 't', 'What is it?');
  if (!cat) return formErr(f, 'newCat', 'Type the new category');
  if (qty === null) return formErr(f, 'qty', 'Type a quantity, like 4 — or leave it empty');
  if (target === null) return formErr(f, 'target', 'Type a price, like 250 — or leave it empty');
  if (v.link && !/^https?:\/\//i.test(v.link.trim())) return formErr(f, 'link', 'A link starts with https://');
  const rec = { t: clean(v.t), cat, sub: clean(v.sub), project: v.project || '', area: clean(v.area), qty, unit: clean(v.unit), specs: specList(rows), notes: String(v.notes || '').trim().slice(0, 2000),
    link: String(v.link || '').trim(), target, cur: BUY_CURS.includes(v.tcur) ? v.tcur : 'USD', where: clean(v.where) || 'Anywhere', pri: +v.pri || 2, tags: tagsFrom(v.tags) };
  const pending = rows.filter(x => specPics[x.key]), by = myName() || S.lastBy || '';
  let id = old && old.id;
  if (!old) { id = newNeed({ ...rec, status: v.status === 'idea' ? 'idea' : 'tobuy', ...(tripOf(v.trip) ? { trip: v.trip } : {}) }).id; toast('Added to the list ✓'); }
  else {
    const changes = changedOf(old, rec, NEED_LABELS);
    if (!changes.length && !pending.length) { closeSheet(); return toast('Nothing changed'); }
    if (changes.length) update({ needs: S.needs.map(n => (n.id === old.id ? { ...n, ...rec, editedAt: stampSec(), editedBy: by } : n)), log: logWith([['Edited', old.id, `${rec.t}: ${changes.join(', ')} changed`]], by) });
    toast('Changes saved ✓');
  }
  // the photos picked on the form: kept with the item, each line then holds its file
  if (pending.length) {
    for (const x of pending) { const p = specPics[x.key]; x.fid = await keepFile({ for: id, type: 'attachment', name: p.name, mime: p.mime, note: `${x.k}${x.v ? `: ${x.v}` : ''}` }, p.data); }
    specPics = {};
    update({ needs: S.needs.map(n => (n.id === id ? { ...n, specs: specList(rows), editedAt: stampSec(), editedBy: by } : n)) });
  }
  needDetail(id);
}

// the item's photos as pictures (product photos, the sample, the factory's own); a PDF stays a row
const isPic = f => f.mime && f.mime.startsWith('image/');
const photoStrip = id => { const ps = filesFor(id).filter(f => isPic(f) && !f.removed && !f.replaced); return ps.length ? `<div class="thumbs">${ps.map(f => `<button type="button" data-act="showFile" data-id="${esc(f.id)}" aria-label="Open the photo"><img alt="" data-thumb="${esc(f.id)}"></button>`).join('')}</div>` : ''; };
function paintThumbs() {
  $$('#sheet img[data-thumb]').forEach(img => { const id = img.dataset.thumb; img.removeAttribute('data-thumb'); fileBlob(id).then(b => { img.src = URL.createObjectURL(b); }).catch(() => { img.alt = 'Not on this phone yet'; }); });
}
const facts = rows => `<dl class="facts">${rows.filter(r => r[1]).map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>`;
// where an item stands: to buy → bought → checked → on the way → received
const STEPS = [['tobuy', 'To buy'], ['ordered', 'Bought'], ['inspected', 'Checked'], ['shipped', 'On the way'], ['received', 'Received']];
const dayMonth = d => fmtDate(d).replace(/ \d{4}$/, '');
function stepper(n) {
  const at = STEPS.findIndex(([s]) => s === n.status);
  return `<ol class="steps" aria-label="Where it stands">${STEPS.map(([s, t], i) => `<li class="${i <= at ? 'on' : ''}${i === at ? ' now' : ''}"${i === at ? ' aria-current="step"' : ''}><span aria-hidden="true"></span>${t}${n.steps && n.steps[s] ? `<small>${esc(dayMonth(n.steps[s]))}</small>` : ''}</li>`).join('')}</ol>`;
}
// the one thing to do next, big; the rarer ones as links under it
function nextStep(n) {
  const b = (act, label, cls, to = '') => `<button class="btn ${cls}" data-act="${act}" data-id="${esc(n.id)}"${to ? ` data-to="${to}"` : ''}>${label}</button>`;
  const l = (act, label, to = '') => `<button class="link" data-act="${act}" data-id="${esc(n.id)}"${to ? ` data-to="${to}"` : ''}>${label}</button>`;
  const o = n.order, sup = o && supOf(o.sup);
  return {
    idea: `<div class="two">${b('needStep', '🛒 Decided: buy it', 'ghost', 'tobuy')}${b('tickNeed', '✓ Bought', 'in')}</div>`,
    tobuy: `${b('tickNeed', '✓ Bought', 'in')}<p class="center">${l('orderNeed', 'Bought, with the price and supplier…')}</p>`,
    ordered: `${o ? b('needStep', '✅ Received', 'in', 'received') : b('orderNeed', 'Add the price and supplier', 'in')}<p class="center">${o ? '' : `${l('needStep', 'Received', 'received')} · `}${sup ? `${l('inspect', '🔍 Inspect it').replace(`data-id="${esc(n.id)}"`, `data-id="${esc(o.sup)}"`)} · ` : ''}${l('shipNeed', 'On the way')}</p>`,
    inspected: `${b('needStep', '✅ Received', 'in', 'received')}<p class="center">${l('shipNeed', 'Loaded / on the way')}</p>`,
    shipped: b('needStep', '✅ Received', 'in', 'received'),
    received: '', dropped: b('needStep', '↩️ Put it back on the list', 'ghost', 'tobuy'),
  }[n.status];
}
// the photos: the first one big, the others small beside
function hero(id) {
  const ps = filesFor(id).filter(f => isPic(f) && !f.removed && !f.replaced);
  return ps.length ? `<div class="hero"><button type="button" data-act="showFile" data-id="${esc(ps[0].id)}" aria-label="Open the photo"><img alt="" data-thumb="${esc(ps[0].id)}"></button></div>${ps.length > 1 ? `<div class="thumbs">${ps.slice(1).map(f => `<button type="button" data-act="showFile" data-id="${esc(f.id)}" aria-label="Open the photo"><img alt="" data-thumb="${esc(f.id)}"></button>`).join('')}</div>` : ''}` : '';
}
function needDetail(id) {
  const n = needOf(id);
  if (!n) return false;
  const o = n.order, sup = o && supOf(o.sup), t = tripOf(n.trip || (o && o.trip)), pays = live(S.expenses).filter(e => e.need === id).sort(byAt), kids = kidsOf(id), up = n.under && needOf(n.under);
  const info = [['How many', qtyText(n)], ['Project', n.project && projName(n.project)], ['Room / area', n.area], ['Where to buy', n.where !== 'Anywhere' && n.where], ['Target price', n.target && `${cost(n.target, n.cur || 'USD')} each`], ['Trip', t && tripName(t)], ['How soon', n.pri !== 2 && PRI[n.pri]], ['Tags', (n.tags || []).join(', ')]].filter(r => r[1]);
  openSheet(`${head(n.t, 'out', `${n.cat}${n.sub ? ` › ${n.sub}` : ''}`)}
    ${hero(id)}
    ${up ? `<button class="crumb" data-act="openNeed" data-id="${esc(up.id)}">↳ An idea for: ${esc(up.t)}</button>` : ''}
    ${n.status === 'dropped' ? '<p class="note">Dropped: not buying it.</p>' : `${n.status === 'idea' ? '<p class="note">💡 Just an idea for now.</p>' : ''}${stepper(n)}`}
    <div class="next">${nextStep(n)}</div>
    ${info.length ? `<section class="dcard">${facts(info)}</section>` : ''}
    <section class="dcard"><h3>Details <button class="link" data-act="editNeed" data-id="${esc(id)}">Edit</button></h3>
      ${n.specs && n.specs.length ? `<dl class="facts">${n.specs.map(([k, v, fid]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${fid ? `<button type="button" class="spec-thumb" data-act="showFile" data-id="${esc(fid)}" aria-label="Open the photo of ${esc(k)}"><img alt="" data-thumb="${esc(fid)}"></button>` : ''}</dd></div>`).join('')}</dl>` : '<p class="muted">Colour, sizes, material… tap Edit to add them, with a photo of each if you like. Each becomes a line to check when it arrives.</p>'}
      ${n.notes ? `<p class="pre">${esc(n.notes)}</p>` : ''}
      ${n.link ? `<a class="link" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">🔗 Open the link</a>` : ''}</section>
    ${o ? `<section class="dcard"><h3>Bought from ${esc(sup ? sup.name : 'a supplier')}</h3><p><b>${esc(plain(o.qty))} × ${esc(cost(o.price, o.cur))} = ${esc(cost(needTotal(n), o.cur))}</b>${o.cur !== 'USD' && o.rate ? ` ≈ ${esc(money(inUsd(needTotal(n), o), 'USD'))}` : ''} · ${esc(fmtDate(o.date))}</p>
      <p class="muted">${orderShares(o, n.project).map(sh => `${esc(sh.p ? projName(sh.p) : EXTRA)}: ${esc(plain(sh.q))} = ${esc(cost(sh.cost, o.cur))}`).join(' · ')}</p>${o.note ? `<p class="muted">${esc(o.note)}</p>` : ''}
      ${n.insp ? `<p>🔍 Checked ${esc(fmtDate(n.insp.date))}${n.insp.by ? ` by ${esc(n.insp.by)}` : ''}: <b>${INSP_TEXT[n.insp.result] || ''}</b>${n.insp.note ? ` — ${esc(n.insp.note)}` : ''}</p>` : ''}${n.ship ? `<p class="muted">🚢 ${esc(n.ship)}</p>` : ''}</section>` : ''}
    <section class="dcard"><h3>Ideas for it ${kids.length ? `<span class="count">${kids.length}</span>` : ''}</h3>
      ${kids.length ? ckList(kids) : ''}
      <form data-form="subIdea" data-id="${esc(id)}" class="qadd small"><input name="t" placeholder="Add an idea or add-on for it…" maxlength="160" autocomplete="off" aria-label="An idea or add-on for this item"><button class="btn small ghost">Add</button></form></section>
    <section class="dcard"><h3>Quotes ${(n.quotes || []).length ? `<span class="count">${n.quotes.length}</span>` : ''} <button class="link" data-act="addQuote" data-id="${esc(id)}">＋ Add</button></h3>
      ${(n.quotes || []).length ? `<div class="card list inset">${n.quotes.slice().sort((a, b) => a.price - b.price).map(q => quoteRow(n, q)).join('')}</div>` : '<p class="muted">Each supplier’s price, to compare before buying.</p>'}</section>
    ${pays.length ? `<section class="dcard"><h3>Paid for it</h3><div class="card list inset">${pays.map(x => itemRow(x, 'E', true)).join('')}</div></section>` : ''}
    ${filesList(filesFor(id).filter(f => !isPic(f)), 'Files')}
    <div class="two" style="margin-top:16px">${attachButton(id, '📷 Add a photo', 'attachment', 'image/*')}<button class="btn ghost" data-act="editNeed" data-id="${esc(id)}">✏️ Edit</button></div>
    <details class="more-actions"><summary>More</summary><div class="two">${attachButton(id, '📎 Add a PDF', 'attachment', 'application/pdf')}<button class="btn ghost" data-act="copyNeed" data-id="${esc(id)}">⧉ Copy as new</button>
      ${n.status === 'dropped' ? '' : `<button class="btn ghost" data-act="needStep" data-id="${esc(id)}" data-to="dropped">✖ Not buying it</button>`}<button class="btn danger" data-act="delNeed" data-id="${esc(id)}">🗑 Delete 🔒</button></div></details>`);
  paintThumbs();
  comeBack(() => needDetail(id));
}
const EXTRA = 'Extra / no project'; // bought beyond what the projects need, or for no project
const quoteRow = (n, q) => { const u = supOf(q.sup); return `<div class="sugg"><div><b>${esc(cost(q.price, q.cur))}</b> · ${esc(u ? u.name : 'A deleted supplier')}<br><span class="muted">${esc([q.moq && `minimum ${q.moq}`, q.lead && `ready in ${q.lead}`, q.at && fmtDate(q.at), q.note].filter(Boolean).join(' · '))}</span></div>
  <div class="two">${['idea', 'tobuy'].includes(n.status) && u ? `<button class="btn small out" data-act="orderNeed" data-id="${esc(n.id)}" data-q="${esc(q.id)}">🧾 Order from them</button>` : ''}<button class="btn small ghost" data-act="delQuote" data-id="${esc(n.id)}" data-q="${esc(q.id)}">Remove</button></div></div>`; };
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
    ${buyNav('budgets')}
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
