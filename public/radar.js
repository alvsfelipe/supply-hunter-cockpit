(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SupplyHunterRadar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function sourceLabel(source) {
    if (source === 'meu_imovel') return 'Meu Imóvel';
    if (source === 'ghar') return 'Ghar';
    return source || 'Fonte não informada';
  }

  function safeUrl(value) {
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '#';
    } catch (_error) {
      return '#';
    }
  }

  function promotionPayload(building, units, score) {
    if (!building?.id || !building.address || !building.polo) throw new Error('Empreendimento incompleto.');
    if (!Number.isInteger(units) || units < 1) throw new Error('Quantidade de unidades inválida.');
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Supply Score inválido.');
    const source = sourceLabel(building.source);
    return {
      name: building.name || building.address,
      type: building.developer_organization_id ? 'Incorporadora' : 'Edifício / densificação',
      organization_id: building.developer_organization_id || null,
      building_id: building.id,
      polo: building.polo,
      units_represented: units,
      units_are_hypothesis: false,
      supply_score: Math.round(score),
      why_now: `Empreendimento identificado no radar ${source}; quantidade de unidades conferida antes da promoção.`,
      stage: 'Identificado'
    };
  }

  return {promotionPayload, safeUrl, sourceLabel};
});
