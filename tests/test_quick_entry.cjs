'use strict';

const assert = require('node:assert/strict');

global.window = {};
require('../public/quick-entry.js');

const quick = global.window.SupplyHunterQuickEntry;

assert.equal(
  quick.buildOlxUrl({neighborhood: 'Moema', minPrice: 3000, maxPrice: 6000}),
  'https://www.olx.com.br/imoveis/aluguel/apartamentos/estado-sp/sao-paulo-e-regiao/zona-sul/moema?ps=3000&pe=6000'
);

const parsed = quick.parseOlxText(`
https://sp.olx.com.br/sao-paulo-e-regiao/imoveis/apartamento-em-moema-1507586318
R$ 4.363/mês
42m² · 1 Quarto
Localização
Moema, São Paulo - SP
PROFISSIONAL
Só Flats Negócios Imobiliários
Na OLX desde março de 2022
`);

assert.equal(parsed.externalId, '1507586318');
assert.equal(parsed.rentPrice, 4363);
assert.equal(parsed.areaM2, 42);
assert.equal(parsed.bedrooms, 1);
assert.equal(parsed.neighborhood, 'moema');
assert.equal(parsed.polo, 'Z1');
assert.equal(parsed.advertiserName, 'Só Flats Negócios Imobiliários');
assert.equal(parsed.advertiserType, 'profissional');
assert.equal(parsed.containsContactData, false);

assert.equal(quick.parseOlxText('Telefone (11) 98765-4321').containsContactData, true);
assert.throws(
  () => quick.buildOlxUrl({neighborhood: 'moema', minPrice: 7000, maxPrice: 3000}),
  /mínimo/
);

console.log('quick-entry: ok');
