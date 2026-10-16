/* ---------- buying PDFs: the list, a factory's inspection checklist and report, a trip's report ---------- */
// All drawn by renderStatement (files.js) on the letterhead: a section per category or per item. The inspection checklist
// has every detail of each item and the usual checks as lines with an OK and a Not OK box — empty to print and tick at the
// factory, or ticked from what was saved on the phone — with the item's photos to compare against.
const BUY_COLS = [{ h: 'Item', w: 300, wrap: true }, { h: 'Details', w: 340, wrap: true }, { h: 'Qty', w: 110, right: true }, { h: 'For', w: 170, wrap: true }, { h: 'Status', w: 140, wrap: true }];
const buyRow = n => [n.sub ? `${n.t} (${n.sub})` : n.t, [...(n.specs || []).map(([k, v]) => `${k}: ${v}`), n.notes].filter(Boolean).join('; '), qtyText(n), [n.project && projName(n.project), n.area].filter(Boolean).join(' · '), BUY_STATE[n.status][1]];
const pdfName = (title, words) => `${title} ${fileSafe(words)} ${today()}.pdf`;
async function buyListPdf() {
  const list = live(S.needs).filter(buyMatches);
  await shareStatement({ title: 'BUYING LIST', no: statementNo(), date: fmtDate(today()), ref: '',
    info: [['List', BUY_VIEWS[buyView.view][0]], ['Project', buyView.project ? projName(buyView.project) : 'All'], ['Items', String(list.length)], ['Search', buyView.q || '—']],
    sections: needGroups(list).map(([c, l]) => ({ title: c, cols: BUY_COLS, rows: l.map(buyRow) })), summary: [['Items', String(list.length), true]], verdict: null }, pdfName('Buying list', BUY_VIEWS[buyView.view][0]));
}
async function tripPdf(id) {
  const j = tripOf(id), open = j ? tripItems(id).filter(n => ['idea', 'tobuy'].includes(n.status)) : [];
  if (!j) return;
  await shareStatement({ title: 'TRIP BUYING LIST', no: statementNo(), date: fmtDate(today()), ref: id, info: tripInfo(j),
    sections: needGroups(open).map(([c, l]) => ({ title: c, cols: [...BUY_COLS.slice(0, 4), { h: 'Target', w: 140, right: true }], rows: l.map(n => [...buyRow(n).slice(0, 4), n.target ? cost(n.target, n.cur || 'USD') : '']) })),
    summary: [['Items to buy', String(open.length), true]], verdict: null }, pdfName('Trip list', j.to));
}
const tripInfo = j => [['Where to', j.to], ['When', tripDays(j)], ['Who', j.who.join(', ')], ['Why', j.purpose || '—']];
// totals per currency, for prices in any currency
const costSum = rows => Object.entries(rows.reduce((t, [cur, n]) => ({ ...t, [cur]: (t[cur] || 0) + Math.round(n * 100) }), {})).map(([cur, c]) => cost(c / 100, cur));
async function tripReport(id) {
  const j = tripOf(id);
  if (!j) return;
  const items = tripItems(id), ordered = items.filter(n => n.order), open = items.filter(n => ['idea', 'tobuy'].includes(n.status)), costs = tripCosts(id);
  const seen = new Set(), quotes = items.flatMap(n => (n.quotes || []).filter(q => (q.trip === id || !q.trip) && !seen.has(q.id) && seen.add(q.id)).map(q => [n, q])); // the rest of a part-ordered item carries the same quotes
  const goods = costSum(ordered.map(n => [n.order.cur, needTotal(n)]));
  await shareStatement({ title: 'TRIP REPORT', no: statementNo(), date: fmtDate(today()), ref: id, info: tripInfo(j),
    sections: [
      { title: `Ordered (${ordered.length})`, cols: [{ h: 'Item', w: 330, wrap: true }, { h: 'From', w: 220, wrap: true }, { h: 'Qty', w: 110, right: true }, { h: 'Unit price', w: 180, right: true }, { h: 'Total', w: 220, right: true }],
        rows: ordered.map(n => [n.t, (supOf(n.order.sup) || {}).name || '', `${plain(n.order.qty)} ${n.unit || ''}`.trim(), cost(n.order.price, n.order.cur), cost(needTotal(n), n.order.cur)]) },
      ...(quotes.length ? [{ title: `Quotes collected (${quotes.length})`, cols: [{ h: 'Item', w: 330, wrap: true }, { h: 'Supplier', w: 240, wrap: true }, { h: 'Price', w: 170, right: true }, { h: 'Minimum', w: 140 }, { h: 'Ready in', w: 180 }],
        rows: quotes.map(([n, q]) => [n.t, (supOf(q.sup) || {}).name || '', cost(q.price, q.cur), q.moq || '', q.lead || '']) }] : []),
      ...(open.length ? [{ title: `Still to buy (${open.length})`, cols: [{ h: 'Item', w: 420, wrap: true }, { h: 'Qty', w: 140, right: true }, { h: 'Details', w: 500, wrap: true }], rows: open.map(n => [n.t, qtyText(n), (n.specs || []).map(([k, v]) => `${k}: ${v}`).join('; ')]) }] : []),
      { title: `What the trip cost (${costs.length})`, cols: [{ h: 'Date', w: 160 }, { h: 'Paid to', w: 260, wrap: true }, { h: 'For', w: 400, wrap: true }, { h: 'Amount', w: 240, right: true }],
        rows: costs.map(e => [fmtDate(e.at.slice(0, 10)), e.paidTo, e.reason, slipMoney(e.amount, e.cur)]) }],
    summary: [...goods.map(g => ['Goods ordered', g]), ...sumByCur(costs).map(c => ['Trip payments', c, true])], verdict: null,
    notes: j.note ? [['Notes', j.note.split('\n')]] : null }, pdfName('Trip report', j.to));
}
// A factory's inspection: blank (to print and tick) or with the results ticked on the phone (saved, or still on the screen)
async function inspPdf(supId, blank) {
  const u = supOf(supId), items = toInspect(supId).filter(n => blank || inspTouched(inspOf(n)));
  if (!u) return;
  if (!items.length) return toast(blank ? 'Nothing ordered here to inspect.' : 'Nothing ticked yet: tick the lines first, or make the checklist to print.');
  toast('Making the PDF…');
  const pics = await Promise.all(items.map(n => Promise.all(filesFor(n.id).filter(f => isPic(f) && !f.removed && !f.replaced).slice(-5).map(f => fileBlob(f.id).then(imgFrom).catch(() => null))).then(a => a.filter(Boolean))));
  const res = items.map(n => (blank ? null : inspOf(n))), fails = res.filter((r, i) => r && inspResult(r, items[i]) === 'fail').length, part = res.filter((r, i) => r && inspResult(r, items[i]) === 'open').length;
  const by = blank ? '' : (items.map(n => n.insp && n.insp.by).find(Boolean) || myName() || '');
  const cols = [{ h: 'Check', w: 380, wrap: true }, { h: 'Should be', w: 330, wrap: true }, { h: 'OK', w: 80, box: true }, { h: 'Not OK', w: 100, box: true }, { h: 'Note', w: 170, wrap: true }];
  const mark = v => [v === 'ok' ? 'ok' : v === 'na' ? 'na' : '', v === 'bad' ? 'bad' : v === 'na' ? 'na' : ''];
  await shareStatement({ title: blank ? 'INSPECTION CHECKLIST' : 'INSPECTION REPORT', no: statementNo(), date: fmtDate(today()), ref: supId,
    info: [['Supplier', u.name], ['Where', [u.market, u.city, u.country].filter(Boolean).join(', ') || '—'], ['Contact', [u.person, u.phone, u.wechat && `WeChat ${u.wechat}`].filter(Boolean).join(' · ') || '—'], ['Items', String(items.length)]],
    sections: items.map((n, i) => {
      const r = res[i], o = n.order;
      return { title: `${i + 1}. ${n.t}`, sub: [`${plain(o.qty)} ${n.unit || ''} ordered ${fmtDate(o.date)} at ${cost(o.price, o.cur)}`, n.project && projName(n.project), n.area].filter(Boolean).join(' · '), photos: pics[i], cols,
        rows: [...(n.specs || []).map(([k, v], si) => [k, v, ...mark(r && r.specs[si]), '']),
          ...STD_CHECKS.map(([k, label]) => [label, k === 'qty' ? `${plain(o.qty)} ${n.unit || ''}`.trim() : '', ...mark(r && r.std[k]), k === 'qty' && r && countOf(r) !== null ? `${plain(countOf(r))} counted` : '']),
          ...(r && r.note ? [['Note', r.note, 'skip', 'skip', '']] : blank ? [['Note', '', 'skip', 'skip', '']] : [])] };
    }),
    summary: blank ? [['Items to inspect', String(items.length), true]] : [['Items inspected', String(items.length)], ['Not fully checked', String(part)], ['Not OK', String(fails), true]],
    verdict: blank ? null : { text: fails ? `${fails} ITEM${fails === 1 ? '' : 'S'} NOT OK` : part ? `${part} NOT FULLY CHECKED` : 'ALL ITEMS OK', good: !fails && !part },
    approvals: true, noStamp: true, signLabels: ['Inspected by', 'For the supplier', 'Approved by'], preparedBy: by }, pdfName(blank ? 'Inspection checklist' : 'Inspection report', u.name));
}
