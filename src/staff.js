/* ---------- staff: employees, salaries, advances, leaving ---------- */
// An employee (kind W) earns their monthly wage on a 30-day month (calc.js). Every payment to them is an
// ordinary expense that names them (worker, pay = salary | advance | settlement), so the cash and bank
// balances stay right. The office manager's changes to an employee, marking someone as left and advances
// above the monthly limit all wait for an admin.
const ADVANCE_LIMIT_USD = 100; // ponytail: the owner's $100 a month; make it an admin setting when they want to change it
const PAY_REASON = { salary: m => `Salary ${monthName(m)}`, advance: () => 'Salary advance', settlement: () => 'Final settlement' };
const today = () => stamp().slice(0, 10);
const workerOf = id => S.workers.find(w => w.id === id);
const ledgerOf = (w, upTo = today(), extra = []) => workerLedger(w, [...S.expenses, ...extra], upTo, S.absences);
// the days someone did not work (recorded one by one, with their dates), newest first
const absencesOf = (id, month) => live(S.absences).filter(a => a.worker === id && (!month || a.date.startsWith(month))).sort((a, b) => b.date.localeCompare(a.date));
// "3, 7, 8 Oct" — the days of one month
const dayList = list => { const ds = list.map(a => a.date).sort(); return ds.length ? `${ds.map(d => +d.slice(8, 10)).join(', ')} ${MON[+ds[0].slice(5, 7) - 1]}` : ''; };
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || '?';
// advances an admin approved that nobody has given yet
const approvedAdvances = id => S.changes.filter(c => c.action === 'advance' && c.target === id && c.status === 'approved' && !live(S.expenses).some(e => e.approval === c.id));
const owedLabel = l => (l.balance >= 0 ? 'to pay' : 'paid ahead');
const dayBefore = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd - 1)).toISOString().slice(0, 10); };
const lastMonthEnd = () => dayBefore(today().slice(0, 8) + '01');
// what was there before the app: owed to them (+) or already paid (−)
const beforeText = (n, cur) => (n > 0 ? `${money(n, cur)} owed from before the app` : `${money(-n, cur)} paid before the app`);
// profile photos in the list: fetched once, then kept
const thumbs = new Map();
function loadThumbs() {
  $$('[data-photo]').forEach(async el => {
    const id = el.dataset.photo;
    try { if (!thumbs.has(id)) thumbs.set(id, URL.createObjectURL(await fileBlob(id))); el.innerHTML = `<img src="${thumbs.get(id)}" alt="">`; } catch { /* offline: the initials stay */ }
  });
}

function viewStaff() {
  const ws = live(S.workers).sort((a, b) => a.name.localeCompare(b.name));
  const on = ws.filter(w => w.status !== 'left'), gone = ws.filter(w => w.status === 'left');
  return `${approvalsBanner()}<div class="sec-head"><h2 class="sec">Staff</h2><button class="btn small primary" data-act="addWorker">＋ Add employee</button></div>
    ${on.length ? `<div class="card list">${on.map(workerRow).join('')}</div>` : gone.length ? empty('Nobody working now', 'Everyone listed has left the company.') : empty('No employees yet', 'Add each person once: their job, wage, the day they started and a photo of their ID.')}
    ${gone.length ? `<details class="gone"><summary>Left the company (${gone.length})</summary><div class="card list">${gone.map(workerRow).join('')}</div></details>` : ''}`;
}
function workerRow(w) {
  const l = ledgerOf(w), photo = latestFile(w.id, 'profile');
  return `<button class="row" data-act="openWorker" data-id="${esc(w.id)}">
    <span class="dot avatar" ${photo ? `data-photo="${esc(photo.id)}"` : ''}>${photo && thumbs.has(photo.id) ? `<img src="${thumbs.get(photo.id)}" alt="">` : esc(initials(w.name))}</span>
    <span class="main"><span class="t"><span class="tt">${esc(w.name)}</span>${waitingFor(w.id).length ? '<i class="tag warn">Waiting</i>' : ''}</span>
    <span class="s">${esc([w.job, `${money(w.wage, w.cur)} a month`].filter(Boolean).join(' · '))}</span></span>
    <span class="amt${l.balance < 0 ? ' neg' : ''}">${money(l.balance, l.cur)}<small>${owedLabel(l)}</small></span></button>`;
}

function workerDetail(id) {
  const w = workerOf(id);
  if (!w || w.deleted) return false;
  const l = ledgerOf(w), left = w.status === 'left';
  const pays = live(S.expenses).filter(e => e.worker === id).sort((a, b) => byAt(b, a));
  const facts = [['Job', w.job], ['Phone', w.phone], ['Monthly wage', money(w.wage, w.cur)], ['Started', fmtDate(w.start)], ['Salary cleared up to', w.clearedTo && fmtDate(w.clearedTo)], ['Left on', w.left && fmtDate(w.left)],
    ['ID number', w.idNo], ['Before the app', w.openingAmount ? beforeText(w.openingAmount, w.cur) : '']];
  const idPhoto = latestFile(id, 'idphoto');
  // every voucher and slip given to them, and their signed statements
  const payIds = new Set(pays.map(e => e.id));
  const docs = [...live(S.files), ...outbox.map(f => ({ ...f, pending: true }))].filter(f => (payIds.has(f.for) && ['voucher', 'slip'].includes(f.type)) || (f.for === id && f.type === 'statement'))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  openSheet(`${head(w.name, '', w.id)}
    <div class="wtop"><span class="wphoto" id="wPhoto">${esc(initials(w.name))}</span>
      <div><div class="dbig ${l.balance < 0 ? 'out' : ''}" style="margin:0">${money(l.balance, l.cur)}</div><small class="muted">${l.balance >= 0 ? `still to pay ${esc(w.name)}` : 'paid more than earned so far'}${left ? ' · has left' : ''}</small></div></div>
    ${waitingNote(id)}
    ${approvedAdvances(id).map(c => `<div class="banner new"><span>✅ Advance of ${money(+c.after.amount, c.after.cur)} approved by ${esc(c.decidedBy)}.</span><button class="btn small" data-act="payWorker" data-pay="advance" data-id="${esc(id)}" data-approval="${esc(c.id)}">Give it</button></div>`).join('')}
    <div class="two">${left
      ? `<button class="btn out" data-act="settle" data-id="${esc(id)}">${l.balance > 0.004 ? '💵 Pay final settlement' : '📑 Final settlement statement'}</button>`
      : `<button class="btn out" data-act="payWorker" data-pay="salary" data-id="${esc(id)}">💵 Pay salary</button><button class="btn ghost" data-act="payWorker" data-pay="advance" data-id="${esc(id)}">➖ Advance</button>`}<button class="btn ghost" data-act="workerStatement" data-id="${esc(id)}">📄 Statement</button></div>
    <dl class="facts" style="margin-top:16px">${facts.filter(f => f[1]).map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    <div class="two">${canChange() ? `<button class="btn ghost" data-act="editWorker" data-id="${esc(id)}">✏️ Edit 🔒</button>` : ''}${left || !canChange() ? '' : `<button class="btn danger" data-act="markLeft" data-id="${esc(id)}">🚪 Has left 🔒</button>`}</div>
    <div class="two" style="margin-top:10px">${attachButton(id, '🙂 Profile photo', 'profile', 'image/*')}${idPhoto ? `<button class="btn ghost" data-act="showFile" data-id="${esc(idPhoto.id)}">🪪 ID photo</button>` : attachButton(id, '🪪 Add ID photo', 'idphoto')}</div>
    <h3 class="subh">Wage by month</h3>
    <div class="card list inset">${[...l.months].reverse().slice(0, 12).map(m => `<div class="mrow"><span>${monthName(m.month)}</span><span class="muted">${m.days} days${m.daysOff ? ` − ${m.daysOff} not worked` : ''}</span><b>${money(m.earned, l.cur)}</b></div>`).join('') || '<p class="muted pad">Starts on ' + esc(fmtDate(w.start)) + '.</p>'}</div>
    <p class="muted">Earned ${money(l.earned, l.cur)}${l.opening > 0 ? ` + ${money(l.opening, l.cur)} owed from before the app` : l.opening < 0 ? ` − ${money(-l.opening, l.cur)} paid before the app` : ''} − paid ${money(l.paid, l.cur)} = ${money(l.balance, l.cur)}.${l.unconverted.length ? ` ⚠️ ${l.unconverted.length} payment(s) in another currency without a rate are not counted.` : ''}</p>
    <h3 class="subh">Days not worked (${absencesOf(id).length})</h3>
    ${absencesOf(id).length ? `<div class="card list inset">${absencesOf(id).slice(0, 40).map(a => `<button class="row" data-act="openAbsence" data-id="${esc(a.id)}"><span class="dot">📅</span><span class="main"><span class="t"><span class="tt">${esc(fmtDay(a.date))}</span>${waitingFor(a.id).length ? '<i class="tag warn">Delete asked</i>' : ''}</span><span class="s">${esc([a.note, a.by && 'recorded by ' + a.by].filter(Boolean).join(' · '))}</span></span></button>`).join('')}</div>` : '<p class="muted">None recorded.</p>'}
    ${left ? '' : `<button class="btn ghost" data-act="addAbsence" data-id="${esc(id)}" style="margin-top:10px">📅 Record days not worked</button>`}
    ${filesList(docs, 'Slips and statements')}
    <h3 class="subh">Payments (${pays.length})</h3>
    ${pays.length ? `<div class="card list inset">${pays.map(x => itemRow(x, 'E', true)).join('')}</div>` : '<p class="muted">Nothing paid yet.</p>'}
    ${filesBlock(id)}
    ${can('delete') ? `<button class="btn danger" data-act="del" data-kind="W" data-id="${esc(id)}" style="margin-top:18px">🗑 Delete employee 🔒</button>`
      : can('suggest') && !waitingFor(id).length ? `<button class="btn danger" data-act="askDelete" data-kind="W" data-id="${esc(id)}" style="margin-top:18px">🗑 Ask to delete employee 🔒</button>` : ''}`);
  comeBack(() => workerDetail(id));
  const photo = latestFile(id, 'profile');
  if (photo) { $('#wPhoto').dataset.photo = photo.id; loadThumbs(); }
}

function workerForm(old) {
  const d = old || { cur: 'USD', start: today(), wage: '' };
  openSheet(`${head(old ? 'Edit employee' : 'New employee', '', old?.id)}
    <form data-form="worker" data-id="${esc(old?.id || '')}">
      ${textField('name', 'Full name', 'e.g. John Deng', d.name)}
      ${textField('job', 'Job', 'e.g. Mason, driver, guard', d.job)}
      <label class="fld"><span>Phone <em>(optional)</em></span><input name="phone" type="tel" value="${esc(d.phone)}" autocomplete="off" maxlength="30"></label>
      ${curChips(d.cur, 'Wage is paid in')}
      ${amountField(d.wage, d.cur, 'wage', 'Monthly wage')}
      <label class="fld"><span>Started work on</span><input type="date" name="start" value="${esc(d.start)}" max="${today()}" required></label>
      ${old ? `<label class="fld"><span>Salary cleared up to <em>(optional — wages before this day were paid outside the app)</em></span><input type="date" name="clearedTo" value="${esc(d.clearedTo || '')}"></label>
      <label class="fld"><span>Before the app <em>(optional — owed to them, or put − for what was already paid)</em></span><input name="openingAmount" inputmode="decimal" value="${esc(d.openingAmount || '')}" placeholder="0" autocomplete="off"></label>` : `
      <div class="oldpay" hidden>
        <div class="fld"><span>Has their salary been paid?</span><div class="curseg roles">
          <label class="opt-month"><input type="radio" name="cleared" value="month" checked><span><b>Yes, up to the end of last month</b><small class="lm"></small></span></label>
          <label><input type="radio" name="cleared" value="today"><span><b>Yes, up to today</b><small>Nothing is owed today</small></span></label>
          <label><input type="radio" name="cleared" value="part"><span><b>No, not fully</b><small>Type what has been paid since they started</small></span></label>
        </div></div>
        <label class="fld paidpart" hidden><span>Already paid since they started</span><div class="amt-in"><b class="cur-sym">${SYM[d.cur].trim()}</b><input name="paidSoFar" inputmode="decimal" placeholder="0" autocomplete="off"></div><small class="amt-preview"></small></label>
        <p class="note oldinfo"></p>
      </div>`}
      ${textField('idNo', 'National ID or passport number', '', d.idNo, false)}
      ${old ? '' : `<label class="fld"><span>Photo of the national ID or passport</span><input type="file" name="idphoto" accept="image/*,application/pdf" required></label>
      <label class="fld"><span>Profile photo <em>(optional — shown in the staff list)</em></span><input type="file" name="profile" accept="image/*" capture="environment"></label>`}
      ${byField()}${approvalNote(old)}
      <p class="err"></p>
      <button class="btn primary">${old ? saveLabel() : 'Add employee'}</button>
    </form>${datalists()}`);
  refreshOld($('#sheet form'));
}
// Started on an old date: was the salary paid up to the end of last month, up to today, or only partly?
function refreshOld(f) {
  const box = $('.oldpay', f);
  if (!box) return;
  const start = f.elements.start.value, t = today(), monthEnd = lastMonthEnd();
  box.hidden = !(DATE_RE.test(start) && start < t);
  if (box.hidden) return;
  const canMonth = start <= monthEnd;
  $('.opt-month', f).hidden = !canMonth;
  if (!canMonth && f.elements.cleared.value === 'month') $('[name=cleared][value=part]', f).checked = true; // started this month: usually not paid yet
  $('.lm', f).textContent = `${monthName(monthEnd.slice(0, 7))} and before are paid; wages count from 1 ${MONTHS[+t.slice(5, 7) - 1]}`;
  const choice = f.elements.cleared.value, wage = parseAmount(f.elements.wage.value) || 0, cur = formCur(f);
  $('.paidpart', f).hidden = choice !== 'part';
  const w = { id: 'new', wage, cur, start, status: 'active', ...(choice === 'month' ? { clearedTo: monthEnd } : choice === 'today' ? { clearedTo: t } : {}) };
  const earned = workerLedger(w, [], t).earned, paid = choice === 'part' ? parseAmount(f.elements.paidSoFar.value) || 0 : 0;
  $('.oldinfo', f).innerHTML = !wage ? 'Type the monthly wage to see what is owed.'
    : choice === 'part' ? `Earned since ${fmtDate(start)}: <b>${money(earned, cur)}</b><br>Already paid: <b>${money(paid, cur)}</b><br>Still to pay now: <b>${money(minus(earned, paid), cur)}</b>`
    : choice === 'month' ? `Still to pay now (this month so far): <b>${money(earned, cur)}</b>` : 'Nothing is owed today. Wages count again from tomorrow.';
}
async function saveWorker(f) {
  const v = Object.fromEntries(new FormData(f));
  const old = workerOf(f.dataset.id);
  const wage = parseAmount(v.wage), opening = String(v.openingAmount || '').replace(/[,\s$]/g, '');
  const rec = { name: clean(v.name), job: clean(v.job), phone: clean(v.phone), wage, cur: formCur(f), start: v.start, idNo: clean(v.idNo) };
  if (!rec.name) return formErr(f, 'name', 'Type their name');
  if (!rec.job) return formErr(f, 'job', 'Type their job');
  if (wage === null) return formErr(f, 'wage', 'Type the monthly wage, like 300');
  if (!DATE_RE.test(rec.start) || rec.start > today()) return formErr(f, 'start', 'Pick the day they started');
  if (old) {
    rec.openingAmount = opening ? Math.round(Number(opening) * 100) / 100 : 0;
    rec.clearedTo = DATE_RE.test(v.clearedTo || '') ? v.clearedTo : undefined;
    if (!Number.isFinite(rec.openingAmount)) return formErr(f, 'openingAmount', 'Type a number, like 150 or −50');
  } else {
    if (!f.elements.idphoto.files[0]) return formErr(f, 'idphoto', 'Add a photo of their national ID or passport');
    const choice = $('.oldpay', f).hidden ? '' : v.cleared;
    if (choice === 'month') rec.clearedTo = lastMonthEnd();
    if (choice === 'today') rec.clearedTo = today();
    if (choice === 'part') {
      const paid = String(v.paidSoFar || '').trim() ? parseAmount(v.paidSoFar) : 0;
      if (paid === null) return formErr(f, 'paidSoFar', 'Type what has been paid, like 200 — or 0');
      if (paid) Object.assign(rec, { openingAmount: -paid, openingNote: 'Paid before the app' });
    }
  }
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
  const extra = [rec.clearedTo && `salary cleared up to ${fmtDate(rec.clearedTo)}`, rec.openingAmount && beforeText(rec.openingAmount, rec.cur)].filter(Boolean).join(' · ');
  update({ workers: [...S.workers, { id, ...rec, status: 'active', by, createdAt: stampSec() }], seq, lastBy: by,
    log: logWith([['Employee', id, `${rec.name} added · ${rec.job} · ${money(wage, rec.cur)} a month from ${fmtDate(rec.start)}${extra ? ' · ' + extra : ''}`]], by) });
  for (const type of ['idphoto', 'profile']) {
    const file = f.elements[type].files[0];
    if (!file) continue;
    try { const p = await prepareFile(file); await keepFile({ for: id, type, name: p.name, mime: p.mime }, p.data); }
    catch (e) { alert(`${FILE_NAME[type]}: ${e.message}`); }
  }
  render(); workerDetail(id); toast(`${rec.name} added ✓`);
}

// Days not worked: one day, or several days in a row; each comes off that month's wage at wage ÷ 30.
function absenceForm(id) {
  const w = workerOf(id);
  openSheet(`${head('Days not worked', 'out', w.name)}
    <form data-form="absence" data-id="${esc(id)}">
      <label class="fld"><span>Day not worked</span><input type="date" name="from" value="${today()}" min="${esc(w.start)}" max="${today()}" required></label>
      <label class="fld"><span>Until <em>(optional — for several days in a row)</em></span><input type="date" name="to" min="${esc(w.start)}" max="${today()}"></label>
      ${textField('note', 'Reason', 'e.g. Sick, absent, leave', '', false)}
      <p class="muted">Each day takes ${money(Math.round(w.wage / 30 * 100) / 100, w.cur)} off that month's wage.</p>
      ${byField()}
      <p class="err"></p>
      <button class="btn out">Save</button>
    </form>${datalists()}`);
}
// the dates from one day to another (both included)
function datesBetween(a, b) { const out = []; for (let d = a; d <= b && out.length < 62; d = dayAfter(d)) out.push(d); return out; }
// Record days not worked for someone; days already recorded are skipped. Returns how many were added, or an error.
function addAbsences(w, from, to, note, by) {
  if (!DATE_RE.test(from) || from < w.start || from > today()) return 'Pick a day between their start and today';
  if (to && (!DATE_RE.test(to) || to < from || to > today())) return 'The last day must be after the first, and not after today';
  const days = datesBetween(from, to || from);
  if (days.length > 31) return 'At most 31 days at once';
  if (w.left && days.some(d => d > w.left)) return `They left on ${fmtDate(w.left)}`;
  if (w.clearedTo && from <= w.clearedTo) return `Their salary is cleared up to ${fmtDate(w.clearedTo)}: days before that don't change the pay`;
  const have = new Set(absencesOf(w.id).map(a => a.date)), fresh = days.filter(d => !have.has(d));
  if (!fresh.length) return 'Already recorded';
  const [ids, seq] = nextIds('A', fresh.length, S.seq), at = stampSec();
  const span = fresh.length === 1 ? fmtDate(fresh[0]) : `${fmtDate(fresh[0])} – ${fmtDate(fresh[fresh.length - 1])} (${fresh.length} days)`;
  update({ absences: [...S.absences, ...fresh.map((date, i) => ({ id: ids[i], worker: w.id, date, note, by, createdAt: at }))], seq, lastBy: by,
    log: logWith([['Days not worked', w.id, `${w.name}: ${span}${note ? ' · ' + note : ''}`]], by) });
  return fresh.length;
}
function saveAbsence(f) {
  const w = workerOf(f.dataset.id), v = Object.fromEntries(new FormData(f)), by = clean(v.by);
  if (!by) return formErr(f, 'by', 'Type your name');
  const n = addAbsences(w, v.from, v.to, clean(v.note), by);
  if (typeof n === 'string') return formErr(f, 'from', n);
  closeSheet(); render(); toast(`✓ ${n} day${n === 1 ? '' : 's'} not worked recorded for ${w.name}`);
}
function absenceSheet(id) {
  const a = S.absences.find(x => x.id === id), w = a && workerOf(a.worker);
  if (!a) return;
  openSheet(`${head('Day not worked', 'out', w ? w.name : a.worker)}
    <div class="dbig out">${esc(fmtDay(a.date))}</div>
    ${waitingNote(id)}
    <dl class="facts">${[['Reason', a.note], ['Recorded by', a.by], ['Recorded', a.createdAt && fmtAbs(String(a.createdAt).slice(0, 16))], ['Comes off', w && `${money(Math.round(w.wage / 30 * 100) / 100, w.cur)} from ${monthName(a.date.slice(0, 7))}`]].filter(x => x[1]).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${can('delete') ? `<button class="btn danger" data-act="del" data-kind="A" data-id="${esc(id)}">🗑 Delete — they did work 🔒</button>` : can('suggest') && !waitingFor(id).length ? `<button class="btn danger" data-act="askDelete" data-kind="A" data-id="${esc(id)}">🗑 Ask to delete 🔒</button>` : ''}`);
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
  render(); settleWorker(w.id);
}
// Someone who left: still owed something → pay it (that slip is the full final statement); nothing owed → the signed statement.
function settleWorker(id) {
  if (ledgerOf(workerOf(id)).balance > 0.004) return payForm(id, 'settlement');
  finalSheet(id);
}
function finalSheet(id) {
  const w = workerOf(id), l = ledgerOf(w);
  openSheet(`${head('Final settlement', 'in', w.name)}
    <p class="note">${l.balance < -0.004 ? `${esc(w.name)} was paid ${money(-l.balance, l.cur)} more than they earned. The statement shows it as owed by them.` : `Every wage is paid. ${esc(w.name)} signs that they received everything up to ${fmtDate(w.left || today())}.`}</p>
    <form data-form="final" data-id="${esc(id)}">
      ${sigField(w.name)}
      ${photoField(w.name)}
      <p class="err"></p>
      <button class="btn in">Make the final settlement (PDF)</button>
    </form>`);
  sigPad($('#sheet canvas.sig'));
}
async function saveFinal(f) {
  const w = workerOf(f.dataset.id), cv = $('canvas.sig', f);
  if (!cv.dataset.ink) return formErr(f, null, 'Please ask them to sign in the box first.');
  const btn = $('button.btn', f);
  btn.disabled = true; $('.err', f).textContent = 'Making the PDF…';
  try {
    const st = workerStatementSpec(w, { final: true, no: statementNo(), sig: cv, photo: framedPhoto(f) });
    const blob = await renderStatement(st), name = `${st.no} ${fileSafe(w.name)} final settlement.pdf`;
    await keepFile({ for: w.id, type: 'statement', no: st.no, name, mime: 'application/pdf' }, await blob.arrayBuffer());
    await keepTakenPhoto(f, w.id, st.no);
    update({ log: logWith([['Final settlement', w.id, `${w.name}: final settlement statement ${st.no} signed`]]) });
    readySheet(st.title, st.no, blob, name);
  } catch (e) { btn.disabled = false; formErr(f, null, e.message); }
}
// Everything about one employee: wages month by month, every payment with its voucher number, and the balance.
// docs = voucher numbers not saved yet (the settlement slip being made right now)
function workerStatementSpec(w, { final = false, no, sig = null, photo = null, date = today(), docs = {} } = {}) {
  const l = ledgerOf(w), M = n => slipMoney(n, w.cur), end = w.status === 'left' && w.left ? w.left : today();
  const pays = live(S.expenses).filter(e => e.worker === w.id).sort(byAt);
  const settled = Math.abs(l.balance) < 0.005;
  return {
    title: final ? 'FINAL SETTLEMENT' : 'STATEMENT OF ACCOUNT', no, date: fmtDate(date), stampDate: date.split('-').reverse().join('-'),
    info: [['Employee', `${w.name}${w.job ? ` · ${w.job}` : ''}`], ['Employee no.', w.id], ['Started', fmtDate(w.start)], [w.status === 'left' ? 'Last day of work' : 'Up to', fmtDate(end)],
      ['Monthly wage', `${M(w.wage)} (30-day month)`], w.clearedTo ? ['Salary cleared up to', fmtDate(w.clearedTo)] : ['ID / passport no.', w.idNo || '—']],
    sections: [
      { title: 'Wages earned', cols: [{ h: 'Month', w: 330 }, { h: 'Days worked', w: 480 }, { h: 'Earned', w: 250, right: true }],
        rows: l.months.map(m => { const offs = dayList(absencesOf(w.id, m.month)); return [monthName(m.month), `${m.days - m.daysOff} of ${m.days}${m.daysOff ? ` (${m.daysOff} not worked${offs ? `: ${offs}` : ''})` : ''}`, M(m.earned)]; }), total: ['Total earned', M(l.earned)] },
      { title: 'Payments', cols: [{ h: 'Date', w: 170 }, { h: 'Voucher / ref', w: 200 }, { h: 'Details', w: 440 }, { h: 'Paid', w: 250, right: true }],
        rows: pays.map(e => { const c = inWage(e, w.cur); return [fmtDate(e.at.slice(0, 10)), docs[e.id] || docNo(e.id) || e.id, `${e.reason}${e.cur !== w.cur ? ` · ${slipMoney(e.amount, e.cur)}${e.rate ? ` at ${plain(e.rate)}` : ''}` : ''}`, c === null ? 'no rate' : M(c / 100)]; }),
        total: ['Total paid', M(l.paid)] },
    ],
    // the tables already total what was earned and paid: here only what is outside them, and the balance
    summary: [...(l.opening ? [[l.opening > 0 ? 'Owed from before the app' : 'Paid before the app', M(Math.abs(l.opening))]] : []),
      [l.balance >= 0 ? 'Balance due to the employee' : 'Paid ahead (owed by the employee)', M(Math.abs(l.balance)), true]],
    verdict: settled ? { text: final ? 'FULLY SETTLED — ALL WAGES PAID' : 'FULLY PAID UP TO DATE', good: true } : l.balance > 0 ? { text: `BALANCE DUE ${M(l.balance)}`, good: false } : { text: `OWED BY THE EMPLOYEE ${M(-l.balance)}`, good: false },
    sign: final ? { label: 'Received in full and final settlement', name: w.name, sig, photo } : null,
    preparedBy: myName() || S.lastBy || '', ref: w.id,
  };
}
function workerStatement(id) { const w = workerOf(id), st = workerStatementSpec(w, { no: statementNo() }); shareStatement(st, `${st.no} ${fileSafe(w.name)}.pdf`); }

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
// what is still owed for work up to the end of that month (the days not worked recorded for it are already off)
function owedFor(w, month) {
  return ledgerOf(w, month ? [today(), `${month}-31`].sort()[0] : today());
}
function payInfo(f) {
  const w = workerOf(f.dataset.id), pay = f.dataset.pay;
  if (pay === 'advance') {
    const used = advancesUsd(live(S.expenses).filter(e => e.worker === w.id), today().slice(0, 7));
    return `Advances given to ${esc(w.name)} this month: <b>${money(used, 'USD')}</b> of the ${money(ADVANCE_LIMIT_USD, 'USD')} limit.`;
  }
  const month = f.elements.month ? f.elements.month.value : '';
  const l = owedFor(w, month), m = l.months.find(x => x.month === month), offs = month ? absencesOf(w.id, month) : [];
  return `${m ? `${monthName(month)}: ${m.days - m.daysOff} days worked of ${m.days}${offs.length ? ` (not worked: ${esc(dayList(offs))})` : ''} → <b>${money(m.earned, l.cur)}</b><br>` : ''}Still to pay ${esc(w.name)}${month ? ` up to the end of ${monthName(month)}` : ''}: <b>${money(l.balance, l.cur)}</b>`;
}
function payForm(id, pay, approval) {
  const w = workerOf(id), appr = approval && approvedAdvances(id).find(c => c.id === approval);
  const month = pay === 'salary' ? payMonth(w) : '';
  const suggested = appr ? +appr.after.amount : pay === 'advance' ? '' : Math.max(0, owedFor(w, month).balance);
  const cur = appr ? appr.after.cur : w.cur;
  const title = { salary: 'Pay salary', advance: 'Give an advance', settlement: 'Final settlement' }[pay];
  openSheet(`${head(title, 'out', w.name)}
    <form data-form="pay" data-id="${esc(id)}" data-pay="${pay}" data-approval="${esc(appr ? appr.id : '')}">
      ${pay === 'salary' ? `<label class="fld"><span>For the month of</span><select name="month">${monthsOf(w).map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select></label>
      <div class="fld"><span>Days not worked that month <em>(${money(Math.round(w.wage / 30 * 100) / 100, w.cur)} a day comes off)</em></span>
        <div class="addoff"><input type="date" name="offDate" min="${esc(w.start)}" max="${today()}" aria-label="Day not worked"><button type="button" class="btn small ghost" data-act="addOffHere">＋ Add this day</button></div></div>` : ''}
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
  if (t && (t.name === 'month' || t.name === 'offDate') && !f.dataset.typed) { // keep the suggested amount in step until they type their own
    const w = workerOf(f.dataset.id), l = owedFor(w, f.elements.month.value);
    f.elements.amount.value = Math.max(0, l.balance) || '';
    refreshAmount(f.elements.amount);
  }
}
// a day not worked added straight from the salary screen
function addOffHere(b) {
  const f = b.closest('form'), w = workerOf(f.dataset.id), d = f.elements.offDate.value;
  const by = clean(f.elements.by.value) || myName() || S.lastBy || '';
  const n = addAbsences(w, d, '', '', by);
  if (typeof n === 'string') return formErr(f, 'offDate', n);
  if (d.slice(0, 7) !== f.elements.month.value) toast(`Recorded for ${monthName(d.slice(0, 7))} — another month`);
  f.elements.offDate.value = '';
  $('.err', f).textContent = '';
  refreshPay(f, f.elements.offDate);
}
function savePay(f) {
  const w = workerOf(f.dataset.id), pay = f.dataset.pay, v = Object.fromEntries(new FormData(f));
  const amount = parseAmount(v.amount), cur = formCur(f), rate = rateFrom(f, cur);
  if (amount === null) return formErr(f, 'amount', 'Type the amount paid, like 250');
  if (rate === null) return formErr(f, 'rate', RATE_ERR);
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
    worker: w.id, pay, ...(month ? { month } : {}), ...(appr ? { approval: appr.id } : {}) };
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

// What a salary slip shows: how the amount due was reached, from the payment and the employee's account.
function payslipSpec(r) {
  const w = workerOf(r.worker) || { id: r.worker || '', name: r.paidTo, wage: 0, cur: r.cur, start: r.at.slice(0, 10) };
  const M = n => slipMoney(n, w.cur), round2 = n => Math.round(n * 100) / 100, lines = [];
  const paidNow = inWage(r, w.cur); // this payment in the wage's currency (cents), or null without a rate
  // the account up to the end of the month paid (salary), the last day (settlement) or today (advance), this payment included
  const end = r.pay === 'salary' && r.month ? [today(), `${r.month}-31`].sort()[0] : r.pay === 'settlement' && w.left ? w.left : today();
  const upTo = ledgerOf(w, end), due = paidNow === null ? null : round2(upTo.balance + paidNow / 100);
  const after = { t: upTo.balance >= 0 ? 'Balance after this payment' : 'Paid ahead after this payment', v: M(Math.abs(upTo.balance)), muted: true };
  if (r.pay === 'salary' && r.month) {
    const m = upTo.months.find(x => x.month === r.month) || { days: 0, daysOff: 0, earned: 0 };
    lines.push({ t: 'Monthly wage (30-day month)', v: M(w.wage) });
    if (m.days < 30) lines.push({ t: `Pay for ${m.days} days (wage ÷ 30 × ${m.days})`, v: M(round2(w.wage * m.days / 30)) });
    const offs = dayList(absencesOf(w.id, r.month));
    if (m.daysOff) lines.push({ t: `Less ${m.daysOff} day${m.daysOff === 1 ? '' : 's'} not worked${offs ? `: ${offs}` : ''}`, v: `−${M(round2(w.wage * m.days / 30) - m.earned)}` });
    lines.push({ t: `Earned for ${monthName(r.month)}`, v: M(m.earned), strong: true });
    const other = due === null ? 0 : round2(due - m.earned);
    if (other) lines.push({ t: other > 0 ? 'Earlier months still unpaid' : 'Less advances and earlier payments', v: `${other > 0 ? '+' : '−'}${M(Math.abs(other))}` });
    if (due !== null) lines.push({ t: `Total due to end of ${MON[+r.month.slice(5, 7) - 1]} ${r.month.slice(0, 4)}`, v: M(due), strong: true });
  } else if (r.pay === 'advance') lines.push({ t: 'Advance on salary', v: slipMoney(r.amount, r.cur) });
  else if (due !== null) lines.push({ t: `Total due up to the last day of work${w.left ? `, ${fmtDate(w.left)}` : ''}`, v: M(due), strong: true });
  lines.push(after);
  const salary = r.pay === 'salary';
  return { title: SLIP_TITLE[r.pay] || SLIP_TITLE.voucher, party: ['Employee', `${w.name}${w.job ? ` · ${w.job}` : ''}`], when: [salary ? 'Pay period' : 'Date', salary ? monthName(r.month) : slipDay(r)],
    forLabel: salary ? 'Pay details' : 'Being payment for', lines,
    extra: [...(salary ? [['Paid on', slipDay(r)]] : []), ['Paid from', accountOf(r.mode)], ...rateRow(r), ['Employee no.', w.id]], signLabel: 'Received by', signName: w.name };
}
