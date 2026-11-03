/* ---------- invoices and quotations (admins; office managers sell from stock, 2 Nov 2026) ---------- */
// An invoice or a quotation (kind I) goes to a client (kind K). Its lines are quantity × unit price, and tax is a
// percentage typed on it — none until someone types one (the tax line is "built but hidden"). The sheet numbers invoices
// in one unbroken series, so making one needs the internet; quotations are numbered by the phone (QT-…) and work offline.
// Once made it is never edited: a mistake is cancelled (kept, stamped) and a copy made. Payments are Money received
// entries that name it (invoice), so what each client owes is always worked out, never typed (calc.js invoiceState).
// someone else's sale reaches an office manager as a stub (only the stock it took, for the warehouse): never shown as an invoice
const invOf = id => S.invoices.find(x => x.id === id && !x.deleted && !x.stub);
const invs = () => live(S.invoices).filter(x => !x.stub);
const seesPaid = () => can('money'); // what was paid and is owed comes from money received: admins only
const clientOf = id => S.clients.find(x => x.id === id && !x.deleted);
const invState = inv => invoiceState(inv, S.credits, today());
const INV_STATE = { unpaid: ['Unpaid', 'warn'], part: ['Part paid', 'warn'], overdue: ['Overdue', 'bad'], paid: ['Paid', ''], cancelled: ['Cancelled', 'bad'] };
const madeFrom = id => invs().find(x => x.from === id && !x.cancelled); // the invoice made from a quotation
const lineAmount = it => Math.round(it.qty * it.price * 100) / 100;
const plusDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const waChat = phone => `https://wa.me/${String(phone).replace(/\D/g, '')}`;
// what invoices still ask for: all of them, or one client's ({ amount, cur } per invoice, for sumText)
const owedBy = clientId => invs().filter(x => x.type === 'invoice' && (!clientId || x.client === clientId)).map(x => ({ cur: x.cur, amount: invState(x).due })).filter(x => x.amount);
function invTag(inv) {
  if (inv.ok === 'waiting') return '<i class="tag warn">Price waiting</i>';
  if (inv.ok === 'rejected') return '<i class="tag bad">Price refused</i>';
  if (!seesPaid() && inv.type === 'invoice') return inv.cancelled ? '<i class="tag bad">Cancelled</i>' : '';
  if (inv.type === 'quote') return inv.cancelled ? '<i class="tag bad">Cancelled</i>' : madeFrom(inv.id) ? '<i class="tag">Invoiced</i>' : inv.due && inv.due < today() ? '<i class="tag">Expired</i>' : '';
  const [text, tone] = INV_STATE[invState(inv).state];
  return `<i class="tag ${tone}">${text}</i>`;
}
function invRow(x) {
  const k = clientOf(x.client), st = invState(x);
  return `<button class="row in" data-act="openInvoice" data-id="${esc(x.id)}"><span class="dot">${x.type === 'quote' ? '📝' : '🧾'}</span>
    <span class="main"><span class="t"><span class="tt">${esc(x.no)}</span>${invTag(x)}</span><span class="s">${esc([k ? k.name : '—', fmtDate(x.date), seesPaid() && x.type === 'invoice' && st.due && !x.cancelled ? `${money(st.due, x.cur)} owed` : ''].filter(Boolean).join(' · '))}</span></span>
    <span class="amt">${money(st.total, x.cur)}</span></button>`;
}
const invList = (list, none) => (list.length ? `<div class="card list inset">${list.map(invRow).join('')}</div>` : `<p class="muted">${none}</p>`);

function salesSheet() {
  const all = invs().sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
  if (!seesPaid()) return mySalesSheet(all);
  const open = all.filter(x => x.type === 'invoice' && ['unpaid', 'part', 'overdue'].includes(invState(x).state)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const quotes = all.filter(x => x.type === 'quote' && !x.cancelled && !madeFrom(x.id));
  const done = all.filter(x => !open.includes(x) && !quotes.includes(x)).slice(0, 50), owed = owedBy();
  openSheet(`${head('Invoices & quotations', 'in')}
    <div class="two"><button class="btn in" data-act="newInvoice" data-type="invoice">＋ Invoice</button><button class="btn ghost" data-act="newInvoice" data-type="quote">＋ Quotation</button></div>
    <button class="btn ghost" data-act="clients" style="margin-top:10px">👥 Clients (${live(S.clients).length})</button>
    <p class="note" style="margin-top:14px">Owed by clients: <b>${owed.length ? sumText(owed) : 'nothing'}</b></p>
    <h3 class="subh">Waiting for payment (${open.length})</h3>${invList(open, 'Nothing is owed.')}
    <h3 class="subh">Open quotations (${quotes.length})</h3>${invList(quotes, 'None.')}
    ${done.length ? `<details class="gone"><summary>Paid, cancelled and invoiced (${done.length})</summary>${invList(done, '')}</details>` : ''}`);
  comeBack(salesSheet);
}

// an office manager's invoices and quotations (what was paid is the admins'): those waiting for a price, then the rest
function mySalesSheet(all) {
  const waitingP = all.filter(x => x.ok === 'waiting'), rest = all.filter(x => x.ok !== 'waiting');
  openSheet(`${head('Invoices & quotations', 'in')}
    <div class="two"><button class="btn in" data-act="newInvoice" data-type="invoice">＋ Invoice</button><button class="btn ghost" data-act="newInvoice" data-type="quote">＋ Quotation</button></div>
    <button class="btn ghost" data-act="clients" style="margin-top:10px">👥 Clients (${live(S.clients).length})</button>
    ${waitingP.length ? `<h3 class="subh">Price waiting for an admin (${waitingP.length})</h3>${invList(waitingP, '')}` : ''}
    <h3 class="subh">Invoices (${rest.filter(x => x.type === 'invoice').length})</h3>${invList(rest.filter(x => x.type === 'invoice').slice(0, 60), 'None yet.')}
    <h3 class="subh">Quotations (${rest.filter(x => x.type === 'quote').length})</h3>${invList(rest.filter(x => x.type === 'quote').slice(0, 40), 'None yet.')}`);
  comeBack(salesSheet);
}

/* ---------- clients ---------- */
function clientsSheet() {
  const ks = live(S.clients).sort((a, b) => a.name.localeCompare(b.name));
  openSheet(`${head('Clients', 'in')}
    <button class="btn in" data-act="addClient">＋ Add a client</button>
    ${ks.length ? `<div class="card list inset" style="margin-top:14px">${ks.map(k => { const o = owedBy(k.id); return `<button class="row" data-act="openClient" data-id="${esc(k.id)}"><span class="dot">👤</span>
      <span class="main"><span class="t"><span class="tt">${esc(k.name)}</span></span><span class="s">${esc([k.phone, k.address].filter(Boolean).join(' · '))}</span></span>
      ${o.length ? `<span class="amt">${sumText(o)}<small>owes</small></span>` : ''}</button>`; }).join('')}</div>`
      : `<div style="height:14px"></div>${empty('No clients yet', 'Add one here, or while making an invoice.')}`}`);
  comeBack(clientsSheet);
}
function clientDetail(id) {
  const k = clientOf(id);
  if (!k) return false;
  const theirs = invs().filter(x => x.client === id).sort((a, b) => b.date.localeCompare(a.date)), o = owedBy(id);
  openSheet(`${head(k.name, 'in', id)}
    ${seesPaid() ? `<p class="note">${o.length ? `Owes <b>${sumText(o)}</b>.` : 'Owes nothing.'}</p>` : ''}
    <div class="two"><button class="btn in" data-act="newInvoice" data-type="invoice" data-client="${esc(id)}">＋ Invoice</button><button class="btn ghost" data-act="newInvoice" data-type="quote" data-client="${esc(id)}">＋ Quotation</button></div>
    <dl class="facts" style="margin-top:16px">${[['Phone', k.phone], ['Address', k.address], ['TIN', k.tin], ['Note', k.note]].filter(f => f[1]).map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    ${k.phone ? `<a class="btn ghost" href="${esc(waChat(k.phone))}" target="_blank" rel="noopener">💬 WhatsApp chat</a>` : ''}
    <h3 class="subh">Invoices and quotations (${theirs.length})</h3>${invList(theirs, 'None yet.')}
    ${can('edit') ? `<div class="two" style="margin-top:16px"><button class="btn ghost" data-act="editClient" data-id="${esc(id)}">✏️ Edit</button>${theirs.length ? '' : `<button class="btn danger" data-act="delClient" data-id="${esc(id)}">🗑 Delete 🔒</button>`}</div>` : ''}`);
  comeBack(() => clientDetail(id));
}
function clientForm(old) {
  const d = old || {};
  openSheet(`${head(old ? 'Edit client' : 'New client', 'in', old?.id)}
    <form data-form="client" data-id="${esc(old?.id || '')}">
      ${textField('name', 'Name', 'Company or person', d.name)}
      <label class="fld"><span>Phone (WhatsApp) <em>(optional)</em></span><input name="phone" type="tel" value="${esc(d.phone)}" maxlength="30" autocomplete="off"></label>
      ${textField('address', 'Address', 'Town, street', d.address, false)}
      ${textField('tin', 'Tax number (TIN)', '', d.tin, false)}
      ${textField('note', 'Note', '', d.note, false)}
      <p class="err"></p>
      <button class="btn in">${old ? 'Save changes' : 'Add client'}</button>
    </form>`);
}
const clientFields = v => ({ name: clean(v.name), phone: clean(v.phone), address: clean(v.address), tin: clean(v.tin), note: clean(v.note) });
function newClient(rec) {
  const [[id], seq] = nextIds('K', 1, S.seq), by = myName() || S.lastBy || '';
  update({ clients: [...S.clients, { id, ...rec, by, createdAt: stampSec() }], seq, log: logWith([['Added', id, `Client: ${rec.name}`]], by) });
  return id;
}
function saveClient(f) {
  const old = clientOf(f.dataset.id), rec = clientFields(Object.fromEntries(new FormData(f)));
  if (!rec.name) return formErr(f, 'name', 'Type the client’s name');
  if (!old) { const id = newClient(rec); toast('Client added ✓'); return clientDetail(id); }
  const changes = diff(old, rec), by = myName() || S.lastBy || '';
  if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
  update({ clients: S.clients.map(k => (k.id === old.id ? { ...k, ...rec, editedAt: stampSec(), editedBy: by } : k)), log: logWith([['Edited', old.id, changes.join(' ; ')]], by) });
  toast('Changes saved ✓'); closeSheet();
}
async function deleteClient(id) {
  const k = clientOf(id);
  if (!k || invs().some(x => x.client === id) || !await unlock('Enter the password to delete this client.')) return;
  const by = confirmBy(`Delete the client "${k.name}"?`);
  if (!by) return;
  update({ clients: S.clients.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Client: ${k.name}`]], by) });
  toast('Deleted ✓'); closeAll(); clientsSheet();
}

/* ---------- making one ---------- */
// a line may come from the warehouse: its item (m), name, unit and price (the list price in the invoice's money); how many are in
// stock shows under it. An office manager sells at the list price — her price box is locked — unless an admin allows her a
// discount (Logins); lower waits for an admin (the sheet checks it too).
const priceLocked = () => !can('edit') && !(myOff() > 0);
const stockPick = it => (live(S.stock).length ? `<select name="m" class="ipick" aria-label="From stock"><option value="">✎ Typed line (not from stock)</option>${items().map(m => `<option value="${esc(m.id)}" ${m.id === it.m ? 'selected' : ''}>📦 ${esc(m.name)}</option>`).join('')}</select>` : '');
const listFor = (m, cur, rate) => (!m || !(m.price > 0) ? 0 : cur === 'USD' ? m.price : rate > 0 ? Math.round(m.price * rate) : 0);
const lineRow = (it = {}) => `<div class="iline">${stockPick(it)}<input name="t" placeholder="What — e.g. Cement 42.5, 50 kg bags" value="${esc(it.t)}" maxlength="200" autocomplete="off" aria-label="Description">
  <div class="iline-n"><input name="qty" inputmode="decimal" placeholder="Qty" value="${esc(it.qty ?? '')}" autocomplete="off" aria-label="Quantity"><input name="unit" placeholder="Unit" value="${esc(it.unit)}" maxlength="20" autocomplete="off" aria-label="Unit, e.g. bags">
  <input name="price" inputmode="decimal" placeholder="Unit price" value="${esc(it.price ?? '')}" autocomplete="off" aria-label="Unit price" ${it.keep ? 'data-typed="1"' : ''} ${it.m && priceLocked() ? 'readonly title="The list price — an admin sets prices"' : ''}><button type="button" class="x" data-act="delLine" aria-label="Remove line">×</button></div><small class="muted ihint"></small></div>`;
// a line picked from stock: its name, unit and list price; again whenever the money or the rate changes (unless a price was typed)
function pickStockLine(row, fresh) {
  const f = row.closest('form'), m = itemOf($('[name=m]', row).value), cur = formCur(f), rate = cur === 'SSP' ? parseAmount(f.elements.rate && f.elements.rate.value) : null;
  if (!m) return;
  if (fresh) { $('[name=t]', row).value = m.name; $('[name=unit]', row).value = m.unit; delete $('[name=price]', row).dataset.typed; }
  const list = listFor(m, cur, rate), price = $('[name=price]', row);
  price.readOnly = priceLocked();
  if (price.readOnly) delete price.dataset.typed; // locked: always the list price
  if (!price.dataset.typed) price.value = list || '';
}
// src: a quotation to invoice, or an earlier one to copy; client: made from a client's page
// pre: the shop's cart (lines from stock) or one stock item's id
function invoiceForm(type, src, client, pre) {
  const last = invs().filter(x => x.type === type).pop() || {}, ks = live(S.clients).sort((a, b) => a.name.localeCompare(b.name)), one = typeof pre === 'string' && itemOf(pre);
  const preLines = Array.isArray(pre) ? pre : one ? [{ m: one.id, t: one.name, unit: one.unit, price: one.price }] : null;
  const d = src ? { ...src } : { client: client || '', cur: 'USD', items: preLines || [{}], tax: last.tax || 0, notes: last.notes || '', bank: last.bank || '', project: '' };
  const dline = (d.items || []).find(it => it.dlv), lines = (d.items || []).filter(it => !it.dlv).map(it => (src ? { ...it, keep: true } : it)); // the delivery charge is asked on its own
  if (!src && !can('edit') && S.link && S.link.rate) d.rate = S.link.rate; // an office manager sells in SSP at the company's rate
  const fromQuote = src && src.type === 'quote' && type === 'invoice';
  openSheet(`${head(type === 'quote' ? 'New quotation' : 'New invoice', 'in')}
    ${fromQuote ? `<p class="note">From quotation ${esc(src.no)}. Check the lines, then make the invoice.</p>` : ''}
    ${Array.isArray(pre) ? `<p class="note">🛒 ${pre.length} item${pre.length === 1 ? '' : 's'} from the cart. Choose the customer, say how the goods go, and make it.</p>` : ''}
    <form data-form="invoice" data-type="${type}" data-from="${esc(fromQuote ? src.id : '')}" data-cart="${Array.isArray(pre) ? '1' : ''}">
      <label class="fld"><span>Client</span><select name="client">${ks.length && !d.client ? '<option value="" selected disabled>Choose the customer…</option>' : ''}${ks.map(k => `<option value="${esc(k.id)}" ${k.id === d.client ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}<option value="__new" ${ks.length ? '' : 'selected'}>＋ New client…</option></select></label>
      <div class="newk" ${ks.length ? 'hidden' : ''}>${textField('kname', 'New client’s name', 'Company or person', '', false)}<label class="fld"><span>Their phone (WhatsApp) <em>(optional)</em></span><input name="kphone" type="tel" maxlength="30" autocomplete="off"></label>
        ${textField('kaddr', 'Their address', 'Town, street', '', false)}${textField('ktin', 'Tax number (TIN)', '', '', false)}</div>
      <label class="fld"><span>Date</span><input type="date" name="date" value="${today()}" required></label>
      <label class="fld"><span>${type === 'quote' ? 'Valid until' : 'Pay by'}</span><input type="date" name="due" value="${plusDays(today(), type === 'quote' ? 30 : 14)}"></label>
      ${curChips(d.cur)}
      ${rateField(d.cur, d.rate).replace('<label class="fld ratef"', '<label class="fld ratef" data-stock-rate')}
      <div class="fld"><span>Lines</span><div class="ilines">${(lines.length ? lines : [{}]).map(lineRow).join('')}</div><button type="button" class="btn small ghost" data-act="addLine">＋ Add a line</button></div>
      <div class="fld"><span>The goods</span><div class="curseg"><label><input type="radio" name="dl" value="collect" ${d.dl === 'deliver' || dline ? '' : 'checked'}><span><b>🙋 They collect</b><small>from the warehouse</small></span></label>
        <label><input type="radio" name="dl" value="deliver" ${d.dl === 'deliver' || dline ? 'checked' : ''}><span><b>🚚 We deliver</b><small>to their site</small></span></label></div></div>
      <div class="dl-only">${textField('addr', 'Deliver to', 'e.g. Gudele block 3', d.addr || '', false)}
        <label class="fld"><span>Delivery charge <em>(optional — empty: free delivery)</em></span><input name="dcharge" inputmode="decimal" value="${esc(dline ? dline.price : '')}" placeholder="0" autocomplete="off"></label></div>
      <label class="fld"><span>Tax % <em>(optional — empty for none)</em></span><input name="tax" inputmode="decimal" value="${d.tax || ''}" placeholder="e.g. 18" autocomplete="off"></label>
      <p class="note itotal"></p>
      <label class="fld"><span>Pay into <em>(printed on it)</em></span><select name="bank"><option value="">— no bank details —</option>${bankList().map(b => `<option value="${esc(b.id)}" ${b.id === d.bank ? 'selected' : ''}>${esc(`${b.bank} · ${b.cur} · ${b.number}`)}</option>`).join('')}</select></label>
      ${projectSelect(d.project || '', true)}
      <label class="fld"><span>Notes and terms <em>(optional)</em></span><textarea class="plain" name="notes" rows="3" maxlength="600" placeholder="e.g. Delivery to site included.">${esc(d.notes)}</textarea></label>
      ${brandNote()}${mySigField()}
      <p class="err"></p>
      <button class="btn in">Make the ${type === 'quote' ? 'quotation' : 'invoice'} (PDF)</button>
    </form>`);
  refreshInvoice($('#sheet form'));
  showMySigField();
}
// the lines typed, and which one is not complete; empty lines are skipped
function invoiceLines(f) {
  const rows = $$('.iline', f).map(el => ({ m: $('[name=m]', el) && itemOf($('[name=m]', el).value) ? $('[name=m]', el).value : '', t: clean($('[name=t]', el).value), q: $('[name=qty]', el).value.trim(), unit: clean($('[name=unit]', el).value), p: $('[name=price]', el).value.trim(), el }))
    .filter(r => r.m || r.t || r.q || r.p);
  const items = rows.map(r => ({ t: r.t, qty: parseAmount(r.q), unit: r.unit, price: parseAmount(r.p), ...(r.m ? { m: r.m } : {}) }));
  const bad = rows.find((r, i) => !items[i].t || items[i].qty === null || items[i].price === null);
  return { items, bad };
}
function refreshInvoice(f) {
  const { items, } = invoiceLines(f), tax = parseAmount(f.elements.tax.value) || 0, cur = formCur(f), dl = f.elements.dl.value, charge = dl === 'deliver' ? parseAmount(f.elements.dcharge.value) || 0 : 0;
  const ok = [...items.filter(it => it.t && it.qty && it.price), ...(charge > 0 ? [{ qty: 1, price: charge }] : [])];
  const t = invoiceTotals({ items: ok, tax });
  // from stock: how many are there, and how far below the list price it is (an office manager: 1 % at most, or an admin approves)
  const b = book(), rate = cur === 'SSP' ? parseAmount(f.elements.rate.value) : null, stockLines = $$('.iline', f).filter(el => $('[name=m]', el) && itemOf($('[name=m]', el).value));
  $$('.iline', f).forEach(el => {
    const m = $('[name=m]', el) && itemOf($('[name=m]', el).value), hint = $('.ihint', el);
    if (!m) { hint.textContent = ''; return; }
    const list = listFor(m, cur, rate), price = parseAmount($('[name=price]', el).value), qty = parseAmount($('[name=qty]', el).value), have = b[m.id] ? b[m.id].qty : 0, off = price !== null ? belowList(price, list) : 0;
    const over = off > myOff() + 1e-9;
    hint.innerHTML = `${plain(have)} ${esc(m.unit)} in stock${qty > have ? ' — <b class="out-c">not enough</b>' : ''} · ${priceLocked() ? 'the list price' : `list ${list ? money(list, cur) : cur === 'SSP' ? '— type the rate above' : 'no price yet'}`}${off ? ` · <b class="${over ? 'out-c' : ''}">${plain(off)} % below</b>${over ? ' — an admin must approve it' : ''}` : ''}`;
  });
  const rateBox = $('[data-stock-rate]', f);
  rateBox.hidden = !(cur === 'SSP' && stockLines.length); $('input', rateBox).required = !rateBox.hidden;
  $('.dl-only', f).hidden = dl !== 'deliver';
  $('.itotal', f).innerHTML = ok.length ? `${ok.length} line${ok.length === 1 ? '' : 's'} · ${tax ? `${money(t.sub, cur)} + tax ${plain(tax)}% ${money(t.tax, cur)} = ` : ''}<b>${money(t.total, cur)}</b>` : 'Type each line: what, quantity, unit price.';
  $('.newk', f).hidden = f.elements.client.value !== '__new';
}
async function saveInvoice(f) {
  const type = f.dataset.type, v = Object.fromEntries(new FormData(f)), cur = formCur(f), { items, bad } = invoiceLines(f);
  const tax = v.tax.trim() ? parseAmount(v.tax) : 0, newName = clean(v.kname), dl = v.dl === 'deliver' ? 'deliver' : 'collect';
  if (v.client === '__new' ? !newName : !clientOf(v.client)) return formErr(f, v.client === '__new' ? 'kname' : 'client', 'Who is it for?');
  if (!items.length) return formErr(f, null, 'Add at least one line: what, quantity and unit price.');
  if (bad) { $('[name=t]', bad.el).focus(); return formErr(f, null, 'Each line needs what it is, a quantity and a unit price.'); }
  if (tax === null || tax > 100) return formErr(f, 'tax', 'Type the tax as a percentage, like 18 — or leave it empty');
  if (!DATE_RE.test(v.date)) return formErr(f, 'date', 'Choose the date');
  if (v.due && v.due < v.date) return formErr(f, 'due', 'It cannot be due before its date');
  const charge = dl === 'deliver' && String(v.dcharge || '').trim() ? parseAmount(v.dcharge) : 0;
  if (charge === null) return formErr(f, 'dcharge', 'Type the delivery charge, like 25 — or leave it empty for free delivery');
  // from stock: the list price as the item has it now (never what the form says), enough in stock, and the price rule
  const stockLines = items.filter(it => it.m), rate = cur === 'SSP' && stockLines.length ? parseAmount(v.rate) : null;
  if (stockLines.length && cur === 'SSP' && !(rate > 0)) return formErr(f, 'rate', RATE_ERR);
  stockLines.forEach(it => { it.list = listFor(itemOf(it.m), cur, rate); });
  const noPrice = stockLines.find(it => !(it.list > 0));
  if (noPrice) return formErr(f, null, `${itemOf(noPrice.m).name} has no selling price yet — an admin sets it in the Warehouse.`);
  const src = f.dataset.from && invOf(f.dataset.from), mine = signedIn() ? session.user.id : '';
  const usedQuote = src && invs().some(x => x.from === src.id && !x.cancelled), approvedQuote = src && src.type === 'quote' && src.ok === 'approved' && src.uid === mine && src.cur === cur && !usedQuote ? src : null;
  const quotedQty = m => (approvedQuote ? approvedQuote.items.filter(q => q.m === m).reduce((t, q) => t + q.qty, 0) : 0), soldQty = m => stockLines.filter(it => it.m === m).reduce((t, it) => t + it.qty, 0);
  const offOk = it => belowList(it.price, it.list) <= myOff() + 1e-9 || (approvedQuote && soldQty(it.m) <= quotedQty(it.m) + 1e-9 && approvedQuote.items.some(q => q.m === it.m && it.price >= q.price - 1e-9));
  const typedLines = items.filter(it => !it.m), lowRate = !can('edit') && cur === 'SSP' && stockLines.length && S.link && S.link.rate > 0 && rate < S.link.rate * (1 - myOff() / 100) - 1e-9;
  const needsApproval = !can('edit') && (stockLines.some(it => !offOk(it)) || typedLines.length > 0 || lowRate);
  if (type === 'invoice') {
    const b = book(), want = {};
    stockLines.forEach(it => { want[it.m] = (want[it.m] || 0) + it.qty; });
    const over = Object.entries(want).find(([m, q]) => q > (b[m] ? b[m].qty : 0) + 1e-9);
    if (over) { const m = itemOf(over[0]), have = b[m.id] ? b[m.id].qty : 0; if (!can('edit')) return formErr(f, null, `Only ${plain(have)} ${m.unit} of ${m.name} are in stock.`); if (!confirm(`Only ${plain(have)} ${m.unit} of ${m.name} are in stock, and this sells ${plain(over[1])}.\n\nMake it anyway?`)) return; }
  }
  if (can('edit') && seesCost()) { // an admin selling below what it cost is asked first
    const b = book(), under = stockLines.find(it => b[it.m] && b[it.m].avg > 0 && toUsd(it.price, cur, rate) < b[it.m].avg - 0.005);
    if (under && !confirm(`${itemOf(under.m).name} sells here for less than it cost (${usd4(b[under.m].avg)} landed). Make it anyway?`)) return;
  }
  const why = [...stockLines.filter(it => !offOk(it)).map(it => `${itemOf(it.m).name}: ${money(it.price, cur)} (list ${money(it.list, cur)}, ${plain(belowList(it.price, it.list))} % below)`),
    ...typedLines.map(it => `"${it.t}" is typed, not from stock`), ...(lowRate ? [`The rate ${plain(rate)} is below the company's ${plain(S.link.rate)}`] : [])];
  if (needsApproval && !confirm(`An admin must approve this first:\n${why.join('\n')}\n\nSend it to an admin? It is made only when they approve.`)) return;
  let no;
  $('.err', f).textContent = 'Making it…';
  if (needsApproval) { const [[q], seq] = nextIds(type === 'quote' ? 'QT' : 'REQ', 1, S.seq); update({ seq }); no = q; } // numbered when approved
  else if (type === 'invoice') { // the next number in the company's one series, from the sheet
    if (!S.link) return formErr(f, null, 'Invoices are numbered by the Google Sheet. Connect this phone to it first.');
    try { no = (await callServer(S.link, { op: 'number' })).no; }
    catch (e) { return formErr(f, null, e.offline ? 'Making an invoice needs the internet: the Google Sheet gives it the next number, so numbers never repeat or skip.' : e.message); }
  } else { const [[q], seq] = nextIds('QT', 1, S.seq); update({ seq }); no = q; }
  const client = v.client === '__new' ? newClient({ name: newName, phone: clean(v.kphone), address: clean(v.kaddr), tin: clean(v.ktin), note: '' }) : v.client;
  if (f.dataset.cart) cart = {}; // sold: the shop's cart starts empty again
  const by = myName() || S.lastBy || '', [[id], seq] = nextIds('I', 1, S.seq), addr = dl === 'deliver' ? clean(v.addr) : '';
  const lines = [...items, ...(charge > 0 ? [{ t: `Delivery${addr ? ` to ${addr}` : ''}`, qty: 1, unit: 'trip', price: charge, dlv: true }] : [])];
  const inv = { id, type, no, client, date: v.date, due: v.due || '', cur, items: lines, tax: tax || 0, bank: bankOf(v.bank) ? v.bank : '', project: v.project || '', notes: String(v.notes || '').trim().slice(0, 600),
    ...(stockLines.length ? { dl, ...(addr ? { addr } : {}) } : {}), ...(rate ? { rate } : {}),
    ...(needsApproval ? { ok: 'waiting' } : approvedQuote && !can('edit') ? { ok: 'approved', okBy: approvedQuote.okBy } : {}),
    ...(f.dataset.from ? { from: f.dataset.from } : {}), check: newCheck(), by, createdAt: stampSec() };
  update({ invoices: [...S.invoices, inv], seq, log: logWith([['Made', id, `${type === 'quote' ? 'Quotation' : 'Invoice'} ${no} for ${clientOf(client).name}: ${money(invoiceTotals(inv).total, cur)}${needsApproval ? ' — price waiting for an admin' : ''}`]], by) });
  if (needsApproval) { toast('Sent to an admin ✓ It is made when they approve the price'); return invoiceDetail(id); }
  await makeInvoicePdf(inv, await approvalFrom(f));
}
// An admin approves an office manager's price below the list (the invoice then takes its number and its PDF is made), or refuses it
async function approvePrice(id) {
  const x = invOf(id);
  if (!x || x.ok !== 'waiting' || !can('edit') || !await unlock('Enter the password to approve the price.')) return;
  let no = x.no;
  if (x.type === 'invoice') {
    try { no = (await callServer(S.link, { op: 'number' })).no; }
    catch (e) { return alert(e.offline ? 'Approving an invoice needs the internet: the Google Sheet gives it its number.' : e.message); }
  }
  const by = myName() || S.lastBy || '', done = { ...x, no, ok: 'approved', okBy: by };
  update({ invoices: S.invoices.map(y => (y.id === id ? done : y)), log: logWith([['Approved', id, `Price on ${no} for ${(clientOf(x.client) || {}).name || ''} (asked by ${x.by})`]], by) });
  const sig = await mySignature();
  await makeInvoicePdf(done, sig ? { sig, name: myName(), date: fmtDate(today()) } : null);
}
async function refusePrice(id) {
  const x = invOf(id);
  if (!x || x.ok !== 'waiting' || !can('edit') || !await unlock('Enter the password to refuse the price.')) return;
  const why = clean(prompt('Why is the price refused? (they see it)', 'Too far below the list price'));
  if (!why) return;
  const by = myName() || S.lastBy || '';
  update({ invoices: S.invoices.map(y => (y.id === id ? { ...y, ok: 'rejected', okBy: by, why } : y)), log: logWith([['Refused', id, `Price on ${x.no}: ${why}`]], by) });
  toast('Refused ✓'); invoiceDetail(id);
}
// the price requests an admin decides on (Changes to approve)
const priceWaits = () => invs().filter(x => x.ok === 'waiting');
function priceCard(x) {
  const k = clientOf(x.client), t = invoiceTotals(x);
  return `<section class="card pad" style="margin-bottom:12px">
    <p style="margin:0 0 6px"><b>${x.type === 'quote' ? 'Quotation' : 'Invoice'} for ${esc(k ? k.name : '—')}: ${money(t.total, x.cur)}</b></p>
    <ul style="margin:0 0 8px;padding-left:20px">${x.items.filter(it => !it.dlv).map(it => { const list = it.m ? listFor(itemOf(it.m), x.cur, x.rate) : 0, off = belowList(it.price, list);
      return `<li>${esc(it.t)}: ${plain(it.qty)} × ${money(it.price, x.cur)} — ${it.m ? `list ${list ? money(list, x.cur) : '?'}${off ? `, <b>${plain(off)} % below</b>` : ''}` : '<b>typed, not from stock</b>'}</li>`; }).join('')}</ul>
    ${x.cur === 'SSP' && x.rate ? `<p class="muted" style="margin:0 0 6px">At ${plain(x.rate)} SSP for 1 USD${S.link && S.link.rate ? ` (the company's newest: ${plain(S.link.rate)})` : ''}.</p>` : ''}
    <p class="muted" style="margin:0 0 10px">Asked by ${esc(x.by)} · ${esc(fmtAbs(String(x.createdAt).slice(0, 16)))}</p>
    <div class="two"><button class="btn in" data-act="approvePrice" data-id="${esc(x.id)}">✓ Approve</button><button class="btn danger" data-act="refusePrice" data-id="${esc(x.id)}">✗ Refuse</button></div></section>`;
}
// the PDF, kept with it (and sent up to Drive), then offered for sending
async function makeInvoicePdf(inv, approval) {
  toast('Making the PDF…');
  try {
    const blob = await renderStatement(invoiceSpec(inv, approval)), k = clientOf(inv.client), name = `${inv.no} ${fileSafe(k ? k.name : '')}.pdf`;
    await keepFile({ for: inv.id, type: inv.type, no: inv.no, name, mime: 'application/pdf', check: inv.check }, await blob.arrayBuffer());
    readySheet(inv.type === 'quote' ? 'QUOTATION' : 'INVOICE', inv.no, blob, name);
  } catch (e) { alert(`The PDF could not be made: ${e.message}\n\nOpen it from the list to try again.`); invoiceDetail(inv.id); }
}
function invoiceSpec(inv, approval) {
  const k = clientOf(inv.client) || {}, t = invoiceTotals(inv), isQ = inv.type === 'quote', b = bankOf(inv.bank);
  return { title: isQ ? 'QUOTATION' : 'INVOICE', no: inv.no, date: fmtDate(inv.date), check: inv.check, stampDate: inv.date.split('-').reverse().join('-'), ref: inv.id,
    info: [[isQ ? 'Quotation for' : 'Bill to', k.name || '—'], [isQ ? 'Valid until' : 'Pay by', inv.due ? fmtDate(inv.due) : '—'], ['Phone', k.phone || '—'], ['Address', k.address || '—'], ...(k.tin ? [['TIN', k.tin]] : [])],
    sections: [{ title: isQ ? 'Quoted' : 'Items', cols: [{ h: 'Description', w: 430, wrap: true }, { h: 'Qty', w: 110, right: true }, { h: 'Unit', w: 110 }, { h: 'Unit price', w: 190, right: true }, { h: 'Amount', w: 220, right: true }],
      rows: inv.items.map(it => [it.t, plain(it.qty), it.unit || '', slipMoney(it.price, inv.cur), slipMoney(lineAmount(it), inv.cur)]) }],
    summary: [...(t.tax ? [['Subtotal', slipMoney(t.sub, inv.cur)], [`Tax ${plain(inv.tax)}%`, slipMoney(t.tax, inv.cur)]] : []), [isQ ? 'Total' : 'Total due', slipMoney(t.total, inv.cur), true]],
    verdict: null,
    notes: [['Amount in words', [amountInWords(t.total, inv.cur)]], ...(inv.dl ? [['Delivery', [inv.dl === 'deliver' ? `Delivered by us${inv.addr ? ` to ${inv.addr}` : ''}, with a delivery note to sign.` : 'Collected by the client from our warehouse, with a delivery note to sign.']]] : []), ...(b ? [['Pay into', bankLines(b).map(([kk, vv]) => (kk ? `${kk}: ${vv}` : vv))]] : []), ...(inv.notes ? [['Notes', inv.notes.split('\n')]] : [])],
    approvals: true, preparedBy: inv.by || '', preparedSign: approval && approval.name === inv.by ? approval : null, approval };
}

/* ---------- one invoice or quotation ---------- */
function invoiceDetail(id) {
  const inv = invOf(id);
  if (!inv) return false;
  const k = clientOf(inv.client), st = invState(inv), t = invoiceTotals(inv), isQ = inv.type === 'quote', made = isQ && madeFrom(id), b = bankOf(inv.bank);
  const pdfFile = filesFor(id).filter(f => f.type === inv.type).pop(), pays = live(S.credits).filter(c => c.invoice === id).sort(byAt);
  const status = inv.cancelled ? `Cancelled on ${fmtAbs(String(inv.cancelled).slice(0, 16))}${inv.cancelledBy ? ` by ${inv.cancelledBy}` : ''}${inv.cancelReason ? ` — ${inv.cancelReason}` : ''}.`
    : isQ ? (made ? `Invoiced as ${made.no}.` : inv.due && inv.due < today() ? `Expired on ${fmtDate(inv.due)}.` : '')
    : !seesPaid() || inv.ok === 'waiting' || inv.ok === 'rejected' ? '' : st.state === 'paid' ? '✅ Paid in full.' : `${INV_STATE[st.state][0]}: ${money(st.due, inv.cur)} still owed${inv.due ? ` · pay by ${fmtDate(inv.due)}` : ''}.`;
  const held = inv.ok === 'waiting' || inv.ok === 'rejected', send = !isQ && sells(inv) ? toSend(inv, S.deliveries) : [], dns = live(S.deliveries).filter(d => d.inv === id);
  openSheet(`${head(`${isQ ? 'Quotation' : 'Invoice'} ${inv.no}`, 'in', k ? k.name : '')}
    <div class="dbig in">${money(t.total, inv.cur)}</div>
    ${status ? `<p class="note">${esc(status)}</p>` : ''}
    ${inv.ok === 'waiting' ? `<p class="note">⏳ A price is lower than ${esc(inv.by || 'its maker')} may give, or a line is not from stock: it waits for an admin. It is numbered and made when they approve.</p>${can('edit') ? priceCard(inv) : ''}` : ''}
    ${inv.ok === 'rejected' ? `<p class="note">✗ The price was refused by ${esc(inv.okBy || 'an admin')}${inv.why ? `: ${esc(inv.why)}` : ''}. Copy it as new with another price.</p>` : ''}
    <div class="two">${held ? '' : pdfFile ? `<button class="btn ghost" data-act="showFile" data-id="${esc(pdfFile.id)}">📄 Open or send</button>` : `<button class="btn ghost" data-act="remakeInvoice" data-id="${esc(id)}">📄 Make the PDF</button>`}
      ${seesPaid() && !isQ && !inv.cancelled && !held && st.due ? `<button class="btn in" data-act="payInvoice" data-id="${esc(id)}">💵 Record payment</button>` : ''}
      ${isQ && !inv.cancelled && !made && !held ? `<button class="btn in" data-act="quoteToInvoice" data-id="${esc(id)}">🧾 Make the invoice</button>` : ''}</div>
    <dl class="facts" style="margin-top:16px">${[['Client', k && k.name], ['Date', fmtDate(inv.date)], [isQ ? 'Valid until' : 'Pay by', inv.due && fmtDate(inv.due)], ['Pay into', b && `${b.bank} · ${b.number}`], ['Project', inv.project && projName(inv.project)], ['Check code', inv.check]]
      .filter(x => x[1]).map(([a, v]) => `<div><dt>${a}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <h3 class="subh">Lines</h3><div class="card list inset">${inv.items.map(it => `<div class="mrow"><span>${esc(it.t)}</span><span class="muted">${plain(it.qty)} ${esc(it.unit || '')} × ${money(it.price, inv.cur)}</span><b>${money(lineAmount(it), inv.cur)}</b></div>`).join('')}</div>
    ${t.tax ? `<p class="muted">${money(t.sub, inv.cur)} + tax ${plain(inv.tax)}% ${money(t.tax, inv.cur)} = ${money(t.total, inv.cur)}</p>` : ''}
    ${!isQ && sells(inv) && inv.items.some(it => it.m) ? `<h3 class="subh">Delivery — ${inv.dl === 'deliver' ? `we deliver${inv.addr ? ` to ${esc(inv.addr)}` : ''}` : 'they collect'}</h3>
      ${send.length ? `<p class="note">Still to send: ${send.map(l => `${plain(l.qty)} ${esc((itemOf(l.m) || {}).name || '')}`).join(', ')}.</p><button class="btn out" data-act="deliveryForm" data-inv="${esc(id)}">🚚 Make a delivery note</button>` : '<p class="muted">Everything has left on a delivery note. ✓</p>'}
      ${dns.length ? `<div class="card list inset" style="margin-top:10px">${dns.map(deliveryRow).join('')}</div>` : ''}` : ''}
    ${isQ || !seesPaid() ? '' : `<h3 class="subh">Payments (${pays.length})</h3>${pays.length ? `<div class="card list inset">${pays.map(x => itemRow(x, 'R', true)).join('')}</div>` : '<p class="muted">Nothing received yet.</p>'}`}
    ${k && k.phone ? `<a class="btn ghost" style="margin-top:14px" href="${esc(waChat(k.phone))}" target="_blank" rel="noopener">💬 WhatsApp chat with ${esc(k.name)}</a>` : ''}
    <div class="two" style="margin-top:10px"><button class="btn ghost" data-act="copyInvoice" data-id="${esc(id)}">📋 Copy as new</button>${can('edit') && !inv.cancelled && !pays.length && !dns.length ? `<button class="btn danger" data-act="cancelInvoice" data-id="${esc(id)}">🚫 Cancel 🔒</button>` : ''}</div>`);
  comeBack(() => invoiceDetail(id));
}
function payInvoice(id) {
  const inv = invOf(id), st = inv && invState(inv), k = inv && clientOf(inv.client);
  if (!st || !st.due) return;
  creditForm(null, inv.project, { cur: inv.cur, amount: st.due, note: `${inv.no} — ${k ? k.name : ''}`, invoice: id, hint: `🧾 Payment for invoice ${inv.no}: ${money(st.due, inv.cur)} still owed. Change the amount if they paid part.` });
}
async function cancelInvoice(id) {
  const inv = invOf(id);
  if (!inv || inv.cancelled || live(S.credits).some(c => c.invoice === id) || !await unlock('Enter the password to cancel it.')) return;
  const why = clean(prompt(`Why is ${inv.no} cancelled? (printed on the stamped copy)`, 'Made by mistake'));
  if (!why) return;
  const by = confirmBy(`Cancel ${inv.no}? It is kept, stamped CANCELLED. Make a copy to send a corrected one.`);
  if (!by) return;
  const at = stampSec();
  update({ invoices: S.invoices.map(x => (x.id === id ? { ...x, cancelled: at, cancelledBy: by, cancelReason: why } : x)), log: logWith([['Cancelled', id, `${inv.no}: ${why}`]], by) });
  const f = filesFor(id).filter(x => x.type === inv.type && !x.cancelled).pop();
  if (f) await patchFile(f, { cancelled: at, cancelledBy: by, cancelReason: why });
  toast('Cancelled ✓ — kept, stamped');
  invoiceDetail(id);
}
async function remakeInvoice(id) {
  const inv = invOf(id), sig = inv && await mySignature();
  if (inv) makeInvoicePdf(inv, sig ? { sig, name: myName(), date: fmtDate(today()) } : null);
}
