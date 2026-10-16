/* ---------- the company's bank accounts: copied or sent to a client in one tap ---------- */
// A bank account (kind B) is only the details someone needs to pay the company — never a balance. Everyone with the app
// can open them (owner, 11 Oct 2026); only admins add or change them. The real details are typed into the app, so they
// live in the company Google Sheet and never in this code.
const bankOf = id => S.banks.find(b => b.id === id && !b.deleted);
const bankList = () => live(S.banks).sort((a, b) => a.bank.localeCompare(b.bank) || String(a.cur).localeCompare(String(b.cur)));
const bankLines = b => [['Bank', b.bank], ['Account name', b.accName], ['Account number', b.number], ['Currency', b.cur], ['Branch', b.branch], ['SWIFT code', b.swift], ['', b.note]].filter(([, v]) => v);
// the text that is copied or sent: what a client types into their bank to pay. Accounts at the same bank, branch and name
// (one in SSP, one in USD) are one block with each number and its currency.
function bankText(list) {
  const groups = [];
  list.forEach(b => { const k = [b.bank, b.accName, b.branch, b.swift].join('|'), g = groups.find(x => x.k === k); if (g) g.list.push(b); else groups.push({ k, list: [b] }); });
  const no = b => `${b.number}${b.cur ? ` (${b.cur})` : ''}${b.note ? ` — ${b.note}` : ''}`;
  const block = ([b, ...more]) => [`Bank: ${b.bank}`, b.accName && `Account name: ${b.accName}`, more.length ? `Account numbers:\n${[b, ...more].map(x => `• ${no(x)}`).join('\n')}` : `Account number: ${no(b)}`,
    b.branch && `Branch: ${b.branch}`, b.swift && `SWIFT code: ${b.swift}`].filter(Boolean).join('\n');
  return `${S.company || 'Company'} — bank details\n\nPlease pay by bank transfer to:\n\n${groups.map(g => block(g.list)).join('\n\n')}`;
}
const waLink = text => `https://wa.me/?text=${encodeURIComponent(text)}`;
const shareButtons = (text, act, id) => `<div class="two" style="margin-top:12px"><button class="btn in" data-act="${act}" data-id="${esc(id)}">📋 Copy</button>
  <a class="btn ghost" href="${esc(waLink(text))}" target="_blank" rel="noopener">💬 Send on WhatsApp</a></div>
  ${navigator.share ? `<button class="btn ghost" data-act="${act}" data-id="${esc(id)}" data-share="1" style="margin-top:10px">📤 Share another way</button>` : ''}`;

function banksSheet() {
  const list = bankList();
  openSheet(`${head('Company bank details', 'in')}
    <p class="hint">For anyone paying the company. Tap an account to copy it or send it on WhatsApp.</p>
    ${list.length ? `<div class="card list inset">${list.map(b => `<button class="row in" data-act="openBank" data-id="${esc(b.id)}"><span class="dot">🏦</span>
      <span class="main"><span class="t"><span class="tt">${esc(b.bank)}</span>${b.cur ? `<i class="tag">${esc(b.cur)}</i>` : ''}</span><span class="s">${esc([b.accName, b.number].filter(Boolean).join(' · '))}</span></span></button>`).join('')}</div>
      ${list.length > 1 ? `<h3 class="subh">All ${list.length} accounts together</h3>${shareButtons(bankText(list), 'copyBank', 'all')}` : ''}`
      : empty('No bank accounts yet', can('settings') ? 'Add each company account once.' : 'An admin adds them.')}
    ${can('settings') ? '<button class="btn ghost" data-act="addBank" style="margin-top:16px">＋ Add a bank account 🔒</button>' : ''}`);
  comeBack(banksSheet);
}
function bankDetail(id) {
  const b = bankOf(id);
  if (!b) return false;
  openSheet(`${head(b.bank, 'in', b.cur || '')}
    <dl class="facts">${bankLines(b).map(([k, v]) => `<div><dt>${k || 'Note'}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${shareButtons(bankText([b]), 'copyBank', id)}
    ${can('settings') ? `<div class="two" style="margin-top:18px"><button class="btn ghost" data-act="editBank" data-id="${esc(id)}">✏️ Edit 🔒</button><button class="btn danger" data-act="delBank" data-id="${esc(id)}">🗑 Delete 🔒</button></div>` : ''}`);
  comeBack(() => bankDetail(id));
}
async function copyBank(btn) {
  const text = bankText(btn.dataset.id === 'all' ? bankList() : [bankOf(btn.dataset.id)].filter(Boolean));
  if (btn.dataset.share) return navigator.share({ text }).catch(() => {});
  try { await navigator.clipboard.writeText(text); toast('Bank details copied ✓ Paste them in WhatsApp, SMS or email'); }
  catch { prompt('Copy the bank details:', text); } // no clipboard here: the text is selected to copy by hand
}

const CUR_SUGGEST = ['USD', 'SSP', 'UGX', 'KES', 'EUR'];
function bankForm(old) {
  const d = old || { accName: S.company || '', cur: 'USD' };
  openSheet(`${head(old ? 'Edit bank account' : 'New bank account', 'in', old?.id)}
    <form data-form="bank" data-id="${esc(old?.id || '')}">
      ${textField('bank', 'Bank', 'e.g. the bank’s full name', d.bank)}
      ${textField('accName', 'Account name', 'As the bank writes it', d.accName)}
      ${textField('number', 'Account number', '', d.number)}
      <label class="fld"><span>Currency of the account</span><input name="cur" value="${esc(d.cur)}" list="dl-cur" maxlength="10" autocomplete="off" autocapitalize="characters" required></label>
      <datalist id="dl-cur">${CUR_SUGGEST.map(c => `<option value="${c}">`).join('')}</datalist>
      ${textField('branch', 'Branch', 'e.g. Juba main branch', d.branch, false)}
      ${textField('swift', 'SWIFT code', 'For payments from abroad', d.swift, false)}
      ${textField('note', 'Anything else', 'e.g. IBAN, sort code, mobile money number', d.note, false)}
      <p class="err"></p>
      <button class="btn in">${old ? 'Save changes' : 'Add bank account'}</button>
    </form>`);
}
function saveBank(f) {
  const v = Object.fromEntries(new FormData(f)), old = bankOf(f.dataset.id);
  const rec = { bank: clean(v.bank), accName: clean(v.accName), number: clean(v.number), cur: clean(v.cur).toUpperCase(), branch: clean(v.branch), swift: clean(v.swift).toUpperCase(), note: clean(v.note) };
  if (!rec.bank) return formErr(f, 'bank', 'Which bank?');
  if (!rec.accName) return formErr(f, 'accName', 'Type the account name');
  if (!rec.number) return formErr(f, 'number', 'Type the account number');
  if (!rec.cur) return formErr(f, 'cur', 'Which currency is the account in?');
  const by = myName() || S.lastBy || '';
  if (old) {
    const changes = diff(old, rec);
    if (!changes.length) { closeSheet(); return toast('Nothing changed'); }
    update({ banks: S.banks.map(b => (b.id === old.id ? { ...b, ...rec, editedAt: stampSec(), editedBy: by } : b)), log: logWith([['Edited', old.id, changes.join(' ; ')]], by) });
    toast('Changes saved ✓');
    return closeSheet();
  }
  const [[id], seq] = nextIds('B', 1, S.seq);
  update({ banks: [...S.banks, { id, ...rec, by, createdAt: stampSec() }], seq, log: logWith([['Added', id, `Bank account: ${rec.bank} (${rec.cur})`]], by) });
  toast('Bank account added ✓');
  banksSheet();
}
async function deleteBank(id) {
  const b = bankOf(id);
  if (!b || !await unlock('Enter the password to delete this bank account.')) return;
  const by = confirmBy(`Delete ${b.bank} (${b.cur}) from the company bank details?`);
  if (!by) return;
  update({ banks: S.banks.map(x => (x.id === id ? { ...x, deleted: stampSec(), deletedBy: by } : x)), log: logWith([['Deleted', id, `Bank account: ${b.bank} (${b.cur})`]], by) });
  toast('Deleted ✓'); closeAll(); banksSheet();
}
