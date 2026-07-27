(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SupplyHunterEnrichment = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUFFIXES = /(incorporadora|construtora|empreendimentos|imoveis|realty)$/g;

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/sa$/g, '')
      .replace(SUFFIXES, '');
  }

  function matchCompanyOpportunity(companyName, opportunityName) {
    const company = normalizeName(companyName);
    const opportunity = normalizeName(opportunityName);
    if (!company || !opportunity) return null;
    if (company === opportunity) return {method: 'normalized', confidence: 1};
    if (company.length >= 5 && opportunity.startsWith(company)) return {method: 'alias', confidence: 0.9};
    return null;
  }

  function firstName(value) {
    return String(value || '').trim().split(/\s+/)[0] || 'Olá';
  }

  function buildEmailDraft(company, contact, opportunity) {
    const profile = company.profile_type || 'incorporadora';
    const person = firstName(contact?.name);
    const target = opportunity?.name || company.name;
    const units = Number(opportunity?.units_represented) > 0
      ? `${opportunity.units_represented} unidades representadas`
      : 'um conjunto relevante de unidades residenciais';
    const context = opportunity?.why_now
      ? `O sinal que chamou nossa atenção foi: ${opportunity.why_now}`
      : `O perfil residencial e a escala da ${company.name} chamaram nossa atenção.`;

    const angles = {
      incorporadora: {
        subject: `${target}: operação de locação para unidades de investidores`,
        value: 'estruturar a locação long stay desde a entrega, reduzindo vacância e dando previsibilidade ao investidor'
      },
      administradora: {
        subject: `${company.name}: mais eficiência para a carteira de locação`,
        value: 'absorver operação, atendimento e ocupação de carteiras residenciais em escala, com visão única das unidades'
      },
      proprietario: {
        subject: `${target}: previsibilidade para a operação das unidades`,
        value: 'reduzir vacância, organizar a operação e dar previsibilidade de receita ao conjunto de imóveis'
      }
    };
    const angle = angles[profile] || angles.incorporadora;
    return {
      subject: angle.subject,
      body: `Olá, ${person}.\n\n${context}\n\nNa 7Cantos, ajudamos a ${angle.value}. Neste caso, estamos olhando para ${units}.\n\nQueria entender como vocês estão planejando a operação de locação e se faz sentido comparar esse desenho com o modelo da 7Cantos.\n\nPodemos marcar uma conversa de 20 minutos nesta semana?\n\nAbraço,\nFelipe Alves\n7Cantos`
    };
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
    } catch (_) {
      return '#';
    }
  }

  return {normalizeName, matchCompanyOpportunity, buildEmailDraft, safeExternalUrl};
});
