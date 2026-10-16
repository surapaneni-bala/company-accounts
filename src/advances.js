/* ---------- supplier advances: paid once, goods taken from it over time ---------- */
// An advance is an expense marked advance: true — money paid to a supplier before the goods. The cash left that day and
// the supplier signed for the whole amount (advanceTotal). Each time goods are taken, "Take from advance" splits it: a
// new expense for what was taken (its own reason and project; the advance's day and account, so cash and bank never
// move) and the advance shrinks by that much. The last piece turns the advance itself into what was taken
// (advance: false, advanceTotal kept). The signed voucher stays valid: what was signed for is advanceTotal (signedFacts).
const openAdvances = () => live(S.expenses).filter(e => e.advance);
const takenFrom = id => live(S.expenses).filter(e => e.from === id).sort(byAt);
const advanceTag = x => (x.advance ? `<i class="tag warn">Advance · ${esc(money(x.amount, x.cur))} left</i>` : x.from ? '<i class="tag">From advance</i>' : '');
// entries typed as plain expenses that look like an advance — to a supplier or company, or a salary advance to an employee
// (not rent or internet paid for several months ahead — "Internet advance till Dec" is a regular payment, see calc.js)
const looksLikeAdvance = e => !e.advance && !e.advanceTotal && !e.from && !e.worker && !e.regular && !(S.notAdvance || []).includes(e.id) && !prepaidOf(e) && /advance/i.test(`${e.reason} ${e.paidTo}`);
// the employee a payment's "paid to" names (full name, or the same first name): only a guess, an admin confirms
const employeeLike = e => { const n = clean(e.paidTo).toLowerCase(); return n ? live(S.workers).find(w => { const m = w.name.toLowerCase(); return m === n || m.split(' ')[0] === n.split(' ')[0]; }) : null; };
// the two kinds, as buttons: which one it was is the admin's call (owner, 15 Oct 2026: tell employee advances apart)
const advanceKindButtons = r => `<div class="two" style="margin-bottom:10px">${live(S.workers).length ? `<button class="btn small ghost" data-act="empAdvance" data-id="${esc(r.id)}">👷 Salary advance to an employee</button>` : ''}<button class="btn small ghost" data-act="makeAdvance" data-id="${esc(r.id)}">🏪 Advance to a supplier or company</button>${looksLikeAdvance(r) ? `<button class="btn small ghost" data-act="notAdvance" data-id="${esc(r.id)}">✖ Neither — a normal payment</button>` : ''}</div>`;
// a supplier advance marked by mistake can be undone while nothing has been taken from it
const undoable = r => r.advance && !takenFrom(r.id).length && cents(r.amount) === cents(r.advanceTotal || r.amount);
const undoButton = (id, label) => `<button class="btn ghost" data-act="undoAdvance" data-id="${esc(id)}" style="margin-bottom:10px">↩️ ${label}</button>`;

// on an expense's page: where it stands as an advance, or a way to make it one
function advanceBlock(r) {
  if (r.worker && r.pay === 'advance') {
    const w = workerOf(r.worker);
    return can('edit') ? `<p class="note">👷 Salary advance to ${esc(w ? w.name : r.paidTo)}: it comes off their pay.</p>${undoButton(r.id, 'Not a salary advance — undo')}` : '';
  }
  if (r.from) {
    const p = S.expenses.find(x => x.id === r.from);
    return `<p class="note">🏪 Taken from the advance paid to ${esc(r.paidTo)}${p ? ` on ${esc(fmtDate(p.at.slice(0, 10)))}` : ''}${r.received ? ` · collected ${esc(fmtDate(r.received))}` : ''}.</p>
      ${p && !p.deleted ? `<button class="btn ghost" data-act="open" data-kind="E" data-id="${esc(p.id)}" style="margin-bottom:10px">🏪 Open the advance</button>` : ''}`;
  }
  if (!r.advance && !r.advanceTotal) {
    if (!can('edit') || r.worker || r.regular) return '';
    const w = employeeLike(r);
    return `${looksLikeAdvance(r) ? `<p class="muted">Was this an advance?${w ? ` It names ${esc(w.name)}, one of your employees.` : ''}</p>` : ''}${advanceKindButtons(r)}`;
  }
  const taken = takenFrom(r.id), total = r.advanceTotal || r.amount, used = minus(total, r.advance ? r.amount : 0);
  return `<div class="note">🏪 <b>Advance to ${esc(r.paidTo)}</b>: ${money(total, r.cur)} paid · ${money(used, r.cur)} taken · <b>${r.advance ? `${money(r.amount, r.cur)} left` : 'all taken'}</b></div>
    ${r.advance && can('edit') ? `<button class="btn out" data-act="takeAdvance" data-id="${esc(r.id)}" style="margin:10px 0">➖ Take from the advance</button>` : ''}
    ${undoable(r) && can('edit') ? undoButton(r.id, 'Not an advance — undo') : ''}
    ${taken.length ? `<h3 class="subh">Taken so far (${taken.length})</h3><div class="card list inset" style="margin-bottom:12px">${taken.map(x => itemRow(x, 'E', true)).join('')}</div>` : ''}`;
}
function advancesSheet() {
  const open = openAdvances().sort(byAt), maybe = can('edit') ? live(S.expenses).filter(looksLikeAdvance).sort((a, b) => byAt(b, a)).slice(0, 20) : [];
  const staff = can('staff') ? live(S.expenses).filter(e => e.worker && e.pay === 'advance').sort((a, b) => byAt(b, a)) : [];
  openSheet(`${head('Advances', 'out')}
    <h3 class="subh">🏪 With suppliers and companies</h3>
    <p class="hint">Money paid before the goods or the work. Each time you collect something, open the advance and tap <b>Take from the advance</b>.</p>
    ${open.length ? `<p class="note">Still with them: <b>${sumText(open)}</b></p><div class="card list inset">${open.map(x => itemRow(x, 'E', true)).join('')}</div>` : '<p class="muted">None open. Tick "Advance to a supplier or company" when you add the payment.</p>'}
    ${maybe.length ? `<h3 class="subh">❓ Entries that look like advances (${maybe.length})</h3><p class="muted">Say which kind each one was. An employee's comes off their pay.</p>
      ${maybe.map(x => { const w = employeeLike(x); return `<div class="card list inset" style="margin-bottom:10px">${itemRow(x, 'E', true)}<div class="sugg">${w ? `<span class="muted">Names ${esc(w.name)}, one of your employees.</span>` : ''}${advanceKindButtons(x)}</div></div>`; }).join('')}` : ''}
    ${can('staff') ? `<h3 class="subh">👷 Salary advances to employees (${staff.length})</h3><p class="muted">These come off each employee's pay (Employees).</p>
      ${staff.length ? `<div class="card list inset">${staff.slice(0, 15).map(x => itemRow(x, 'E', true)).join('')}</div>` : ''}` : ''}`);
  comeBack(advancesSheet);
}
// A plain entry that was a salary advance: linked to the employee (worker, pay 'advance') so it comes off their pay, like
// one given from Employees. Who it was paid to and what was signed stay as they are, so its voucher stays valid.
async function empAdvanceSheet(id) {
  const r = S.expenses.find(x => x.id === id && !x.deleted), ws = live(S.workers).sort((a, b) => a.name.localeCompare(b.name));
  if (!r || !ws.length || !await unlock('Enter the password to link it to an employee.')) return;
  const guess = employeeLike(r);
  openSheet(`${head('Salary advance to an employee', 'out', `${money(r.amount, r.cur)} to ${r.paidTo} · ${fmtDate(r.at.slice(0, 10))}`)}
    <form data-form="empAdvance" data-id="${esc(id)}">
      <label class="fld"><span>Which employee?</span><select name="worker">${guess ? '' : '<option value="">Choose…</option>'}${ws.map(w => `<option value="${esc(w.id)}" ${guess && w.id === guess.id ? 'selected' : ''}>${esc(w.name)}${w.status === 'left' ? ' (has left)' : ''}</option>`).join('')}</select></label>
      <p class="muted">It is taken off their pay, like an advance given from Employees. "Paid to" and the signed voucher stay as they are.</p>
      <p class="err"></p>
      <button class="btn out">Link as a salary advance</button>
    </form>`);
}
function saveEmpAdvance(f) {
  const r = S.expenses.find(x => x.id === f.dataset.id && !x.deleted), w = workerOf(f.elements.worker.value);
  if (!r) return closeSheet();
  if (!w) return formErr(f, 'worker', 'Choose the employee');
  const day = r.at.slice(0, 10);
  if (w.clearedTo && day <= w.clearedTo && !confirm(`This was paid on ${fmtDate(day)}, before ${w.name}'s salary was cleared (up to ${fmtDate(w.clearedTo)}).\n\nLinking it takes it off their pay again. Link it anyway?`)) return;
  const by = myName() || S.lastBy || '';
  update({ expenses: S.expenses.map(x => (x.id === r.id ? { ...x, worker: w.id, pay: 'advance', editedAt: stampSec(), editedBy: by } : x)), log: logWith([['Edited', r.id, `Linked to ${w.name} as a salary advance (${money(r.amount, r.cur)}) — it comes off their pay`]], by) });
  toast(`Linked to ${w.name} ✓ — it comes off their pay`);
  detail('E', r.id);
}
// Undo a mistake (owner, 15 Oct 2026): a supplier advance with nothing taken from it, or a payment linked to an employee
// as a salary advance, goes back to a normal payment. What was paid and signed for doesn't change, so its voucher stays valid.
async function undoAdvance(id) {
  const r = S.expenses.find(x => x.id === id && !x.deleted), emp = r && r.worker && r.pay === 'advance';
  if (!r || !(emp || undoable(r)) || !await unlock('Enter the password to undo the advance.')) return;
  const w = emp && workerOf(r.worker), day = r.at.slice(0, 10);
  const cleared = w && w.clearedTo && day <= w.clearedTo ? `\n\n${w.name}'s salary was already cleared up to ${fmtDate(w.clearedTo)} with this advance taken off. Undoing it means they are owed ${money(r.amount, r.cur)} more.` : '';
  if (!confirm(emp ? `Is ${money(r.amount, r.cur)} to ${r.paidTo} not a salary advance to ${w ? w.name : 'an employee'}?\n\nIt stops coming off their pay and stays a normal payment.${cleared}` : `Is ${money(r.amount, r.cur)} to ${r.paidTo} not an advance?\n\nIt stays a normal payment.`)) return;
  const by = myName() || S.lastBy || '', drop = emp ? ['worker', 'pay', 'month'] : ['advance', 'advanceTotal'];
  const plain = Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k)));
  update({ expenses: S.expenses.map(x => (x.id === id ? { ...plain, editedAt: stampSec(), editedBy: by } : x)), notAdvance: [...(S.notAdvance || []), id],
    log: logWith([['Edited', id, emp ? `Not a salary advance to ${w ? w.name : 'an employee'} after all — a normal payment again` : `Not an advance to ${r.paidTo} after all — a normal payment again`]], by) });
  toast('Undone ✓ — a normal payment again');
  detail('E', id);
}
// "neither": this phone stops asking about it (ponytail: kept on this phone, like "Not regular"; a shared flag needs a sheet-script change)
function notAdvance(id, inList) { update({ notAdvance: [...(S.notAdvance || []), id] }); toast('OK — a normal payment'); if (inList) advancesSheet(); else detail('E', id); }
async function makeAdvance(id) {
  const r = S.expenses.find(x => x.id === id && !x.deleted);
  if (!r || !await unlock('Enter the password to mark this as an advance.')) return;
  if (!confirm(`Mark ${money(r.amount, r.cur)} to ${r.paidTo} as an advance to a supplier or company?\n\nThen each time goods or work are collected you take them from it, and it shows what is left.`)) return;
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
