/* ---------- events ---------- */
const ACTIONS = {
  tab: b => { tab = b.dataset.tab; render(); scrollTo(0, 0); },
  close: closeSheet,
  setupMode: b => { setupMode = b.dataset.mode; render(); },
  addExpense: () => expenseForm(),
  addBulk: () => bulkForm(),
  addCredit: b => creditForm(null, b.dataset.project),
  addProject: () => projectForm(),
  open: b => detail(b.dataset.kind, b.dataset.id),
  openProject: b => projectDetail(b.dataset.id),
  edit: async b => {
    const k = b.dataset.kind, r = (k === 'E' ? S.expenses : S.credits).find(x => x.id === b.dataset.id);
    if (await unlock('Enter the password to edit this entry.')) (k === 'E' ? expenseForm : creditForm)(r);
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
  shareInvite: () => navigator.share({ title: `Join ${S.company}`, text: `Join ${S.company} accounts:`, url: $('#inviteLink').value }).catch(() => {}),
  disconnect: () => disconnect(),
  importOld: () => importSheet(),
};
const FORMS = { expense: saveExpense, credit: saveCredit, bulk: saveBulk, project: saveProject, settings: saveSettings, setup: doSetup, join: doJoin, connect: doConnect, import: doImport };

function refreshAmount(input) {
  const n = parseAmount(input.value);
  input.closest('.fld').querySelector('.amt-preview').textContent = n === null ? '' : money(n, formCur(input.form));
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && ACTIONS[b.dataset.act]) ACTIONS[b.dataset.act](b);
});
document.addEventListener('submit', e => {
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
  if (t.name === 'rows' && t.form && t.form.dataset.form === 'import') previewImport(t.form);
  if (t.id === 'q') { histQuery = t.value; $('#histRes').innerHTML = histResults(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'cur' && t.form) {
    $$('.cur-sym', t.form).forEach(s => (s.textContent = SYM[t.value].trim()));
    $$('.amt-in input', t.form).forEach(refreshAmount);
    if ($('.brows', t.form)) updateBulk(t.form);
  }
  if (t.name === 'project' && t.form) { const np = $('.newp', t.form); if (np) { np.hidden = t.value !== '__new'; if (!np.hidden) $('input', np).focus(); } }
  if (t.id === 'month') { histMonth = t.value; $('#histRes').innerHTML = histResults(); }
  if (t.id === 'restoreFile') { doRestore(t.files[0]); t.value = ''; }
});
// another tab of this app saved something: pick it up so neither tab overwrites the other
addEventListener('storage', e => { if (e.key === KEY) { S = load(); render(); } });
// sync as soon as the internet comes back, when the app is reopened, and every few minutes
addEventListener('online', () => scheduleSync(0));
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSync(0); });
setInterval(() => { if (!document.hidden) syncNow(); }, SYNC_EVERY_MS);
setInterval(renderLock, 10000);

if (S) { S = migrate(S); save(); }
if (S && location.hash) history.replaceState(null, '', location.pathname);
render();
scheduleSync(0);
// offline support: the service worker keeps a copy of the app on the device
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Offline copy not installed:', e.message));
}
