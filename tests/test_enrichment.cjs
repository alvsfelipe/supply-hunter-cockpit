const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {normalizeName, matchCompanyOpportunity, buildEmailDraft, safeExternalUrl} = require('../public/enrichment.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260727030827_add_clay_enrichment.sql'), 'utf8');

assert.equal(normalizeName('Tegra Incorporadora S.A.'), 'tegra');
assert.deepEqual(matchCompanyOpportunity('Tegra Incorporadora', 'Tegra + Exto — Ledge Brooklin Studios'), {
  method: 'alias', confidence: 0.9
});
assert.equal(matchCompanyOpportunity('Tabas', 'Vitacon — ON Pixel Life'), null);

const draft = buildEmailDraft(
  {name: 'Tegra Incorporadora', profile_type: 'incorporadora'},
  {name: 'Rafael Brandimarte'},
  {name: 'Ledge Brooklin Studios', units_represented: 40, why_now: 'Entrega recente.'}
);
assert.match(draft.subject, /Ledge Brooklin Studios/);
assert.match(draft.body, /Olá, Rafael/);
assert.match(draft.body, /40 unidades representadas/);
assert.match(draft.body, /Entrega recente/);
assert.equal(safeExternalUrl('javascript:alert(1)'), '#');
assert.equal(safeExternalUrl('https://example.com/perfil'), 'https://example.com/perfil');
assert.match(html, /data-t="clay"/);
assert.match(html, /id="clay-results"/);
assert.match(html, /src="\.\/enrichment\.js"/);
assert.match(app, /from\('clay_companies'\)/);
assert.match(app, /from\('clay_contacts'\)/);
assert.match(migration, /alter table public\.clay_contacts enable row level security/);
assert.match(migration, /revoke all on public\.clay_companies, public\.clay_contacts, public\.clay_company_opportunities from anon/);
console.log('enrichment: ok');
