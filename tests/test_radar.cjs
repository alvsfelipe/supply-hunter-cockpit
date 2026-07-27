const assert = require('node:assert/strict');
const {promotionPayload, safeUrl, sourceLabel} = require('../public/radar.js');

assert.equal(sourceLabel('meu_imovel'), 'Meu Imóvel');
assert.equal(sourceLabel('ghar'), 'Ghar');
assert.equal(safeUrl('javascript:alert(1)'), '#');
assert.equal(safeUrl('https://example.com/ficha'), 'https://example.com/ficha');

const ghar = {
  id: 'building-1',
  name: 'Residencial Teste',
  address: 'Rua Teste, 10',
  polo: 'Z1',
  source: 'ghar',
  developer_organization_id: 'org-1'
};
assert.deepEqual(promotionPayload(ghar, 100, 64.6), {
  name: 'Residencial Teste',
  type: 'Incorporadora',
  organization_id: 'org-1',
  building_id: 'building-1',
  polo: 'Z1',
  units_represented: 100,
  units_are_hypothesis: false,
  supply_score: 65,
  why_now: 'Empreendimento identificado no radar Ghar; quantidade de unidades conferida antes da promoção.',
  stage: 'Identificado'
});

assert.throws(() => promotionPayload(ghar, 0, 50), /unidades inválida/);
assert.throws(() => promotionPayload(ghar, 10, 101), /Score inválido/);
console.log('radar: ok');
