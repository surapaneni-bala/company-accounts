/* ---------- staff: employees, salaries, advances, leaving ---------- */
// An employee (kind W) earns their monthly wage on a 30-day month (calc.js). Every payment to them is an
// ordinary expense that names them (worker, pay = salary | advance | settlement), so the cash and bank
// balances stay right. The office manager's changes to an employee, marking someone as left and advances
// above the monthly limit all wait for an admin.
const ADVANCE_LIMIT_USD = 100; // ponytail: the owner's $100 a month; make it an admin setting when they want to change it
const PAY_REASON = { salary: m => `Salary ${monthName(m)}`, advance: () => 'Salary advance', settlement: () => 'Final settlement' };
const today = () => stamp().slice(0, 10);
const workerOf = id => S.workers.find(w => w.id === id);
const ledgerOf = (w, upTo = today(), extra = []) => workerLedger(w, [...S.expenses, ...extra], upTo);
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || '?';
// advances an admin approved that nobody has given yet
const approvedAdvances = id => S.changes.filter(c => c.action === 'advance' && c.target === id && c.status === 'approved' && !live(S.expenses).some(e => e.approval === c.id));
const owedLabel = l => (l.balance >= 0 ? 'to pay' : 'paid ahead');

function viewStaff() {
  const ws = live(S.workers).sort((a, b) => a.name.localeCompare(b.name));
  const on = ws.filter(w => w.status !== 'left'), gone = ws.filter(w => w.status === 'left');
  return `${approvalsBanner()}<div class="sec-head"><h2 class="sec">Staff</h2><button class="btn small primary" data-act="addWorker">＋ Add employee</button></div>
    ${on.length ? `<div class="card list">${on.map(workerRow).join('')}</div>` : gone.length ? empty('Nobody working now', 'Everyone listed has left the company.') : empty('No employees yet', 'Add each person once: their wage, the day they started and the balance from the salary book.')}
    ${gone.length ? `<details class="gone"><summary>Left the company (${gone.length})</summary><div class="card list">${gone.map(workerRow).join('')}</div></details>` : ''}`;
}
function workerRow(w) {
  const l = ledgerOf(w);
  return `<button class="row" data-act="openWorker" data-id="${esc(w.id)}">
    <span class="dot avatar">${esc(initials(w.name))}</span>
    <span class="main"><span class="t"><span class="tt">${esc(w.name)}</span>${waitingFor(w.id).length ? '<i class="tag warn">Waiting</i>' : ''}</span>
    <span class="s">${esc([w.job, w.site, `${money(w.wage, w.cur)} a month`].filter(Boolean).join(' · '))}</span></span>
    <span class="amt${l.balance < 0 ? ' neg' : ''}">${money(l.balance, l.cur)}<small>${owedLabel(l)}</small></span></button>`;
}

function workerDetail(id) {
  const w = workerOf(id);
  if (!w || w.deleted) return false;
  const l = ledgerOf(w), left = w.status === 'left';
  const pays = live(S.expenses).filter(e => e.worker === id).sort((a, b) => byAt(b, a));
  const facts = [['Job', w.job], ['Site', w.site], ['Phone', w.phone], ['Monthly wage', money(w.wage, w.cur)], ['Started', fmtDate(w.start)], ['Left on', w.left && fmtDate(w.left)],
    ['ID number', w.idNo], ['From the salary book', w.openingAmount ? `${money(w.openingAmount, w.cur)}${w.openingNote ? ' · ' + w.openingNote : ''}` : '']];
  const idPhoto = latestFile(id, 'idphoto');
  openSheet(`${head(w.name, '', w.id)}
    <div class="wtop"><span class="wphoto" id="wPhoto">${esc(initials(w.name))}</span>
      <div><div class="dbig ${l.balance < 0 ? 'out' : ''}" style="margin:0">${money(l.balance, l.cur)}</div><small class="muted">${l.balance >= 0 ? `still to pay ${esc(w.name)}` : 'paid more than earned so far'}${left ? ' · has left' : ''}</small></div></div>
    ${waitingNote(id)}
    ${approvedAdvances(id).map(c => `<div class="banner new"><span>✅ Advance of ${money(+c.after.amount, c.after.cur)} approved by ${esc(c.decidedBy)}.</span><button class="btn small" data-act="payWorker" data-pay="advance" data-id="${esc(id)}" data-approval="${esc(c.id)}">Give it</button></div>`).join('')}
    <div class="two">${left
      ? `<button class="btn out" data-act="payWorker" data-pay="settlement" data-id="${esc(id)}">💵 Final settlement</button>`
      : `<button class="btn out" data-act="payWorker" data-pay="salary" data-id="${esc(id)}">💵 Pay salary</button><button class="btn ghost" data-act="payWorker" data-pay="advance" data-id="${esc(id)}">➖ Advance</button>`}</div>
    <dl class="facts" style="margin-top:16px">${facts.filter(f => f[1]).map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    <div class="two">${canChange() ? `<button class="btn ghost" data-act="editWorker" data-id="${esc(id)}">✏️ Edit 🔒</button>` : ''}${left || !canChange() ? '' : `<button class="btn danger" data-act="markLeft" data-id="${esc(id)}">🚪 Has left 🔒</button>`}</div>
    <div class="two" style="margin-top:10px">${attachButton(id, '🙂 Profile photo', 'profile', 'image/*')}${idPhoto ? `<button class="btn ghost" data-act="showFile" data-id="${esc(idPhoto.id)}">🪪 ID photo</button>` : attachButton(id, '🪪 Add ID photo', 'idphoto')}</div>
    <h3 class="subh">Wage by month</h3>
    <div class="card list inset">${[...l.months].reverse().slice(0, 12).map(m => `<div class="mrow"><span>${monthName(m.month)}</span><span class="muted">${m.days} days${m.daysOff ? ` − ${m.daysOff} not worked` : ''}</span><b>${money(m.earned, l.cur)}</b></div>`).join('') || '<p class="muted pad">Starts on ' + esc(fmtDate(w.start)) + '.</p>'}</div>
    <p class="muted">Earned ${money(l.earned, l.cur)}${l.opening ? ` + ${money(l.opening, l.cur)} from the salary book` : ''} − paid ${money(l.paid, l.cur)} = ${money(l.balance, l.cur)}.${l.unconverted.length ? ` ⚠️ ${l.unconverted.length} payment(s) in another currency without a rate are not counted.` : ''}</p>
    <h3 class="subh">Payments (${pays.length})</h3>
    ${pays.length ? `<div class="card list inset">${pays.map(x => itemRow(x, 'E', true)).join('')}</div>` : '<p class="muted">Nothing paid yet.</p>'}
    ${filesBlock(id)}`);
  comeBack(() => workerDetail(id));
  const photo = latestFile(id, 'profile');
  if (photo) fileBlob(photo.id).then(b => { const el = $('#wPhoto'); if (el) el.innerHTML = `<img src="${URL.createObjectURL(b)}" alt="">`; }).catch(() => {});
}

function workerForm(old) {
  const d = old || { cur: 'USD', start: today(), wage: '', openingAmount: '' };
  openSheet(`${head(old ? 'Edit employee' : 'New employee', '', old?.id)}
    <form data-form="worker" data-id="${esc(old?.id || '')}">
      ${textField('name', 'Full name', 'e.g. John Deng', d.name)}
      ${textField('job', 'Job', 'e.g. Mason, driver, guard', d.job, false)}
      ${textField('site', 'Site', 'Where they work', d.site, false)}
      <label class="fld"><span>Phone <em>(optional)</em></span><input name="phone" type="tel" value="${esc(d.phone)}" autocomplete="off" maxlength="30"></label>
      ${curChips(d.cur, 'Wage is paid in')}
      ${amountField(d.wage, d.cur, 'wage', 'Monthly wage')}
      <label class="fld"><span>Started work on</span><input type="date" name="start" value="${esc(d.start)}" required></label>
      ${textField('idNo', 'National ID or passport number', '', d.idNo, false)}
      <label class="fld"><span>Balance from the salary book <em>(optional — what the company still owed them on the day they started in the app; put − if they owed the company)</em></span><input name="openingAmount" inputmode="decimal" value="${esc(d.openingAmount || '')}" placeholder="0" autocomplete="off"></label>
      ${textField('openingNote', 'Note about that balance', 'e.g. From the salary book, September', d.openingNote, false)}
      ${old ? '' : `<label class="fld"><span>Profile photo <em>(optional)</em></span><input type="file" name="profile" accept="image/*" capture="environment"></label>
      <label class="fld"><span>ID or passport photo <em>(optional — only admins and the office see it)</em></span><input type="file" name="idphoto" accept="image/*,application/pdf"></label>`}
      ${byField()}${approvalNote(old)}
      <p class="err"></p>
      <button class="btn primary">${old ? saveLabel() : 'Add employee'}</button>
    </form>${datalists()}`);
}
async function saveWorker(f) {
  const v = Object.fromEntries(new FormData(f));
  const old = workerOf(f.dataset.id);
  const wage = parseAmount(v.wage), opening = String(v.openingAmount || '').replace(/[,\s$]/g, '');
  const rec = { name: clean(v.name), job: clean(v.job), site: clean(v.site), phone: clean(v.phone), wage, cur: formCur(f), start: v.start, idNo: clean(v.idNo), openingAmount: opening ? Math.round(Number(opening) * 100) / 100 : 0, openingNote: clean(v.openingNote) };
  if (!rec.name) return formErr(f, 'name', 'Type their name');
  if (wage === null) return formErr(f, 'wage', 'Type the monthly wage, like 300');
  if (!DATE_RE.test(rec.start)) return formErr(f, 'start', 'Pick the day they started');
  if (!Number.isFinite(rec.openingAmount)) return formErr(f, 'openingAmount', 'Type a number, like 150 or −50');
  const by = clean(v.by);
  if (!by) return formErr(f, 'by', 'Type your name');
  if (old) {
    const changes = diff(old, rec);
    if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
    if (!can('edit')) return requestChange('W', old, rec, changes, by);
    update({ workers: S.workers.map(x => x.id === old.id ? { ...x, ...rec, editedAt: stampSec(), editedBy: by } : x), log: logWith([['Edited', old.id, changes.join(' ; ')]], by), lastBy: by });
    closeSheet(); render(); return toast('Changes saved ✓');
  }
  const [[id], seq] = nextIds('W', 1, S.seq);
  update({ workers: [...S.workers, { id, ...rec, status: 'active', by, createdAt: stampSec() }], seq, lastBy: by,
    log: logWith([['Employee', id, `${rec.name} added · ${money(wage, rec.cur)} a month from ${fmtDate(rec.start)}`]], by) });
  for (const type of ['profile', 'idphoto']) {
    const file = f.elements[type].files[0];
    if (!file) continue;
    try { const p = await prepareFile(file); await keepFile({ for: id, type, name: p.name, mime: p.mime }, p.data); }
    catch (e) { alert(`${FILE_NAME[type]}: ${e.message}`); }
  }
  render(); workerDetail(id); toast(`${rec.name} added ✓`);
}

// Someone leaves: an admin records it (the office manager asks), then their final settlement is paid.
function leftForm(id) {
  const w = workerOf(id);
  openSheet(`${head(`${w.name} has left`, 'out', w.id)}
    <form data-form="left" data-id="${esc(id)}">
      <label class="fld"><span>Last day of work</span><input type="date" name="left" value="${today()}" required></label>
      <p class="muted">Their wage is counted up to this day. Then pay the final settlement.</p>
      ${byField()}${can('edit') ? '' : '<p class="note">An admin approves this first.</p>'}
      <p class="err"></p>
      <button class="btn out">${can('edit') ? 'Save' : 'Send for approval'}</button>
    </form>${datalists()}`);
}
function saveLeft(f) {
  const w = workerOf(f.dataset.id), left = f.elements.left.value, by = clean(f.elements.by.value);
  if (!DATE_RE.test(left) || left < w.start) return formErr(f, 'left', 'Pick a day on or after they started');
  if (!by) return formErr(f, 'by', 'Type your name');
  const rec = { status: 'left', left }, changes = [`Status: Working → Left on ${fmtDate(left)}`];
  if (!can('edit')) return requestChange('W', w, rec, changes, by);
  update({ workers: S.workers.map(x => x.id === w.id ? { ...x, ...rec, editedAt: stampSec(), editedBy: by } : x), log: logWith([['Left', w.id, `${w.name} left on ${fmtDate(left)}`]], by), lastBy: by });
  render(); payForm(w.id, 'settlement');
}

/* paying an employee: salary for a month, an advance, or the final settlement */
function monthsOf(w) {
  const out = [], last = today().slice(0, 7);
  for (let m = w.start.slice(0, 7); m <= last && out.length < 240; m = nextMonth(m)) out.push(m);
  return out.reverse().slice(0, 24);
}
// the month most likely being paid: last month if it hasn't had a salary yet, otherwise this month
function payMonth(w) {
  const ms = monthsOf(w), paid = new Set(live(S.expenses).filter(e => e.worker === w.id && e.pay === 'salary').map(e => e.month));
  return ms.find((m, i) => i === 1 && !paid.has(m)) || ms[0];
}
// what is still owed for work up to the end of that month, if this many days were not worked
function owedFor(w, month, daysOff) {
  const end = month ? [today(), `${month}-31`].sort()[0] : today();
  const extra = month && daysOff ? [{ id: 'new', worker: w.id, pay: 'salary', month, daysOff, amount: 0, cur: w.cur, at: `${end}T00:00` }] : [];
  return ledgerOf(w, end, extra);
}
function payInfo(f) {
  const w = workerOf(f.dataset.id), pay = f.dataset.pay;
  if (pay === 'advance') {
    const used = advancesUsd(live(S.expenses).filter(e => e.worker === w.id), today().slice(0, 7));
    return `Advances given to ${esc(w.name)} this month: <b>${money(used, 'USD')}</b> of the ${money(ADVANCE_LIMIT_USD, 'USD')} limit.`;
  }
  const month = f.elements.month ? f.elements.month.value : '', off = Math.max(0, Math.round(Number(f.elements.daysOff?.value || 0)));
  const l = owedFor(w, month, off), m = l.months.find(x => x.month === month);
  return `${m ? `${monthName(month)}: ${m.days - m.daysOff} days worked of ${m.days} → <b>${money(m.earned, l.cur)}</b><br>` : ''}Still to pay ${esc(w.name)}${month ? ` up to the end of ${monthName(month)}` : ''}: <b>${money(l.balance, l.cur)}</b>`;
}
function payForm(id, pay, approval) {
  const w = workerOf(id), appr = approval && approvedAdvances(id).find(c => c.id === approval);
  const month = pay === 'salary' ? payMonth(w) : '';
  const suggested = appr ? +appr.after.amount : pay === 'advance' ? '' : Math.max(0, owedFor(w, month, 0).balance);
  const cur = appr ? appr.after.cur : w.cur;
  const title = { salary: 'Pay salary', advance: 'Give an advance', settlement: 'Final settlement' }[pay];
  openSheet(`${head(title, 'out', w.name)}
    <form data-form="pay" data-id="${esc(id)}" data-pay="${pay}" data-approval="${esc(appr ? appr.id : '')}">
      ${pay === 'salary' ? `<label class="fld"><span>For the month of</span><select name="month">${monthsOf(w).map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select></label>
      <label class="fld"><span>Days not worked that month <em>(${money(Math.round(w.wage / 30 * 100) / 100, w.cur)} a day comes off)</em></span><input name="daysOff" type="number" inputmode="numeric" min="0" max="30" step="1" value="0"></label>` : ''}
      <p class="note payinfo"></p>
      ${appr ? `<input type="hidden" name="cur" value="${esc(cur)}"><p class="muted">Approved by ${esc(appr.decidedBy)}: ${money(+appr.after.amount, cur)}</p>` : curChips(cur, 'Paid in')}
      ${amountField(suggested, cur)}
      ${rateField(cur)}
      ${accountChips(S.lastMode || 'Cash', 'Paid from')}
      ${byField()}
      <p class="err"></p>
      <button class="btn out">Save, then sign the slip</button>
    </form>${datalists()}`);
  const f = $('#sheet form');
  $('.payinfo', f).innerHTML = payInfo(f);
}
function refreshPay(f, t) {
  $('.payinfo', f).innerHTML = payInfo(f);
  if (t && (t.name === 'month' || t.name === 'daysOff') && !f.dataset.typed) { // keep the suggested amount in step until they type their own
    const w = workerOf(f.dataset.id), l = owedFor(w, f.elements.month.value, Math.max(0, Math.round(Number(f.elements.daysOff.value || 0))));
    f.elements.amount.value = Math.max(0, l.balance) || '';
    refreshAmount(f.elements.amount);
  }
}
function savePay(f) {
  const w = workerOf(f.dataset.id), pay = f.dataset.pay, v = Object.fromEntries(new FormData(f));
  const amount = parseAmount(v.amount), cur = formCur(f), rate = rateFrom(f, cur);
  if (amount === null) return formErr(f, 'amount', 'Type the amount paid, like 250');
  if (rate === null) return formErr(f, 'rate', RATE_ERR);
  const daysOff = pay === 'salary' ? Number(v.daysOff || 0) : 0;
  if (!Number.isInteger(daysOff) || daysOff < 0 || daysOff > 30) return formErr(f, 'daysOff', 'Days not worked: a whole number from 0 to 30');
  const by = clean(v.by);
  if (!by) return formErr(f, 'by', 'Type your name');
  const appr = f.dataset.approval && approvedAdvances(w.id).find(c => c.id === f.dataset.approval);
  if (pay === 'advance' && !appr) {
    const used = advancesUsd(live(S.expenses).filter(e => e.worker === w.id), today().slice(0, 7));
    const usd = cur === 'USD' ? amount : amount / rate;
    if (cents(used + usd) > cents(ADVANCE_LIMIT_USD)) {
      if (!can('edit')) return askAdvance(w, amount, cur, by);
      if (!confirm(`This is more than the ${money(ADVANCE_LIMIT_USD, 'USD')} a month limit (${money(used, 'USD')} given this month already).\n\nGive it anyway?`)) return;
    }
  }
  if (appr && (cur !== appr.after.cur || amount > +appr.after.amount)) return formErr(f, 'amount', `The admin approved ${money(+appr.after.amount, appr.after.cur)} — not more.`);
  const month = pay === 'salary' ? v.month : '';
  const rec = { cur, amount, rate, paidTo: w.name, reason: PAY_REASON[pay](month), location: '', project: '', mode: v.mode || 'Cash', ...dateFrom({}),
    worker: w.id, pay, ...(month ? { month } : {}), ...(daysOff ? { daysOff } : {}), ...(appr ? { approval: appr.id } : {}) };
  const [[id], seq] = nextIds('E', 1, S.seq);
  update({ expenses: [...S.expenses, { id, ...rec, by, createdAt: stampSec(), batch: null }], seq, lastBy: by, lastMode: rec.mode, ...(rate ? { lastRate: rate } : {}) });
  render(); toast(`Saved ✓ ${money(amount, cur)} to ${w.name}`);
  slipSheet('E', id);
}
// above the monthly limit, the office manager asks an admin first
function askAdvance(w, amount, cur, by) {
  const [[id], seq] = nextIds('C', 1, S.seq);
  const text = `Advance of ${money(amount, cur)} to ${w.name} — more than the ${money(ADVANCE_LIMIT_USD, 'USD')} a month limit`;
  update({
    changes: [...S.changes, { id, kind: 'W', target: w.id, action: 'advance', before: {}, after: { amount, cur }, text, by, at: stamp(), createdAt: stampSec(), status: 'waiting' }], seq,
    log: logWith([['Advance asked', w.id, `${text} — waiting for an admin`]], by), lastBy: by,
  });
  closeSheet(); render(); toast('Sent to an admin ✓ You can give it once they approve.');
}

// what a salary slip shows, from the payment and the employee's account
function payslipSpec(r) {
  const w = workerOf(r.worker) || { name: r.paidTo, wage: 0, cur: r.cur, start: r.at.slice(0, 10) };
  const after = ledgerOf(w);
  const m = r.month && after.months.find(x => x.month === r.month);
  const rows = [['Employee', w.name], ['Job', w.job], ['Employee no.', w.id]];
  if (r.pay === 'salary') rows.push(['Month', monthName(r.month)], ['Monthly wage', `${money(w.wage, w.cur)} (30-day month)`],
    ['Days worked', m ? `${m.days - m.daysOff} of ${m.days}${m.daysOff ? ` (${m.daysOff} not worked)` : ''}` : ''], ['Earned that month', m ? money(m.earned, w.cur) : '']);
  if (r.pay === 'settlement') rows.push(['Last day of work', w.left ? fmtDate(w.left) : '']);
  rows.push(['Paid from', accountOf(r.mode)], ...rateRow(r), [after.balance >= 0 ? 'Still to pay after this' : 'Paid ahead after this', money(Math.abs(after.balance), after.cur)]);
  return { title: SLIP_TITLE[r.pay] || SLIP_TITLE.voucher, rows: rows.filter(x => x[1]), signLabel: 'Received by', signName: w.name };
}
