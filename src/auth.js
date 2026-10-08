/* ---------- logins ---------- */
// Each person signs in with their own username and password. The Google Sheet checks it and decides
// what they receive and may change; the app only hides what they can't use. Until the sheet has
// logins (or for a phone that hasn't signed in yet) everything works as before, with the company password.
// The sign-in lives in its own storage slot, so it never ends up in a backup file.
const SESSION_KEY = KEY + '-login';
const ROLES = { admin: 'Admin', manager: 'Office manager', store: 'Store keeper' };
const ROLE_HELP = { admin: 'Everything, including giving logins', manager: 'Sees everything · adds and edits entries', store: 'Adds expenses · sees only their own, no company money' };
const RIGHTS = {
  admin: ['add', 'edit', 'delete', 'date', 'money', 'projects', 'settings', 'import', 'backup', 'restore', 'logins', 'phones'],
  manager: ['add', 'suggest', 'date', 'money', 'projects', 'backup'], // suggest = edits wait for an admin's approval
  store: ['add'],
};
const NOTHING_SEEN = { expenses: [], credits: [], transfers: [], projects: [], log: [], changes: [] };

// { token, user: { id, name, username, role }, check: { salt, hash } } — or { out: true, why } once signed out
let session = loadSession();
let usersCache = [];
function loadSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
function saveSession(s) {
  session = s;
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { alert('⚠️ Could not save the sign-in: ' + e.message); }
}
const signedIn = () => !!(session && session.token);
const myName = () => (signedIn() ? session.user.name : '');
const can = what => !signedIn() || RIGHTS[session.user.role].includes(what);
const mustSignIn = () => !!(S && S.link && session && session.out);
const signInBanner = () => (S.link?.logins && !signedIn() ? `<div class="banner new"><span>👤 Everyone can now have their own login. Sign in with yours.</span><button class="btn small" data-act="signIn">Sign in</button></div>` : '');

// Signed in: remember who, and a check of the password so "unlock" works offline.
// The company code is removed from this phone, so a closed login can't fall back to it.
async function signedInAs(res, password) {
  const salt = randHex();
  saveSession({ token: res.token, user: res.me, check: { salt, hash: await hashPw(password, salt) } });
  // reload the company settings as this person may see them (only admins get the company password);
  // a store keeper sees only their own entries: drop what this phone held before (it's all on the sheet)
  const clear = { settingsU: 0, ...(res.me.role === 'admin' ? {} : { pass: null }), ...(res.me.role === 'store' && !S.dirty.length ? NOTHING_SEEN : {}) };
  S = { ...S, ...clear, link: { ...S.link, k: '', since: 0, logins: true }, lastBy: res.me.name };
  save();
}
// The sheet ended this sign-in (password reset, login disabled, or logins now required).
function signedOutByServer(why) {
  saveSession({ out: true, why });
  // nothing stays on a phone that lost access — except changes it hasn't sent yet
  S = { ...S, ...(S.dirty.length ? {} : NOTHING_SEEN), link: { ...S.link, since: 0 } };
  save(); closeSheet(); render();
}
async function signOut() {
  const n = S.dirty.length;
  if (n) return alert(`This phone has ${n} change${n === 1 ? '' : 's'} not sent to the Google Sheet yet.\n\nConnect to the internet and wait until it says "Up to date", then sign out.`);
  if (!confirm('Sign out of this phone?\n\nThe company records leave this phone. They come back when someone signs in.')) return;
  try { await callServer(S.link, { op: 'logout' }); } catch { /* already signed out on the sheet: fine */ }
  saveSession({ out: true });
  S = { ...S, ...NOTHING_SEEN, link: { ...S.link, since: 0 } };
  save(); closeSheet(); render();
}

const signInFields = (autofocus = true) => `
  <label class="fld"><span>Username</span><input name="username" required autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="30" ${autofocus ? 'autofocus' : ''}></label>
  <label class="fld"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>`;
function viewSignIn() {
  const n = S.dirty.length;
  return `<section class="setup card pad">${APP_LOGO}
    <h1>Sign in</h1>
    <p>${esc(S.company || 'Company accounts')}</p>
    ${session.why ? `<p class="note">${esc(session.why)}</p>` : ''}
    <form data-form="signin">${signInFields()}
      <p class="err"></p>
      <button class="btn primary">Sign in</button>
    </form>
    ${n ? `<p class="muted">${n} change${n === 1 ? '' : 's'} on this phone ${n === 1 ? 'is' : 'are'} waiting. ${n === 1 ? 'It is' : 'They are'} sent after you sign in.</p>` : ''}
    <p class="muted center">Forgot your password? Ask an admin to give you a new one.</p>
  </section>`;
}
function signInSheet() {
  openSheet(`${head('Sign in')}
    <p class="hint">Use the username and password an admin gave you.</p>
    <form data-form="signin">${signInFields()}<p class="err"></p><button class="btn primary">Sign in</button></form>`);
}
async function doSignIn(f) {
  const v = Object.fromEntries(new FormData(f));
  $('.err', f).textContent = 'Signing in…';
  let res;
  try { res = await callServer(S.link, { op: 'login', username: v.username, password: v.password, device: S.dev }); }
  catch (e) { return formErr(f, e.offline ? null : 'password', e.offline ? 'No internet. Signing in needs internet.' : e.message); }
  await signedInAs(res, v.password);
  update({ log: logWith([['Signed in', '—', `${res.me.name} signed in on this phone (${S.dev})`]], res.me.name) });
  closeSheet(); tab = 'home'; render(); toast(`Welcome, ${res.me.name} ✓`);
  syncNow();
}

/* the owner's first login, proven with today's company code and company password */
function setupLoginsSheet() {
  openSheet(`${head('Set up logins')}
    <p class="hint">You become the first admin. Then you give logins to the Managing Director and your staff. Phones that haven't signed in keep working until you choose <b>Require logins</b>.</p>
    <form data-form="setupLogins">
      <label class="fld"><span>Company password <em>(the one you use today)</em></span><input type="password" name="company" required autocomplete="off" autofocus></label>
      <label class="fld"><span>Your name</span><input name="name" required maxlength="60" value="${esc(S.lastBy || '')}" autocomplete="name"></label>
      <label class="fld"><span>Choose a username <em>(what you type to sign in)</em></span><input name="username" required maxlength="30" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="e.g. john"></label>
      <label class="fld"><span>Your new password</span><input type="password" name="pw" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></label>
      <label class="fld"><span>Type it again</span><input type="password" name="pw2" required minlength="6" autocomplete="new-password"></label>
      <p class="err"></p>
      <button class="btn primary">Set up logins</button>
    </form>`);
}
async function doSetupLogins(f) {
  const v = Object.fromEntries(new FormData(f));
  if (v.pw !== v.pw2) return formErr(f, 'pw2', "The two passwords don't match.");
  $('.err', f).textContent = 'Setting up…';
  let res;
  try { res = await callServer(S.link, { op: 'setup', key: S.link.k, password: v.company, name: clean(v.name), username: v.username, newPassword: v.pw, device: S.dev }); }
  catch (e) { return formErr(f, null, e.offline ? 'No internet. This needs internet.' : e.message); }
  if (!res.token) return formErr(f, null, 'The Google Sheet script is too old for logins. Update it to version 3 first (Sheet tab → Show me how).');
  await signedInAs(res, v.pw);
  update({ log: logWith([['Logins', '—', `Logins set up. ${res.me.name} (${res.me.username}) is the first admin.`]], res.me.name) });
  render(); toast('Logins are ready ✓ Now give the others theirs.');
  syncNow();
  usersSheet();
}

/* admins: give, change and close logins */
async function usersSheet() {
  openSheet(`${head('Logins')}<p class="muted">Loading…</p>`);
  let res;
  try { res = await callServer(S.link, { op: 'users' }); }
  catch (e) { return openSheet(`${head('Logins')}<p class="err">${esc(e.offline ? 'No internet. Managing logins needs internet.' : e.message)}</p>`); }
  usersCache = res.users;
  const active = res.users.filter(u => u.active).length;
  openSheet(`${head('Logins', '', `${active} active`)}
    <button class="btn primary" data-act="userForm">＋ Give someone a login</button>
    <div class="card list inset" style="margin-top:14px">${res.users.map(userRow).join('')}</div>
    <h3 class="subh">Old invite links</h3>
    <p class="muted">${res.required ? '🔒 Only signed-in people can use the app. Old invite links and the company code no longer work.' : 'Phones that joined with an old invite link still work without a login. When everyone has signed in with their own login, switch this on.'}</p>
    <button class="btn ${res.required ? 'ghost' : 'out'}" data-act="requireLogins" data-on="${res.required ? '' : '1'}">${res.required ? 'Allow old invite links again' : 'Require logins for everyone'}</button>`);
}
const lastSeen = u => (u.lastLogin ? ` · signed in ${fmtAbs(stamp(new Date(u.lastLogin)))}` : ' · not signed in yet');
const userRow = u => `<button class="row" data-act="userForm" data-id="${esc(u.id)}">
  <span class="dot">${u.active ? '👤' : '⛔'}</span>
  <span class="main"><span class="t"><span class="tt">${esc(u.name)}</span>${u.active ? '' : '<i class="tag warn">Blocked</i>'}${session.user.id === u.id ? '<i class="tag">You</i>' : ''}</span>
  <span class="s">${esc(u.username)} · ${ROLES[u.role]}${lastSeen(u)}</span></span></button>`;
function userForm(id) {
  const u = usersCache.find(x => x.id === id);
  const role = u ? u.role : 'store';
  openSheet(`${head(u ? u.name : 'New login', '', u ? u.username : '')}
    <form data-form="user" data-id="${esc(u?.id || '')}">
      <label class="fld"><span>Name</span><input name="name" required maxlength="60" value="${esc(u?.name)}" placeholder="e.g. Mary" ${u ? '' : 'autofocus'}></label>
      <label class="fld"><span>Username <em>(what they type to sign in)</em></span><input name="username" required maxlength="30" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(u?.username)}" placeholder="e.g. mary"></label>
      <div class="fld"><span>What may they do?</span><div class="curseg roles">${Object.keys(ROLES).map(r => `<label><input type="radio" name="role" value="${r}" ${r === role ? 'checked' : ''}><span><b>${ROLES[r]}</b><small>${ROLE_HELP[r]}</small></span></label>`).join('')}</div></div>
      <label class="fld"><span>${u ? 'New password <em>(leave empty to keep theirs)</em>' : 'Password'}</span><input name="password" ${u ? '' : 'required'} minlength="6" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="At least 6 characters"></label>
      ${u ? `<label class="fld check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Login is open <em>(untick to block this person)</em></label>` : ''}
      <p class="err"></p>
      <button class="btn primary">${u ? 'Save changes' : 'Create login'}</button>
    </form>
    <p class="center"><button class="link" data-act="users">← All logins</button></p>`);
}
async function saveUserForm(f) {
  const v = Object.fromEntries(new FormData(f));
  const id = f.dataset.id;
  const user = { name: clean(v.name), username: clean(v.username).toLowerCase(), role: v.role, ...(id ? { id, active: !!v.active } : {}), ...(v.password ? { password: v.password } : {}) };
  $('.err', f).textContent = 'Saving…';
  try { usersCache = (await callServer(S.link, { op: 'saveUser', user })).users; }
  catch (e) { return formErr(f, null, e.offline ? 'No internet. Managing logins needs internet.' : e.message); }
  const what = [id ? 'Login changed' : 'Login given', `${user.name} (${user.username}) · ${ROLES[user.role]}`, id && !user.active && 'blocked', id && v.password && 'new password'].filter(Boolean).join(' · ');
  update({ log: logWith([['Logins', id || '—', what]]) });
  toast(id ? 'Saved ✓' : `Login created ✓ Tell ${user.name}: username "${user.username}" and the password`);
  if (id === session.user.id && (user.role !== session.user.role || v.password)) return syncNow(); // own role or password changed: sign in again
  usersSheet();
}
async function requireLogins(on) {
  if (on && !confirm('Require logins for everyone?\n\nPhones that have not signed in stop syncing until they sign in. Old invite links and the company code stop working.\n\nOnly do this when everyone has their own login.')) return;
  try { await callServer(S.link, { op: 'require', on: !!on }); }
  catch (e) { return alert(e.offline ? 'No internet.' : e.message); }
  update({ log: logWith([['Logins', '—', on ? 'Logins required for everyone — old invite links stopped' : 'Old invite links allowed again']]) });
  toast(on ? 'Done 🔒 Only signed-in people can use the app now' : 'Old invite links work again');
  usersSheet();
}

/* my login */
function accountSheet() {
  const u = session.user;
  openSheet(`${head(u.name, '', `${u.username} · ${ROLES[u.role]}`)}
    <form data-form="password">
      <h3 class="subh" style="margin-top:0">Change my password</h3>
      <label class="fld"><span>Current password</span><input type="password" name="old" required autocomplete="current-password"></label>
      <label class="fld"><span>New password</span><input type="password" name="pw" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></label>
      <label class="fld"><span>New password again</span><input type="password" name="pw2" required minlength="6" autocomplete="new-password"></label>
      <p class="err"></p>
      <button class="btn primary">Change password</button>
    </form>
    <button class="btn ghost" data-act="signOut" style="margin-top:14px">Sign out of this phone</button>`);
}
async function doChangePassword(f) {
  const v = Object.fromEntries(new FormData(f));
  if (v.pw !== v.pw2) return formErr(f, 'pw2', "The two new passwords don't match.");
  $('.err', f).textContent = 'Saving…';
  try { await callServer(S.link, { op: 'password', old: v.old, password: v.pw }); }
  catch (e) { return formErr(f, e.offline ? null : 'old', e.offline ? 'No internet. Changing your password needs internet.' : e.message); }
  const salt = randHex();
  saveSession({ ...session, check: { salt, hash: await hashPw(v.pw, salt) } });
  closeSheet(); toast('Password changed ✓');
}

function loginsCard() {
  if (!S.link) return '';
  if (signedIn()) {
    return `<section class="card pad"><h3>👤 ${esc(session.user.name)}</h3>
      <p class="muted">Signed in as <b>${esc(session.user.username)}</b> · ${ROLES[session.user.role]}</p>
      <div class="two">${can('logins') ? '<button class="btn ghost" data-act="users">👥 Logins</button>' : ''}<button class="btn ghost" data-act="account">My password · Sign out</button></div></section>`;
  }
  if (S.link.logins) {
    return `<section class="card pad"><h3>👥 Logins</h3><p class="muted">Everyone can have their own username and password. Sign in with yours.</p>
      <button class="btn primary" data-act="signIn">Sign in</button></section>`;
  }
  if ((S.link.v || 2) < 3) {
    return `<section class="card pad"><h3>👥 Logins</h3><p class="muted">Give each person their own username and password. This needs the newest Google Sheet script (version 3).</p>
      <button class="btn ghost" data-act="howUpdate">Show me how to update it</button></section>`;
  }
  return `<section class="card pad"><h3>👥 Logins</h3><p class="muted">Give each person their own username and password, and decide what they may see and do. You become the first admin.</p>
    <button class="btn primary" data-act="setupLogins">Set up logins 🔒</button></section>`;
}

/* ---------- edits waiting for approval ---------- */
// An office manager's edit doesn't change the entry: it becomes a change request (kind C) that an admin
// approves or rejects. Until then the entry and every total keep the old values.
const canChange = () => can('edit') || can('suggest');
const saveLabel = () => (can('edit') ? 'Save changes' : 'Send for approval');
const approvalNote = old => (old && !can('edit') ? '<p class="note">An admin approves this change first. Until then the entry and the totals stay as they are.</p>' : '');
const waiting = () => (S.changes || []).filter(c => c.status === 'waiting');
const waitingFor = id => waiting().filter(c => c.target === id);
const waitingNote = id => waitingFor(id).map(c => `<p class="note">✏️ <b>Change waiting for approval</b> — ${esc(c.text)} · asked by ${esc(c.by)}, ${fmtAbs(c.at)}</p>`).join('');
const recordsOf = kind => S[kind === 'P' ? 'projects' : COLL[kind]];

function requestChange(kind, old, rec, changes, by) {
  const [[id], seq] = nextIds('C', 1, S.seq);
  const before = Object.fromEntries(Object.keys(rec).map(f => [f, old[f] ?? '']));
  update({
    changes: [...S.changes, { id, kind, target: old.id, before, after: rec, text: changes.join(' ; '), by, at: stamp(), createdAt: stampSec(), status: 'waiting' }], seq,
    log: logWith([['Change asked', old.id, `${changes.join(' ; ')} — waiting for an admin`]], by), lastBy: by,
  });
  closeSheet(); render(); toast('Sent for approval ✓ It changes when an admin approves it.');
}
function approvalsBanner() {
  const n = waiting().length;
  if (!n) return '';
  if (can('edit')) return `<div class="banner"><span>✏️ ${n} change${n === 1 ? '' : 's'} waiting for your approval.</span><button class="btn small" data-act="approvals">Review</button></div>`;
  const mine = waiting().filter(c => c.by === myName()).length;
  return mine ? `<div class="banner new"><span>✏️ ${mine} of your changes ${mine === 1 ? 'is' : 'are'} waiting for an admin to approve.</span></div>` : '';
}
function approvalsSheet() {
  const list = waiting().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  openSheet(`${head('Changes to approve', '', `${list.length} waiting`)}
    ${list.length ? list.map(changeCard).join('') : '<p class="muted">Nothing is waiting. ✓</p>'}`);
}
function changeCard(c) {
  const r = recordsOf(c.kind).find(x => x.id === c.target);
  const gone = !r || r.deleted;
  // the entry was changed by someone else after this request: show it so the admin looks first
  const moved = r && Object.keys(c.before).some(f => String(r[f] ?? '') !== String(c.before[f] ?? ''));
  return `<section class="card pad" style="margin-bottom:12px">
    <p style="margin:0 0 6px"><b>${esc(r ? (c.kind === 'P' ? `Project "${r.name}"` : describe(c.kind, r)) : c.target)}</b></p>
    <ul style="margin:0 0 8px;padding-left:20px">${c.text.split(' ; ').map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <p class="muted" style="margin:0 0 10px">Asked by ${esc(c.by)} · ${fmtAbs(c.at)}</p>
    ${gone ? '<p class="note">This entry was deleted — the change can only be rejected.</p>' : moved ? '<p class="note">⚠️ This entry was changed after the request. Check it before approving.</p>' : ''}
    <div class="two"><button class="btn danger" data-act="decide" data-id="${esc(c.id)}" data-ok="">Reject</button><button class="btn in" data-act="decide" data-id="${esc(c.id)}" data-ok="1" ${gone ? 'disabled' : ''}>Approve</button></div>
  </section>`;
}
async function decide(id, ok) {
  if (!await unlock('Enter the password to approve or reject changes.')) return;
  const c = S.changes.find(x => x.id === id);
  if (!c || c.status !== 'waiting') return approvalsSheet();
  const me = myName() || S.lastBy || 'Admin', key = c.kind === 'P' ? 'projects' : COLL[c.kind];
  const patch = {
    changes: S.changes.map(x => (x.id === id ? { ...x, status: ok ? 'approved' : 'rejected', decidedBy: me, decidedAt: stampSec() } : x)),
    log: logWith([[ok ? 'Approved' : 'Rejected', c.target, `${c.text} — asked by ${c.by}`]], me),
  };
  if (ok) patch[key] = S[key].map(x => (x.id === c.target ? { ...x, ...c.after, editedAt: stampSec(), editedBy: `${c.by} (approved by ${me})` } : x));
  update(patch);
  render(); approvalsSheet(); toast(ok ? 'Approved ✓ The entry is changed' : 'Rejected — the entry stays as it was');
}
