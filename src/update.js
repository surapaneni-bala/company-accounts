/* ---------- app updates ---------- */
// GitHub Pages lets phones keep the app files for 10 minutes, so the app asks for version.json
// (never cached) to learn about a newer version, and "Update now" fetches a completely fresh copy.
// The app's address can also change (to the company's own domain): version.json then names the new home, and
// a phone still on the old address is asked to move — only once its waiting changes have reached the sheet,
// because the old address's storage stays behind.
let newerVersion = '', movedTo = '';
const CACHE_PREFIX = 'accounts-'; // same as in sw.js
async function latestInfo() {
  const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('version check failed');
  return res.json();
}
const elsewhere = home => typeof home === 'string' && /^https:\/\//.test(home) && !location.href.startsWith(home);
async function checkForUpdate() {
  if (location.protocol === 'file:') return;
  let info;
  try { info = await latestInfo(); } catch { return; } // offline: check again later
  const was = newerVersion + movedTo;
  movedTo = elsewhere(info.home) ? info.home : '';
  newerVersion = !movedTo && info.version && info.version !== APP_VERSION ? info.version : '';
  if (newerVersion + movedTo !== was && S && !typing()) render();
}
function moveBanner() {
  if (!movedTo) return '';
  const host = esc(new URL(movedTo).host), n = S ? S.dirty.length : 0;
  if (n) return `<div class="banner"><span>🏠 This app is moving to <b>${host}</b>. First connect to the internet so your ${n} waiting change${n === 1 ? '' : 's'} reach${n === 1 ? 'es' : ''} the Google Sheet.</span><button class="btn small" data-act="syncNow">Sync now</button></div>`;
  return `<div class="banner new"><span>🏠 This app now lives at <b>${host}</b>. Open it there, add it to your home screen and sign in once — everything is in the Google Sheet.</span><button class="btn small" data-act="moveApp">Open</button></div>`;
}
function moveApp() {
  if (S && S.dirty.length) return alert('Your waiting changes must reach the Google Sheet first. Connect to the internet and tap Sync now.');
  location.href = movedTo + (S && S.link ? `#join=${inviteCode()}` : '');
}
async function updateApp() {
  let v;
  try { const info = await latestInfo(); if (elsewhere(info.home)) { movedTo = info.home; render(); return moveApp(); } v = info.version; }
  catch { return alert('No internet. Connect to the internet to update the app.'); }
  if (v === APP_VERSION) { newerVersion = ''; render(); return toast(`You have the newest version ✓ (${APP_VERSION.slice(0, 7)})`); }
  toast('Updating the app…');
  // only this app's saved files are removed — your records are stored separately and stay
  try {
    await Promise.all((await caches.keys()).filter(k => k.startsWith(CACHE_PREFIX)).map(k => caches.delete(k)));
    const reg = await navigator.serviceWorker.getRegistration(); // the one for this page only
    if (reg) await reg.unregister();
  } catch (e) { console.warn('Could not clear the old app files:', e.message); }
  location.replace(`${location.pathname}?v=${v}`); // a new address, so no stored copy can be used
}
const updateBanner = () => (newerVersion ? `<div class="banner new"><span>🆕 A new version of the app is ready.</span><button class="btn small" data-act="updateApp">Update now</button></div>` : '');

/* ---------- installing the app on Android: one tap instead of Chrome's ⋮ menu ---------- */
// Chrome tells the page when the app can be installed (beforeinstallprompt); its install box may only open from a tap,
// so an Install banner shows above every page until it is installed (owner, 12 Oct 2026: a POCO phone whose menu had no
// "Add to Home screen"). iPhones have no such box: Safari's Share → Add to Home Screen stays the way.
let installEvent = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; paintInstall(); });
addEventListener('appinstalled', () => { installEvent = null; paintInstall(); toast('Installed ✓ — open Brookfield from your home screen'); });
function paintInstall() {
  const slot = document.getElementById('installSlot');
  if (slot) slot.innerHTML = installEvent && !isInstalled() ? `<div class="banner new"><span>📲 <b>Install Brookfield</b> on this phone: it opens from your home screen like any app, even without internet.</span><button class="btn small primary" data-act="installApp">Install</button></div>` : '';
}
async function installApp() {
  const e = installEvent;
  if (!e) return;
  installEvent = null; paintInstall(); // Chrome's offer can be used once
  e.prompt();
  const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  if (outcome !== 'accepted') toast('Not installed. Open the link again to see the Install button.');
}
