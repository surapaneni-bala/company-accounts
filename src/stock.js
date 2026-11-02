/* ---------- the warehouse (owner, 2 Nov 2026): stock items, goods received with their landed cost, goods out, counts ---------- */
// Everything is worked out from the records, never typed twice: what is on hand and at what average landed cost (calc.js
// stockBook), what an import cost (landedCost), what a sale still has to send (toSend). Admins see costs, values and profit;
// an office manager sees quantities and selling prices, records goods used and counts, and sells from stock (invoices.js).
const STOCK_UNITS = ['pcs', 'bars', 'bags', 'boxes', 'cartons', 'sets', 'rolls', 'sheets', 'lengths', 'm', 'm²', 'm³', 'kg', 'tons', 'litres', 'pairs'];
// what an import's costs are for; each is spread over the lines by weight, value or quantity (the first is the usual way)
const COST_TYPES = [['freight', 'Freight / shipping', 'kg'], ['duty', 'Customs duty', 'value'], ['tax', 'Taxes at import (VAT…)', 'value'], ['clearing', 'Clearing agent', 'value'],
  ['port', 'Port / border charges', 'kg'], ['transport', 'Transport to the warehouse', 'kg'], ['handling', 'Loading / offloading', 'kg'], ['insurance', 'Insurance', 'value'], ['bank', 'Bank / transfer charges', 'value'], ['other', 'Other', 'value']];
const COST_NAME = Object.fromEntries(COST_TYPES.map(([k, n]) => [k, n]));
const SPLIT_NAME = { kg: 'by weight', value: 'by value', qty: 'by quantity' };
const OUT_KIND = { use: ['Used', 'Used on a project or site'], damage: ['Damaged / lost', 'Broken, spoilt, stolen or missing'], return: ['Returned', 'Sent back to the supplier'], count: ['Stock count', 'The difference a count found'] };
const DEFAULT_MARKUP = 10;
const itemOf = id => S.stock.find(x => x.id === id && !x.deleted);
const receiptOf = id => S.receipts.find(x => x.id === id && !x.deleted);
const items = () => live(S.stock).sort((a, b) => String(a.cat || '').localeCompare(String(b.cat || '')) || a.name.localeCompare(b.name));
const book = () => stockBook(S.receipts, S.stockOut, S.invoices);
const usd4 = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
// what one sells for, also in SSP at the last rate typed (a manager selling in SSP sees both)
const priceText = m => (m.price > 0 ? `${money(m.price, 'USD')}${S.lastRate ? ` ≈ ${money(Math.round(m.price * S.lastRate), 'SSP')}` : ''}` : 'no price yet');
const nw = t => `<span class="nw">${t}</span>`; // a price stays on one line
const seesCost = () => can('money');
const stockNav = active => `<nav class="subnav" aria-label="Warehouse">${[['stock', '📦', 'Stock'], ['stockIn', '🚢', 'Received'], ['stockOutList', '🚚', 'Out'], ...(seesCost() ? [['stockReport', '📈', 'Report']] : [])]
  .map(([a, i, t]) => `<button type="button" data-act="${a}"${a === active ? ' aria-current="page"' : ''}><span aria-hidden="true">${i}</span>${t}</button>`).join('')}</nav>`;
const itemOptions = (sel, extra = '') => `<option value="">Choose…</option>${items().map(m => `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}${m.code ? ` (${esc(m.code)})` : ''}</option>`).join('')}${extra}`;
// the sheet script must be new enough to keep these records (they stay on this phone until then)
const stockScriptNote = () => (S.link && (S.link.v || 2) < 23 ? `<p class="note">The warehouse needs the Google Sheet script version 23 (this sheet runs ${S.link.v || 2}). Until then what you enter stays on this phone. ${can('settings') ? '<button class="link" data-act="howUpdate">Show me how</button>' : 'Tell the owner.'}</p>` : '');

// on the menu tile: deliveries arrived short (admins), loads not confirmed for two days, items running low
function stockBadge() {
  if (!live(S.stock).length) return '';
  const b = book(), low = live(S.stock).filter(m => m.min > 0 && (b[m.id] ? b[m.id].qty : 0) <= m.min).length;
  const late = live(S.deliveries).filter(d => d.status === 'out' && d.date <= plusDays(today(), -2)).length, short = can('edit') ? live(S.deliveries).filter(d => dnState(d) === 'short' && d.recv.at.slice(0, 10) >= plusDays(today(), -7)).length : 0;
  const t = short ? `${short} short` : late ? `${late} not confirmed` : low ? `${low} low` : '';
  return t ? `<span class="badge">${t}</span>` : '';
}

/* ---------- selling, like a shop (owner, 2 Nov 2026): find it, see its price and stock, add how many, check out ---------- */
let cart = {}; // item id → how many; kept while the app is open, emptied once the invoice is made
let shopQ = '';
const cartLines = () => Object.entries(cart).filter(([m, q]) => itemOf(m) && q > 0);
const cartTotal = () => cartLines().reduce((t, [m, q]) => t + Math.round(q * (itemOf(m).price || 0) * 100), 0) / 100;
function shopSheet() {
  if (!live(S.stock).length) return toast('Nothing is in the warehouse yet');
  openSheet(`${head('Sell', 'in', 'Find it, add how many, check out')}
    <form data-form="shopFind"><input name="q" class="shop-q" placeholder="🔍 Search: rebar 12, cement, RB12…" value="${esc(shopQ)}" autocomplete="off" aria-label="Search the stock"></form>
    <div id="shopList">${shopRows()}</div>
    <div class="cart-bar" id="cartBar">${cartBar()}</div>`);
  comeBack(shopSheet);
}
function shopRows() {
  const b = book(), q = shopQ.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
  const list = items().filter(m => words.every(w => [m.name, m.code, m.cat].some(v => String(v || '').toLowerCase().includes(w))));
  if (!list.length) return '<p class="muted">Nothing matches. Try fewer words.</p>';
  return `<div class="card list inset">${list.slice(0, 60).map(m => { const have = b[m.id] ? b[m.id].qty : 0, n = cart[m.id] || 0;
    return `<div class="shop-row${n ? ' in-cart' : ''}"><div class="shop-what"><b>${esc(m.name)}</b>${m.code ? ` <i class="tag">${esc(m.code)}</i>` : ''}
      <small>${m.price > 0 ? `<b class="shop-price">${money(m.price, 'USD')}</b> / ${esc(m.unit)}${S.lastRate ? ` · ≈ ${nw(money(Math.round(m.price * S.lastRate), 'SSP'))}` : ''}` : 'no price yet'} · <span class="nw ${have > 0 ? '' : 'out-c'}">${plain(have)} in stock</span></small></div>
      <div class="stepper-q"><button type="button" data-act="cartStep" data-id="${esc(m.id)}" data-d="-1" aria-label="One less" ${n ? '' : 'disabled'}>−</button><input data-cart="${esc(m.id)}" inputmode="decimal" value="${n || ''}" placeholder="0" aria-label="How many ${esc(m.name)}"><button type="button" data-act="cartStep" data-id="${esc(m.id)}" data-d="1" aria-label="One more" ${m.price > 0 ? '' : 'disabled'}>＋</button></div></div>`; }).join('')}</div>`;
}
const cartBar = () => { const n = cartLines().length; return n ? `<span>🛒 <b>${n}</b> item${n === 1 ? '' : 's'} · <b>${money(cartTotal(), 'USD')}</b></span><button class="btn in" data-act="checkout">Check out →</button>` : '<span class="muted">🛒 Add something to sell</span>'; };
function cartSet(id, n) {
  const m = itemOf(id), have = (book()[id] || { qty: 0 }).qty;
  if (!m) return;
  n = Math.max(0, Math.round((Number.isFinite(n) ? n : 0) * 1e6) / 1e6);
  if (n > have && n > (cart[id] || 0)) toast(`Only ${plain(have)} ${m.unit} in stock`);
  cart = { ...cart, [id]: n };
  if (!n) { const { [id]: _, ...rest } = cart; cart = rest; }
  $('#cartBar').innerHTML = cartBar();
  const row = $(`[data-cart="${id}"]`);
  if (row && document.activeElement !== row) row.value = n || '';
  if (row) { row.closest('.shop-row').classList.toggle('in-cart', !!n); $('[data-d="-1"]', row.closest('.shop-row')).disabled = !n; }
}
function checkout(type = 'invoice') {
  const lines = cartLines().map(([m, qty]) => { const it = itemOf(m); return { m, t: it.name, unit: it.unit, qty, price: it.price }; });
  if (!lines.length) return toast('The cart is empty');
  invoiceForm(type, null, '', lines);
}

/* ---------- the stock list ---------- */
let stockQ = '';
function stockSheet() {
  const b = book(), list = items(), admin = seesCost(), wait = awaitingDelivery(S.invoices, S.deliveries);
  const low = list.filter(m => m.min > 0 && (b[m.id] ? b[m.id].qty : 0) <= m.min);
  const atCost = list.reduce((t, m) => t + Math.max(0, b[m.id] ? b[m.id].value : 0), 0), atPrice = list.reduce((t, m) => t + Math.round(Math.max(0, b[m.id] ? b[m.id].qty : 0) * (m.price || 0) * 100), 0);
  openSheet(`${head('Warehouse', 'stock')}${stockNav('stock')}${stockScriptNote()}
    ${admin ? `<div class="ssp-big"><small>STOCK WORTH</small><b>${money(atCost / 100, 'USD')}</b><span>at landed cost · ${money(atPrice / 100, 'USD')} at selling prices · ${list.length} item${list.length === 1 ? '' : 's'}</span></div>` : ''}
    <div class="two">${admin ? '<button class="btn primary" data-act="receiveForm">🚢 Goods received</button>' : ''}<button class="btn ghost" data-act="outForm">➖ Goods out</button>
      <button class="btn in" data-act="sellStock">🧾 Sell from stock</button><button class="btn ghost" data-act="countSheet">📋 Count the stock</button></div>
    ${low.length ? `<p class="note" style="margin-top:12px">⚠️ Running low: ${low.map(m => `<b>${esc(m.name)}</b> (${plain(b[m.id] ? b[m.id].qty : 0)})`).join(', ')}</p>` : ''}
    <form data-form="stockFilter" class="qadd" style="margin-top:12px"><input name="q" placeholder="Find an item, a code or a shelf" value="${esc(stockQ)}" autocomplete="off" aria-label="Find an item"></form>
    <div id="stockList">${stockRows(list, b, wait)}</div>
    ${admin ? '<button class="btn ghost" data-act="itemForm" style="margin-top:12px">＋ New stock item</button>' : ''}
    <div class="two" style="margin-top:10px"><button class="btn ghost" data-act="stockPdf">📄 Stock list (PDF)</button><button class="btn ghost" data-act="countPdf">🖨 Count sheet to print</button></div>`);
  comeBack(stockSheet);
}
function stockRows(list, b, wait) {
  const q = stockQ.trim().toLowerCase(), shown = q ? list.filter(m => [m.name, m.code, m.bin, m.cat].some(v => String(v || '').toLowerCase().includes(q))) : list;
  if (!list.length) return empty('Nothing in the warehouse yet', seesCost() ? 'Tap <b>Goods received</b> when an import arrives: its items are made as you type them.' : 'An admin enters goods as they arrive.');
  if (!shown.length) return '<p class="muted">Nothing matches.</p>';
  const groups = [...new Set(shown.map(m => m.cat || 'Other'))];
  return groups.map(g => `<h3 class="subh">${esc(g)}</h3><div class="card list inset">${shown.filter(m => (m.cat || 'Other') === g).map(m => {
    const s = b[m.id] || { qty: 0, avg: 0 }, low = m.min > 0 && s.qty <= m.min;
    return `<button class="row" data-act="openItem" data-id="${esc(m.id)}"><span class="dot">📦</span>
      <span class="main"><span class="t"><span class="tt">${esc(m.name)}</span>${m.code ? `<i class="tag">${esc(m.code)}</i>` : ''}${low ? '<i class="tag warn">Low</i>' : ''}${s.short ? '<i class="tag bad">Below zero</i>' : ''}</span>
      <span class="s">${esc([`${priceText(m)} each`, seesCost() && s.avg ? `cost ${usd4(s.avg)}` : '', wait[m.id] ? `${plain(wait[m.id])} sold, not yet sent` : '', m.bin && `shelf ${m.bin}`].filter(Boolean).join(' · '))}</span></span>
      <span class="amt">${plain(s.qty)}<small>${esc(m.unit)}</small></span></button>`;
  }).join('')}</div>`).join('');
}
function filterStock(f) { stockQ = f.elements.q.value; $('#stockList').innerHTML = stockRows(items(), book(), awaitingDelivery(S.invoices, S.deliveries)); }

/* ---------- one item: how many, its price, its cost (admins), every move ---------- */
function itemDetail(id) {
  const m = itemOf(id);
  if (!m) return false;
  const s = book()[id] || { qty: 0, avg: 0, value: 0, moves: [], sold: 0, revenue: 0, cogs: 0 }, admin = seesCost(), wait = awaitingDelivery(S.invoices, S.deliveries)[id] || 0;
  const markup = m.markup === undefined ? DEFAULT_MARKUP : m.markup, suggest = s.avg ? sellPrice(s.avg, markup) : 0;
  const what = mv => mv.kind === 'in' ? 'Received' : mv.kind === 'sale' ? `Sold${(invOf(mv.ref) || {}).no ? ' · ' + invOf(mv.ref).no : ''}` : (OUT_KIND[mv.kind] || [mv.kind])[0];
  openSheet(`${head(m.name, 'stock', [m.code, m.cat].filter(Boolean).join(' · '))}
    <div class="dbig${s.short ? ' out' : ''}">${plain(s.qty)} <small style="font-size:.45em">${esc(m.unit)}</small></div>
    <p class="note">Sells for <b>${priceText(m)}</b> each${m.fixed ? ' (price set by hand)' : ''}.${admin && s.avg ? `<br>Landed cost <b>${usd4(s.avg)}</b> each (average) · ${plain(markup)} % on top = ${money(suggest, 'USD')}${!m.fixed && Math.abs(suggest - (m.price || 0)) > 0.004 ? ' — the price follows it when goods come in' : ''}.<br>In stock worth ${money(s.value / 100, 'USD')} at cost.` : ''}</p>
    ${wait ? `<p class="note">🚚 ${plain(wait)} ${esc(m.unit)} are sold but still here, waiting for their delivery note.</p>` : ''}
    <div class="two"><button class="btn in" data-act="sellStock" data-id="${esc(id)}">🧾 Sell</button><button class="btn ghost" data-act="outForm" data-id="${esc(id)}">➖ Goods out</button>${admin ? `<button class="btn ghost" data-act="itemForm" data-id="${esc(id)}">✏️ Edit 🔒</button>` : ''}</div>
    <dl class="facts" style="margin-top:16px">${[['Unit', m.unit], ['Shelf / place', m.bin], ['Reorder at', m.min ? `${plain(m.min)} ${m.unit}` : ''], ['Sold so far', s.sold ? `${plain(s.sold)} ${m.unit}` : ''],
      ...(admin && s.sold ? [['Earned on them', `${money(s.revenue / 100, 'USD')} for goods that cost ${money(s.cogs / 100, 'USD')} — ${money((s.revenue - s.cogs) / 100, 'USD')} profit`]] : []), ['Note', m.note]]
      .filter(x => x[1]).map(([a, v]) => `<div><dt>${a}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <h3 class="subh">Every move (${s.moves.length})</h3>
    ${s.moves.length ? `<div class="card list inset">${[...s.moves].reverse().slice(0, 80).map(mv => `<button class="mrow" data-act="openMove" data-kind="${mv.kind}" data-id="${esc(mv.ref)}" style="width:100%;border:0;background:none;text-align:left;cursor:pointer;font:inherit">
      <span>${esc(fmtDate(mv.date))} · ${esc(what(mv))}</span><span class="muted">${admin ? usd4(mv.kind === 'in' ? mv.cost : mv.avg) + ' · ' : ''}left ${plain(mv.bal)}</span><b class="${mv.qty < 0 ? 'out-c' : 'in-c'}">${mv.qty > 0 ? '+' : '−'}${plain(Math.abs(mv.qty))}</b></button>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}
    ${attachButton(id, '📷 Add a photo of it', 'photo', 'image/*')}
    ${filesBlock(id)}`);
  comeBack(() => itemDetail(id));
}
function openMove(b) {
  const k = b.dataset.kind, id = b.dataset.id;
  if (k === 'in') return receiptDetail(id);
  if (k === 'sale') return invoiceDetail(id) === false ? toast('That sale is not on this phone') : null;
  return outDetail(id);
}

async function itemForm(id) {
  const old = id && itemOf(id);
  if (!seesCost() || !await unlock(old ? 'Enter the password to change this item.' : 'Enter the password to add a stock item.')) return;
  const d = old || { unit: 'pcs', markup: DEFAULT_MARKUP };
  openSheet(`${head(old ? 'Edit stock item' : 'New stock item', 'stock', old ? old.id : '')}
    <form data-form="item" data-id="${esc(old ? old.id : '')}">
      ${textField('name', 'What it is', 'e.g. Rebar 12 mm × 12 m', d.name)}
      <div class="two"><label class="fld"><span>Unit</span><input name="unit" list="dl-unit" value="${esc(d.unit)}" maxlength="20" required autocomplete="off"></label>
        <label class="fld"><span>Code <em>(optional)</em></span><input name="code" value="${esc(d.code || '')}" maxlength="30" placeholder="e.g. RB12" autocomplete="off"></label></div>
      <label class="fld"><span>Category</span><input name="cat" list="dl-cat" value="${esc(d.cat || '')}" maxlength="60" placeholder="e.g. Steel" autocomplete="off"></label>
      <div class="two"><label class="fld"><span>Shelf / place <em>(optional)</em></span><input name="bin" value="${esc(d.bin || '')}" maxlength="40" placeholder="e.g. Yard A" autocomplete="off"></label>
        <label class="fld"><span>Reorder at <em>(optional)</em></span><input name="min" inputmode="decimal" value="${esc(d.min || '')}" placeholder="e.g. 50" autocomplete="off"></label></div>
      <label class="fld"><span>Markup on the landed cost, %</span><input name="markup" inputmode="decimal" value="${esc(d.markup === undefined ? DEFAULT_MARKUP : d.markup)}" autocomplete="off"></label>
      <label class="fld check"><input type="checkbox" name="fixed" ${d.fixed ? 'checked' : ''}><span>Set the selling price by hand instead</span></label>
      <label class="fld fixed-price" ${d.fixed ? '' : 'hidden'}><span>Sells for, in US dollars, each</span><input name="price" inputmode="decimal" value="${esc(d.fixed ? d.price || '' : '')}" autocomplete="off"></label>
      ${textField('note', 'Note', '', d.note || '', false)}
      <p class="err"></p>
      <button class="btn primary">${old ? 'Save changes' : 'Add the item'}</button>
    </form>${stockLists()}`);
}
const stockLists = () => `<datalist id="dl-unit">${STOCK_UNITS.map(u => `<option value="${esc(u)}">`).join('')}</datalist><datalist id="dl-cat">${[...new Set([...live(S.stock).map(m => m.cat).filter(Boolean), ...BUY_CATS.map(c => c[0])])].map(c => `<option value="${esc(c)}">`).join('')}</datalist>`;
function itemFields(v) {
  const markup = String(v.markup ?? '').trim() === '' ? DEFAULT_MARKUP : parseNum(v.markup), min = String(v.min || '').trim() ? parseNum(v.min) : 0;
  const rec = { name: clean(v.name), unit: clean(v.unit) || 'pcs', code: clean(v.code), cat: clean(v.cat), bin: clean(v.bin), min, markup, note: clean(v.note), fixed: !!v.fixed };
  return { rec, price: v.fixed ? parseAmount(v.price) : null };
}
function saveItem(f) {
  const old = itemOf(f.dataset.id), { rec, price } = itemFields(Object.fromEntries(new FormData(f)));
  if (!rec.name) return formErr(f, 'name', 'Type what it is');
  if (rec.markup === null || rec.markup > 1000) return formErr(f, 'markup', 'Type the markup as a percentage, like 10');
  if (rec.min === null) return formErr(f, 'min', 'Type how few should make you reorder, like 50 — or leave it empty');
  if (rec.fixed && !(price > 0)) return formErr(f, 'price', 'Type what one sells for, like 13.50');
  const clash = live(S.stock).find(m => m.id !== (old && old.id) && (m.name.toLowerCase() === rec.name.toLowerCase() || (rec.code && m.code && m.code.toLowerCase() === rec.code.toLowerCase())));
  if (clash) return formErr(f, clash.name.toLowerCase() === rec.name.toLowerCase() ? 'name' : 'code', `${clash.name} already has this ${clash.name.toLowerCase() === rec.name.toLowerCase() ? 'name' : 'code'}`);
  const by = myName() || S.lastBy || '', s = book()[old ? old.id : ''], auto = s && s.avg ? sellPrice(s.avg, rec.markup) : undefined;
  const full = { ...rec, ...(rec.fixed ? { price } : auto ? { price: auto } : old && old.price && !old.fixed ? { price: old.price } : {}) };
  if (old) {
    const { price: _p, ...rest } = old;
    update({ stock: S.stock.map(x => (x.id === old.id ? { ...rest, ...full, editedAt: stampSec(), editedBy: by } : x)), log: logWith([['Edited', old.id, `Stock item ${rec.name}${(full.price || 0) !== (old.price || 0) ? `: sells for ${money(full.price || 0, 'USD')} (was ${money(old.price || 0, 'USD')})` : ''}`]], by) });
    toast('Saved ✓'); return itemDetail(old.id);
  }
  const id = newItem(full, by);
  toast(`${rec.name} added ✓`); itemDetail(id);
}
function newItem(rec, by) {
  const [[id], seq] = nextIds('M', 1, S.seq);
  update({ stock: [...S.stock, { id, ...rec, by, createdAt: stampSec() }], seq, log: logWith([['Added', id, `Stock item: ${rec.name} (${rec.unit})`]], by) });
  return id;
}
// after goods come in (or an import is changed or deleted): an item's price follows its new average cost and markup, unless fixed
function followCosts(ids, by) {
  const b = book(), changed = [];
  const stock = S.stock.map(m => {
    const s = b[m.id];
    if (!ids.includes(m.id) || m.fixed || !s || !(s.avg > 0)) return m;
    const price = sellPrice(s.avg, m.markup === undefined ? DEFAULT_MARKUP : m.markup);
    if (Math.abs(price - (m.price || 0)) < 0.005) return m;
    changed.push(`${m.name}: ${money(price, 'USD')}`);
    return { ...m, price, editedAt: stampSec(), editedBy: by };
  });
  if (changed.length) update({ stock, log: logWith([['Prices', '—', `Selling prices follow the landed cost: ${changed.join('; ')}`]], by) });
}

/* ---------- goods received: an import, every cost in its currency, the landed cost of one ---------- */
const recvLine = (l = {}) => `<div class="rline">
  <select name="m" aria-label="Item">${itemOptions(l.m, `<option value="__new" ${l.m === '__new' ? 'selected' : ''}>＋ A new item…</option>`)}</select>
  <div class="rnew" ${l.m === '__new' ? '' : 'hidden'}><input name="nname" placeholder="New item — e.g. Rebar 12 mm × 12 m" value="${esc(l.nname || '')}" maxlength="160" autocomplete="off" aria-label="New item's name"><input name="nunit" list="dl-unit" placeholder="Unit" value="${esc(l.nunit || 'pcs')}" maxlength="20" autocomplete="off" aria-label="Unit"></div>
  <div class="rnums"><label><span>How many</span><input name="qty" inputmode="decimal" value="${esc(l.qty ?? '')}" autocomplete="off"></label>
    <label><span>Line total</span><input name="amt" inputmode="decimal" value="${esc(l.amt ?? '')}" autocomplete="off"></label>
    <label><span>Weight</span><input name="kg" inputmode="decimal" value="${esc(l.w ?? '')}" autocomplete="off"></label>
    <button type="button" class="x" data-act="delRecvLine" aria-label="Remove this line">×</button></div>
  <small class="muted rhint"></small></div>`;
const costLine = (c = {}) => `<div class="cline">
  <div class="cnums"><select name="ct" aria-label="What the cost was for">${COST_TYPES.map(([k, n]) => `<option value="${k}" ${k === (c.t || 'freight') ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <input name="cwhat" placeholder="Detail (optional) — e.g. truck Kampala → Juba" value="${esc(c.what || '')}" maxlength="120" autocomplete="off" aria-label="Detail"></div>
  <div class="cnums"><input name="camt" inputmode="decimal" placeholder="Amount" value="${esc(c.amt ?? '')}" autocomplete="off" aria-label="Amount">
    <select name="ccur" aria-label="Currency">${BUY_CURS.map(k => `<option ${k === (c.cur || 'USD') ? 'selected' : ''}>${k}</option>`).join('')}</select>
    <input name="crate" inputmode="decimal" placeholder="1 USD =" value="${esc(c.rate || (c.cur && c.cur !== 'USD' ? '' : ''))}" autocomplete="off" aria-label="How many made 1 US dollar that day" ${(c.cur || 'USD') === 'USD' ? 'hidden' : ''}>
    <button type="button" class="x" data-act="delCostLine" aria-label="Remove this cost">×</button></div>
  <div class="cnums"><select name="csplit" aria-label="How it is spread">${Object.entries(SPLIT_NAME).map(([k, n]) => `<option value="${k}" ${k === (c.split || 'kg') ? 'selected' : ''}>Spread ${n}</option>`).join('')}</select>
    <select name="cpay" aria-label="In Accounts">${payOptions(c.pay)}</select></div>
  <small class="muted chint"></small></div>`;
// a cost's payment in Accounts: not there, add it now (cash or bank), or one already entered (so nothing is typed twice)
function payOptions(sel) {
  const recent = live(S.expenses).filter(e => !e.worker && !e.regular && e.at >= plusDays(today(), -150)).sort((a, b) => byAt(b, a)).slice(0, 60);
  return `<option value="">Not in Accounts</option><option value="cash" ${sel === 'cash' ? 'selected' : ''}>＋ Add to Accounts: paid in cash</option><option value="bank" ${sel === 'bank' ? 'selected' : ''}>＋ Add to Accounts: paid from the bank</option>
    ${recent.length ? `<optgroup label="Already in Accounts">${recent.map(e => `<option value="${esc(e.id)}" ${e.id === sel ? 'selected' : ''}>${esc(`${fmtDate(e.at.slice(0, 10))} · ${money(e.amount, e.cur)} · ${e.paidTo}`)}</option>`).join('')}</optgroup>` : ''}`;
}
async function receiveForm(id) {
  const old = id && receiptOf(id);
  if (!seesCost() || !await unlock(old ? 'Enter the password to change goods received.' : 'Enter the password to enter goods received.')) return;
  const sups = live(S.suppliers).map(u => u.name), d = old || { date: today(), gcur: 'USD', lines: [{}], costs: [{ t: 'freight' }] }, ton = !old || (old.lines.every(l => !l.kg || l.kg >= 100));
  const lines = d.lines.map(l => ({ ...l, w: l.kg ? (ton ? l.kg / 1000 : l.kg) : '' }));
  openSheet(`${head(old ? 'Change goods received' : 'Goods received', 'stock', old ? old.ref || old.id : 'An import, a delivery from a supplier')}
    ${stockScriptNote()}
    <form data-form="receive" data-id="${esc(old ? old.id : '')}">
      <div class="two"><label class="fld"><span>Arrived on</span><input type="date" name="date" value="${esc(d.date)}" max="${today()}" required></label>
        <label class="fld"><span>Their invoice / container no.</span><input name="ref" value="${esc(d.ref || '')}" maxlength="60" placeholder="e.g. PI-2026-118" autocomplete="off"></label></div>
      <div class="two"><label class="fld"><span>Supplier</span><input name="from" list="dl-sup" value="${esc(d.sup ? (live(S.suppliers).find(u => u.id === d.sup) || {}).name || d.from || '' : d.from || '')}" maxlength="80" placeholder="Who sold it" autocomplete="off"></label>
        <label class="fld"><span>From <em>(country)</em></span><input name="origin" value="${esc(d.origin || '')}" maxlength="40" placeholder="e.g. Uganda" autocomplete="off"></label></div>
      <datalist id="dl-sup">${sups.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="two"><label class="fld"><span>The supplier's invoice is in</span><select name="gcur">${BUY_CURS.map(k => `<option ${k === (d.gcur || 'USD') ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label class="fld grate" ${(d.gcur || 'USD') === 'USD' ? 'hidden' : ''}><span>How many made 1 US dollar</span><input name="grate" inputmode="decimal" value="${esc(d.grate || '')}" autocomplete="off"></label></div>
      <div class="fld"><span>Weights are in</span><div class="curseg"><label><input type="radio" name="wu" value="t" ${ton ? 'checked' : ''}><span><b>Tons</b><small>as on a steel invoice</small></span></label><label><input type="radio" name="wu" value="kg" ${ton ? '' : 'checked'}><span><b>kg</b></span></label></div></div>
      <h3 class="subh">What came in <small class="muted">— each line as on their invoice; the weight only if costs are spread by weight</small></h3>
      <div class="rlines">${lines.map(recvLine).join('')}</div>
      <button type="button" class="btn small ghost" data-act="addRecvLine">＋ Another line</button>
      <h3 class="subh">Every other cost <small class="muted">— freight, duty, clearing… each in the money it was paid in, at that day's rate</small></h3>
      <div class="clines">${d.costs.map(costLine).join('')}</div>
      <button type="button" class="btn small ghost" data-act="addCostLine">＋ Another cost</button>
      <div class="lc-out card pad" style="margin-top:16px"></div>
      ${textField('note', 'Note', '', d.note || '', false)}
      <p class="err"></p>
      <button class="btn primary">${old ? 'Save the changes' : 'Save — the goods are in stock'}</button>
    </form>${stockLists()}`);
  refreshReceive($('#sheet form'));
}
// what the form says, as an import (y) for landedCost; bad = the first line or cost not filled in, with why
function readReceive(f) {
  const v = Object.fromEntries(new FormData(f)), wu = v.wu === 'kg' ? 1 : 1000, gcur = BUY_CURS.includes(v.gcur) ? v.gcur : 'USD';
  const rows = $$('.rline', f).map(el => ({ el, m: $('[name=m]', el).value, nname: clean($('[name=nname]', el).value), nunit: clean($('[name=nunit]', el).value) || 'pcs',
    qty: parseNum($('[name=qty]', el).value), amt: parseNum($('[name=amt]', el).value), kgText: $('[name=kg]', el).value.trim() }))
    .filter(r => r.m || r.nname || r.qty || r.amt);
  rows.forEach(r => { const w = r.kgText ? parseNum(r.kgText) : 0; r.kg = w === null ? null : Math.round(w * wu * 1000) / 1000; });
  const costs = $$('.cline', f).map(el => ({ el, t: $('[name=ct]', el).value, what: clean($('[name=cwhat]', el).value), amtText: $('[name=camt]', el).value.trim(), cur: $('[name=ccur]', el).value,
    rate: parseNum($('[name=crate]', el).value) || undefined, split: $('[name=csplit]', el).value, pay: $('[name=cpay]', el).value }))
    .filter(c => c.amtText);
  costs.forEach(c => { c.amt = parseNum(c.amtText); });
  const y = { gcur, grate: gcur === 'USD' ? undefined : parseNum(v.grate) || undefined, lines: rows.map(r => ({ m: r.m, qty: r.qty, amt: r.amt, kg: r.kg || 0 })),
    costs: costs.map(c => ({ t: c.t, amt: c.amt, cur: c.cur, rate: c.cur === 'USD' ? undefined : c.rate, split: c.split })) };
  const badLine = rows.find(r => !(r.m && r.m !== '__new' ? itemOf(r.m) : r.nname) || !(r.qty > 0) || r.amt === null || r.kg === null);
  const badCost = costs.find(c => c.amt === null || (c.cur !== 'USD' && !(c.rate > 0)));
  return { v, rows, costs, y, badLine, badCost };
}
function refreshReceive(f) {
  $$('.rline', f).forEach(el => { $('.rnew', el).hidden = $('[name=m]', el).value !== '__new'; });
  $$('.cline', f).forEach(el => { $('[name=crate]', el).hidden = $('[name=ccur]', el).value === 'USD'; });
  $('.grate', f).hidden = f.elements.gcur.value === 'USD';
  const { rows, costs, y } = readReceive(f), out = $('.lc-out', f), cur = y.gcur;
  rows.forEach(r => { const h = $('.rhint', r.el); h.textContent = r.qty > 0 && r.amt > 0 ? `${cost(Math.round(r.amt / r.qty * 1e4) / 1e4, cur)} each as invoiced${r.kg ? ` · ${plain(Math.round(r.kg / r.qty * 1000) / 1000)} kg each` : ''}` : ''; });
  costs.forEach(c => { const h = $('.chint', c.el), usd = c.amt === null ? null : toUsd(c.amt, c.cur, c.rate); h.textContent = c.cur !== 'USD' && usd !== null ? `= ${money(Math.round(usd * 100) / 100, 'USD')}` : c.cur !== 'USD' && c.amt ? `Type how many ${c.cur} made 1 US dollar that day` : ''; });
  const ready = rows.length && rows.every(r => r.qty > 0 && r.amt !== null && r.kg !== null) && costs.every(c => c.amt !== null);
  if (!ready) { out.innerHTML = '<p class="muted" style="margin:0">Type each line (how many, and what the line cost) and each cost: the landed cost of one appears here.</p>'; return; }
  const r = landedCost(y);
  if (r.err) { out.innerHTML = `<p class="err" style="margin:0">To spread ${r.cost !== undefined ? `the ${esc((COST_NAME[costs[r.cost].t] || '').toLowerCase())} cost` : 'the costs'}, type ${esc(r.err)}.</p>`; return; }
  const name = (row) => (row.m && row.m !== '__new' ? (itemOf(row.m) || {}).name : row.nname) || '—';
  const markupOf = row => { const m = row.m && itemOf(row.m); return m && m.markup !== undefined ? m.markup : DEFAULT_MARKUP; };
  out.innerHTML = `<h3 style="margin:0 0 8px">Landed cost</h3>
    <div class="lc-table">${r.lines.map((l, i) => `<div class="lc-row"><b>${esc(name(rows[i]))}</b><span class="muted">${plain(rows[i].qty)} · goods ${money(l.goods / 100, 'USD')} + costs ${money(l.extra / 100, 'USD')} = ${money(l.total / 100, 'USD')}</span>
      <span class="lc-each"><b>${usd4(l.unit)}</b> each · sells for <b>${money(sellPrice(l.unit, markupOf(rows[i])), 'USD')}</b> (+${plain(markupOf(rows[i]))} %)</span></div>`).join('')}</div>
    <p class="muted" style="margin:10px 0 0">Goods ${money(r.goods / 100, 'USD')} + costs ${money(r.extra / 100, 'USD')} = <b>${money(r.total / 100, 'USD')}</b>${r.kg ? ` · ${plain(Math.round(r.kg) / 1000)} tons · ${usd4(Math.round(r.total / r.kg * 1e4) / 1e6)} a kg` : ''}${r.goods ? ` · the costs add ${plain(Math.round(r.extra / r.goods * 1000) / 10)} % to the goods` : ''}.</p>`;
}
async function saveReceive(f) {
  const old = receiptOf(f.dataset.id), { v, rows, costs, y, badLine, badCost } = readReceive(f);
  if (!DATE_RE.test(v.date) || v.date > today()) return formErr(f, 'date', 'Choose the day it arrived');
  if (!rows.length) return formErr(f, null, 'Add at least one line: the item, how many and what the line cost.');
  if (badLine) { $('input,select', badLine.el).focus(); return formErr(f, null, !(badLine.m && badLine.m !== '__new') && !badLine.nname ? 'Choose the item on each line (or type the new one).' : 'Each line needs how many came (above 0), what the line cost and, if typed, a weight in numbers.'); }
  if (y.gcur !== 'USD' && !(y.grate > 0)) return formErr(f, 'grate', `Type how many ${y.gcur} made 1 US dollar`);
  if (badCost) { $('[name=camt]', badCost.el).focus(); return formErr(f, null, badCost.amt === null ? 'Type each cost as a number.' : `Type how many ${badCost.cur} made 1 US dollar the day that cost was paid.`); }
  const badPay = costs.find(c => ['cash', 'bank'].includes(c.pay) && !CURS.includes(c.cur));
  if (badPay) return formErr(f, null, `A cost in ${badPay.cur} cannot go into Accounts (it keeps US dollars and SSP). Choose "Not in Accounts" for it.`);
  const r = landedCost(y);
  if (r.err) return formErr(f, null, `To spread the costs, type ${r.err}.`);
  const by = myName() || S.lastBy || '';
  // new items first (each line points at its item), then the import, then the payments it made in Accounts
  rows.forEach(row => { if (row.m === '__new') { const same = live(S.stock).find(m => m.name.toLowerCase() === row.nname.toLowerCase()); row.m = same ? same.id : newItem({ name: row.nname, unit: row.nunit, markup: DEFAULT_MARKUP }, by); } });
  const sup = live(S.suppliers).find(u => u.name.toLowerCase() === clean(v.from).toLowerCase());
  let id = old && old.id;
  if (!old) { const [[nid], seq] = nextIds('Y', 1, S.seq); update({ seq }); id = nid; }
  const payIds = [];
  const outCosts = costs.map(c => {
    let pay = c.pay && !['cash', 'bank'].includes(c.pay) ? c.pay : '';
    if (['cash', 'bank'].includes(c.pay)) {
      const [[eid], s2] = nextIds('E', 1, S.seq);
      const e = { id: eid, cur: c.cur, amount: c.amt, rate: c.cur === 'SSP' ? c.rate : undefined, paidTo: c.what || COST_NAME[c.t], reason: `${COST_NAME[c.t]} — goods received ${clean(v.ref) || v.date}`, location: '', project: '', mode: c.pay === 'bank' ? 'Bank' : 'Cash', at: `${v.date}T12:00`, manualDate: true, imp: id, by, createdAt: stampSec(), batch: null };
      update({ expenses: [...S.expenses, e], seq: s2 });
      payIds.push(eid); pay = eid;
    }
    return { t: c.t, ...(c.what ? { what: c.what } : {}), amt: c.amt, cur: c.cur, ...(c.cur !== 'USD' ? { rate: c.rate } : {}), split: c.split, ...(pay ? { pay } : {}) };
  });
  const rec = { date: v.date, ref: clean(v.ref), ...(sup ? { sup: sup.id } : { from: clean(v.from) }), origin: clean(v.origin), gcur: y.gcur, ...(y.gcur !== 'USD' ? { grate: y.grate } : {}),
    lines: rows.map(row => ({ m: row.m, qty: row.qty, amt: row.amt, ...(row.kg ? { kg: row.kg } : {}) })), costs: outCosts, lc: r.lines.map(l => l.unit), note: clean(v.note) };
  const text = `${rows.length} line${rows.length === 1 ? '' : 's'} · landed ${money(r.total / 100, 'USD')}${payIds.length ? ` · ${payIds.length} cost${payIds.length === 1 ? '' : 's'} added to Accounts` : ''}`;
  if (old) update({ receipts: S.receipts.map(x => (x.id === old.id ? { ...x, ...rec, editedAt: stampSec(), editedBy: by } : x)), log: logWith([['Edited', id, `Goods received ${rec.ref || rec.date}: ${text}`]], by) });
  else update({ receipts: [...S.receipts, { id, ...rec, by, createdAt: stampSec() }], log: logWith([['Received', id, `Goods received ${rec.ref || rec.date}: ${text}`]], by) });
  followCosts([...new Set([...rec.lines.map(l => l.m), ...(old ? old.lines.map(l => l.m) : [])])], by);
  toast(old ? 'Saved ✓' : 'In stock ✓');
  receiptDetail(id);
}
function receiptDetail(id) {
  const y = receiptOf(id);
  if (!y) return false;
  const admin = seesCost() && !y.stub, r = admin ? landedCost(y) : null, sup = y.sup && live(S.suppliers).find(u => u.id === y.sup);
  openSheet(`${head('Goods received', 'stock', [fmtDate(y.date), y.ref].filter(Boolean).join(' · '))}
    <dl class="facts">${[['Arrived on', fmtDate(y.date)], ['Their invoice / container', y.ref], ['Supplier', sup ? sup.name : y.from], ['From', y.origin], ...(admin ? [['Invoiced in', y.gcur === 'USD' ? 'US dollars' : `${y.gcur} · ${plain(y.grate)} for 1 USD`]] : []), ['Entered by', y.by]]
      .filter(x => x[1]).map(([a, v]) => `<div><dt>${a}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <h3 class="subh">What came in</h3>
    <div class="card list inset">${y.lines.map((l, i) => { const m = itemOf(l.m) || { name: 'An item no longer in the list', unit: '' }; return `<button class="mrow" data-act="openItem" data-id="${esc(l.m)}" style="width:100%;border:0;background:none;text-align:left;cursor:pointer;font:inherit">
      <span>${esc(m.name)}</span><span class="muted">${admin ? `${r && !r.err ? `${money(r.lines[i].total / 100, 'USD')} landed · ` : ''}${usd4(y.lc[i])} each` : esc(m.unit)}</span><b>${plain(l.qty)}</b></button>`; }).join('')}</div>
    ${admin ? `<h3 class="subh">Costs (${y.costs.length})</h3>${y.costs.length ? `<div class="card list inset">${y.costs.map(c => { const usd = toUsd(c.amt, c.cur, c.rate), e = c.pay && S.expenses.find(x => x.id === c.pay && !x.deleted);
      return `<div class="mrow"><span>${esc(COST_NAME[c.t] || c.t)}${c.what ? ` — ${esc(c.what)}` : ''}<br><small class="muted">${esc(SPLIT_NAME[c.split])}${e ? ` · in Accounts: ${esc(fmtDate(e.at.slice(0, 10)))} ${esc(money(e.amount, e.cur))}` : ' · not in Accounts'}</small></span>
        <span class="muted">${c.cur === 'USD' ? '' : `${esc(cost(c.amt, c.cur))} at ${plain(c.rate)}`}</span><b>${money(Math.round(usd * 100) / 100, 'USD')}</b></div>`; }).join('')}</div>` : '<p class="muted">None.</p>'}
      ${r && !r.err ? `<p class="note">Goods ${money(r.goods / 100, 'USD')} + costs ${money(r.extra / 100, 'USD')} = <b>${money(r.total / 100, 'USD')}</b> landed${r.kg ? ` · ${usd4(Math.round(r.total / r.kg * 1e4) / 1e6)} a kg` : ''}.</p>` : ''}
      <div class="two"><button class="btn ghost" data-act="landedPdf" data-id="${esc(id)}">📄 Landed cost sheet (PDF)</button><button class="btn ghost" data-act="receiveForm" data-id="${esc(id)}">✏️ Change 🔒</button></div>
      ${attachButton(id, '📎 Add their invoice, packing list, customs papers…')}
      ${filesBlock(id)}
      <button class="btn danger" data-act="deleteReceipt" data-id="${esc(id)}" style="margin-top:16px">🗑 Delete 🔒</button>` : ''}`);
  comeBack(() => receiptDetail(id));
}
async function deleteReceipt(id) {
  const y = receiptOf(id);
  if (!y || !await unlock('Enter the password to delete goods received.')) return;
  const b = book(), short = y.lines.filter(l => (b[l.m] ? b[l.m].qty : 0) - l.qty < 0).map(l => (itemOf(l.m) || {}).name);
  const by = confirmBy(`Delete these goods received${y.ref ? ` (${y.ref})` : ''}?${short.length ? `\n\n⚠️ Without them there would be fewer than nothing of: ${short.join(', ')} — they were sold or used.` : ''}\n\nPayments it added to Accounts stay (delete them there if they are wrong).`);
  if (!by) return;
  update({ receipts: S.receipts.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Goods received ${y.ref || y.date}`]], by) });
  followCosts(y.lines.map(l => l.m), by);
  toast('Deleted ✓'); closeAll(); stockSheet();
}
function receivedList() {
  const ys = live(S.receipts).sort((a, b) => b.date.localeCompare(a.date)), admin = seesCost();
  openSheet(`${head('Goods received', 'stock')}${stockNav('stockIn')}
    ${admin ? '<button class="btn primary" data-act="receiveForm">🚢 Goods received</button>' : ''}
    ${ys.length ? `<div class="card list inset" style="margin-top:14px">${ys.map(y => { const r = admin && !y.stub ? landedCost(y) : null; return `<button class="row in" data-act="openReceipt" data-id="${esc(y.id)}"><span class="dot">🚢</span>
      <span class="main"><span class="t"><span class="tt">${esc(y.ref || 'Goods received')}</span></span><span class="s">${esc([fmtDate(y.date), (y.sup && (live(S.suppliers).find(u => u.id === y.sup) || {}).name) || y.from, `${y.lines.length} line${y.lines.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '))}</span></span>
      ${r && !r.err ? `<span class="amt">${money(r.total / 100, 'USD')}<small>landed</small></span>` : ''}</button>`; }).join('')}</div>` : `<div style="height:12px"></div>${empty('Nothing received yet', 'Each import or delivery from a supplier is entered here, with all its costs.')}`}`);
  comeBack(receivedList);
}

/* ---------- goods out: used, damaged, returned ---------- */
const outLine = (l = {}) => `<div class="oline"><select name="m" aria-label="Item">${itemOptions(l.m)}</select><input name="qty" inputmode="decimal" placeholder="How many" value="${esc(l.qty ?? '')}" autocomplete="off" aria-label="How many"><button type="button" class="x" data-act="delOutLine" aria-label="Remove">×</button><small class="muted ohint"></small></div>`;
function outForm(itemId) {
  if (!live(S.stock).length) return toast('Nothing is in the warehouse yet');
  openSheet(`${head('Goods out', 'out', 'Used, damaged or returned')}
    <form data-form="stockOut">
      <div class="fld"><span>What happened?</span><div class="curseg roles">${['use', 'damage', 'return'].map((k, i) => `<label><input type="radio" name="kind" value="${k}" ${i ? '' : 'checked'}><span><b>${OUT_KIND[k][0]}</b><small>${OUT_KIND[k][1]}</small></span></label>`).join('')}</div></div>
      <div class="olines">${outLine({ m: itemId })}</div>
      <button type="button" class="btn small ghost" data-act="addOutLine">＋ Another item</button>
      <div class="use-only">${projectSelect('', true)}</div>
      ${textField('to', 'Taken by / sent to', 'e.g. Site foreman Juma', '', false)}
      <label class="fld"><span>On</span><input type="date" name="date" value="${today()}" max="${today()}" required></label>
      ${textField('note', 'Why / note', 'e.g. For the slab of the second floor', '', false)}
      <p class="err"></p>
      <button class="btn out">Take them out of stock</button>
    </form>`);
  refreshOut($('#sheet form'));
}
function refreshOut(f) {
  const b = book();
  $$('.oline', f).forEach(el => { const m = itemOf($('[name=m]', el).value); $('.ohint', el).textContent = m ? `${plain(b[m.id] ? b[m.id].qty : 0)} ${m.unit} in stock` : ''; });
  $('.use-only', f).hidden = f.elements.kind.value !== 'use';
}
function saveStockOut(f) {
  const v = Object.fromEntries(new FormData(f)), b = book(), kind = v.kind;
  const lines = $$('.oline', f).map(el => ({ m: $('[name=m]', el).value, qty: parseNum($('[name=qty]', el).value), el })).filter(l => l.m || l.qty);
  if (!lines.length) return formErr(f, null, 'Choose an item and how many.');
  const bad = lines.find(l => !itemOf(l.m) || !(l.qty > 0));
  if (bad) { $('select', bad.el).focus(); return formErr(f, null, 'Each line needs its item and how many (above 0).'); }
  const want = {};
  lines.forEach(l => { want[l.m] = (want[l.m] || 0) + l.qty; });
  const over = Object.entries(want).find(([m, q]) => q > (b[m] ? b[m].qty : 0) + 1e-9);
  if (over) { const m = itemOf(over[0]); if (!can('edit')) return formErr(f, null, `Only ${plain(b[m.id] ? b[m.id].qty : 0)} ${m.unit} of ${m.name} are in stock.`); if (!confirm(`Only ${plain(b[m.id] ? b[m.id].qty : 0)} ${m.unit} of ${m.name} are in stock. Take ${plain(over[1])} out anyway?`)) return; }
  if (!DATE_RE.test(v.date) || v.date > today()) return formErr(f, 'date', 'Choose the day');
  if (kind === 'use' && !v.project && !clean(v.to)) return formErr(f, 'to', 'Say which project, or who took them');
  const by = myName() || S.lastBy || '', [[id], seq] = nextIds('O', 1, S.seq);
  const rec = { id, date: v.date, kind, lines: Object.entries(want).map(([m, qty]) => ({ m, qty })), project: kind === 'use' ? v.project || '' : '', to: clean(v.to), note: clean(v.note), by, createdAt: stampSec() };
  update({ stockOut: [...S.stockOut, rec], seq, log: logWith([['Goods out', id, `${OUT_KIND[kind][0]}: ${rec.lines.map(l => `${plain(l.qty)} ${itemOf(l.m).unit} ${itemOf(l.m).name}`).join(', ')}${rec.project ? ` — ${projName(rec.project)}` : ''}${rec.to ? ` — ${rec.to}` : ''}`]], by) });
  toast('Out of stock ✓');
  outDetail(id);
}
function outDetail(id) {
  const o = S.stockOut.find(x => x.id === id && !x.deleted);
  if (!o) return false;
  const b = book(), dn = live(S.deliveries).find(d => d.out === id);
  openSheet(`${head(OUT_KIND[o.kind][0], o.kind === 'count' ? 'stock' : 'out', fmtDate(o.date))}
    <dl class="facts">${[['On', fmtDate(o.date)], ['Project', o.project && projName(o.project)], ['Taken by / sent to', o.to], ['Note', o.note], ['Recorded by', o.by]].filter(x => x[1]).map(([a, v]) => `<div><dt>${a}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <div class="card list inset">${o.lines.map(l => { const m = itemOf(l.m) || { name: l.m, unit: '' }, val = seesCost() && b[l.m] ? Math.round(Math.abs(l.qty) * ((b[l.m].moves.find(mv => mv.ref === id && mv.m === l.m) || {}).avg || 0) * 100) / 100 : null;
      return `<div class="mrow"><span>${esc(m.name)}</span><span class="muted">${l.counted !== undefined ? `counted ${plain(l.counted)} · ` : ''}${val !== null ? money(val, 'USD') + ' at cost' : ''}</span><b class="${o.kind === 'count' && l.qty > 0 ? 'in-c' : 'out-c'}">${o.kind === 'count' && l.qty > 0 ? '+' : '−'}${plain(Math.abs(l.qty))} ${esc(m.unit)}</b></div>`; }).join('')}</div>
    ${o.kind === 'use' ? (dn ? `<button class="btn ghost" data-act="openDelivery" data-id="${esc(dn.id)}" style="margin-top:12px">🚚 Delivery note ${esc(dn.no)}</button>` : `<button class="btn ghost" data-act="deliveryForm" data-out="${esc(id)}" style="margin-top:12px">🚚 Make a delivery note to the site</button>`) : ''}
    ${attachButton(id, '📷 Add a photo')}
    ${filesBlock(id)}
    ${can('delete') ? `<button class="btn danger" data-act="deleteOut" data-id="${esc(id)}" style="margin-top:16px">🗑 Delete 🔒</button>` : ''}`);
  comeBack(() => outDetail(id));
}
async function deleteOut(id) {
  const o = S.stockOut.find(x => x.id === id && !x.deleted);
  if (!o || !await unlock('Enter the password to delete it.')) return;
  const by = confirmBy(`Delete this record (${OUT_KIND[o.kind][0]}, ${fmtDate(o.date)})? The goods count as in stock again.`);
  if (!by) return;
  update({ stockOut: S.stockOut.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Goods out (${OUT_KIND[o.kind][0]}) ${o.date}`]], by) });
  toast('Deleted ✓'); closeAll(); stockSheet();
}
function outList() {
  const outs = live(S.stockOut).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 60);
  const dns = live(S.deliveries).sort((a, b) => b.date.localeCompare(a.date)), onWay = dns.filter(d => d.status === 'out');
  const toGo = live(S.invoices).filter(x => !x.stub && sells(x) && toSend(x, S.deliveries).length);
  openSheet(`${head('Goods out', 'stock')}${stockNav('stockOutList')}
    <div class="two"><button class="btn ghost" data-act="outForm">➖ Goods out</button><button class="btn in" data-act="sellStock">🧾 Sell from stock</button></div>
    ${toGo.length ? `<h3 class="subh">Sold, waiting for a delivery note (${toGo.length})</h3><div class="card list inset">${toGo.map(x => `<button class="row" data-act="deliveryForm" data-inv="${esc(x.id)}"><span class="dot">📦</span>
      <span class="main"><span class="t"><span class="tt">${esc(x.no)}</span><i class="tag warn">To send</i></span><span class="s">${esc([(clientOf(x.client) || {}).name, fmtDate(x.date), toSend(x, S.deliveries).map(l => `${plain(l.qty)} ${(itemOf(l.m) || {}).name || ''}`).join(', ')].filter(Boolean).join(' · '))}</span></span></button>`).join('')}</div>` : ''}
    ${onWay.length ? `<h3 class="subh">On the way — not yet confirmed (${onWay.length})</h3><div class="card list inset">${onWay.map(deliveryRow).join('')}</div>` : ''}
    <h3 class="subh">Delivery notes (${dns.length})</h3>${dns.length ? `<div class="card list inset">${dns.slice(0, 40).map(deliveryRow).join('')}</div>` : '<p class="muted">None yet.</p>'}
    <h3 class="subh">Used, damaged, returned, counted</h3>
    ${outs.length ? `<div class="card list inset">${outs.map(o => `<button class="row out" data-act="openOut" data-id="${esc(o.id)}"><span class="dot">${o.kind === 'count' ? '📋' : '−'}</span>
      <span class="main"><span class="t"><span class="tt">${esc(OUT_KIND[o.kind][0])}</span></span><span class="s">${esc([fmtDate(o.date), o.project && projName(o.project), o.to, o.lines.map(l => `${plain(Math.abs(l.qty))} ${(itemOf(l.m) || {}).name || ''}`).join(', '), o.by && 'by ' + o.by].filter(Boolean).join(' · '))}</span></span></button>`).join('')}</div>` : '<p class="muted">Nothing yet.</p>'}`);
  comeBack(outList);
}

/* ---------- the stock count: what should be on the shelves, what is ---------- */
// should be there = on hand + sold but not yet sent (still on the shelf); the differences found go in or out at the average cost
function countSheet() {
  const b = book(), wait = awaitingDelivery(S.invoices, S.deliveries), list = items();
  if (!list.length) return toast('Nothing is in the warehouse yet');
  openSheet(`${head('Count the stock', 'stock', fmtDate(today()))}
    <p class="hint">Count what is on the shelves and type it. Leave an item empty if you did not count it. Sold goods not yet sent are still here: they are in "should be".</p>
    <form data-form="count">
      ${[...new Set(list.map(m => m.cat || 'Other'))].map(g => `<h3 class="subh">${esc(g)}</h3><div class="card pad">${list.filter(m => (m.cat || 'Other') === g).map(m => {
        const should = Math.round(((b[m.id] ? b[m.id].qty : 0) + (wait[m.id] || 0)) * 1e6) / 1e6;
        return `<label class="count-row"><span><b>${esc(m.name)}</b><small class="muted">should be ${plain(should)} ${esc(m.unit)}${m.bin ? ` · ${esc(m.bin)}` : ''}</small></span><input name="c-${esc(m.id)}" data-should="${should}" inputmode="decimal" placeholder="${plain(should)}" autocomplete="off" aria-label="Counted ${esc(m.name)}"></label>`;
      }).join('')}</div>`).join('')}
      ${textField('to', 'Counted by', 'Who counted', myName() || S.lastBy || '', true)}
      <p class="note count-sum">Type what you counted.</p>
      <p class="err"></p>
      <button class="btn primary">Save the count</button>
    </form>`);
}
function countDiffs(f) {
  return $$('input[data-should]', f).filter(i => i.value.trim()).map(i => ({ m: i.name.slice(2), counted: parseNum(i.value), should: +i.dataset.should, el: i }));
}
function refreshCount(f) {
  const rows = countDiffs(f), diff = rows.filter(r => r.counted !== null && Math.abs(r.counted - r.should) > 1e-9);
  $('.count-sum', f).innerHTML = !rows.length ? 'Type what you counted.' : diff.length ? `${rows.length} counted · <b>${diff.length} different</b>: ${diff.map(r => `${esc((itemOf(r.m) || {}).name)} ${r.counted > r.should ? '+' : '−'}${plain(Math.abs(Math.round((r.counted - r.should) * 1e6) / 1e6))}`).join(', ')}` : `${rows.length} counted · everything matches ✓`;
}
function saveCount(f) {
  const rows = countDiffs(f), bad = rows.find(r => r.counted === null || r.counted < 0), who = clean(f.elements.to.value);
  if (!rows.length) return formErr(f, null, 'Type what you counted of at least one item.');
  if (bad) { bad.el.focus(); return formErr(f, null, 'Type each count as a number (0 or more).'); }
  if (!who) return formErr(f, 'to', 'Who counted?');
  const diff = rows.filter(r => Math.abs(r.counted - r.should) > 1e-9), by = myName() || S.lastBy || '';
  if (!diff.length) { update({ log: logWith([['Counted', '—', `Stock count by ${who}: ${rows.length} item${rows.length === 1 ? '' : 's'}, all as expected`]], by) }); toast('Everything matches ✓'); return stockSheet(); }
  if (!confirm(`${diff.length} item${diff.length === 1 ? '' : 's'} differ:\n${diff.map(r => `${(itemOf(r.m) || {}).name}: should be ${plain(r.should)}, counted ${plain(r.counted)}`).join('\n')}\n\nThe stock is corrected to what was counted, and admins see who counted.`)) return;
  const [[id], seq] = nextIds('O', 1, S.seq);
  const rec = { id, date: today(), kind: 'count', lines: diff.map(r => ({ m: r.m, qty: Math.round((r.counted - r.should) * 1e6) / 1e6, counted: r.counted })), to: who, note: `${rows.length} counted, ${diff.length} different`, by, createdAt: stampSec() };
  update({ stockOut: [...S.stockOut, rec], seq, log: logWith([['Counted', id, `Stock count by ${who}: ${diff.map(r => `${(itemOf(r.m) || {}).name} ${r.counted > r.should ? '+' : '−'}${plain(Math.abs(Math.round((r.counted - r.should) * 1e6) / 1e6))}`).join(', ')}`]], by) });
  toast('Count saved ✓');
  outDetail(id);
}

/* ---------- the report (admins): what was sold and earned, used on projects, lost; what the stock is worth ---------- */
function stockReport(month = today().slice(0, 7)) {
  if (!seesCost()) return;
  const b = book(), list = items(), inMonth = mv => !month || mv.date.slice(0, 7) === month;
  const per = list.map(m => {
    const mv = (b[m.id] ? b[m.id].moves : []).filter(inMonth), sum = (k, f) => mv.filter(x => x.kind === k).reduce((t, x) => t + f(x), 0);
    const sold = -sum('sale', x => x.qty), cogs = -sum('sale', x => x.val), rev = sum('sale', x => x.usd || 0), used = -sum('use', x => x.qty), usedV = -sum('use', x => x.val);
    const lost = mv.filter(x => ['damage', 'return', 'count'].includes(x.kind)).reduce((t, x) => t - x.val, 0);
    return { m, sold, cogs, rev, used, usedV, lost };
  });
  const tot = k => per.reduce((t, p) => t + p[k], 0), months = [...new Set(Object.values(b).flatMap(s => s.moves.map(x => x.date.slice(0, 7))))].sort().reverse();
  const byProject = {};
  Object.values(b).forEach(s => s.moves.filter(x => x.kind === 'use' && inMonth(x)).forEach(x => { byProject[x.project || ''] = (byProject[x.project || ''] || 0) - x.val; }));
  openSheet(`${head('Stock report', 'stock', month ? monthName(month) : 'Since the start')}${stockNav('stockReport')}
    <form data-form="stockMonth"><label class="fld"><span>Period</span><select name="month"><option value="">Since the start</option>${[...new Set([today().slice(0, 7), ...months])].map(x => `<option value="${x}" ${x === month ? 'selected' : ''}>${monthName(x)}</option>`).join('')}</select></label></form>
    <div class="stats"><div><small>Sold for</small><span class="in"><b>${money(tot('rev') / 100, 'USD')}</b></span></div><div><small>They cost</small><span><b>${money(tot('cogs') / 100, 'USD')}</b></span></div><div><small>Profit</small><span class="${tot('rev') >= tot('cogs') ? 'in' : 'out'}"><b>${money((tot('rev') - tot('cogs')) / 100, 'USD')}</b></span></div></div>
    <h3 class="subh">Sold</h3>
    ${per.some(p => p.sold) ? `<div class="card list inset">${per.filter(p => p.sold).map(p => `<button class="mrow" data-act="openItem" data-id="${esc(p.m.id)}" style="width:100%;border:0;background:none;text-align:left;cursor:pointer;font:inherit"><span>${esc(p.m.name)}<br><small class="muted">${plain(p.sold)} ${esc(p.m.unit)} · cost ${money(p.cogs / 100, 'USD')}</small></span><span class="muted">${p.rev ? `${plain(Math.round((p.rev - p.cogs) / p.rev * 1000) / 10)} % margin` : ''}</span><b>${money(p.rev / 100, 'USD')}</b></button>`).join('')}</div>` : '<p class="muted">Nothing sold.</p>'}
    <h3 class="subh">Used on projects (at cost)</h3>
    ${Object.keys(byProject).length ? `<div class="card list inset">${Object.entries(byProject).map(([p, v]) => `<div class="mrow"><span>${esc(projName(p))}</span><span></span><b>${money(v / 100, 'USD')}</b></div>`).join('')}</div>` : '<p class="muted">Nothing used.</p>'}
    <h3 class="subh">Damaged, returned, counted short (at cost)</h3>
    ${per.some(p => p.lost) ? `<div class="card list inset">${per.filter(p => p.lost).map(p => `<div class="mrow"><span>${esc(p.m.name)}</span><span></span><b class="${p.lost > 0 ? 'out-c' : 'in-c'}">${p.lost > 0 ? '−' : '+'}${money(Math.abs(p.lost) / 100, 'USD')}</b></div>`).join('')}</div>` : '<p class="muted">Nothing lost. ✓</p>'}
    <button class="btn ghost" data-act="stockPdf" style="margin-top:14px">📄 Stock list with costs (PDF)</button>`);
  comeBack(() => stockReport(month));
}

/* ---------- papers: the stock list, a count sheet to print, an import's landed cost ---------- */
const stockDoc = (title, no, extra = {}) => ({ title, no, date: fmtDate(today()), stampDate: today().split('-').reverse().join('-'), ref: no, info: [['Company', S.company || ''], ['Date', fmtDate(today())]], summary: [], noStamp: true, ...extra });
async function shareDoc(spec, name) {
  toast('Making the PDF…');
  try { const blob = await renderStatement(spec); shown = { blob, name }; readySheet(spec.title, spec.no, blob, name); } catch (e) { alert(`The PDF could not be made: ${e.message}`); }
}
function stockPdf() {
  const b = book(), list = items(), admin = seesCost();
  const cols = admin ? [{ h: 'Item', w: 360, wrap: true }, { h: 'On hand', w: 150, right: true }, { h: 'Cost each', w: 170, right: true }, { h: 'Value', w: 190, right: true }, { h: 'Sells for', w: 190, right: true }]
    : [{ h: 'Item', w: 480, wrap: true }, { h: 'Shelf', w: 170 }, { h: 'On hand', w: 190, right: true }, { h: 'Sells for', w: 220, right: true }];
  const groups = [...new Set(list.map(m => m.cat || 'Other'))];
  const value = list.reduce((t, m) => t + Math.max(0, b[m.id] ? b[m.id].value : 0), 0);
  shareDoc(stockDoc('STOCK LIST', `STOCK ${today()}`, {
    sections: groups.map(g => ({ title: g, cols, rows: list.filter(m => (m.cat || 'Other') === g).map(m => { const s = b[m.id] || { qty: 0, avg: 0, value: 0 };
      return admin ? [`${m.name}${m.code ? ` (${m.code})` : ''}`, `${plain(s.qty)} ${m.unit}`, usd4(s.avg), slipMoney(s.value / 100, 'USD'), slipMoney(m.price || 0, 'USD')] : [`${m.name}${m.code ? ` (${m.code})` : ''}`, m.bin || '', `${plain(s.qty)} ${m.unit}`, slipMoney(m.price || 0, 'USD')]; }) })),
    summary: admin ? [['Stock at landed cost', slipMoney(value / 100, 'USD'), true]] : [] }), `Stock list ${today()}.pdf`);
}
function countPdf() {
  const b = book(), wait = awaitingDelivery(S.invoices, S.deliveries), list = items();
  shareDoc(stockDoc('STOCK COUNT SHEET', `COUNT ${today()}`, {
    info: [['Company', S.company || ''], ['Date', fmtDate(today())], ['Counted by', ''], ['Checked by', '']],
    sections: [...new Set(list.map(m => m.cat || 'Other'))].map(g => ({ title: g, cols: [{ h: 'Item', w: 420, wrap: true }, { h: 'Shelf', w: 160 }, { h: 'Should be', w: 160, right: true }, { h: 'Counted', w: 160, right: true }, { h: 'Diff.', w: 160, right: true }],
      rows: list.filter(m => (m.cat || 'Other') === g).map(m => [`${m.name}${m.code ? ` (${m.code})` : ''}`, m.bin || '', `${plain(Math.round(((b[m.id] ? b[m.id].qty : 0) + (wait[m.id] || 0)) * 1e6) / 1e6)} ${m.unit}`, '', '']) })),
    approvals: true, signLabels: ['Counted by', 'Checked by', 'Approved by'] }), `Stock count sheet ${today()}.pdf`);
}
function landedPdf(id) {
  const y = receiptOf(id);
  if (!y || !seesCost()) return;
  const r = landedCost(y), sup = y.sup && live(S.suppliers).find(u => u.id === y.sup);
  if (r.err) return toast(`Cannot work it out: ${r.err}`);
  shareDoc({ title: 'LANDED COST', no: y.ref || y.id, date: fmtDate(y.date), stampDate: y.date.split('-').reverse().join('-'), ref: y.id, noStamp: true,
    info: [['Supplier', (sup && sup.name) || y.from || '—'], ['Arrived on', fmtDate(y.date)], ['Their invoice / container', y.ref || '—'], ['Invoiced in', y.gcur === 'USD' ? 'US dollars' : `${y.gcur} at ${plain(y.grate)} for 1 USD`]],
    sections: [{ title: 'Goods', cols: [{ h: 'Item', w: 300, wrap: true }, { h: 'Qty', w: 110, right: true }, { h: 'Goods', w: 160, right: true }, { h: 'Costs', w: 160, right: true }, { h: 'Landed', w: 160, right: true }, { h: 'Each', w: 170, right: true }],
      rows: y.lines.map((l, i) => [(itemOf(l.m) || {}).name || l.m, plain(l.qty), slipMoney(r.lines[i].goods / 100, 'USD'), slipMoney(r.lines[i].extra / 100, 'USD'), slipMoney(r.lines[i].total / 100, 'USD'), usd4(r.lines[i].unit)]) },
    { title: 'Costs', sub: 'Each in the money it was paid in, at that day\'s rate, spread over the goods as shown', cols: [{ h: 'Cost', w: 330, wrap: true }, { h: 'Paid', w: 230, right: true }, { h: 'Rate', w: 120, right: true }, { h: 'US dollars', w: 190, right: true }, { h: 'Spread', w: 190 }],
      rows: y.costs.map(c => [`${COST_NAME[c.t] || c.t}${c.what ? ` — ${c.what}` : ''}`, cost(c.amt, c.cur), c.cur === 'USD' ? '' : plain(c.rate), slipMoney(Math.round(toUsd(c.amt, c.cur, c.rate) * 100) / 100, 'USD'), SPLIT_NAME[c.split]]) }],
    summary: [['Goods', slipMoney(r.goods / 100, 'USD')], ['Costs', slipMoney(r.extra / 100, 'USD')], ['Landed', slipMoney(r.total / 100, 'USD'), true], ...(r.kg ? [['A kg', usd4(Math.round(r.total / r.kg * 1e4) / 1e6)]] : [])],
    approvals: true, preparedBy: y.by || '' }, `Landed cost ${fileSafe(y.ref || y.date)}.pdf`);
}
