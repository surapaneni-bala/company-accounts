/* ---------- phone notifications (owner, 3 Nov 2026): this phone registers with Firebase so the sheet can reach it ---------- */
// Once an admin has set it up (Settings → Phone notifications), the sheet gives signed-in phones the Firebase project's public
// web settings and Web Push key (S.link.push). A phone that allowed notifications loads Firebase's messaging library (only then,
// only online), gets its token and gives it to the sheet — again once a week, so the sheet knows the phone is still in use.
// The private key that sends them stays in the sheet. Tapping a notification opens the 🔔.
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const launch = { bell: new URLSearchParams(location.search).has('bell'), apk: new URLSearchParams(location.search).get('apk'), fromApp: document.referrer.startsWith('android-app://com.bepl.brookfield') };
let pushBusy = false, pushErr = '', launchSeen = false;
const loadScript = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('no internet to load the notification library')); document.head.appendChild(s); });
const deviceName = () => (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? (S.apk ? 'Android app' : 'Android') : 'Computer');
async function pushRegister(force) {
  const p = S.link && S.link.push, uid = myUid(), kept = (S.pushReg || {})[uid];
  if (!p || !uid || pushBusy || notifyState() !== 'granted' || !('serviceWorker' in navigator) || !navigator.onLine) return false;
  if (!force && kept && kept.project === p.web.projectId && kept.at >= plusDays(today(), -7)) return true;
  pushBusy = true;
  try {
    if (!window.firebase || !firebase.messaging) { await loadScript(`${FIREBASE_SDK}firebase-app-compat.js`); await loadScript(`${FIREBASE_SDK}firebase-messaging-compat.js`); }
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(p.web);
    const token = await app.messaging().getToken({ vapidKey: p.vapid, serviceWorkerRegistration: await navigator.serviceWorker.ready });
    if (!token) throw new Error('Firebase gave no token');
    const res = await callServer(S.link, { op: 'pushToken', fcm: token, device: deviceName() });
    if (!res.ok) throw new Error(res.error || 'the sheet did not take it');
    update({ pushReg: perUser(S.pushReg, { project: p.web.projectId, at: today() }) });
    pushErr = '';
    return true;
  } catch (e) {
    pushErr = e.message || String(e); // shown in the 🔔 and in Settings, never lost in silence
    return false;
  } finally { pushBusy = false; }
}
async function pushTest() {
  if (!await pushRegister(true)) return alert(`This phone could not register for notifications${pushErr ? `: ${pushErr}` : ''}.`);
  try {
    const res = await callServer(S.link, { op: 'pushTest' });
    if (res.ok) toast(`Test sent to ${plural(res.phones || res.sent, 'phone')} of yours ✓ It arrives in a few seconds`); else alert(res.error); // an error stays until read
  } catch (e) { alert(e.offline ? 'No internet.' : e.message); }
}
// a tapped notification: the 🔔, on a phone where the app was already open or freshly opened
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.bell && signedIn()) bellSheet(); });
// on the first drawing after the app opened: which Android app file opened it (S.apk: 1 = the first, made before notifications;
// 2 = the new one, which opens at /?apk=2), and the 🔔 when a notification was tapped (/?bell=1)
function noteLaunch() {
  if (launchSeen) return;
  launchSeen = true;
  if (launch.apk === '2' && S.apk !== 2) update({ apk: 2 });
  else if (launch.fromApp && !launch.apk && !S.apk) update({ apk: 1 });
  if (launch.bell || launch.apk) history.replaceState(null, '', location.pathname);
  if (launch.bell && signedIn()) setTimeout(bellSheet, 300);
}

/* the admin's set-up: the three things from the Firebase console, checked by the sheet with Google before they are kept */
async function pushSheet() {
  if (!await unlock('Enter the password to set up phone notifications.')) return;
  const p = S.link && S.link.push, old = (S.link.v || 2) < 25;
  openSheet(`${head('Phone notifications', '', p ? `On · Firebase project ${p.web.projectId}` : 'Not set up yet')}
    ${old ? `<p class="note">First update the Google Sheet script to version 25 (Sheet tab → Show me how), then come back.</p>` : ''}
    ${p ? `<p class="muted">✓ Questions, approvals and alerts reach the phones of everyone who allowed notifications. Change the set-up below only if you made a new Firebase project.</p><button class="btn ghost" data-act="pushTest">📲 Send a test to this phone</button>` : ''}
    <form data-form="pushSetup" style="margin-top:14px">
      <label class="fld"><span>1. The firebaseConfig <em>(Firebase → Project settings → General → Your apps)</em></span><textarea name="cfg" rows="5" required placeholder="const firebaseConfig = { apiKey: &quot;…&quot;, … };" autocomplete="off" spellcheck="false"></textarea></label>
      <label class="fld"><span>2. The Web Push key <em>(Cloud Messaging → Web Push certificates)</em></span><input name="vapid" required autocomplete="off" spellcheck="false" placeholder="B…"></label>
      <label class="fld"><span>3. The key file <em>(Service accounts → Generate new private key — the .json file)</em></span><input type="file" name="key" accept=".json,application/json" required></label>
      <p class="hint">The key file goes only to your Google Sheet and stays there. Once it says it is on, delete the file from your computer.</p>
      <p class="err"></p>
      <button class="btn primary" ${old ? 'disabled' : ''}>Check and switch on</button>
    </form>`);
  if (p && (S.link.v || 2) >= 26) pushStatusInto();
}
// what the sheet knows: this login's registered phones, and how many in all (owner, 9 Nov 2026)
async function pushStatusInto() {
  let st;
  try { st = await callServer(S.link, { op: 'pushStatus' }); } catch (e) { return; } // offline: the screen works without it
  const box = $('#sheet form[data-form=pushSetup]');
  if (!st || !st.ok || !box) return;
  const mine = st.mine || [];
  box.insertAdjacentHTML('beforebegin', `<p class="note" style="margin-top:12px">${mine.length ? `📲 Your registered ${mine.length === 1 ? 'phone' : 'phones'}: ${esc(mine.map(m => `${m.device || 'phone'} (since ${fmtDate(new Date(m.since).toISOString().slice(0, 10))})`).join(', '))}.` : '📲 <b>None of your phones is registered yet.</b> On your phone: open the app, tap 🔔, then <b>Turn on notifications</b>.'}
    ${st.all !== undefined ? ` Phones registered in the company: <b>${st.all}</b>.` : ''}</p>`);
}
async function savePushSetup(f) {
  const web = Object.fromEntries([...f.elements.cfg.value.matchAll(/(\w+)\s*:\s*["']([^"']+)["']/g)].map(m => [m[1], m[2]]));
  const file = f.elements.key.files[0];
  if (!web.apiKey || !web.projectId || !web.appId || !web.messagingSenderId) return formErr(f, 'cfg', 'Paste everything from "const firebaseConfig" to the closing };');
  if (!file) return formErr(f, 'key', 'Choose the .json key file you downloaded.');
  if (file.size > 20000) return formErr(f, 'key', 'That is not the key file (it is too big).');
  const btn = $('button.primary', f);
  btn.disabled = true; btn.textContent = 'Checking with Google…';
  try {
    const res = await callServer(S.link, { op: 'pushSetup', web, vapid: f.elements.vapid.value.trim(), key: await file.text() });
    if (!res.ok) return formErr(f, null, res.error);
    update({ link: { ...S.link, push: res.push } });
    toast('Phone notifications are on ✓');
    if (notifyState() === 'default') await notifyOn(); else await pushRegister(true);
    pushSheet();
  } catch (e) { formErr(f, null, e.offline ? 'No internet. Setting this up needs internet.' : e.message); }
  finally { btn.disabled = false; btn.textContent = 'Check and switch on'; }
}

// phones with the first Android app file are told to download the new one
const apkBanner = () => (S.apk === 1 ? `<div class="banner new"><span>📦 <b>A new Brookfield app is ready.</b> Download it and tap <b>Update</b> — nothing is lost, and notifications can then reach this phone.</span><a class="btn small" href="/brookfield.apk" download="Brookfield.apk">Download</a></div>` : '');
