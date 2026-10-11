/* ---------- regular payments: rent, internet, licence fees ---------- */
// A regular payment (kind G) is something paid again every 1, 3, 6 or 12 months. Paying it is an ordinary expense that
// names it (regular) and the due date it pays (period), so nothing about what was paid is stored on it: where it stands
// is worked out from those expenses (calc.js regularDue). Admins set them up; the office manager pays them too.
const EVERY = { 1: 'Every month', 3: 'Every 3 months', 6: 'Every 6 months', 12: 'Every year' };
const DUE_SOON_DAYS = 7; // ponytail: a week's notice for all of them; a setting per payment if the owner wants one
const regularOf = id => S.regulars.find(g => g.id === id && !g.deleted);
const dueOf = g => regularDue(g, live(S.expenses).filter(e => e.regular === g.id && e.period).map(e => e.period), today());
const daysTo = d => Math.round((Date.parse(d) - Date.parse(today())) / 864e5);
const isDueSoon = due => !!due.next && daysTo(due.next) <= DUE_SOON_DAYS;
function dueText({ next, late }) {
  const n = daysTo(next);
  if (late > 1) return `${late} payments late — the oldest was due ${fmtDate(next)}`;
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} late — due ${fmtDate(next)}`;
  return n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : n <= DUE_SOON_DAYS ? `Due in ${n} days — ${fmtDay(next)}` : `Next due ${fmtDate(next)}`;
}
// what one payment covers: "October 2026", or "1 Oct 2026 – 31 Dec 2026"
function periodText(g, d) {
  if (g.every === 1) return monthName(d.slice(0, 7));
  const k = Math.round(((+d.slice(0, 4) - +g.first.slice(0, 4)) * 12 + (+d.slice(5, 7) - +g.first.slice(5, 7))) / g.every);
  return `${fmtDate(d)} – ${fmtDate(dayBefore(dueOn(g.first, g.every, k + 1)))}`;
}
const dueList = () => live(S.regulars).map(g => [g, dueOf(g)]).sort((a, b) => (a[1].next || '9').localeCompare(b[1].next || '9'));

// at the top of Accounts: what is due within a week, or late
function regularBanners() {
  if (!can('staff')) return '';
  const due = dueList().filter(([, d]) => isDueSoon(d));
  return due.slice(0, 3).map(([g, d]) => `<div class="banner${daysTo(d.next) < 0 ? '' : ' new'}"><span>🔁 <b>${esc(g.name)}</b> · ${money(g.amount, g.cur)} to ${esc(g.paidTo)} — ${esc(dueText(d))}</span><button class="btn small" data-act="payRegular" data-id="${esc(g.id)}">Pay</button></div>`).join('')
    + (due.length > 3 ? `<div class="banner"><span>🔁 ${due.length - 3} more regular payments are due.</span><button class="btn small" data-act="regulars">See all</button></div>` : '');
}

function regularsSheet() {
  const list = dueList();
  openSheet(`${head('Regular payments', 'out')}
    <p class="hint">Rent, internet, licence fees… Each one shows here a week before it is due. <b>Pay</b> fills in the expense for you.</p>
    ${can('settings') ? '<button class="btn out" data-act="addRegular">＋ Add a regular payment 🔒</button>' : ''}
    ${list.length ? `<div class="card list inset" style="margin-top:14px">${list.map(([g, d]) => regularRow(g, d)).join('')}</div>`
      : `<div style="height:14px"></div>${empty('None yet', can('settings') ? 'Add each one once: what it is, who is paid, how much and how often.' : 'An admin adds them.')}`}`);
  comeBack(regularsSheet);
}
function regularRow(g, d) {
  const n = d.next ? daysTo(d.next) : 99;
  return `<button class="row out" data-act="openRegular" data-id="${esc(g.id)}"><span class="dot">🔁</span>
    <span class="main"><span class="t"><span class="tt">${esc(g.name)}</span>${n < 0 ? '<i class="tag bad">Late</i>' : n <= DUE_SOON_DAYS ? '<i class="tag warn">Due soon</i>' : ''}</span>
    <span class="s">${esc([g.paidTo, EVERY[g.every], dueText(d)].join(' · '))}</span></span>
    <span class="amt">${money(g.amount, g.cur)}</span></button>`;
}
function regularDetail(id) {
  const g = regularOf(id);
  if (!g) return false;
  const d = dueOf(g), pays = live(S.expenses).filter(e => e.regular === id).sort((a, b) => byAt(b, a));
  const facts = [['Paid to', g.paidTo], ['How often', EVERY[g.every]], ['First due', fmtDate(g.first)], ['Usually paid from', accountOf(g.mode)], ['Project', g.project && projName(g.project)], ['Note', g.note]];
  openSheet(`${head(g.name, 'out', id)}
    <div class="dbig out">${money(g.amount, g.cur)}</div>
    <p class="note">${esc(dueText(d))}: ${esc(periodText(g, d.next))}.</p>
    <button class="btn out" data-act="payRegular" data-id="${esc(id)}">💵 Pay ${esc(periodText(g, d.next))}</button>
    <dl class="facts" style="margin-top:16px">${facts.filter(f => f[1]).map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl>
    ${can('settings') ? `<div class="two"><button class="btn ghost" data-act="editRegular" data-id="${esc(id)}">✏️ Edit 🔒</button><button class="btn danger" data-act="delRegular" data-id="${esc(id)}">🗑 Delete 🔒</button></div>` : ''}
    <h3 class="subh">Paid so far (${pays.length})</h3>
    ${pays.length ? `<div class="card list inset">${pays.map(x => itemRow(x, 'E', true)).join('')}</div>` : '<p class="muted">Nothing paid in the app yet.</p>'}`);
  comeBack(() => regularDetail(id));
}
// paying one: the expense form, filled in, for the oldest due date not paid yet
function payRegular(id) {
  const g = regularOf(id), d = g && dueOf(g);
  if (!d || !d.next) return;
  expenseForm(null, { cur: g.cur, amount: g.amount, paidTo: g.paidTo, reason: `${g.name} — ${periodText(g, d.next)}`, location: '', project: g.project || '', mode: g.mode, regular: g.id, period: d.next,
    hint: `🔁 ${g.name}, ${periodText(g, d.next)} (due ${fmtDate(d.next)}). Change the amount if it is different this time.` });
}

function regularForm(old) {
  const d = old || { cur: defCur(), amount: '', every: 1, first: today(), mode: 'Bank', project: '' };
  openSheet(`${head(old ? 'Edit regular payment' : 'New regular payment', 'out', old?.id)}
    <form data-form="regular" data-id="${esc(old?.id || '')}">
      ${textField('name', 'What is it?', 'e.g. Land rent, Internet, Trading licence', d.name)}
      ${textField('paidTo', 'Paid to', 'Who is paid?', d.paidTo)}
      ${curChips(d.cur)}
      ${amountField(d.amount, d.cur).replace(' autofocus', '')}
      <div class="fld"><span>How often? Every…</span><div class="curseg">${EVERY_MONTHS.map(n => `<label><input type="radio" name="every" value="${n}" ${n === +d.every ? 'checked' : ''}><span><b>${n === 12 ? '1 year' : `${n} month${n === 1 ? '' : 's'}`}</b></span></label>`).join('')}</div></div>
      <label class="fld"><span>${old ? 'First due date <em>(changing it moves every due date)</em>' : 'When is it due next?'}</span><input type="date" name="first" value="${esc(d.first)}" required></label>
      ${accountChips(d.mode, 'Usually paid from')}
      ${projectSelect(d.project, true)}
      ${textField('note', 'Note', 'e.g. contract number', d.note, false)}
      <p class="err"></p>
      <button class="btn out">${old ? 'Save changes' : 'Add regular payment'}</button>
    </form>${datalists()}`);
}
function saveRegular(f) {
  const v = Object.fromEntries(new FormData(f)), old = regularOf(f.dataset.id), amount = parseAmount(v.amount), every = +v.every;
  if (!clean(v.name)) return formErr(f, 'name', 'What is it? e.g. Land rent');
  if (!clean(v.paidTo)) return formErr(f, 'paidTo', 'Who is paid?');
  if (amount === null) return formErr(f, 'amount', 'Type a correct amount, like 500');
  if (!EVERY[every]) return formErr(f, null, 'Choose how often');
  if (!DATE_RE.test(v.first)) return formErr(f, 'first', 'Choose the date it is due');
  const rec = { name: clean(v.name), paidTo: clean(v.paidTo), cur: formCur(f), amount, every, first: v.first, mode: v.mode === 'Cash' ? 'Cash' : 'Bank', project: v.project || '', note: clean(v.note) };
  const by = myName() || S.lastBy || '';
  if (old) {
    const changes = diff(old, rec);
    if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
    update({ regulars: S.regulars.map(g => (g.id === old.id ? { ...g, ...rec, editedAt: stampSec(), editedBy: by } : g)), log: logWith([['Edited', old.id, changes.join(' ; ')]], by) });
    toast('Changes saved ✓');
    return closeSheet();
  }
  const [[id], seq] = nextIds('G', 1, S.seq);
  update({ regulars: [...S.regulars, { id, ...rec, by, createdAt: stampSec() }], seq,
    log: logWith([['Added', id, `Regular payment: ${rec.name} — ${money(amount, rec.cur)} to ${rec.paidTo}, ${EVERY[every].toLowerCase()} from ${fmtDate(rec.first)}`]], by) });
  toast('Regular payment added ✓');
  render(); regularsSheet();
}
async function deleteRegular(id) {
  const g = regularOf(id);
  if (!g || !await unlock('Enter the password to delete this regular payment.')) return;
  const by = confirmBy(`Delete the regular payment "${g.name}"?\n\nWhat was already paid stays in the accounts. It just stops reminding you.`);
  if (!by) return;
  update({ regulars: S.regulars.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Regular payment: ${g.name}`]], by) });
  toast('Deleted ✓'); closeAll(); render();
}
