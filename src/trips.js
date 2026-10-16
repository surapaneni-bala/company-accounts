/* ---------- buying trips: who went where and when, its list, what it cost (admins only) ---------- */
// A trip (kind J) is who travelled, where, the day they left and came back, and why. Items go on its list from the buying
// list (those to buy where it goes are offered first); its list goes as a PDF or a WhatsApp message. Payments name it (trip)
// — flights, visas, hotels, local transport, and what was paid for the goods — so its report shows what was ordered, the
// quotes collected, what is still to buy and what the trip cost (buypdf.js). Owner, 16 Oct 2026.
const tripName = j => `${j.to} · ${fmtDate(j.out)}`;
const tripItems = id => live(S.needs).filter(n => n.trip === id || (n.order && n.order.trip === id));
const tripCosts = id => live(S.expenses).filter(e => e.trip === id).sort(byAt);
const tripDays = j => (j.back ? `${fmtDate(j.out)} – ${fmtDate(j.back)}` : `from ${fmtDate(j.out)}`);
// on a payment's form (admins, once there are trips): the buying trip it was for
function tripSelect(cur) {
  if (!can('settings')) return '';
  const js = live(S.trips).sort((a, b) => b.out.localeCompare(a.out)).slice(0, 12);
  if (cur && tripOf(cur) && !js.some(j => j.id === cur)) js.push(tripOf(cur));
  return js.length ? `<label class="fld"><span>Trip <em>(optional — a buying trip it was for)</em></span><select name="trip"><option value="">— no trip —</option>${js.map(j => `<option value="${esc(j.id)}" ${j.id === cur ? 'selected' : ''}>${esc(tripName(j))}</option>`).join('')}</select></label>` : '';
}
function tripsSheet() {
  const js = live(S.trips).sort((a, b) => b.out.localeCompare(a.out)), now = today();
  const row = j => { const items = tripItems(j.id), open = items.filter(n => ['idea', 'tobuy'].includes(n.status)).length, on = j.out <= now && (!j.back || j.back >= now);
    return `<button class="row" data-act="openTrip" data-id="${esc(j.id)}"><span class="dot">✈️</span><span class="main"><span class="t"><span class="tt">${esc(j.to)}</span>${on ? '<i class="tag warn">Travelling</i>' : j.out > now ? '<i class="tag">Coming</i>' : ''}</span>
      <span class="s">${esc([tripDays(j), j.who.join(', '), items.length && `${items.length} items${open ? `, ${open} to buy` : ''}`].filter(Boolean).join(' · '))}</span></span></button>`; };
  openSheet(`${head('Trips', 'out')}
    <button class="btn out" data-act="addTrip">＋ Plan a trip</button>
    ${js.length ? `<div class="card list inset" style="margin-top:14px">${js.map(row).join('')}</div>` : `<div style="height:14px"></div>${empty('No trips yet', 'Plan one: who goes, where and when. Then put the items to buy on its list.')}`}`);
  comeBack(tripsSheet);
}
function tripForm(old) {
  const d = old || { who: [myName()].filter(Boolean), out: today(), country: '' };
  const names = [...new Set([...live(S.trips).flatMap(j => j.who), myName()].filter(Boolean))];
  openSheet(`${head(old ? 'Edit trip' : 'Plan a trip', 'out', old?.id)}
    <form data-form="trip" data-id="${esc(old?.id || '')}">
      ${textField('to', 'Where to', 'e.g. Guangzhou & Foshan', d.to)}
      <label class="fld"><span>Country</span><input name="country" value="${esc(d.country)}" list="dl-where" maxlength="40" autocomplete="off" placeholder="e.g. China"></label>${listFrom('dl-where', [...WHERES, ...live(S.trips).map(j => j.country)])}
      <label class="fld"><span>Who travels <em>(names, with commas)</em></span><input name="who" value="${esc(d.who.join(', '))}" list="dl-who" maxlength="200" autocomplete="off" required></label>${listFrom('dl-who', names)}
      <div class="two"><label class="fld"><span>Leaves on</span><input type="date" name="out" value="${esc(d.out)}" required></label><label class="fld"><span>Back on <em>(optional)</em></span><input type="date" name="back" value="${esc(d.back || '')}"></label></div>
      ${textField('purpose', 'Why', 'e.g. Furniture and lights for the villa; Canton Fair', d.purpose, false)}
      <label class="fld"><span>Notes <em>(optional — flights, hotel, agent, meetings)</em></span><textarea class="plain" name="note" rows="3" maxlength="1000">${esc(d.note)}</textarea></label>
      <p class="err"></p>
      <button class="btn out">${old ? 'Save changes' : 'Save the trip'}</button>
    </form>`);
}
const TRIP_LABELS = { to: 'Where to', country: 'Country', who: 'Who', out: 'Leaves on', back: 'Back on', purpose: 'Why', note: 'Notes' };
function saveTrip(f) {
  const v = Object.fromEntries(new FormData(f)), old = tripOf(f.dataset.id);
  const rec = { to: clean(v.to), country: clean(v.country), who: tagsFrom(v.who), out: v.out, back: v.back || '', purpose: clean(v.purpose), note: String(v.note || '').trim().slice(0, 1000) };
  if (!rec.to) return formErr(f, 'to', 'Where to?');
  if (!rec.who.length) return formErr(f, 'who', 'Who travels?');
  if (!DATE_RE.test(rec.out)) return formErr(f, 'out', 'Choose the day they leave');
  if (rec.back && rec.back < rec.out) return formErr(f, 'back', 'They come back after they leave');
  const by = myName() || S.lastBy || '';
  if (!old) {
    const [[id], seq] = nextIds('J', 1, S.seq);
    update({ trips: [...S.trips, { id, ...rec, by, createdAt: stampSec() }], seq, log: logWith([['Added', id, `Trip: ${rec.to}, ${tripDays(rec)} (${rec.who.join(', ')})`]], by) });
    toast('Trip saved ✓');
    return tripDetail(id);
  }
  const changes = changedOf(old, rec, TRIP_LABELS);
  if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
  update({ trips: S.trips.map(j => (j.id === old.id ? { ...j, ...rec, editedAt: stampSec(), editedBy: by } : j)), log: logWith([['Edited', old.id, `Trip ${rec.to}: ${changes.join(', ')} changed`]], by) });
  toast('Changes saved ✓');
  tripDetail(old.id);
}
function tripDetail(id) {
  const j = tripOf(id);
  if (!j) return false;
  const items = tripItems(id), open = items.filter(n => ['idea', 'tobuy'].includes(n.status)), done = items.filter(n => !open.includes(n)), costs = tripCosts(id);
  const sups = [...new Set(items.filter(n => n.order).map(n => n.order.sup))].map(supOf).filter(Boolean);
  openSheet(`${head(j.to, 'out', tripDays(j))}
    ${facts([['Who', j.who.join(', ')], ['Country', j.country], ['Why', j.purpose]])}
    ${j.note ? `<p class="pre">${esc(j.note)}</p>` : ''}
    <div class="two"><button class="btn ghost" data-act="tripPdf" data-id="${esc(id)}">📄 Buying list PDF</button><button class="btn ghost" data-act="tripText" data-id="${esc(id)}">💬 List on WhatsApp</button></div>
    <h3 class="subh">To buy on this trip (${open.length})</h3>
    ${open.length ? needGroups(open).map(([c, l]) => `<details class="buy-cat" open><summary>${esc(c)} <small>${l.length}</small></summary><div class="card list inset">${l.map(needRow).join('')}</div></details>`).join('') : '<p class="muted">Nothing yet.</p>'}
    <button class="btn ghost" data-act="pickForTrip" data-id="${esc(id)}" style="margin-top:10px">＋ Put items from the buying list on it</button>
    ${done.length ? `<h3 class="subh">Ordered on this trip (${done.length})</h3><div class="card list inset">${done.map(needRow).join('')}</div>` : ''}
    ${sups.length ? `<h3 class="subh">Factories to inspect</h3><div class="card list inset">${sups.map(u => `<button class="row" data-act="inspect" data-id="${esc(u.id)}"><span class="dot">🔍</span><span class="main"><span class="t"><span class="tt">${esc(u.name)}</span></span><span class="s">${toInspect(u.id).length} items</span></span></button>`).join('')}</div>` : ''}
    <h3 class="subh">What the trip cost (${costs.length})</h3>
    ${costs.length ? `<p class="note">${sumText(costs)}</p><div class="card list inset">${costs.map(x => itemRow(x, 'E', true)).join('')}</div>` : '<p class="muted">Flights, visas, hotels, transport: link them here, or choose this trip when you add a payment.</p>'}
    <button class="btn ghost" data-act="linkTripCosts" data-id="${esc(id)}" style="margin-top:10px">🔗 Link payments to this trip</button>
    <button class="btn out" data-act="tripReport" data-id="${esc(id)}" style="margin-top:16px">📄 Trip report (PDF)</button>
    ${photoStrip(id)}${filesList(filesFor(id).filter(f => !isPic(f)), 'Files')}
    <div class="two" style="margin-top:10px">${attachButton(id, '📷 Add a photo', 'attachment', 'image/*')}${attachButton(id, '📎 Tickets, visa (PDF)', 'attachment', 'application/pdf')}</div>
    <div class="two" style="margin-top:18px"><button class="btn ghost" data-act="editTrip" data-id="${esc(id)}">✏️ Edit</button>${items.length || costs.length ? '' : `<button class="btn danger" data-act="delTrip" data-id="${esc(id)}">🗑 Delete 🔒</button>`}</div>`);
  paintThumbs();
  comeBack(() => tripDetail(id));
}
async function deleteTrip(id) {
  const j = tripOf(id);
  if (!j || tripItems(id).length || tripCosts(id).length || !await unlock('Enter the password to delete this trip.')) return;
  const by = confirmBy(`Delete the trip to ${j.to} (${tripDays(j)})?`);
  if (!by) return;
  update({ trips: S.trips.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Trip: ${j.to}`]], by) });
  toast('Deleted ✓'); closeAll(); tripsSheet();
}
// a picker: open items not on another trip; those to buy where the trip goes are ticked
function pickForTrip(id) {
  const j = tripOf(id);
  if (!j) return;
  const here = [j.country, j.to].filter(Boolean).map(s => s.toLowerCase()), match = n => !n.where || n.where === 'Anywhere' || here.some(h => h.includes(n.where.toLowerCase()) || n.where.toLowerCase().includes(h));
  const list = live(S.needs).filter(n => ['idea', 'tobuy'].includes(n.status) && n.trip !== id && !(n.trip && tripOf(n.trip) && (tripOf(n.trip).back || tripOf(n.trip).out) >= today()));
  openSheet(`${head('Put items on the trip', 'out', j.to)}
    ${list.length ? `<form data-form="tripPick" data-id="${esc(id)}">
      <p class="hint">Ticked: to buy in ${esc(j.country || j.to)} or anywhere. Tick or untick, then save.</p>
      ${needGroups(list).map(([c, l]) => `<h3 class="subh">${esc(c)}</h3><div class="card pad">${l.map(n => `<label class="fld check"><input type="checkbox" name="n" value="${esc(n.id)}" ${match(n) ? 'checked' : ''}> ${esc(n.t)}<small class="muted">${esc(needLine(n))}</small></label>`).join('')}</div>`).join('')}
      <p class="err"></p><button class="btn out">Put them on the list</button></form>` : empty('Nothing to add', 'Every open item is already on a trip. Add new ones in Buying.')}`);
}
function saveTripPick(f) {
  const id = f.dataset.id, ids = new Set($$('input[name=n]:checked', f).map(i => i.value)), by = myName() || S.lastBy || '';
  if (!ids.size) return formErr(f, null, 'Tick at least one item.');
  update({ needs: S.needs.map(n => (ids.has(n.id) ? { ...n, trip: id, editedAt: stampSec(), editedBy: by } : n)), log: logWith([['Edited', id, `Trip ${tripOf(id).to}: ${ids.size} items put on its list`]], by) });
  toast(`${ids.size} on the list ✓`);
  tripDetail(id);
}
// payments around the trip's days (a week either side) that name no trip yet: tick the ones it cost
function linkTripCosts(id) {
  const j = tripOf(id);
  if (!j) return;
  const from = plusDays(j.out, -21), to = plusDays(j.back || j.out, 14);
  const list = live(S.expenses).filter(e => !e.trip && !e.worker && e.at.slice(0, 10) >= from && e.at.slice(0, 10) <= to).sort((a, b) => byAt(b, a));
  openSheet(`${head('Link payments to the trip', 'out', j.to)}
    ${list.length ? `<form data-form="tripCosts" data-id="${esc(id)}">
      <p class="hint">Payments from three weeks before it left to two weeks after it came back. Tick what the trip cost: tickets, visas, hotels, transport, the goods.</p>
      <div class="card pad">${list.map(e => `<label class="fld check"><input type="checkbox" name="e" value="${esc(e.id)}"> ${esc(money(e.amount, e.cur))} · ${esc(e.reason)}<small class="muted">${esc([fmtDate(e.at.slice(0, 10)), e.paidTo].join(' · '))}</small></label>`).join('')}</div>
      <p class="err"></p><button class="btn out">Link them</button></form>` : empty('No payments around those days', 'Add them in Accounts and choose this trip.')}`);
}
function saveTripCosts(f) {
  const id = f.dataset.id, ids = new Set($$('input[name=e]:checked', f).map(i => i.value)), by = myName() || S.lastBy || '';
  if (!ids.size) return formErr(f, null, 'Tick at least one payment.');
  update({ expenses: S.expenses.map(e => (ids.has(e.id) ? { ...e, trip: id, editedAt: stampSec(), editedBy: by } : e)), log: logWith([...ids].map(e => ['Edited', e, `Trip: ${tripOf(id).to}`]), by), lastBy: by });
  toast(`${ids.size} linked ✓`);
  tripDetail(id);
}
// the trip's list as a message: grouped by category, every detail under each item
function tripText(id) {
  const j = tripOf(id), open = j ? tripItems(id).filter(n => ['idea', 'tobuy'].includes(n.status)) : [];
  if (!j) return '';
  return `✈️ Buying list — ${j.to}, ${tripDays(j)}\n${needGroups(open).map(([c, l]) => `\n${c.toUpperCase()}\n${l.map(n => `☐ ${n.t}${n.qty ? ` — ${qtyText(n)}` : ''}${[n.project && projName(n.project), n.area].filter(Boolean).length ? ` (${[n.project && projName(n.project), n.area].filter(Boolean).join(', ')})` : ''}${(n.specs || []).length ? `\n   ${n.specs.map(([k, v]) => `${k}: ${v}`).join(' · ')}` : ''}${n.target ? `\n   Target ${cost(n.target, n.cur || 'USD')} each` : ''}`).join('\n')}`).join('\n')}`;
}
function tripTextSheet(id) {
  const text = tripText(id);
  if (!text) return;
  openSheet(`${head('The list as a message', 'out')}
    <textarea class="plain" rows="14" readonly>${esc(text)}</textarea>
    ${shareButtons(text, 'copyText', '')}`);
  $$('#sheet [data-act=copyText]').forEach(b => { b.dataset.text = text; });
}
async function copyText(btn) {
  const text = btn.dataset.text || '';
  if (btn.dataset.share) return navigator.share({ text }).catch(() => {});
  try { await navigator.clipboard.writeText(text); toast('Copied ✓'); } catch { prompt('Copy it:', text); }
}
