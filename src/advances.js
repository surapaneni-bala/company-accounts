/* ---------- supplier advances: paid once, goods taken from it over time ---------- */
// An advance is an expense marked advance: true — money paid to a supplier before the goods. The cash left that day and
// the supplier signed for the whole amount (advanceTotal). Each time goods are taken, "Take from advance" splits it: a
// new expense for what was taken (its own reason and project; the advance's day and account, so cash and bank never
// move) and the advance shrinks by that much. The last piece turns the advance itself into what was taken
// (advance: false, advanceTotal kept). The signed voucher stays valid: what was signed for is advanceTotal (signedFacts).
const openAdvances = () => live(S.expenses).filter(e => e.advance);
const takenFrom = id => live(S.expenses).filter(e => e.from === id).sort(byAt);
const advanceTag = x => (x.advance ? `<i class="tag warn">Advance · ${esc(money(x.amount, x.cur))} left</i>` : x.from ? '<i class="tag">From advance</i>' : '');
// entries typed before this existed, that look like an advance to a supplier
const looksLikeAdvance = e => !e.advance && !e.advanceTotal && !e.from && !e.worker && !e.regular && /advance/i.test(`${e.reason} ${e.paidTo}`);

// on an expense's page: where it stands as an advance, or a way to make it one
function advanceBlock(r) {
  if (r.from) {
    const p = S.expenses.find(x => x.id === r.from);
    return `<p class="note">🏪 Taken from the advance paid to ${esc(r.paidTo)}${p ? ` on ${esc(fmtDate(p.at.slice(0, 10)))}` : ''}${r.received ? ` · collected ${esc(fmtDate(r.received))}` : ''}.</p>
      ${p && !p.deleted ? `<button class="btn ghost" data-act="open" data-kind="E" data-id="${esc(p.id)}" style="margin-bottom:10px">🏪 Open the advance</button>` : ''}`;
  }
  if (!r.advance && !r.advanceTotal) return can('edit') && !r.worker && !r.regular ? `<button class="btn ghost" data-act="makeAdvance" data-id="${esc(r.id)}" style="margin-bottom:10px">🏪 This was an advance to a supplier</button>` : '';
  const taken = takenFrom(r.id), total = r.advanceTotal || r.amount, used = minus(total, r.advance ? r.amount : 0);
  return `<div class="note">🏪 <b>Advance to ${esc(r.paidTo)}</b>: ${money(total, r.cur)} paid · ${money(used, r.cur)} taken · <b>${r.advance ? `${money(r.amount, r.cur)} left` : 'all taken'}</b></div>
    ${r.advance && can('edit') ? `<button class="btn out" data-act="takeAdvance" data-id="${esc(r.id)}" style="margin:10px 0">➖ Take from the advance</button>` : ''}
    ${taken.length ? `<h3 class="subh">Taken so far (${taken.length})</h3><div class="card list inset" style="margin-bottom:12px">${taken.map(x => itemRow(x, 'E', true)).join('')}</div>` : ''}`;
}
function advancesSheet() {
  const open = openAdvances().sort(byAt), maybe = can('edit') ? live(S.expenses).filter(looksLikeAdvance).sort((a, b) => byAt(b, a)).slice(0, 20) : [];
  openSheet(`${head('Advances with suppliers', 'out')}
    <p class="hint">Money paid to a supplier before the goods. Each time you collect something, open the advance and tap <b>Take from the advance</b>.</p>
    ${open.length ? `<p class="note">Still with suppliers: <b>${sumText(open)}</b></p><div class="card list inset">${open.map(x => itemRow(x, 'E', true)).join('')}</div>` : empty('No open advances', 'Tick "Advance to a supplier" when you add the payment.')}
    ${maybe.length ? `<h3 class="subh">Entries that look like advances</h3><p class="muted">Open one and tap "This was an advance to a supplier".</p><div class="card list inset">${maybe.map(x => itemRow(x, 'E', true)).join('')}</div>` : ''}`);
  comeBack(advancesSheet);
}
async function makeAdvance(id) {
  const r = S.expenses.find(x => x.id === id && !x.deleted);
  if (!r || !await unlock('Enter the password to mark this as an advance.')) return;
  if (!confirm(`Mark ${money(r.amount, r.cur)} to ${r.paidTo} as an advance?\n\nThen each time goods are collected you take them from it, and it shows what is left.`)) return;
  const by = myName() || S.lastBy || '';
  update({ expenses: S.expenses.map(x => (x.id === id ? { ...x, advance: true, advanceTotal: x.amount, editedAt: stampSec(), editedBy: by } : x)), log: logWith([['Edited', id, `Marked as an advance to ${r.paidTo} (${money(r.amount, r.cur)})`]], by) });
  toast('Marked as an advance ✓');
  detail('E', id);
}
function takeForm(id) {
  const r = S.expenses.find(x => x.id === id && x.advance && !x.deleted);
  if (!r) return;
  openSheet(`${head('Take from the advance', 'out', `${r.paidTo} · ${money(r.amount, r.cur)} left`)}
    <form data-form="take" data-id="${esc(id)}">
      ${amountField('', r.cur, 'amount', `Worth (up to ${money(r.amount, r.cur)})`)}
      ${textField('reason', 'What did you collect?', 'e.g. Steel 16mm, 100 bars', '')}
      ${projectSelect(r.project, true)}
      <label class="fld"><span>Collected on</span><input type="date" name="received" value="${today()}" max="${today()}" required></label>
      <p class="muted">No money moves now: it left when the advance was paid.</p>
      <p class="err"></p>
      <button class="btn out">Take it from the advance</button>
    </form>${datalists()}`);
}
function saveTake(f) {
  const r = S.expenses.find(x => x.id === f.dataset.id && x.advance && !x.deleted);
  if (!r) return closeSheet();
  const v = Object.fromEntries(new FormData(f)), amount = parseAmount(v.amount), reason = clean(v.reason), project = v.project || '';
  if (amount === null) return formErr(f, 'amount', 'Type what it was worth, like 300');
  if (cents(amount) > cents(r.amount)) return formErr(f, 'amount', `Only ${money(r.amount, r.cur)} is left of this advance. Take that much, and add the rest as a normal payment.`);
  if (!reason) return formErr(f, 'reason', 'What did you collect?');
  const received = DATE_RE.test(v.received) ? v.received : today(), by = myName() || S.lastBy || '', total = r.advanceTotal || r.amount, at = stampSec();
  const what = `Took ${money(amount, r.cur)} from the advance to ${r.paidTo}: ${reason}`;
  if (cents(amount) === cents(r.amount)) { // the last of it: the advance itself becomes what was collected
    update({ expenses: S.expenses.map(x => (x.id === r.id ? { ...x, advance: false, advanceTotal: total, reason, project, received, editedAt: at, editedBy: by } : x)), log: logWith([['Edited', r.id, `${what} — the advance is used up`]], by) });
  } else {
    const [[id], seq] = nextIds('E', 1, S.seq);
    const piece = { id, cur: r.cur, ...(r.rate ? { rate: r.rate } : {}), amount, paidTo: r.paidTo, reason, location: r.location || '', project, mode: r.mode, at: r.at, manualDate: r.manualDate || false, from: r.id, received, by, createdAt: at };
    update({ expenses: [...S.expenses.map(x => (x.id === r.id ? { ...x, amount: minus(r.amount, amount), advanceTotal: total, editedAt: at, editedBy: by } : x)), piece], seq, log: logWith([['Edited', r.id, what]], by) });
  }
  toast('Taken from the advance ✓');
  detail('E', r.id);
}
