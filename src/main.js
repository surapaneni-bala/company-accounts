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
};
const FORMS = { expense: saveExpense, credit: saveCredit, move: saveMove, assign: saveAssign, bulk: saveBulk, project: saveProject, settings: saveSettings, setup: doSetup, join: doJoin, connect: doConnect, import: doImport };

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
  if (t.name === 'invite' && t.form) inviteHint(t.form);
  if (t.id === 'q') { histQuery = t.value; $('#histRes').innerHTML = histResults(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'cur' && t.form) {
    $$('.cur-sym', t.form).forEach(s => (s.textContent = SYM[t.value].trim()));
    $$('.amt-in input', t.form).forEach(refreshAmount);
    if ($('.brows', t.form)) updateBulk(t.form);
  }
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
addEventListener('storage', e => { if (e.key === KEY) { S = load(); render(); } });
// sync as soon as the internet comes back, when the app is reopened, and every few minutes
addEventListener('online', () => scheduleSync(0));
document.addEventListener('visibilitychange', () => { if (!document.hidden) { scheduleSync(0); checkForUpdate(); } });
setInterval(() => { if (!document.hidden) syncNow(); }, SYNC_EVERY_MS);
setInterval(renderLock, 10000);

if (S) { S = migrate(S); save(); repairImportedMoves(); }
if (S && location.hash) history.replaceState(null, '', location.pathname);
if (location.search) history.replaceState(null, '', location.pathname + location.hash); // drop ?v= left by an update
render();
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
