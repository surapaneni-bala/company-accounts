// Checks that invite links still work after the ways people really share them.
// Usage: node tools/test-invite.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ atob, btoa, URL, location: { protocol: 'https:', origin: 'https://surapaneni-bala.github.io', pathname: '/company-accounts/', hash: '' } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/sync.js'), 'utf8') + '\n;globalThis.api = { parseInvite, b64u };', ctx);
const { parseInvite, b64u } = ctx.api;

const web = 'https://script.google.com/macros/s/AKfycbz_Ab-12XyZ_long_ID-value_0987/exec';
const link = `https://surapaneni-bala.github.io/company-accounts/#join=${b64u(JSON.stringify({ u: web, k: 'A910CA59B8D24031' }))}`;
const want = { u: web, k: 'A910CA59B8D24031' };
const ok = (label, text) => assert.deepStrictEqual({ ...parseInvite(text) }, want, label);

ok('the plain link', link);
ok('a whole WhatsApp message', `Join Test Co accounts: ${link}`);
ok('pasted onto the link that was already filled in', link + link);
ok('pasted twice with a space', `${link} ${link}`);
ok('broken over lines by a messaging app', link.slice(0, 60) + '\n' + link.slice(60, 140) + '\r\n ' + link.slice(140));
ok('%-encoded by an app', link.replace('#', '%23').replace('join=', 'join%3D'));
ok('only the code part', link.split('join=')[1]);
ok('lower-case company code', link.replace(/join=.*/, 'join=' + b64u(JSON.stringify({ u: web, k: 'a910ca59b8d24031' }))));
const company = 'https://script.google.com/a/macros/acme.co/s/AKfycbz_Ab-12XyZ/exec';
assert.strictEqual(parseInvite(`x#join=${b64u(JSON.stringify({ u: company, k: 'K1' }))}`).u, company, 'company (Workspace) link');

assert.strictEqual(parseInvite(link.slice(0, -12)), null, 'a cut-off link is refused');
assert.strictEqual(parseInvite('https://surapaneni-bala.github.io/company-accounts/'), null, 'the app address alone is refused');
assert.strictEqual(parseInvite(`x#join=${b64u(JSON.stringify({ u: 'https://evil.example/exec', k: 'K' }))}`), null, 'only Google web app links are accepted');
console.log('Invite links: all checks passed');
