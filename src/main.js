/* ---------- events ---------- */
const ACTIONS = {
  tab: b => { tab = b.dataset.tab; render(); scrollTo(0, 0); },
  close: closeSheet,
  setupMode: b => { setupMode = b.dataset.mode; render(); const jf = $('form[data-form=join]'); if (jf) inviteHint(jf); },
  addExpense: () => expenseForm(),
  addBulk: () => bulkForm(),
  addCredit: b => creditForm(null, b.dataset.project),
  addProject: () => projectForm(),
  addMove: () => moveForm(),
  open: b => detail(b.dataset.kind, b.dataset.id),
  openProject: b => projectDetail(b.dataset.id),
  edit: async b => {
    const k = b.dataset.kind, r = S[COLL[k]].find(x => x.id === b.dataset.id);
    if (await unlock('Enter the password to edit this entry.')) ({ E: expenseForm, R: creditForm, T: moveForm })[k](r);
  },
  del: b => deleteRecord(b.dataset.kind, b.dataset.id),
  editProject: async b => { if (await unlock('Enter the password to edit this project.')) projectForm(S.projects.find(p => p.id === b.dataset.id)); },
  delProject: b => deleteProject(b.dataset.id),
  unlockDate: async b => {
    if (!await unlock('Enter the password to use a different date.')) return;
    b.closest('.fld').outerHTML = whenField(stamp(), true);
  },
  addRow: () => { const rows = $('.brows'); rows.insertAdjacentHTML('beforeend', bulkRow()); $('.brow:last-child input', rows).focus(); },
  delRow: b => { const rows = $('.brows'); if (rows.children.length > 1) b.closest('.brow').remove(); else $$('input', b.closest('.brow')).forEach(i => (i.value = '')); updateBulk(rows.closest('form')); },
  hist: b => { histKind = b.dataset.k; histMonth = ''; render(); },
  backup: () => doBackup(),
  restore: () => $('#restoreFile').click(),
  settings: async () => { if (await unlock('Enter the password to change settings.')) settingsForm(); },
  lock: () => { unlockedUntil = 0; renderLock(); toast('Locked 🔒'); },
  connect: async () => { if (await unlock('Enter the password to connect this device to the Google Sheet.')) connectForm(); },
  syncNow: () => syncNow(),
  invite: () => inviteSheet(),
  copyInvite: () => navigator.clipboard.writeText($('#inviteLink').value).then(() => toast('Link copied ✓'), () => { $('#inviteLink').select(); toast('Select the link and copy it'); }),
  // the link goes inside the text: some apps (WhatsApp on iPhone) drop a separate url
  shareInvite: () => navigator.share({ text: `Join ${S.company} accounts: ${$('#inviteLink').value}` }).catch(() => {}),
  disconnect: () => disconnect(),
  importOld: () => importSheet(),
  howUpdate: () => howUpdateSheet(),
  updateApp: () => updateApp(),
  assignPick: b => assignSheet(b.dataset.id),
  pickAll: b => { const f = b.closest('form'); $$('.pick:not([hidden]) input', f).forEach(i => (i.checked = true)); updatePick(f); },
  pickNone: b => { const f = b.closest('form'); $$('input[name=pick]', f).forEach(i => (i.checked = false)); updatePick(f); },
  signIn: () => signInSheet(),
  setupLogins: () => setupLoginsSheet(),
  users: () => usersSheet(),
  userForm: b => userForm(b.dataset.id),
  requireLogins: b => requireLogins(!!b.dataset.on),
  account: () => accountSheet(),
  signOut: () => signOut(),
  approvals: () => approvalsSheet(),
  moveApp: () => moveApp(),
  decide: b => decide(b.dataset.id, !!b.dataset.ok),
  askDelete: b => askDelete(b.dataset.kind, b.dataset.id),
  slip: b => slipSheet(b.dataset.kind, b.dataset.id),
  sigClear: b => sigPad($('canvas.sig', b.closest('.fld'))),
  showFile: b => showFile(b.dataset.id),
  shareShown: () => shareShown(),
  letterhead: async () => { if (await unlock('Enter the password to change the letterhead.')) letterheadSheet(); },
  stamp: async () => { if (await unlock('Enter the password to change the company stamp.')) stampSheet(); },
  nudge: b => nudgeStamp(b.dataset.k, b.dataset.d),
  stampSave: () => saveStampPlace(),
  changeCode: () => changeCode(),
  bioOn: () => bioOn(),
  bioOff: () => bioOff(),
  reveal: async () => { if (await pinPrompt({ why: 'Enter your code to see the balances' })) { showMoney = true; render(); } },
  conceal: () => { showMoney = false; render(); },
  addWorker: () => workerForm(),
  openWorker: b => workerDetail(b.dataset.id),
  editWorker: async b => { if (await unlock('Enter the password to change this employee.')) workerForm(workerOf(b.dataset.id)); },
  markLeft: async b => { if (await unlock('Enter the password to record that this employee has left.')) leftForm(b.dataset.id); },
  payWorker: b => payForm(b.dataset.id, b.dataset.pay, b.dataset.approval),
  settle: b => settleWorker(b.dataset.id),
  workerStatement: b => workerStatement(b.dataset.id),
  projectStatement: b => projectStatement(b.dataset.id),
  payeeStatement: b => payeeStatement(b.dataset.name),
};
const FORMS = { expense: saveExpense, credit: saveCredit, move: saveMove, assign: saveAssign, bulk: saveBulk, project: saveProject, settings: saveSettings, setup: doSetup, join: doJoin, connect: doConnect, import: doImport,
  signin: doSignIn, setupLogins: doSetupLogins, user: saveUserForm, password: doChangePassword, slip: saveSlip, worker: saveWorker, left: saveLeft, pay: savePay, final: saveFinal };

function refreshAmount(input) {
  const n = parseAmount(input.value);
  input.closest('.fld').querySelector('.amt-preview').textContent = n === null ? '' : money(n, formCur(input.form));
  refreshRate(input.form);
}
// "≈ $55.56" under the SSP rate, so a mistyped rate shows at once
function refreshRate(f) {
  const out = f && $('.rate-usd', f);
  if (!out) return;
  const rate = parseAmount(f.elements.rate.value), amt = f.elements.amount ? parseAmount(f.elements.amount.value) : null;
  out.textContent = rate === null ? '' : amt === null ? `1 USD = ${plain(rate)} SSP` : `${money(amt, 'SSP')} is about ${money(Math.round(amt / rate * 100) / 100, 'USD')}`;
}
document.addEventListener('click', e => {
  const k = e.target.closest('[data-pin]');
  if (k) return pinKey(k.dataset.pin);
  const b = e.target.closest('[data-act]');
  if (b && ACTIONS[b.dataset.act]) ACTIONS[b.dataset.act](b);
});
document.addEventListener('submit', e => {
  if (e.target.id === 'lkPwForm') return pinPassword(e);
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  FORMS[f.dataset.form](f);
});
document.addEventListener('input', e => {
  const t = e.target;
  t.classList.remove('bad');
  if (t.closest('.brows')) updateBulk(t.form);
  if (t.closest('.amt-in')) refreshAmount(t);
  if (t.name === 'rate' && t.form) refreshRate(t.form);
  if (t.form && t.form.dataset.form === 'pay') { if (t.name === 'amount') t.form.dataset.typed = '1'; refreshPay(t.form, t); }
  if (t.form && t.form.dataset.form === 'worker') refreshOld(t.form);
  if (t.name === 'rows' && t.form && t.form.dataset.form === 'import') previewImport(t.form);
  if (t.name === 'invite' && t.form) inviteHint(t.form);
  if (t.id === 'q') { histQuery = t.value; $('#histRes').innerHTML = histResults(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'cur' && t.form) {
    $$('.cur-sym', t.form).forEach(s => (s.textContent = SYM[t.value].trim()));
    $$('.amt-in input', t.form).forEach(refreshAmount);
    if ($('.brows', t.form)) updateBulk(t.form);
    $$('.ratef', t.form).forEach(l => { l.hidden = t.value !== 'SSP'; $('input', l).required = !l.hidden; });
    refreshRate(t.form);
  }
  if (t.dataset.attach !== undefined) attachPicked(t);
  if (t.form && t.form.dataset.form === 'pay' && t.name === 'month') refreshPay(t.form, t);
  if (t.form && t.form.dataset.form === 'worker') refreshOld(t.form);
  if (t.name === 'pick' && t.form) updatePick(t.form);
  if (t.name === 'others' && t.form) { $$('.pick[data-other="1"]', t.form).forEach(row => { row.hidden = !t.checked; if (!t.checked) $('input', row).checked = false; }); updatePick(t.form); }
  if (t.name === 'project' && t.form) { const np = $('.newp', t.form); if (np) { np.hidden = t.value !== '__new'; if (!np.hidden) $('input', np).focus(); } }
  if (t.id === 'month') { histMonth = t.value; $('#histRes').innerHTML = histResults(); }
  if (t.id === 'restoreFile') { doRestore(t.files[0]); t.value = ''; }
});
// pasting an invite replaces the box (it may already hold the link) instead of adding to it
document.addEventListener('paste', e => {
  const t = e.target;
  if (t.name !== 'invite' || !e.clipboardData) return;
  e.preventDefault();
  t.value = e.clipboardData.getData('text').trim();
  t.dispatchEvent(new Event('input', { bubbles: true }));
});
// another tab of this app saved something: pick it up so neither tab overwrites the other
addEventListener('storage', e => { if (e.key === KEY) { S = load(); render(); } if (e.key === SESSION_KEY) { session = loadSession(); render(); } });
// sync as soon as the internet comes back, when the app is reopened, and every few minutes
addEventListener('online', () => scheduleSync(0));
document.addEventListener('visibilitychange', () => { if (!document.hidden) { scheduleSync(0); checkForUpdate(); } });

/* the code pad: typing on a keyboard works too; opening the app can't be skipped */
document.addEventListener('keydown', e => {
  if (!pin || pin.mode === 'pass' || !$('#lock').open) return;
  if (/^\d$/.test(e.key)) { e.preventDefault(); pinKey(e.key); }
  else if (e.key === 'Backspace') { e.preventDefault(); pinKey('del'); }
});
$('#lock').addEventListener('cancel', e => { if (pin && pin.mandatory) e.preventDefault(); else if (pin) { e.preventDefault(); pinKey('cancel'); } });
$('#lock').addEventListener('close', () => { if (pin && pin.mandatory) $('#lock').showModal(); }); // closed by the browser anyway: open again
// Leaving the app locks it: coming back asks for the code. Not when the app itself sent you away for a moment
// (the camera, choosing a file, the share sheet) — that is consumed by the next return.
// ponytail: a picker that was cancelled without leaving keeps the pass until the next return within 5 minutes
let leftAt = 0, pickerAt = 0;
document.addEventListener('click', e => {
  const t = e.target;
  if ((t.type === 'file') || t.closest('label')?.querySelector('input[type=file]') || t.closest('[data-act=shareShown], [data-act=shareInvite]')) pickerAt = Date.now();
}, true);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { leftAt = Date.now(); return; }
  const mine = pickerAt && Date.now() - pickerAt < 5 * 60e3;
  pickerAt = 0;
  if (leftAt && !mine) lockApp();
});
setInterval(() => { if (!document.hidden) syncNow(); }, SYNC_EVERY_MS);
setInterval(renderLock, 10000);

if (S) { S = migrate(S); save(); repairImportedMoves(); }
loadOutbox().then(() => { if (outbox.length) uploadFiles(); });
if (S && location.hash) history.replaceState(null, '', location.pathname);
if (location.search) history.replaceState(null, '', location.pathname + location.hash); // drop ?v= left by an update
render();
lockApp(); // opening the app asks for the code (a phone signed in before codes existed chooses one now)
checkForUpdate();
if ($('form[data-form=join]')) inviteHint($('form[data-form=join]'));
scheduleSync(0);
// offline support: the service worker keeps a copy of the app on the device
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // a new version was installed in the background: switch to it now, not on the next open
  const hadCopy = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadCopy || reloading) return; // very first install: this page is already the newest
    const go = () => { reloading = true; location.reload(); };
    const busy = [$('#sheet'), $('#pw')].find(d => d.open);
    if (!busy) return go();
    toast('A new version is ready — it opens when you close this window');
    busy.addEventListener('close', go, { once: true });
  });
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Offline copy not installed:', e.message));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
  });
}
