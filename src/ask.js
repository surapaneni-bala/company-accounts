/* ---------- questions and alerts (owner, 3 Nov 2026): an admin asks someone about a payment, an invoice, a delivery — or raises a
   problem — and they answer in the app; staff can raise a problem with the admins the same way ---------- */
// A question (kind Q) is to one login (to: its id) or to the admins (to: 'admins'), maybe about an entry (about: kind, id and a line
// saying what it is, as the one asked may not see the entry). Each answer is its own record (re: the question), so two people
// writing at once never overwrite each other. state on a message: done = sorted, open = opened again; the newest one decides.
// The sheet (script v24) sends a question only to who asked and who was asked (admins: all) and lets nobody change a message.
const QUESTIONS_SCRIPT = 24;
// what a question is about: one entry, or several (owner, 9 Nov 2026: "select what transaction or transactions I am talking about")
// — an array, which the sheet keeps from script v26 on; one entry stays a single object, which every script since v24 keeps
const MULTI_LINK_SCRIPT = 26, MAX_LINKS = 20;
const aboutsOf = q => (Array.isArray(q.about) ? q.about : q.about ? [q.about] : []);
const aboutText = q => { const a = aboutsOf(q); return a.length ? `${a[0].what}${a.length > 1 ? ` and ${a.length - 1} more` : ''}` : ''; };
const LINK_KINDS = { E: 'expenses', R: 'credits', T: 'transfers', I: 'invoices', Y: 'receipts', O: 'stockOut', D: 'deliveries' };
const LINK_ICON = { E: '💵', R: '💰', T: '⇄', I: '🧾', Y: '🚢', O: '−', D: '🚚', W: '👷' };
let askLinks = []; // [kind, id] ticked in the Ask form that is open
function threads() {
  const all = live(S.questions || []);
  return all.filter(q => q.re === undefined).map(q => {
    const msgs = [q, ...all.filter(r => r.re === q.id)].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))), said = msgs.filter(m => m.state).pop();
    return { q, msgs, last: msgs[msgs.length - 1], done: !!said && said.state === 'done' };
  }).sort((a, b) => String(b.last.createdAt).localeCompare(String(a.last.createdAt)));
}
const threadOf = id => threads().find(t => t.q.id === id);
const isMine = t => t.q.to === myUid() || t.q.uid === myUid() || (t.q.to === 'admins' && can('edit'));
// whose turn: a question to the admins waits on them while the asker wrote last; one to a person waits on that person while
// someone else wrote last, and on the asker once that person answered
function waitsOnMe(t) {
  if (t.done) return false;
  const uid = myUid();
  if (t.q.to === 'admins') return can('edit') && t.last.uid === t.q.uid && t.q.uid !== uid;
  return (t.q.to === uid && t.last.uid !== uid) || (t.q.uid === uid && t.last.uid === t.q.to);
}
const canAsk = () => signedIn() && !!S.link && (S.link.v || 2) >= QUESTIONS_SCRIPT;
const toName = t => (t.q.to === 'admins' ? 'the admins' : (peopleSeen().find(p => p.id === t.q.to) || { name: 'them' }).name);
// who can be asked: the logins (admins load them), else everyone this phone has seen enter something
function peopleSeen() {
  const m = new Map(usersCache.filter(u => u.active !== false).map(u => [u.id, u.name]));
  Object.keys(SYNC_KEYS).forEach(key => (S[key] || []).forEach(r => { if (r.uid && r.by && !m.has(r.uid)) m.set(r.uid, r.by); }));
  return [...m].map(([id, name]) => ({ id, name })).filter(p => p.id !== myUid()).sort((a, b) => a.name.localeCompare(b.name));
}
// on an entry's page: the questions about it, and a button to ask
function askInto(k, r) {
  if (!r || !canAsk()) return;
  const about = threads().filter(t => aboutsOf(t.q).some(a => a.id === r.id));
  $('#sheetIn').insertAdjacentHTML('beforeend', `${about.length ? `<h3 class="subh">Questions about this (${about.length})</h3><div class="card list">${about.map(threadRow).join('')}</div>` : ''}
    <button class="btn ghost" data-act="ask" data-kind="${esc(k)}" data-id="${esc(r.id)}" style="margin-top:12px">❓ ${can('edit') ? 'Ask about this' : 'Ask the admins about this'}</button>`);
}
const threadRow = t => `<button class="row" data-act="thread" data-id="${esc(t.q.id)}"><span class="dot">${t.done ? '✓' : waitsOnMe(t) ? '❓' : '💬'}</span>
  <span class="main"><span class="t"><span class="tt">${esc(t.q.text.slice(0, 70))}${t.q.text.length > 70 ? '…' : ''}</span>${t.done ? '<i class="tag">Sorted</i>' : waitsOnMe(t) ? '<i class="tag warn">Your turn</i>' : ''}</span>
  <span class="s">${esc([t.q.uid === myUid() ? `To ${toName(t)}` : `From ${t.q.by || 'someone'}`, aboutText(t.q), `${plural(t.msgs.length, 'message')}`, fmtAbs(t.last.createdAt)].filter(Boolean).join(' · '))}</span></span></button>`;
async function askForm(k, id) {
  if (!canAsk()) return alert(`Questions reach people once the Google Sheet script is updated to version ${QUESTIONS_SCRIPT} (Sheet tab → Show me how).`);
  const r = k ? (S[KIND_KEY[k]] || []).find(x => x.id === id) : null, admin = can('edit');
  if (admin && !usersCache.length && can('logins')) { try { usersCache = (await callServer(S.link, { op: 'users' })).users || []; } catch (e) { /* offline: the people this phone has seen */ } }
  const people = admin ? peopleSeen() : [], pick = r && r.uid && r.uid !== myUid() ? r.uid : '';
  askLinks = r ? [[k, r.id]] : [];
  openSheet(`${head(admin ? 'Ask a question' : 'Ask the admins', '', 'A question or a problem')}
    <form data-form="ask">
      ${admin ? `<label class="fld"><span>To</span><select name="to" required><option value="">Choose who…</option>${people.map(p => `<option value="${esc(p.id)}" ${p.id === pick ? 'selected' : ''}>${esc(p.name)}${p.id === pick ? ' (entered this)' : ''}</option>`).join('')}<option value="admins">The admins</option></select></label>` : '<p class="muted">Every admin sees it and can answer.</p>'}
      <label class="fld"><span>Your question</span><textarea name="text" rows="4" maxlength="2000" required placeholder="${r ? 'e.g. Which site was this for? Please attach the receipt.' : 'e.g. The cement store roof is leaking.'}"></textarea></label>
      <div class="fld"><span>About <em>(optional — tick the transactions you mean)</em></span>
        <div id="askChosen">${askChosen()}</div>
        <input class="shop-q" id="askFind" placeholder="🔍 Search: amount, who was paid, invoice no., date" autocomplete="off" aria-label="Search the transactions to link">
        <div id="askHits">${askHits('')}</div></div>
      <p class="err"></p>
      <button class="btn primary">Send</button>
    </form>`);
  const find = $('#askFind');
  find.addEventListener('input', () => { $('#askHits').innerHTML = askHits(find.value); });
  find.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); }); // a search, not sending the question
  comeBack(() => askForm(k, id));
}
// the transactions to choose from: everything this phone may see, newest first — the chosen person's own entries first
const linkRec = ([k, id]) => (S[KIND_KEY[k]] || []).find(x => x.id === id && !x.deleted);
const linkDate = r => String(r.at || r.date || r.createdAt || '').slice(0, 10);
const linkLabel = (k, r) => (k === 'R' && can('money') ? `Money received ${money(r.amount, r.cur)} on ${fmtDate(linkDate(r))}` : k === 'T' && can('money') ? `${money(r.amount, r.cur)} ${r.from} → ${r.to}, ${fmtDate(linkDate(r))}` : aboutLine(k, r));
function askHits(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean), to = ($('#sheet [name=to]') || {}).value || '';
  const hay = (k, r) => [linkLabel(k, r), r.paidTo, r.reason, r.note, r.location, r.no, r.ref, r.to, r.by, r.amount, plain(r.amount || 0), linkDate(r), fmtDate(linkDate(r)), k === 'I' && (clientOf(r.client) || {}).name].filter(Boolean).join(' ').toLowerCase();
  const list = Object.entries(LINK_KINDS).flatMap(([k, key]) => live(S[key] || []).filter(r => !r.stub).map(r => [k, r]))
    .filter(([k, r]) => words.every(w => hay(k, r).includes(w)))
    .sort((a, b) => ((b[1].uid === to) - (a[1].uid === to)) || linkDate(b[1]).localeCompare(linkDate(a[1])) || String(b[1].createdAt).localeCompare(String(a[1].createdAt))).slice(0, 25);
  if (!list.length) return `<p class="muted">${words.length ? 'Nothing matches. Try fewer words, or only the amount.' : 'Nothing to link yet.'}</p>`;
  return `<div class="card list inset">${list.map(([k, r]) => { const on = askLinks.some(([lk, lid]) => lk === k && lid === r.id);
    return `<button type="button" class="row link-pick ${on ? 'on' : ''}" data-act="askLink" data-kind="${esc(k)}" data-id="${esc(r.id)}" aria-pressed="${on}"><span class="dot">${on ? '✓' : LINK_ICON[k]}</span>
      <span class="main"><span class="t"><span class="tt">${esc(linkLabel(k, r))}</span></span><span class="s">${esc([r.by && `by ${r.by}`, r.reason && k === 'E' ? r.reason : '', fmtDate(linkDate(r))].filter(Boolean).join(' · '))}</span></span></button>`; }).join('')}</div>`;
}
function askChosen() {
  const recs = askLinks.map(l => [l[0], linkRec(l)]).filter(([, r]) => r);
  return recs.length ? `<div class="chips">${recs.map(([k, r]) => `<button type="button" class="chip-x" data-act="askLink" data-kind="${esc(k)}" data-id="${esc(r.id)}" aria-label="Remove ${esc(linkLabel(k, r))}">${LINK_ICON[k] || '📎'} ${esc(linkLabel(k, r))} <b>×</b></button>`).join('')}</div>` : '<p class="muted" style="margin:0 0 6px">Nothing linked.</p>';
}
// tick or untick one; the first one ticked chooses who is asked when nobody is chosen yet (who entered it)
function askLink(k, id) {
  const has = askLinks.some(([lk, lid]) => lk === k && lid === id);
  if (!has && askLinks.length >= MAX_LINKS) return toast(`At most ${MAX_LINKS} transactions on one question`);
  askLinks = has ? askLinks.filter(([lk, lid]) => !(lk === k && lid === id)) : [...askLinks, [k, id]];
  const sel = $('#sheet [name=to]'), r = linkRec([k, id]);
  if (!has && sel && !sel.value && r && r.uid && [...sel.options].some(o => o.value === r.uid)) sel.value = r.uid;
  $('#askChosen').innerHTML = askChosen();
  $('#askHits').innerHTML = askHits($('#askFind').value);
}
// what a question is about, in a line: short, and never the amount of money received or moved (an office manager may be asked)
const aboutLine = (k, r) => (k === 'E' ? `Payment of ${money(r.amount, r.cur)} to ${r.paidTo}, ${fmtDate(r.at.slice(0, 10))}` : k === 'R' ? `Money received on ${fmtDate(r.at.slice(0, 10))}`
  : k === 'T' ? `A cash ↔ bank move on ${fmtDate(r.at.slice(0, 10))}` : whatIs(k, r)).slice(0, 200);
function newMsg(extra) {
  const [[qid], seq] = nextIds('Q', 1, S.seq), by = myName() || S.lastBy || '';
  update({ questions: [...(S.questions || []), { id: qid, ...extra, by, createdAt: stampSec() }], seq });
  return qid;
}
function saveAsk(f) {
  const v = Object.fromEntries(new FormData(f)), text = String(v.text || '').trim();
  const to = can('edit') ? v.to : 'admins', about = askLinks.map(l => [l[0], linkRec(l)]).filter(([, r]) => r).map(([k, r]) => ({ k, id: r.id, what: aboutLine(k, r) }));
  if (!to) return formErr(f, 'to', 'Choose who to ask.');
  if (!text) return formErr(f, 'text', 'Type the question.');
  if (about.length > 1 && (S.link.v || 2) < MULTI_LINK_SCRIPT) return formErr(f, null, `To link more than one transaction, first update the Google Sheet script to version ${MULTI_LINK_SCRIPT} (Sheet tab → Show me how). One is fine now.`);
  const qid = newMsg({ to, text, ...(about.length ? { about: about.length === 1 ? about[0] : about } : {}) });
  askLinks = [];
  toast('Sent ✓ They see it in their 🔔'); threadSheet(qid); paintBell();
}
function threadSheet(id) {
  const t = threadOf(id);
  if (!t) return false;
  const uid = myUid(), links = aboutsOf(t.q);
  // each linked entry opens where this phone has it; one it may not see (an admin's payment) shows what it is
  const linkHtml = a => { const there = (S[KIND_KEY[a.k]] || []).some(x => x.id === a.id && !x.deleted && !x.stub), act = ['E', 'R', 'T'].includes(a.k) ? `data-act="open" data-kind="${esc(a.k)}"` : `data-act="${OPEN_ACT[a.k] || 'open'}"`;
    return there ? `<button class="row" ${act} data-id="${esc(a.id)}"><span class="dot">${LINK_ICON[a.k] || '📎'}</span><span class="main"><span class="t"><span class="tt">${esc(a.what)}</span></span></span></button>` : `<div class="row"><span class="dot">${LINK_ICON[a.k] || '📎'}</span><span class="main"><span class="t"><span class="tt">${esc(a.what)}</span></span></span></div>`; };
  openSheet(`${head(t.q.uid === uid ? `To ${toName(t)}` : `From ${t.q.by || 'someone'}`, '', t.done ? 'Sorted ✓' : waitsOnMe(t) ? 'Waiting for your answer' : 'Waiting for an answer')}
    ${links.length ? `<h3 class="subh" style="margin-top:0">About (${links.length})</h3><div class="card list" style="margin-bottom:14px">${links.map(linkHtml).join('')}</div>` : ''}
    <div class="msgs">${t.msgs.map(m => `<div class="msg ${m.uid === uid ? 'me' : ''}"><p>${esc(m.text)}</p><small>${esc([m.uid === uid ? 'You' : m.by, fmtAbs(m.createdAt), m.state === 'done' ? 'marked sorted' : m.state === 'open' ? 'opened again' : ''].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>
    <form data-form="reply" data-id="${esc(t.q.id)}">
      <label class="fld"><span>${t.done ? 'Write to open it again' : 'Your answer'}</span><textarea name="text" rows="3" maxlength="2000" required></textarea></label>
      <p class="err"></p>
      <div class="two"><button class="btn primary">Send</button>${t.done ? '' : `<button type="button" class="btn in" data-act="qDone" data-id="${esc(t.q.id)}">✓ Sorted</button>`}</div>
    </form>`);
  comeBack(() => threadSheet(id));
}
function saveReply(f) {
  const t = threadOf(f.dataset.id), text = String(new FormData(f).get('text') || '').trim();
  if (!t) return;
  if (!text) return formErr(f, 'text', 'Type your answer.');
  newMsg({ re: t.q.id, text, ...(t.done ? { state: 'open' } : {}) });
  toast('Sent ✓'); threadSheet(t.q.id); paintBell();
}
function qDone(id) { const t = threadOf(id); if (!t) return; newMsg({ re: t.q.id, text: '✓ Sorted', state: 'done' }); toast('Marked as sorted ✓'); threadSheet(id); paintBell(); }
function messagesSheet() {
  const list = threads().filter(isMine), open = list.filter(t => !t.done);
  openSheet(`${head('Messages', '', `${open.length} open`)}
    ${list.length ? `<div class="card list">${[...open, ...list.filter(t => t.done)].slice(0, 100).map(threadRow).join('')}</div>` : '<p class="muted">No questions yet.</p>'}
    ${canAsk() ? `<button class="btn ghost" data-act="askNew" style="margin-top:14px">✉️ ${can('edit') ? 'Send someone a question' : 'Ask the admins'}</button>` : ''}`);
  comeBack(messagesSheet);
}
