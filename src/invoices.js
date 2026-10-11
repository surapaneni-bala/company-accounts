/* ---------- invoices and quotations (admins only) ---------- */
// An invoice or a quotation (kind I) goes to a client (kind K). Its lines are quantity × unit price, and tax is a
// percentage typed on it — none until someone types one (the tax line is "built but hidden"). The sheet numbers invoices
// in one unbroken series, so making one needs the internet; quotations are numbered by the phone (QT-…) and work offline.
// Once made it is never edited: a mistake is cancelled (kept, stamped) and a copy made. Payments are Money received
// entries that name it (invoice), so what each client owes is always worked out, never typed (calc.js invoiceState).
const invOf = id => S.invoices.find(x => x.id === id && !x.deleted);
const clientOf = id => S.clients.find(x => x.id === id && !x.deleted);
const invState = inv => invoiceState(inv, S.credits, today());
const INV_STATE = { unpaid: ['Unpaid', 'warn'], part: ['Part paid', 'warn'], overdue: ['Overdue', 'bad'], paid: ['Paid', ''], cancelled: ['Cancelled', 'bad'] };
const madeFrom = id => live(S.invoices).find(x => x.from === id && !x.cancelled); // the invoice made from a quotation
const lineAmount = it => Math.round(it.qty * it.price * 100) / 100;
const plusDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const waChat = phone => `https://wa.me/${String(phone).replace(/\D/g, '')}`;
// what invoices still ask for: all of them, or one client's ({ amount, cur } per invoice, for sumText)
const owedBy = clientId => live(S.invoices).filter(x => x.type === 'invoice' && (!clientId || x.client === clientId)).map(x => ({ cur: x.cur, amount: invState(x).due })).filter(x => x.amount);
function invTag(inv) {
  if (inv.type === 'quote') return inv.cancelled ? '<i class="tag bad">Cancelled</i>' : madeFrom(inv.id) ? '<i class="tag">Invoiced</i>' : inv.due && inv.due < today() ? '<i class="tag">Expired</i>' : '';
  const [text, tone] = INV_STATE[invState(inv).state];
  return `<i class="tag ${tone}">${text}</i>`;
}
function invRow(x) {
  const k = clientOf(x.client), st = invState(x);
  return `<button class="row in" data-act="openInvoice" data-id="${esc(x.id)}"><span class="dot">${x.type === 'quote' ? '📝' : '🧾'}</span>
    <span class="main"><span class="t"><span class="tt">${esc(x.no)}</span>${invTag(x)}</span><span class="s">${esc([k ? k.name : '—', fmtDate(x.date), x.type === 'invoice' && st.due && !x.cancelled ? `${money(st.due, x.cur)} owed` : ''].filter(Boolean).join(' · '))}</span></span>
    <span class="amt">${money(st.total, x.cur)}</span></button>`;
}
const invList = (list, none) => (list.length ? `<div class="card list inset">${list.map(invRow).join('')}</div>` : `<p class="muted">${none}</p>`);

function salesSheet() {
  const all = live(S.invoices).sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
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
  const invs = live(S.invoices).filter(x => x.client === id).sort((a, b) => b.date.localeCompare(a.date)), o = owedBy(id);
  openSheet(`${head(k.name, 'in', id)}
    <p class="note">${o.length ? `Owes <b>${sumText(o)}</b>.` : 'Owes nothing.'}</p>
    <div class="two"><button class="btn in" data-act="newInvoice" data-type="invoice" data-client="${esc(id)}">＋ Invoice</button><button class="btn ghost" data-act="newInvoice" data-type="quote" data-client="${esc(id)}">＋ Quotation</button></div>
    <dl class="facts" style="margin-top:16px">${[['Phone', k.phone], ['Address', k.address], ['TIN', k.tin], ['Note', k.note]].filter(f => f[1]).map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    ${k.phone ? `<a class="btn ghost" href="${esc(waChat(k.phone))}" target="_blank" rel="noopener">💬 WhatsApp chat</a>` : ''}
    <h3 class="subh">Invoices and quotations (${invs.length})</h3>${invList(invs, 'None yet.')}
    <div class="two" style="margin-top:16px"><button class="btn ghost" data-act="editClient" data-id="${esc(id)}">✏️ Edit</button>${invs.length ? '' : `<button class="btn danger" data-act="delClient" data-id="${esc(id)}">🗑 Delete 🔒</button>`}</div>`);
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
  if (!k || live(S.invoices).some(x => x.client === id) || !await unlock('Enter the password to delete this client.')) return;
  const by = confirmBy(`Delete the client "${k.name}"?`);
  if (!by) return;
  update({ clients: S.clients.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Client: ${k.name}`]], by) });
  toast('Deleted ✓'); closeAll(); clientsSheet();
}

/* ---------- making one ---------- */
const lineRow = (it = {}) => `<div class="iline"><input name="t" placeholder="What — e.g. Cement 42.5, 50 kg bags" value="${esc(it.t)}" maxlength="200" autocomplete="off" aria-label="Description">
  <div class="iline-n"><input name="qty" inputmode="decimal" placeholder="Qty" value="${esc(it.qty ?? '')}" autocomplete="off" aria-label="Quantity"><input name="unit" placeholder="Unit" value="${esc(it.unit)}" maxlength="20" autocomplete="off" aria-label="Unit, e.g. bags">
  <input name="price" inputmode="decimal" placeholder="Unit price" value="${esc(it.price ?? '')}" autocomplete="off" aria-label="Unit price"><button type="button" class="x" data-act="delLine" aria-label="Remove line">×</button></div></div>`;
// src: a quotation to invoice, or an earlier one to copy; client: made from a client's page
function invoiceForm(type, src, client) {
  const last = live(S.invoices).filter(x => x.type === type).pop() || {}, ks = live(S.clients).sort((a, b) => a.name.localeCompare(b.name));
  const d = src ? { ...src } : { client: client || '', cur: defCur(), items: [{}], tax: last.tax || 0, notes: last.notes || '', bank: last.bank || '', project: '' };
  const fromQuote = src && src.type === 'quote' && type === 'invoice';
  openSheet(`${head(type === 'quote' ? 'New quotation' : 'New invoice', 'in')}
    ${fromQuote ? `<p class="note">From quotation ${esc(src.no)}. Check the lines, then make the invoice.</p>` : ''}
    <form data-form="invoice" data-type="${type}" data-from="${esc(fromQuote ? src.id : '')}">
      <label class="fld"><span>Client</span><select name="client">${ks.map(k => `<option value="${esc(k.id)}" ${k.id === d.client ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}<option value="__new" ${ks.length ? '' : 'selected'}>＋ New client…</option></select></label>
      <div class="newk" ${ks.length ? 'hidden' : ''}>${textField('kname', 'New client’s name', 'Company or person', '', false)}<label class="fld"><span>Their phone (WhatsApp) <em>(optional)</em></span><input name="kphone" type="tel" maxlength="30" autocomplete="off"></label></div>
      <label class="fld"><span>Date</span><input type="date" name="date" value="${today()}" required></label>
      <label class="fld"><span>${type === 'quote' ? 'Valid until' : 'Pay by'}</span><input type="date" name="due" value="${plusDays(today(), type === 'quote' ? 30 : 14)}"></label>
      ${curChips(d.cur)}
      <div class="fld"><span>Lines</span><div class="ilines">${(d.items.length ? d.items : [{}]).map(lineRow).join('')}</div><button type="button" class="btn small ghost" data-act="addLine">＋ Add a line</button></div>
      <label class="fld"><span>Tax % <em>(optional — empty for none)</em></span><input name="tax" inputmode="decimal" value="${d.tax || ''}" placeholder="e.g. 18" autocomplete="off"></label>
      <p class="note itotal"></p>
      <label class="fld"><span>Pay into <em>(printed on it)</em></span><select name="bank"><option value="">— no bank details —</option>${bankList().map(b => `<option value="${esc(b.id)}" ${b.id === d.bank ? 'selected' : ''}>${esc(`${b.bank} · ${b.cur} · ${b.number}`)}</option>`).join('')}</select></label>
      ${projectSelect(d.project || '', true)}
      <label class="fld"><span>Notes and terms <em>(optional)</em></span><textarea class="plain" name="notes" rows="3" maxlength="600" placeholder="e.g. Delivery to site included.">${esc(d.notes)}</textarea></label>
      ${mySigField()}
      <p class="err"></p>
      <button class="btn in">Make the ${type === 'quote' ? 'quotation' : 'invoice'} (PDF)</button>
    </form>`);
  refreshInvoice($('#sheet form'));
  showMySigField();
}
// the lines typed, and which one is not complete; empty lines are skipped
function invoiceLines(f) {
  const rows = $$('.iline', f).map(el => ({ t: clean($('[name=t]', el).value), q: $('[name=qty]', el).value.trim(), unit: clean($('[name=unit]', el).value), p: $('[name=price]', el).value.trim(), el }))
    .filter(r => r.t || r.q || r.p);
  const items = rows.map(r => ({ t: r.t, qty: parseAmount(r.q), unit: r.unit, price: parseAmount(r.p) }));
  const bad = rows.find((r, i) => !items[i].t || items[i].qty === null || items[i].price === null);
  return { items, bad };
}
function refreshInvoice(f) {
  const { items } = invoiceLines(f), ok = items.filter(it => it.t && it.qty && it.price), tax = parseAmount(f.elements.tax.value) || 0, cur = formCur(f);
  const t = invoiceTotals({ items: ok, tax });
  $('.itotal', f).innerHTML = ok.length ? `${ok.length} line${ok.length === 1 ? '' : 's'} · ${tax ? `${money(t.sub, cur)} + tax ${plain(tax)}% ${money(t.tax, cur)} = ` : ''}<b>${money(t.total, cur)}</b>` : 'Type each line: what, quantity, unit price.';
  $('.newk', f).hidden = f.elements.client.value !== '__new';
}
async function saveInvoice(f) {
  const type = f.dataset.type, v = Object.fromEntries(new FormData(f)), cur = formCur(f), { items, bad } = invoiceLines(f);
  const tax = v.tax.trim() ? parseAmount(v.tax) : 0, newName = clean(v.kname);
  if (v.client === '__new' ? !newName : !clientOf(v.client)) return formErr(f, v.client === '__new' ? 'kname' : 'client', 'Who is it for?');
  if (!items.length) return formErr(f, null, 'Add at least one line: what, quantity and unit price.');
  if (bad) { $('[name=t]', bad.el).focus(); return formErr(f, null, 'Each line needs what it is, a quantity and a unit price.'); }
  if (tax === null || tax > 100) return formErr(f, 'tax', 'Type the tax as a percentage, like 18 — or leave it empty');
  if (!DATE_RE.test(v.date)) return formErr(f, 'date', 'Choose the date');
  if (v.due && v.due < v.date) return formErr(f, 'due', 'It cannot be due before its date');
  let no;
  $('.err', f).textContent = 'Making it…';
  if (type === 'invoice') { // the next number in the company's one series, from the sheet
    if (!S.link) return formErr(f, null, 'Invoices are numbered by the Google Sheet. Connect this phone to it first.');
    try { no = (await callServer(S.link, { op: 'number' })).no; }
    catch (e) { return formErr(f, null, e.offline ? 'Making an invoice needs the internet: the Google Sheet gives it the next number, so numbers never repeat or skip.' : e.message); }
  } else { const [[q], seq] = nextIds('QT', 1, S.seq); update({ seq }); no = q; }
  const client = v.client === '__new' ? newClient({ name: newName, phone: clean(v.kphone), address: '', tin: '', note: '' }) : v.client;
  const by = myName() || S.lastBy || '', [[id], seq] = nextIds('I', 1, S.seq);
  const inv = { id, type, no, client, date: v.date, due: v.due || '', cur, items, tax: tax || 0, bank: bankOf(v.bank) ? v.bank : '', project: v.project || '', notes: String(v.notes || '').trim().slice(0, 600),
    ...(f.dataset.from ? { from: f.dataset.from } : {}), check: newCheck(), by, createdAt: stampSec() };
  update({ invoices: [...S.invoices, inv], seq, log: logWith([['Made', id, `${type === 'quote' ? 'Quotation' : 'Invoice'} ${no} for ${clientOf(client).name}: ${money(invoiceTotals(inv).total, cur)}`]], by) });
  await makeInvoicePdf(inv, await approvalFrom(f));
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
    notes: [['Amount in words', [amountInWords(t.total, inv.cur)]], ...(b ? [['Pay into', bankLines(b).map(([kk, vv]) => (kk ? `${kk}: ${vv}` : vv))]] : []), ...(inv.notes ? [['Notes', inv.notes.split('\n')]] : [])],
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
    : st.state === 'paid' ? '✅ Paid in full.' : `${INV_STATE[st.state][0]}: ${money(st.due, inv.cur)} still owed${inv.due ? ` · pay by ${fmtDate(inv.due)}` : ''}.`;
  openSheet(`${head(`${isQ ? 'Quotation' : 'Invoice'} ${inv.no}`, 'in', k ? k.name : '')}
    <div class="dbig in">${money(t.total, inv.cur)}</div>
    ${status ? `<p class="note">${esc(status)}</p>` : ''}
    <div class="two">${pdfFile ? `<button class="btn ghost" data-act="showFile" data-id="${esc(pdfFile.id)}">📄 Open or send</button>` : `<button class="btn ghost" data-act="remakeInvoice" data-id="${esc(id)}">📄 Make the PDF</button>`}
      ${!isQ && !inv.cancelled && st.due ? `<button class="btn in" data-act="payInvoice" data-id="${esc(id)}">💵 Record payment</button>` : ''}
      ${isQ && !inv.cancelled && !made ? `<button class="btn in" data-act="quoteToInvoice" data-id="${esc(id)}">🧾 Make the invoice</button>` : ''}</div>
    <dl class="facts" style="margin-top:16px">${[['Client', k && k.name], ['Date', fmtDate(inv.date)], [isQ ? 'Valid until' : 'Pay by', inv.due && fmtDate(inv.due)], ['Pay into', b && `${b.bank} · ${b.number}`], ['Project', inv.project && projName(inv.project)], ['Check code', inv.check]]
      .filter(x => x[1]).map(([a, v]) => `<div><dt>${a}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <h3 class="subh">Lines</h3><div class="card list inset">${inv.items.map(it => `<div class="mrow"><span>${esc(it.t)}</span><span class="muted">${plain(it.qty)} ${esc(it.unit || '')} × ${money(it.price, inv.cur)}</span><b>${money(lineAmount(it), inv.cur)}</b></div>`).join('')}</div>
    ${t.tax ? `<p class="muted">${money(t.sub, inv.cur)} + tax ${plain(inv.tax)}% ${money(t.tax, inv.cur)} = ${money(t.total, inv.cur)}</p>` : ''}
    ${isQ ? '' : `<h3 class="subh">Payments (${pays.length})</h3>${pays.length ? `<div class="card list inset">${pays.map(x => itemRow(x, 'R', true)).join('')}</div>` : '<p class="muted">Nothing received yet.</p>'}`}
    ${k && k.phone ? `<a class="btn ghost" style="margin-top:14px" href="${esc(waChat(k.phone))}" target="_blank" rel="noopener">💬 WhatsApp chat with ${esc(k.name)}</a>` : ''}
    <div class="two" style="margin-top:10px"><button class="btn ghost" data-act="copyInvoice" data-id="${esc(id)}">📋 Copy as new</button>${!inv.cancelled && !pays.length ? `<button class="btn danger" data-act="cancelInvoice" data-id="${esc(id)}">🚫 Cancel 🔒</button>` : ''}</div>`);
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
