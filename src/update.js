/* ---------- app updates ---------- */
// GitHub Pages lets phones keep the app files for 10 minutes, so the app asks for version.json
// (never cached) to learn about a newer version, and "Update now" fetches a completely fresh copy.
let newerVersion = '';
const CACHE_PREFIX = 'accounts-'; // same as in sw.js
async function latestVersion() {
  const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('version check failed');
  return (await res.json()).version;
}
async function checkForUpdate() {
  if (location.protocol === 'file:') return;
  let v;
  try { v = await latestVersion(); } catch { return; } // offline: check again later
  const was = newerVersion;
  newerVersion = v && v !== APP_VERSION ? v : '';
  if (newerVersion !== was && S && (tab === 'home' || tab === 'sheet') && !typing()) render();
}
async function updateApp() {
  let v;
  try { v = await latestVersion(); } catch { return alert('No internet. Connect to the internet to update the app.'); }
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
