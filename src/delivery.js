/* ---------- delivery notes (owner, 2 Nov 2026): every load leaves on one, and comes back signed ---------- */
// Made when the goods leave (for a sale, or goods used on a project's site): what is on the vehicle, who takes it, the vehicle,
// what the client pays for delivery and what it costs us, a photo of the load. Its PDF goes with the driver (printed or on
// WhatsApp). Once there, who received what is added — most drivers have no app: they bring back (or send on WhatsApp) a photo of
// the slip the receiver signed and of the goods delivered; or the receiver signs on the phone. Nothing on the note changes after
// it is made (the sheet allows only its receipt to be added), it can never carry more than was sold, and the receiver signs for
// what arrived — less than was sent shows as SHORT to the admins.
const deliveryOf = id => S.deliveries.find(x => x.id === id && !x.deleted);
const DN_STATE = { out: ['On the way', 'warn'], done: ['Received', ''], short: ['Short', 'bad'] };
const dnState = d => (d.status === 'out' ? 'out' : receivedOf(d).short ? 'short' : 'done');
function deliveryRow(d) {
  const [text, tone] = DN_STATE[dnState(d)];
  return `<button class="row" data-act="openDelivery" data-id="${esc(d.id)}"><span class="dot">🚚</span>
    <span class="main"><span class="t"><span class="tt">${esc(d.no)}</span><i class="tag ${tone}">${text}</i></span><span class="s">${esc([d.to, fmtDate(d.date), d.how === 'collect' ? `collected by ${d.driver || '?'}` : `${d.driver || '?'}${d.vehicle ? ` · ${d.vehicle}` : ''}`].filter(Boolean).join(' · '))}</span></span></button>`;
}
// what the note is for: a sale (its client, address, delivery charge) or goods used on a project (its site)
function deliveryFor({ inv, out }) {
  if (inv) {
    const x = invOf(inv), k = x && clientOf(x.client);
    if (!x) return null;
    const charge = x.items.filter(it => it.dlv).reduce((t, it) => t + lineAmount(it), 0);
    return { inv, title: `${x.no} · ${k ? k.name : ''}`, to: k ? k.name : '', phone: k ? k.phone || '' : '', addr: x.addr || '', how: x.dl === 'collect' ? 'collect' : 'deliver', lines: toSend(x, S.deliveries), charge, cur: x.cur };
  }
  const o = S.stockOut.find(y => y.id === out && !y.deleted);
  return o ? { out, title: `${OUT_KIND[o.kind][0]} · ${o.project ? projName(o.project) : o.to || fmtDate(o.date)}`, to: o.project ? projName(o.project) : o.to || '', addr: '', how: 'deliver', lines: o.lines.map(l => ({ m: l.m, qty: Math.abs(l.qty) })), charge: 0, cur: 'USD' } : null;
}
function deliveryForm(b) {
  const src = deliveryFor({ inv: b.dataset ? b.dataset.inv : b.inv, out: b.dataset ? b.dataset.out : b.out });
  if (!src) return toast('Not found on this phone');
  if (!src.lines.length) return toast('Everything on it has a delivery note already ✓');
  openSheet(`${head('Delivery note', 'out', src.title)}
    <form data-form="delivery" data-inv="${esc(src.inv || '')}" data-out="${esc(src.out || '')}">
      <div class="fld"><span>How does it go?</span><div class="curseg"><label><input type="radio" name="how" value="deliver" ${src.how === 'deliver' ? 'checked' : ''}><span><b>🚚 We deliver</b><small>our driver or a hired truck</small></span></label>
        <label><input type="radio" name="how" value="collect" ${src.how === 'collect' ? 'checked' : ''}><span><b>🙋 They collect</b><small>from the warehouse</small></span></label></div></div>
      <h3 class="subh">What goes <small class="muted">— less if it goes in several loads</small></h3>
      <div class="card pad">${src.lines.map(l => { const m = itemOf(l.m) || { name: l.m, unit: '' }; return `<label class="count-row"><span><b>${esc(m.name)}</b><small class="muted">up to ${plain(l.qty)} ${esc(m.unit)}</small></span><input name="q-${esc(l.m)}" data-max="${l.qty}" inputmode="decimal" value="${plain(l.qty).replace(/,/g, '')}" autocomplete="off" aria-label="How many ${esc(m.name)}"></label>`; }).join('')}</div>
      ${textField('to', 'To', 'Client or site', src.to)}
      ${textField('addr', 'Address / site', 'e.g. Gudele block 3, near the church', src.addr, false)}
      <label class="fld"><span class="who-label">Driver / who takes it</span><input name="driver" required maxlength="80" placeholder="Name" autocomplete="off"></label>
      <div class="two"><label class="fld"><span>Their phone</span><input name="phone" type="tel" maxlength="30" autocomplete="off"></label><label class="fld"><span>Vehicle number</span><input name="vehicle" maxlength="30" placeholder="e.g. SSD 123 A" autocomplete="off"></label></div>
      ${src.charge ? `<p class="note">Delivery charged on the invoice: <b>${money(src.charge, src.cur)}</b>.</p>` : src.inv ? '<p class="muted">No delivery charge on the invoice.</p>' : ''}
      <div class="deliver-only"><div class="two"><label class="fld"><span>What the delivery costs us <em>(optional)</em></span><div class="amt-in"><b class="cur-sym">${SYM[defCur()].trim()}</b><input name="cost" inputmode="decimal" placeholder="0" autocomplete="off"></div><small class="amt-preview"></small></label>
        <label class="fld"><span>In Accounts</span><select name="pay"><option value="">Not in Accounts</option><option value="cash">＋ Add it: paid in cash</option><option value="bank">＋ Add it: paid from the bank</option></select></label></div>
        ${curChips(defCur(), 'Delivery cost in')}${rateField(defCur())}</div>
      <label class="fld"><span>Photo of the loaded goods <em>(optional — on the vehicle, before it leaves)</em></span><input type="file" name="loadphoto" accept="image/*"></label>
      <label class="fld"><span>Leaves on</span><input type="date" name="date" value="${today()}" max="${today()}" required></label>
      ${textField('note', 'Note', '', '', false)}
      <p class="err"></p>
      <button class="btn out">Make the delivery note (PDF)</button>
    </form>`);
  refreshDelivery($('#sheet form'));
}
function refreshDelivery(f) {
  const how = f.elements.how.value;
  $('.deliver-only', f).hidden = how !== 'deliver';
  $('.who-label', f).textContent = how === 'deliver' ? 'Driver / who delivers' : 'Who collects (their name)';
}
async function saveDelivery(f) {
  const v = Object.fromEntries(new FormData(f)), src = deliveryFor({ inv: f.dataset.inv, out: f.dataset.out });
  if (!src) return closeSheet();
  const lines = $$('input[data-max]', f).map(i => ({ m: i.name.slice(2), qty: parseNum(i.value || '0'), max: +i.dataset.max, el: i }));
  const bad = lines.find(l => l.qty === null || l.qty < 0 || l.qty > l.max + 1e-9);
  if (bad) { bad.el.focus(); return formErr(f, null, `Up to ${plain(bad.max)} of each — no more than was sold and is not yet sent.`); }
  const go = lines.filter(l => l.qty > 0);
  if (!go.length) return formErr(f, null, 'Type how many of at least one item go.');
  const driver = clean(v.driver), how = v.how === 'collect' ? 'collect' : 'deliver';
  if (!driver) return formErr(f, 'driver', how === 'deliver' ? 'Who delivers it?' : 'Who collects it?');
  if (!clean(v.to)) return formErr(f, 'to', 'Who or where is it for?');
  if (!DATE_RE.test(v.date) || v.date > today()) return formErr(f, 'date', 'Choose the day it leaves');
  const costCur = formCur(f), costAmt = how === 'deliver' && String(v.cost || '').trim() ? parseAmount(v.cost) : null, rate = costAmt ? rateFrom(f, costCur) : undefined;
  if (how === 'deliver' && String(v.cost || '').trim() && costAmt === null) return formErr(f, 'cost', 'Type what the delivery costs, like 15 — or leave it empty');
  if (costAmt && rate === null) return formErr(f, 'rate', RATE_ERR);
  const by = myName() || S.lastBy || '', [[id], s1] = nextIds('D', 1, S.seq), [[no], seq] = nextIds('DN', 1, s1);
  let pay = '';
  update({ seq });
  if (costAmt && ['cash', 'bank'].includes(v.pay)) {
    const [[eid], s2] = nextIds('E', 1, S.seq);
    update({ expenses: [...S.expenses, { id: eid, cur: costCur, amount: costAmt, ...(rate ? { rate } : {}), paidTo: driver, reason: `Delivery ${no} to ${clean(v.to)}`, location: clean(v.addr), project: '', mode: v.pay === 'bank' ? 'Bank' : 'Cash', at: `${v.date}T12:00`, manualDate: true, dn: id, by, createdAt: stampSec(), batch: null }], seq: s2 });
    pay = eid;
  }
  const d = { id, no, date: v.date, ...(src.inv ? { inv: src.inv } : { out: src.out }), to: clean(v.to), addr: clean(v.addr), how, driver, phone: clean(v.phone), vehicle: clean(v.vehicle).toUpperCase(),
    ...(src.charge ? { charge: src.charge, cur: src.cur } : {}), ...(costAmt ? { cost: costAmt, cur: src.charge ? src.cur : costCur } : {}), ...(pay ? { pay } : {}),
    lines: go.map(l => ({ m: l.m, qty: l.qty })), status: 'out', check: newCheck(), note: clean(v.note), by, createdAt: stampSec() };
  if (d.cost && d.charge && costCur !== src.cur) d.costCur = costCur; // the cost was paid in the other currency (shown as typed)
  update({ deliveries: [...S.deliveries, d], log: logWith([['Delivery', id, `${no} to ${d.to}: ${go.map(l => `${plain(l.qty)} ${(itemOf(l.m) || {}).name || ''}`).join(', ')} · ${how === 'deliver' ? `delivered by ${driver}${d.vehicle ? ` (${d.vehicle})` : ''}` : `collected by ${driver}`}`]], by) });
  const photo = f.elements.loadphoto.files[0];
  if (photo) { try { const p = await prepareFile(photo); await keepFile({ for: id, type: 'photo', name: `${no} loaded.jpg`, mime: p.mime }, p.data); } catch (e) { alert(`The photo: ${e.message}`); } }
  await deliveryPdf(d);
}
function deliverySpec(d) {
  const x = d.inv && invOf(d.inv), o = d.out && S.stockOut.find(y => y.id === d.out), collect = d.how === 'collect';
  return { title: 'DELIVERY NOTE', no: d.no, date: fmtDate(d.date), check: d.check, stampDate: d.date.split('-').reverse().join('-'), ref: d.id,
    info: [[collect ? 'Collected by' : 'Deliver to', collect ? d.driver : d.to], [collect ? 'For' : 'Address', collect ? d.to : d.addr || '—'], [x ? 'Invoice' : 'For', x ? `${x.no} of ${fmtDate(x.date)}` : o && o.project ? projName(o.project) : '—'],
      [collect ? 'Their phone' : 'Driver', collect ? d.phone || '—' : `${d.driver}${d.phone ? ` · ${d.phone}` : ''}`], ...(collect ? [] : [['Vehicle', d.vehicle || '—']])],
    sections: [{ title: 'Goods', cols: [{ h: 'Item', w: 460, wrap: true }, { h: 'Sent', w: 170, right: true }, { h: 'Unit', w: 140 }, { h: 'Received', w: 290 }],
      rows: d.lines.map(l => { const m = itemOf(l.m) || { name: l.m, unit: '' }; return [`${m.name}${m.code ? ` (${m.code})` : ''}`, plain(l.qty), m.unit, '']; }) }],
    summary: [], verdict: null,
    notes: [['Delivery', [collect ? 'Collected from the warehouse by the person named above.' : `Delivered by the company${d.charge ? ` · delivery charged ${slipMoney(d.charge, d.cur)} on the invoice` : ''}.`]],
      ['To the receiver', ['Check every item before you sign. If anything is missing or damaged, write how many you received above, then sign with your name, phone, the date and the time.', 'Receiver\'s name: ____________________   Phone: ______________   Date & time: ______________']],
      ...(d.note ? [['Note', [d.note]]] : [])],
    approvals: true, signLabels: ['Dispatched by', collect ? 'Collected by' : 'Delivered by', 'Received by (signature)'], preparedBy: d.by || '', checkedBy: d.driver };
}
async function deliveryPdf(d) {
  toast('Making the delivery note…');
  try {
    const blob = await renderStatement(deliverySpec(d)), name = `${d.no} ${fileSafe(d.to)}.pdf`;
    await keepFile({ for: d.id, type: 'delivery', no: d.no, name, mime: 'application/pdf', check: d.check }, await blob.arrayBuffer());
    readySheet('DELIVERY NOTE', d.no, blob, name);
  } catch (e) { alert(`The PDF could not be made: ${e.message}\n\nOpen the delivery note to try again.`); deliveryDetail(d.id); }
}
function deliveryDetail(id) {
  const d = deliveryOf(id);
  if (!d) return false;
  const st = dnState(d), [text] = DN_STATE[st], rec = receivedOf(d), x = d.inv && invOf(d.inv), pdf = filesFor(id).filter(f => f.type === 'delivery' && !f.removed).shift();
  openSheet(`${head(`Delivery note ${d.no}`, st === 'short' ? 'out' : 'in', d.to)}
    <p class="note">${st === 'out' ? `🚚 On the way since ${esc(fmtDate(d.date))}. When it arrives: record who received what, with the signed slip.` : st === 'short' ? `⚠️ Received <b>short</b> by ${esc(d.recv.name)} on ${esc(fmtAbs(d.recv.at))}${d.recv.note ? ` — ${esc(d.recv.note)}` : ''}.` : `✅ Received by ${esc(d.recv.name)}${d.recv.phone ? ` (${esc(d.recv.phone)})` : ''} on ${esc(fmtAbs(d.recv.at))}.`}</p>
    <div class="two">${pdf ? `<button class="btn ghost" data-act="showFile" data-id="${esc(pdf.id)}">📄 Open or send the note</button>` : `<button class="btn ghost" data-act="remakeDelivery" data-id="${esc(id)}">📄 Make the PDF</button>`}
      ${st === 'out' && can('staff') ? `<button class="btn in" data-act="receiveDelivery" data-id="${esc(id)}">✍️ Record receipt</button>` : ''}</div>
    <dl class="facts" style="margin-top:16px">${[['Status', text], ['Left on', fmtDate(d.date)], ['For', x ? x.no : d.out ? 'Goods used on a project' : ''], ['To', d.to], ['Address', d.addr], [d.how === 'collect' ? 'Collected by' : 'Delivered by', `${d.driver}${d.phone ? ` · ${d.phone}` : ''}`], ['Vehicle', d.vehicle],
      ['Delivery charged', d.charge ? money(d.charge, d.cur) : ''], ['Delivery cost', d.cost ? money(d.cost, d.costCur || d.cur) : ''], ['Made by', d.by]]
      .filter(f => f[1]).map(([a, v]) => `<div><dt>${a}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${d.recv && d.recv.geo ? `<a class="btn ghost" href="https://maps.google.com/?q=${d.recv.geo.lat},${d.recv.geo.lng}" target="_blank" rel="noopener">📍 Where it was signed (±${Math.round(d.recv.geo.acc)} m)</a>` : ''}
    <h3 class="subh">Goods</h3>
    <div class="card list inset">${rec.lines.map(l => { const m = itemOf(l.m) || { name: l.m, unit: '' }; return `<div class="mrow"><span>${esc(m.name)}</span><span class="muted">sent ${plain(l.sent)} ${esc(m.unit)}</span><b class="${l.got !== null && l.got < l.sent ? 'out-c' : ''}">${l.got === null ? '—' : `got ${plain(l.got)}`}</b></div>`; }).join('')}</div>
    ${x ? `<button class="btn ghost" data-act="openInvoice" data-id="${esc(x.id)}" style="margin-top:12px">🧾 Invoice ${esc(x.no)}</button>` : ''}
    ${filesList(filesFor(id), 'Papers and photos')}
    ${attachButton(id, '📷 Add a photo')}
    ${can('delete') ? `<button class="btn danger" data-act="deleteDelivery" data-id="${esc(id)}" style="margin-top:16px">🗑 Delete 🔒</button>` : ''}`);
  comeBack(() => deliveryDetail(id));
}
async function remakeDelivery(id) { const d = deliveryOf(id); if (d) await deliveryPdf(d); }
async function deleteDelivery(id) {
  const d = deliveryOf(id);
  if (!d || !await unlock('Enter the password to delete a delivery note.')) return;
  const by = confirmBy(`Delete delivery note ${d.no}? The goods on it count as not yet sent. It stays in Drive (folder CHANGES) and in the Change Log.`);
  if (!by) return;
  update({ deliveries: S.deliveries.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Delivery note ${d.no} to ${d.to}`]], by) });
  toast('Deleted ✓'); closeAll(); outList();
}

/* ---------- the receipt: who received what, the signed slip, the goods delivered ---------- */
function receiveDelivery(id) {
  const d = deliveryOf(id);
  if (!d || d.status !== 'out') return;
  openSheet(`${head('Record receipt', 'in', `${d.no} · ${d.to}`)}
    <p class="hint">From the driver's photos (on WhatsApp or brought back), or with the receiver here. The slip's number <b>${esc(d.no)}</b> must show in the photo.</p>
    <form data-form="dnReceipt" data-id="${esc(id)}">
      ${textField('rname', 'Received by', 'The name the receiver wrote', '')}
      <label class="fld"><span>Their phone <em>(optional)</em></span><input name="rphone" type="tel" maxlength="30" autocomplete="off"></label>
      <div class="two"><label class="fld"><span>Received on</span><input type="date" name="rdate" value="${today()}" min="${esc(d.date)}" max="${today()}" required></label><label class="fld"><span>At</span><input type="time" name="rtime" value="${stamp().slice(11, 16)}" required></label></div>
      <h3 class="subh">How many arrived</h3>
      <div class="card pad">${d.lines.map(l => { const m = itemOf(l.m) || { name: l.m, unit: '' }; return `<label class="count-row"><span><b>${esc(m.name)}</b><small class="muted">sent ${plain(l.qty)} ${esc(m.unit)}</small></span><input name="g-${esc(l.m)}" data-sent="${l.qty}" inputmode="decimal" value="${plain(l.qty).replace(/,/g, '')}" autocomplete="off" aria-label="How many ${esc(m.name)} arrived"></label>`; }).join('')}</div>
      <div class="fld"><span>The receiver's signature</span><div class="curseg"><label><input type="radio" name="sigby" value="paper" checked><span><b>📄 On the paper</b><small>a photo of the signed slip</small></span></label><label><input type="radio" name="sigby" value="phone"><span><b>✍️ Here, on this phone</b><small>the receiver is with you</small></span></label></div></div>
      <label class="fld sig-paper"><span>Photo of the signed delivery note</span><input type="file" name="slip" accept="image/*,application/pdf"></label>
      <div class="sig-phone" hidden>${sigField('the receiver')}</div>
      <label class="fld"><span>Photo of the goods ${d.how === 'deliver' ? 'delivered, at the client' : 'collected'} ${d.how === 'deliver' ? '' : '<em>(optional)</em>'}</span><input type="file" name="goods" accept="image/*"></label>
      <button type="button" class="btn small ghost" data-act="addGeo">📍 Add where we are now <small>(only if you are at the site)</small></button><input type="hidden" name="geo"><small class="muted geo-out"></small>
      ${textField('rnote', 'Note', 'e.g. 5 bars bent, left with the client', '', false)}
      <p class="err"></p>
      <button class="btn in">Save the receipt</button>
    </form>`);
  sigPad($('#sheet canvas.sig'));
}
function refreshDnReceipt(f) {
  const phone = f.elements.sigby.value === 'phone';
  $('.sig-paper', f).hidden = phone; $('.sig-phone', f).hidden = !phone;
  if (phone) sigPad($('canvas.sig', f));
}
function addGeo(b) {
  const f = b.closest('form'), out = $('.geo-out', f);
  if (!navigator.geolocation) return (out.textContent = 'This phone cannot give its place.');
  out.textContent = 'Finding where you are…';
  navigator.geolocation.getCurrentPosition(p => { f.elements.geo.value = JSON.stringify({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5, acc: Math.round(p.coords.accuracy) }); out.textContent = `📍 Added (±${Math.round(p.coords.accuracy)} m).`; },
    e => { out.textContent = e.code === 1 ? 'Not allowed on this phone — fine, it is optional.' : 'Could not find it — fine, it is optional.'; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}
async function saveDnReceipt(f) {
  const d = deliveryOf(f.dataset.id), v = Object.fromEntries(new FormData(f));
  if (!d || d.status !== 'out') return closeSheet();
  const name = clean(v.rname), lines = $$('input[data-sent]', f).map(i => ({ m: i.name.slice(2), qty: parseNum(i.value || '0'), sent: +i.dataset.sent, el: i }));
  if (!name) return formErr(f, 'rname', 'Who received it? (the name on the slip)');
  const bad = lines.find(l => l.qty === null || l.qty < 0 || l.qty > l.sent + 1e-9);
  if (bad) { bad.el.focus(); return formErr(f, null, 'How many arrived — from 0 up to what was sent.'); }
  if (!DATE_RE.test(v.rdate) || !/^\d\d:\d\d$/.test(v.rtime) || v.rdate < d.date || v.rdate > today()) return formErr(f, 'rdate', `The day it arrived: from ${fmtDate(d.date)} to today`);
  const onPhone = v.sigby === 'phone', cv = $('canvas.sig', f), slip = f.elements.slip.files[0], goods = f.elements.goods.files[0];
  if (!onPhone && !slip) return formErr(f, 'slip', `Add the photo of the signed delivery note (its number ${d.no} must show).`);
  if (onPhone && !cv.dataset.ink) return formErr(f, null, 'The receiver signs in the box first.');
  if (d.how === 'deliver' && !goods) return formErr(f, 'goods', 'Add the photo of the goods at the client — proof they arrived.');
  const short = lines.some(l => l.qty < l.sent);
  if (short && !clean(v.rnote)) return formErr(f, 'rnote', 'Less arrived than was sent: write what happened.');
  if (short && !confirm(`Less arrived than was sent:\n${lines.filter(l => l.qty < l.sent).map(l => `${(itemOf(l.m) || {}).name}: sent ${plain(l.sent)}, received ${plain(l.qty)}`).join('\n')}\n\nThe admins are told. Save it like this?`)) return;
  let geo = null;
  try { geo = v.geo ? JSON.parse(v.geo) : null; } catch { geo = null; }
  const recv = { name, ...(clean(v.rphone) ? { phone: clean(v.rphone) } : {}), at: `${v.rdate}T${v.rtime}`, lines: lines.map(l => ({ m: l.m, qty: l.qty })), how: onPhone ? 'phone' : 'paper', ...(clean(v.rnote) ? { note: clean(v.rnote) } : {}), ...(geo ? { geo } : {}) };
  const btn = $('button.btn.in', f); btn.disabled = true; $('.err', f).textContent = 'Saving…';
  try {
    // the proof first (it must not be lost if the phone closes): the signed slip's photo, or a PDF signed here; then the goods
    if (onPhone) {
      const done = { ...d, status: 'done', recv };
      const spec = { ...deliverySpec(done), title: 'DELIVERY NOTE — RECEIVED', sections: [{ ...deliverySpec(done).sections[0], rows: d.lines.map(l => { const m = itemOf(l.m) || { name: l.m, unit: '' }, got = recv.lines.find(g => g.m === l.m); return [m.name, plain(l.qty), m.unit, plain(got ? got.qty : 0)]; }) }],
        notes: [['Received', [`By ${name}${recv.phone ? ` (${recv.phone})` : ''} on ${fmtAbs(recv.at)}${geo ? ` · at ${geo.lat}, ${geo.lng} (±${geo.acc} m)` : ''}.`, ...(recv.note ? [recv.note] : [])]]],
        sign: { label: 'Received by', sig: cv, name } };
      const blob = await renderStatement(spec);
      await keepFile({ for: d.id, type: 'delivery', no: d.no, name: `${d.no} received ${fileSafe(name)}.pdf`, mime: 'application/pdf', check: d.check }, await blob.arrayBuffer());
    } else {
      const p = await prepareFile(slip);
      await keepFile({ for: d.id, type: 'delivery', no: d.no, name: `${d.no} signed slip${p.mime === 'application/pdf' ? '.pdf' : '.jpg'}`, mime: p.mime }, p.data);
    }
    if (goods) { const p = await prepareFile(goods); await keepFile({ for: d.id, type: 'photo', name: `${d.no} delivered.jpg`, mime: p.mime }, p.data); }
  } catch (e) { btn.disabled = false; return formErr(f, null, e.message); }
  const by = myName() || S.lastBy || '';
  update({ deliveries: S.deliveries.map(x => (x.id === d.id ? { ...x, status: 'done', recv } : x)),
    log: logWith([['Delivered', d.id, `${d.no} received by ${name} on ${fmtAbs(recv.at)}${short ? ' — SHORT: ' + lines.filter(l => l.qty < l.sent).map(l => `${(itemOf(l.m) || {}).name} ${plain(l.qty)} of ${plain(l.sent)}`).join(', ') : ''}`]], by) });
  toast(short ? 'Saved — short, the admins are told' : 'Received ✓');
  deliveryDetail(d.id);
}
