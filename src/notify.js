/* ---------- notifications (owner, 3 Nov 2026): one place for everything that needs someone — accounts, approvals, reviews, the
   warehouse, papers, questions — without spamming anyone ---------- */
// Worked out on the phone from what it already holds, never stored: a line goes once what it is about is dealt with, by anyone.
// "Needs you" lines are counted on the 🔔 and the app's icon; "new" lines (a decision on what you asked) count until the 🔔 is
// opened; "good to know" lines are never counted. Things of a kind come as one line ("3 deliveries not confirmed"), never one
// each. "Not now" hides a line on this phone for a week; it comes back if it is still true.
const SNOOZE_DAYS = 7;
const myUid = () => (signedIn() ? session.user.id : '');
const perUser = (o, v) => ({ ...(o || {}), [myUid() || '-']: v }); // what this phone keeps for the one signed in
const seenAt = () => (S.bellSeen || {})[myUid() || '-'] || '';
const reviewedAt = () => (S.reviewed || {})[myUid() || '-'] || '';
const snoozed = key => ((S.snooze || {})[key] || '') >= today();
const notice = (key, icon, text, act, data = {}, how = 'need') => ({ key, icon, text, act, data, how }); // how: need · new · info

function notices() {
  const out = [], admin = can('edit'), uid = myUid(), me = myName(), seen = seenAt();
  const add = (...a) => out.push(notice(...a));
  // questions: each one waiting for an answer from me; and what the other side marked sorted since I last looked
  threads().forEach(t => {
    const who = t.last.by || 'Someone', what = `“${t.last.text.slice(0, 90)}${t.last.text.length > 90 ? '…' : ''}”`;
    if (waitsOnMe(t)) add(`q:${t.q.id}`, '❓', t.msgs.length === 1 ? `${who} asks: ${what}${t.q.about ? ` — about ${t.q.about.what}` : ''}` : `${who} answered: ${what}`, 'thread', { id: t.q.id });
    else if (t.done && t.last.uid !== uid && String(t.last.createdAt) > seen && isMine(t)) add(`qd:${t.q.id}`, '✓', `${who} marked “${t.q.text.slice(0, 60)}” as sorted`, 'thread', { id: t.q.id }, 'new');
  });
  if (admin) {
    const ch = waiting().length, pr = priceWaits().length, dbl = doubles().length, look = can('delete') ? lookalikeExpenses() : [];
    if (ch) add('approvals', '✏️', `${plural(ch, 'change')} waiting for your approval`, 'approvals');
    if (pr) add('prices', '🏷', `${plural(pr, 'price')} below the list waiting for your approval`, 'approvals');
    if (dbl) add('doubles', '⚠️', `${dbl === 1 ? 'A payment' : `${dbl} payments`} may be entered twice`, 'doubles');
    if (look.length) add('lookalike', '⚠️', `${plural(look.length, 'expense')} look${look.length === 1 ? 's' : ''} like a cash ↔ bank move, not spending`, 'open', { kind: 'E', id: look[0].id });
  }
  // what I asked for, decided since I last looked
  const decided = (S.changes || []).filter(c => c.by === me && c.status !== 'waiting' && String(c.decidedAt || '') > seen);
  decided.forEach(c => { const r = targetOf(c), go = r && ['E', 'R', 'T'].includes(c.kind) ? ['open', { kind: c.kind, id: c.target }] : r && c.kind === 'W' ? ['openWorker', { id: c.target }] : ['tab', { tab: 'home' }];
    add(`ch:${c.id}`, c.status === 'approved' ? '✓' : '✗', `${c.decidedBy || 'An admin'} ${c.status} your change${r ? `: ${whatIs(c.kind, r)}` : ''}`, go[0], go[1], 'new'); });
  live(S.invoices).filter(x => x.uid === uid && !x.stub && ['approved', 'rejected'].includes(x.ok) && String(x.okAt || '') > seen && x.okBy !== me)
    .forEach(x => add(`ok:${x.id}`, x.ok === 'approved' ? '✓' : '✗', `${x.okBy || 'An admin'} ${x.ok === 'approved' ? 'approved' : 'refused'} your price on ${x.no}`, 'openInvoice', { id: x.id }, 'new'));
  // invoices: unpaid past their due date (admins: all; others: their own)
  const overdue = live(S.invoices).filter(x => !x.stub && x.type === 'invoice' && (admin || x.uid === uid) && invState(x).state === 'overdue');
  if (overdue.length) add('overdue', '🧾', `${plural(overdue.length, 'invoice')} overdue — not paid by the due date`, 'sales');
  // regular payments and papers (whoever runs staff)
  if (can('staff')) {
    const due = dueList().filter(([, d]) => isDueSoon(d)), late = due.filter(([, d]) => daysTo(d.next) < 0);
    if (late.length) add('reglate', '🔁', `${plural(late.length, 'regular payment')} late: ${late.slice(0, 2).map(([g]) => g.name).join(', ')}${late.length > 2 ? '…' : ''}`, 'regulars');
    if (due.length > late.length) add('regdue', '🔁', `${plural(due.length - late.length, 'regular payment')} due this week`, 'regulars', {}, 'info');
    const docs = live(S.docs).filter(v => docState(v).soon), bad = docs.filter(v => daysTo(v.expires) <= 7);
    if (bad.length) add('docs', '📄', `${plural(bad.length, 'document')} expired or expiring within a week: ${bad.slice(0, 2).map(v => v.title).join(', ')}${bad.length > 2 ? '…' : ''}`, 'docs');
    if (docs.length > bad.length) add('docsoon', '📄', `${plural(docs.length - bad.length, 'document')} to renew soon`, 'docs', {}, 'info');
  }
  if (can('staff') && live(S.stock).length) stockNotices(add, admin, uid);
  // this phone: changes another phone overtook, files not uploaded, a newer app, an older sheet script
  if ((S.lost || []).length) add('lost', '⚠️', `${plural(S.lost.length, 'change')} of yours ${S.lost.length === 1 ? 'was' : 'were'} not saved — see Accounts`, 'tab', { tab: 'home' });
  if (typeof outbox !== 'undefined' && outbox.length) add('uploads', '📤', `${plural(outbox.length, 'file')} on this phone not uploaded yet`, 'tab', { tab: 'sheet' });
  if (newerVersion) add('update', '🆕', 'A new version of the app is ready', 'updateApp', {}, 'info');
  if (can('settings') && S.link && (S.link.v || 2) < NEWEST_SCRIPT) add('script', '🔧', `The Google Sheet script can be updated to version ${NEWEST_SCRIPT}`, 'howUpdate', {}, (S.link.v || 2) < NEEDED_SCRIPT ? 'need' : 'info');
  if (admin) { const n = toReview().length; if (n) add('review', '📋', `${plural(n, 'new entry', 'new entries')} by others to check`, 'review', {}, 'info'); }
  return out.map(n => ({ ...n, hidden: snoozed(n.key) }));
}
// the warehouse: sold and not sent, deliveries not confirmed, short or without proof, below zero, imports that do not tally
function stockNotices(add, admin, uid) {
  const b = book(), items = live(S.stock), dns = live(S.deliveries), old = plusDays(today(), -2);
  const toGo = live(S.invoices).filter(x => !x.stub && (admin || x.uid === uid) && sells(x) && toSend(x, S.deliveries).length);
  if (toGo.length) add('tosend', '📦', `${plural(toGo.length, 'sale')} waiting for a delivery note`, 'stockOutList');
  const late = dns.filter(d => d.status === 'out' && d.date <= old && (admin || d.uid === uid));
  if (late.length) add('dnlate', '🚚', `${plural(late.length, 'delivery', 'deliveries')} not confirmed after 2 days`, 'stockOutList');
  if (!admin) return;
  const week = plusDays(today(), -7), short = dns.filter(d => dnState(d) === 'short' && d.recv.at.slice(0, 10) >= week);
  if (short.length) add('dnshort', '🚚', `${plural(short.length, 'delivery', 'deliveries')} received short this week`, 'stockOutList');
  const proofless = dns.filter(d => d.status === 'done' && d.recv.at.slice(0, 10) >= plusDays(today(), -30) && !S.files.some(f => f.for === d.id && f.proof && !f.deleted));
  if (proofless.length) add('dnproof', '🚚', `${plural(proofless.length, 'delivery', 'deliveries')} received without a signed slip`, 'stockOutList');
  const below = items.filter(m => b[m.id] && b[m.id].qty < -1e-9);
  if (below.length) add('below', '📦', `${plural(below.length, 'item')} below zero in stock: ${below.slice(0, 2).map(m => m.name).join(', ')}${below.length > 2 ? '…' : ''}`, 'stock');
  const tally = live(S.receipts).filter(y => !y.stub && untallied(y));
  if (tally.length) add('tally', '🚢', `${plural(tally.length, 'import')} with costs that do not tally with Accounts`, 'stockIn');
  const low = items.filter(m => m.min > 0 && (b[m.id] ? b[m.id].qty : 0) <= m.min && !(b[m.id] && b[m.id].qty < 0));
  if (low.length) add('low', '📉', `${plural(low.length, 'item')} running low`, 'stock', {}, 'info');
  const check = pricesToCheck().length;
  if (check) add('pricecheck', '🏷', `${plural(check, 'selling price')} to check after new landed costs`, 'prices', {}, 'info');
}
// what others entered since an admin last checked: payments, money received, invoices, stock moves, deliveries, employees
const REVIEW_KINDS = { E: 'expenses', R: 'credits', I: 'invoices', O: 'stockOut', D: 'deliveries', W: 'workers' };
function toReview() {
  const since = reviewedAt(), uid = myUid(), me = myName();
  return Object.entries(REVIEW_KINDS).flatMap(([k, key]) => live(S[key] || []).filter(r => !r.stub && String(r.createdAt || '') > since && (uid ? r.uid && r.uid !== uid : r.by && r.by !== me)).map(r => [k, r]))
    .sort((a, b) => String(b[1].createdAt).localeCompare(String(a[1].createdAt)));
}
const OPEN_ACT = { I: 'openInvoice', O: 'openOut', D: 'openDelivery', W: 'openWorker', Y: 'openReceipt' };
const entryRow = (k, r) => (k === 'E' || k === 'R' ? itemRow(r, k, true)
  : `<button class="row" data-act="${OPEN_ACT[k]}" data-id="${esc(r.id)}"><span class="dot">${{ I: '🧾', O: '−', D: '🚚', W: '👷' }[k]}</span><span class="main"><span class="t"><span class="tt">${esc(whatIs(k, r))}</span></span><span class="s">${esc([r.by && `by ${r.by}`, fmtAbs(r.createdAt)].filter(Boolean).join(' · '))}</span></span></button>`);
function reviewSheet() {
  const list = toReview();
  openSheet(`${head('New entries to check', '', `${list.length} since you last checked`)}
    <p class="hint">What others entered. Open one to check it; if something is wrong, use <b>❓ Ask about this</b> on it — the person who entered it gets the question.</p>
    ${list.length ? `<div class="card list">${list.slice(0, 100).map(([k, r]) => entryRow(k, r)).join('')}</div>
      <button class="btn in" data-act="reviewDone" style="margin-top:14px">✓ I have checked these</button>` : '<p class="muted">Nothing new. ✓</p>'}`);
  comeBack(reviewSheet);
}
function reviewDone() { update({ reviewed: perUser(S.reviewed, stampSec()) }); toast('Checked ✓'); bellSheet(); }

/* the 🔔 */
const bellCount = list => list.filter(n => !n.hidden && n.how !== 'info').length;
function paintBell() {
  const chip = $('#bellChip');
  if (!chip) return;
  const n = bellCount(notices());
  chip.hidden = false;
  chip.innerHTML = `🔔${n ? `<b>${n > 99 ? '99+' : n}</b>` : ''}`;
  chip.setAttribute('aria-label', n ? `Notifications: ${n} need you` : 'Notifications');
  if (S.link && S.link.push && notifyState() === 'granted') pushRegister(); // at most once a week, quietly
  try { if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {}); else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {}); } catch (e) { /* a number on the icon is a nicety */ }
}
const noticeRow = n => `<div class="nrow ${n.how}"><button class="nmain" data-act="${n.act}" ${Object.entries(n.data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}><span class="nic">${n.icon}</span><span>${esc(n.text)}</span></button>
  ${n.how === 'new' ? '' : `<button class="nnot" data-act="snooze" data-key="${esc(n.key)}" aria-label="Not now — hide for a week">Not now</button>`}</div>`;
function bellSheet() {
  const all = notices(), shown = all.filter(n => !n.hidden), hidden = all.length - shown.length;
  const part = (how, title) => { const l = shown.filter(n => n.how === how); return l.length ? `<h3 class="subh">${title}</h3><div class="card list nlist">${l.map(noticeRow).join('')}</div>` : ''; };
  const asks = S.link && (S.link.v || 2) >= 24 && signedIn();
  openSheet(`${head('Notifications', '', `${bellCount(all) || 'Nothing'} need${bellCount(all) === 1 ? 's' : ''} you`)}
    ${part('need', 'Needs you')}${part('new', 'New')}${part('info', 'Good to know')}
    ${shown.length ? '' : '<p class="muted center" style="margin:18px 0">All clear. ✓</p>'}
    ${asks ? `<div class="two" style="margin-top:14px"><button class="btn ghost" data-act="askNew">✉️ ${can('edit') ? 'Send someone a question' : 'Ask the admins'}</button><button class="btn ghost" data-act="messages">💬 Messages</button></div>` : ''}
    ${hidden ? `<button class="btn small ghost" data-act="unsnooze" style="margin-top:12px">Show the ${plural(hidden, 'line')} hidden for now</button>` : ''}
    ${signedIn() && notifyLine() ? `<p class="muted" style="margin-top:14px">${notifyLine()}</p>` : ''}
    <p class="hint" style="margin-top:16px">Only what needs you is counted, and things of one kind come as one line. <b>Not now</b> hides a line for a week. The morning email keeps the daily summary.</p>`);
  update({ bellSeen: perUser(S.bellSeen, stampSec()) }); // "new" lines were shown: they stop counting
  paintBell();
  comeBack(bellSheet);
}
/* turning notifications on (owner, 3 Nov 2026: "ask everyone to turn on notifications"): a phone asks only after a tap, so a banner
   asks everyone signed in, once a week at most until they answer. Allowed: the 🔔's number shows on the app's icon (iPhone), and
   phone notifications reach them once they are switched on for the company. Blocked: only the phone's settings can undo it. */
const notifyState = () => (typeof Notification === 'undefined' ? 'none' : Notification.permission); // none · default · granted · denied
function notifyBanner() {
  if (!signedIn() || S.apk === 1 || notifyState() !== 'default' || ((S.notifyAsk || {})[myUid()] || '') >= today()) return ''; // the first Android app file: the download banner instead
  return `<div class="banner new"><span>🔔 <b>Turn on notifications</b> so questions, approvals and alerts reach you on this phone.</span><span class="two-btn"><button class="btn small" data-act="notifyOn">Turn on</button><button class="btn small ghost" data-act="notifyLater">Not now</button></span></div>`;
}
async function notifyOn() {
  try { await Notification.requestPermission(); } catch (e) { /* an old phone: nothing to ask */ }
  if (notifyState() === 'granted') await pushRegister(true);
  toast(notifyState() === 'granted' ? 'Notifications are on ✓' : notifyState() === 'denied' ? 'Notifications are off. To turn them on later, allow them for this app in the phone’s settings.' : 'Not turned on');
  render();
}
function notifyLater() { update({ notifyAsk: perUser(S.notifyAsk, plusDays(today(), SNOOZE_DAYS)) }); render(); }
const notifyLine = () => ({ granted: `🔔 Notifications are on for this phone.${pushErr ? ` <b class="out-c">It could not register: ${esc(pushErr)}</b>` : ''}${S.link && S.link.push ? ' <button class="btn small ghost" data-act="pushTest">Send a test</button>' : ''}`, denied: '🔕 Notifications are blocked on this phone — allow them for this app in the phone’s settings.', none: /iPhone|iPad/.test(navigator.userAgent) && !isInstalled() ? '📱 On iPhone, notifications work only in the app opened from its <b>Home Screen icon</b> — in Safari tap Share → <b>Add to Home Screen</b>, then open it from there.' : '' }[notifyState()]
  ?? '<button class="btn small" data-act="notifyOn">🔔 Turn on notifications for this phone</button>');
function snooze(key) { update({ snooze: { ...Object.fromEntries(Object.entries(S.snooze || {}).filter(([, d]) => d >= today())), [key]: plusDays(today(), SNOOZE_DAYS) } }); bellSheet(); }
function unsnooze() { update({ snooze: {} }); bellSheet(); }
