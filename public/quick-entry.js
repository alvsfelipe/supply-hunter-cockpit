(() => {
  'use strict';

  const OLX_BASE = 'https://www.olx.com.br/imoveis/aluguel/apartamentos/estado-sp/sao-paulo-e-regiao';
  const NEIGHBORHOODS = {
    'vila-mariana': 'Z1', 'vila-clementino': 'Z1', moema: 'Z1', paraiso: 'Z1',
    ipiranga: 'Z1', indianopolis: 'Z1', 'nova-klabin': 'Z1', brooklin: 'Z2',
    'campo-belo': 'Z2', 'vila-olimpia': 'Z2', 'itaim-bibi': 'Z2',
    'cidade-moncoes': 'Z2', 'santo-amaro': 'Z2'
  };

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const slug = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const money = value => {
    const normalized = clean(value).replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  function buildOlxUrl({neighborhood, minPrice, maxPrice, page = 1}) {
    const neighborhoodSlug = slug(neighborhood);
    if (!NEIGHBORHOODS[neighborhoodSlug]) throw new Error('Escolha um bairro configurado.');
    const min = minPrice === '' || minPrice == null ? null : Number(minPrice);
    const max = maxPrice === '' || maxPrice == null ? null : Number(maxPrice);
    if (min != null && (!Number.isFinite(min) || min < 0)) throw new Error('Valor mínimo inválido.');
    if (max != null && (!Number.isFinite(max) || max < 0)) throw new Error('Valor máximo inválido.');
    if (min != null && max != null && min > max) throw new Error('O mínimo não pode superar o máximo.');
    if (!Number.isInteger(Number(page)) || Number(page) < 1) throw new Error('Página inválida.');
    const params = new URLSearchParams();
    if (min != null) params.set('ps', String(Math.trunc(min)));
    if (max != null) params.set('pe', String(Math.trunc(max)));
    if (Number(page) > 1) params.set('o', String(Number(page)));
    const query = params.toString();
    return `${OLX_BASE}/zona-sul/${neighborhoodSlug}${query ? `?${query}` : ''}`;
  }

  function externalIdFromUrl(url) {
    const match = clean(url).match(/-(\d{7,})(?:[/?#]|$)/);
    return match ? match[1] : null;
  }

  function parseOlxText(rawText) {
    const text = String(rawText ?? '').replace(/\r/g, '');
    const lines = text.split('\n').map(clean).filter(Boolean);
    const listingUrl = (text.match(/https?:\/\/[^\s]+olx\.com\.br\/[^\s]*\/imoveis\/[^\s]+-\d+/i) || [])[0] || '';
    const priceMatch = text.match(/R\$\s*[\d.]+(?:,\d{1,2})?/i);
    const areaMatch = text.match(/(\d+(?:[.,]\d+)?)\s*m[²2]/i);
    const bedroomsMatch = text.match(/(\d+)\s*(?:quartos?|dorm(?:it[oó]rios?)?)/i);
    const advertiserType = /\bPROFISSIONAL\b/i.test(text)
      ? 'profissional'
      : /\bPARTICULAR\b/i.test(text) ? 'particular' : '';
    const photoName = text.match(/Foto de\s+([^\n]+)/i);
    let advertiserName = photoName ? clean(photoName[1]) : '';
    if (!advertiserName && advertiserType) {
      const typeIndex = lines.findIndex(line => line.toLowerCase() === advertiserType);
      const ignored = /^(na olx desde|acessar perfil|informa[cç][oõ]es verificadas|e-mail|telefone|facebook)/i;
      advertiserName = lines.slice(typeIndex + 1).find(line => !ignored.test(line)) || '';
    }
    const foundNeighborhood = Object.keys(NEIGHBORHOODS).find(key => {
      const label = key.replace(/-/g, ' ');
      return slug(text).includes(key) || clean(text).toLowerCase().includes(label);
    }) || '';
    const locationIndex = lines.findIndex(line => /^localiza[cç][aã]o$/i.test(line));
    const address = locationIndex >= 0 ? (lines[locationIndex + 1] || '') : '';
    const contactText = text.replace(/https?:\/\/\S+/gi, ' ').replace(/c[oó]digo do an[uú]ncio\s*:?\s*\d+/gi, ' ');
    const containsContactData = /(?:\+?55\s*)?\(?\d{2}\)?\s*\d{4,5}[-.\s]\d{4}/.test(contactText)
      || /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text);

    return {
      url: listingUrl,
      externalId: externalIdFromUrl(listingUrl),
      advertiserName,
      advertiserType,
      rentPrice: priceMatch ? money(priceMatch[0]) : null,
      areaM2: areaMatch ? money(areaMatch[1]) : null,
      bedrooms: bedroomsMatch ? Number(bedroomsMatch[1]) : null,
      neighborhood: foundNeighborhood,
      polo: NEIGHBORHOODS[foundNeighborhood] || '',
      address,
      containsContactData
    };
  }

  window.SupplyHunterQuickEntry = {
    neighborhoods: NEIGHBORHOODS,
    buildOlxUrl,
    externalIdFromUrl,
    parseOlxText,
    slug
  };
})();
