/* ---------- logins ---------- */
// Each person signs in with their own username and password. The Google Sheet checks it and decides
// what they receive and may change; the app only hides what they can't use. Until the sheet has
// logins (or for a phone that hasn't signed in yet) everything works as before, with the company password.
// The sign-in lives in its own storage slot, so it never ends up in a backup file.
const SESSION_KEY = KEY + '-login';
const ROLES = { admin: 'Admin', manager: 'Office manager', store: 'Store keeper' };
const ROLE_HELP = { admin: 'Everything, including giving logins', manager: 'Sees everything · adds entries · edits wait for an admin', store: 'Adds expenses · sees only their own, no company money' };
const RIGHTS = {
  admin: ['add', 'edit', 'delete', 'date', 'money', 'projects', 'settings', 'import', 'backup', 'restore', 'logins', 'phones', 'staff'],
  manager: ['add', 'suggest', 'date', 'money', 'projects', 'backup', 'staff'], // suggest = edits and deletes wait for an admin's approval
  store: ['add'],
};
const NOTHING_SEEN = { expenses: [], credits: [], transfers: [], projects: [], log: [], changes: [], workers: [], files: [] };

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

// The phone's own check of a login password (for "unlock" without internet): PBKDF2 with many rounds,
// so a copy taken from the phone is slow to crack.
async function slowHash(pw, salt) {
  const enc = new TextEncoder(), key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 200000 }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// only the entries this phone hasn't sent yet (they must never be lost)
const onlyUnsent = () => { const d = new Set(S.dirty); return Object.fromEntries(Object.keys(SYNC_KEYS).map(key => [key, S[key].filter(r => d.has(recId(key, r)))])); };

// Signed in: remember who, and a check of the password so "unlock" works offline.
// The company code is removed from this phone, so a closed login can't fall back to it.
async function signedInAs(res, password) {
  const salt = randHex();
  saveSession({ token: res.token, user: res.me, check: { salt, hash: await slowHash(password, salt) } });
  // reload the company settings as this person may see them (only admins get the company password);
  // a store keeper sees only their own entries: drop everything else this phone held (it's all on the sheet)
  const clear = { settingsU: 0, ...(res.me.role === 'admin' ? {} : { pass: null }), ...(res.me.role === 'store' ? onlyUnsent() : {}) };
  if (res.me.role === 'store') dropFileCopies();
  S = { ...S, ...clear, link: { ...S.link, k: '', since: 0, logins: true }, lastBy: res.me.name };
  save();
}
// The sheet ended this sign-in (password reset, login disabled, or logins now required).
function signedOutByServer(why) {
  saveSession({ out: true, why });
  // nothing stays on a phone that lost access — except changes it hasn't sent yet
  S = { ...S, ...onlyUnsent(), pass: null, link: { ...S.link, since: 0 } }; // signing in again brings back what this login may see
  dropFileCopies();
  save(); closeAll(); render();
}
async function signOut() {
  const n = S.dirty.length + outbox.length;
  if (n) return alert(`This phone has ${n} change${n === 1 ? '' : 's'} or file${n === 1 ? '' : 's'} not sent to the Google Sheet yet.\n\nConnect to the internet and wait until it says "Up to date", then sign out.`);
  if (!confirm('Sign out of this phone?\n\nThe company records leave this phone. They come back when someone signs in.')) return;
  const token = session.token;
  saveSession({ out: true }); // the sign-in screen shows at once, so nothing new can be added meanwhile
  closeAll(); render(); dropFileCopies();
  try { await callServer(S.link, { op: 'logout', token }); } catch { /* already signed out on the sheet: fine */ }
  if (!S.dirty.length) { S = { ...S, ...NOTHING_SEEN, link: { ...S.link, since: 0 } }; save(); } // never drop anything unsent
  render();
}

const signInFields = (autofocus = true) => `
  <label class="fld"><span>Username</span><input name="username" required autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="30" ${autofocus ? 'autofocus' : ''}></label>
  <label class="fld"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>`;
function viewSignIn() {
  const n = S.dirty.length;
  return `${moveBanner()}<section class="setup card pad">${APP_LOGO}
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

/* the owner's first login, proven with a one-time setup code that only appears inside the Google Sheet */
function setupLoginsSheet() {
  openSheet(`${head('Set up logins')}
    <p class="hint">You become the first admin. Then you give logins to the Managing Director and your staff. Phones that haven't signed in keep working until you choose <b>Require logins</b>.</p>
    <form data-form="setupLogins">
      <label class="fld"><span>Setup code <em>(open your Google Sheet → <b>Read me</b> tab → at the bottom)</em></span><input name="code" required maxlength="12" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" autofocus></label>
      <label class="fld"><span>Your name</span><input name="name" required maxlength="60" value="${esc(S.lastBy || '')}" autocomplete="name"></label>
      <label class="fld"><span>Choose a username <em>(what you type to sign in)</em></span><input name="username" required maxlength="30" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="e.g. john"></label>
      <label class="fld"><span>Your new password</span><input type="password" name="pw" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
      <label class="fld"><span>Type it again</span><input type="password" name="pw2" required minlength="8" autocomplete="new-password"></label>
      <p class="err"></p>
      <button class="btn primary">Set up logins</button>
    </form>`);
}
async function doSetupLogins(f) {
  const v = Object.fromEntries(new FormData(f));
  if (v.pw !== v.pw2) return formErr(f, 'pw2', "The two passwords don't match.");
  $('.err', f).textContent = 'Setting up…';
  let res;
  try { res = await callServer(S.link, { op: 'setup', key: S.link.k, setupCode: v.code, name: clean(v.name), username: v.username, newPassword: v.pw, device: S.dev }); }
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
      <div class="fld"><span>What may they do?</span><div class="curseg roles">${Object.keys(ROLES).map(r => `<label><input type="radio" name="role" value="${esc(r)}" ${r === role ? 'checked' : ''}><span><b>${ROLES[r]}</b><small>${ROLE_HELP[r]}</small></span></label>`).join('')}</div></div>
      <label class="fld"><span>${u ? 'New password <em>(leave empty to keep theirs)</em>' : 'Password'}</span><input name="password" ${u ? '' : 'required'} minlength="8" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="At least 8 characters"></label>
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
      <label class="fld"><span>New password</span><input type="password" name="pw" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
      <label class="fld"><span>New password again</span><input type="password" name="pw2" required minlength="8" autocomplete="new-password"></label>
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
  saveSession({ ...session, check: { salt, hash: await slowHash(v.pw, salt) } });
  closeSheet(); toast('Password changed ✓');
}

function loginsCard() {
  if (!S.link) return '';
  if (signedIn()) {
    return `<section class="card pad"><h3>👤 ${esc(session.user.name)}</h3>
      <p class="muted">Signed in as <b>${esc(session.user.username)}</b> · ${ROLES[session.user.role]}</p>
      <div class="two">${can('logins') ? '<button class="btn ghost" data-act="users">👥 Logins</button>' : ''}<button class="btn ghost" data-act="account">My password · Sign out</button></div>
      <div class="setrow" style="margin-top:12px"><span>Quick unlock<br><span class="muted">${session.quick ? `On: a code${session.quick.cred ? ' and Face ID / fingerprint' : ''}` : 'A short code or Face ID instead of your password'}</span></span><button class="btn small ghost" data-act="quick">${session.quick ? 'Change' : 'Set up'} 🔒</button></div></section>`;
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
const recordsOf = kind => S[KIND_KEY[kind]] || [];
const targetOf = c => recordsOf(c.kind).find(x => x.id === c.target);
// the fields an edit may change, per kind (the Google Sheet checks the same list)
const EDITABLE = {
  E: ['cur', 'amount', 'paidTo', 'reason', 'location', 'project', 'mode', 'at', 'manualDate', 'rate'],
  R: ['cur', 'amount', 'project', 'mode', 'note', 'at', 'manualDate', 'rate'],
  T: ['cur', 'amount', 'from', 'to', 'note', 'at', 'manualDate'],
  P: ['name', 'value', 'valueCur'],
  W: ['name', 'phone', 'job', 'site', 'wage', 'cur', 'start', 'idNo', 'status', 'left', 'openingAmount', 'openingNote'],
};
const editPart = c => (c.action ? {} : Object.fromEntries(Object.entries(c.after || {}).filter(([f]) => (EDITABLE[c.kind] || []).includes(f))));
const whatIs = (kind, r) => (kind === 'P' ? `Project "${r.name}"` : kind === 'W' ? `Employee ${r.name}` : describe(kind, r));
// what approving would really change, worked out from the entry itself — never from the text sent with the request
function changeLines(c, r) {
  if (!r) return [];
  if (c.action === 'delete') return [`Delete it: ${whatIs(c.kind, r)}`];
  if (c.action === 'advance') return [`Give an advance of ${money(+c.after.amount, c.after.cur)} — more than the $${ADVANCE_LIMIT_USD} a month limit`];
  const next = { ...r, ...editPart(c) };
  if (c.kind !== 'P') return diff(r, next);
  const vc = x => x.valueCur || 'USD';
  return [r.name !== next.name && `Name: ${r.name} → ${next.name}`,
    (Number(r.value || 0) !== Number(next.value || 0) || vc(r) !== vc(next)) && `Project value: ${money(+r.value || 0, vc(r))} → ${money(+next.value || 0, vc(next))}`].filter(Boolean);
}
const waitingNote = id => waitingFor(id).map(c => `<p class="note">✏️ <b>Change waiting for approval</b> — ${esc(changeLines(c, targetOf(c)).join(' ; ') || 'no real change')} · asked by ${esc(c.by)}, ${esc(fmtAbs(c.at))}</p>`).join('');

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
  const list = waiting().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  openSheet(`${head('Changes to approve', '', `${list.length} waiting`)}
    ${list.length ? list.map(changeCard).join('') : '<p class="muted">Nothing is waiting. ✓</p>'}`);
}
function changeCard(c) {
  const r = targetOf(c);
  const gone = !r || r.deleted, lines = changeLines(c, r);
  // the entry was changed by someone else after this request: show it so the admin looks first
  const moved = r && Object.keys(c.before || {}).some(f => String(r[f] ?? '') !== String(c.before[f] ?? ''));
  return `<section class="card pad" style="margin-bottom:12px">
    <p style="margin:0 0 6px"><b>${esc(r ? whatIs(c.kind, r) : c.target)}</b></p>
    <ul style="margin:0 0 8px;padding-left:20px">${(lines.length ? lines : ['No real change — reject it']).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <p class="muted" style="margin:0 0 10px">Asked by ${esc(c.by)} · ${esc(fmtAbs(c.at))}</p>
    ${gone ? '<p class="note">This entry was deleted — the change can only be rejected.</p>' : moved ? '<p class="note">⚠️ This entry was changed after the request. Check it before approving.</p>' : ''}
    <div class="two"><button class="btn danger" data-act="decide" data-id="${esc(c.id)}" data-ok="">Reject</button><button class="btn in" data-act="decide" data-id="${esc(c.id)}" data-ok="1" ${gone ? 'disabled' : ''}>Approve</button></div>
  </section>`;
}
async function decide(id, ok) {
  if (!await unlock('Enter the password to approve or reject changes.')) return;
  const c = S.changes.find(x => x.id === id);
  if (!c || c.status !== 'waiting') return approvalsSheet();
  const me = myName() || S.lastBy || 'Admin', key = KIND_KEY[c.kind];
  const r = targetOf(c), next = r && { ...r, ...editPart(c) };
  if (ok && (!r || r.deleted || !VALID[c.kind](next))) return alert("This change can't be applied: the entry is gone or the new values aren't valid. Reject it instead.");
  if (ok && c.action === 'delete' && c.kind === 'P' && [...live(S.expenses), ...live(S.credits)].some(x => x.project === c.target)) return alert('This project still has entries. Move or delete them first, or reject this.');
  const what = changeLines(c, r).join(' ; ') || 'no real change';
  const patch = {
    changes: S.changes.map(x => (x.id === id ? { ...x, status: ok ? 'approved' : 'rejected', decidedBy: me, decidedAt: stampSec() } : x)),
    log: logWith([[ok ? 'Approved' : 'Rejected', c.target, `${what} — asked by ${c.by}`]], me),
  };
  // an approved advance changes nothing yet: whoever hands over the money then records it against this approval
  if (ok && c.action === 'delete') patch[key] = S[key].map(x => (x.id === c.target ? { ...x, deleted: stampSec(), deletedBy: `${c.by} (approved by ${me})` } : x));
  if (ok && !c.action) patch[key] = S[key].map(x => (x.id === c.target ? { ...next, editedAt: stampSec(), editedBy: `${c.by} (approved by ${me})` } : x));
  update(patch);
  render(); approvalsSheet(); toast(!ok ? 'Rejected — the entry stays as it was' : c.action === 'delete' ? 'Approved ✓ The entry is deleted' : c.action === 'advance' ? 'Approved ✓ The advance can be given now' : 'Approved ✓ The entry is changed');
}
// An office manager's delete waits for an admin, like her edits.
async function askDelete(k, id) {
  if (!await unlock('Enter the password to ask for this entry to be deleted.')) return;
  const r = S[COLL[k]].find(x => x.id === id);
  if (!confirm(`Ask an admin to delete ${id} — ${money(r.amount, r.cur)}?\n\nIt stays in the totals until an admin approves.`)) return;
  const by = myName() || S.lastBy || '';
  const [[cid], seq] = nextIds('C', 1, S.seq), text = `Delete: ${describe(k, r)}`;
  update({
    changes: [...S.changes, { id: cid, kind: k, target: id, action: 'delete', before: {}, after: {}, text, by, at: stamp(), createdAt: stampSec(), status: 'waiting' }], seq,
    log: logWith([['Delete asked', id, `${text} — waiting for an admin`]], by),
  });
  closeSheet(); render(); toast('Sent for approval ✓ It is deleted when an admin approves.');
}

/* ---------- quick unlock: a short code, and Face ID / fingerprint where the phone has it ---------- */
// Both live only in this phone's sign-in slot. The code is checked like the password (slow hash); after 5 wrong
// codes only the password works. Face ID is a key made on this phone for this address; the phone's own check
// (the "user verified" flag) is what counts. iPhone home-screen apps are known to fumble it, so the code always works.
const QUICK_TRIES = 5;
const quick = () => (signedIn() && session.quick && session.quick.tries < QUICK_TRIES ? session.quick : null);
const rndBytes = n => crypto.getRandomValues(new Uint8Array(n));
const bytesB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function bioAvailable() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}
async function bioCheck() {
  const q = quick();
  if (!q || !q.cred) return false;
  try {
    const a = await navigator.credentials.get({ publicKey: { challenge: rndBytes(32), allowCredentials: [{ type: 'public-key', id: b64uBytes(q.cred) }], userVerification: 'required', timeout: 60000 } });
    return !!(new Uint8Array(a.response.authenticatorData)[32] & 4); // the phone checked the face or finger, not just a tap
  } catch { return false; }
}
async function quickSheet() {
  if (!await unlock('Enter your password to set up quick unlock.', true)) return;
  const bio = await bioAvailable();
  openSheet(`${head('Quick unlock')}
    <p class="hint">Unlock with a short code${bio ? ' or Face ID / fingerprint' : ''} instead of typing your password. It works only on this phone.</p>
    <form data-form="quick">
      <label class="fld"><span>Choose a code <em>(4 to 6 numbers)</em></span><input name="code" type="password" inputmode="numeric" maxlength="6" required autocomplete="off" autofocus></label>
      <label class="fld"><span>Type it again</span><input name="code2" type="password" inputmode="numeric" maxlength="6" required autocomplete="off"></label>
      ${bio ? '<label class="fld check"><input type="checkbox" name="bio" checked> Also use Face ID / fingerprint</label>' : ''}
      <p class="err"></p>
      <button class="btn primary">Save</button>
    </form>
    ${session.quick ? '<p class="center"><button class="link" data-act="quickOff">Turn quick unlock off</button></p>' : ''}`);
}
async function saveQuick(f) {
  const v = Object.fromEntries(new FormData(f));
  if (!/^\d{4,6}$/.test(v.code)) return formErr(f, 'code', 'The code is 4 to 6 numbers.');
  if (v.code !== v.code2) return formErr(f, 'code2', "The two codes don't match.");
  let cred = null;
  if (v.bio) {
    $('.err', f).textContent = 'Setting up Face ID / fingerprint…';
    try {
      const make = navigator.credentials.create({ publicKey: {
        challenge: rndBytes(32), rp: { name: 'Company Accounts' }, user: { id: rndBytes(16), name: session.user.username, displayName: session.user.name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, timeout: 60000 } });
      // some phones never answer (iPhone home-screen apps): give up after the time limit instead of waiting forever
      const c = await Promise.race([make, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 65000))]);
      cred = bytesB64u(c.rawId);
    } catch { if (!confirm('Face ID / fingerprint could not be set up on this phone.\n\nSave the code only?')) return; }
  }
  const salt = randHex();
  saveSession({ ...session, quick: { salt, hash: await slowHash(v.code, salt), cred, tries: 0 } });
  closeSheet(); render(); toast(`Quick unlock is on ✓${cred ? ' Code and Face ID / fingerprint' : ''}`);
}
function quickOff() {
  const { quick: _, ...rest } = session;
  saveSession(rest); closeSheet(); render(); toast('Quick unlock is off');
}
