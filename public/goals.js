(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SupplyHunterGoals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Previsto azul tracejado, realizado laranja sólido. Par validado para daltonismo
  // (ΔE 30,7 visão normal · 26,5 protanopia) e reforçado pelo traço, não só pela cor.
  const PLANNED_COLOR = '#4D8EF0';
  const REALIZED_COLOR = '#DD6435';
  const DEFAULT_CHANNELS = [
    {channel: 'Carteira / administradora', units_target: 200, units_per_deal: 100, sort_order: 1},
    {channel: 'Incorporadora', units_target: 100, units_per_deal: 40, sort_order: 2},
    {channel: 'Edifício / densificação', units_target: 100, units_per_deal: 20, sort_order: 3},
    {channel: 'Investidor PF', units_target: 50, units_per_deal: 8, sort_order: 4},
    {channel: 'Indicação', units_target: 50, units_per_deal: 2, sort_order: 5},
    {channel: 'Unitário', units_target: 50, units_per_deal: 1, sort_order: 6}
  ];

  function monthKey(date) {
    const value = date instanceof Date ? date : new Date(date);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`;
  }

  function parseMonthKey(key) {
    const [year, month] = String(key).split('-').map(Number);
    if (!year || !month || month < 1 || month > 12) throw new Error('Mês inválido.');
    return {year, month};
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function isWorkingDay(year, month, day) {
    const weekday = new Date(year, month - 1, day).getDay();
    return weekday !== 0 && weekday !== 6;
  }

  // Padrão sugerido: segunda a sexta. Feriado é ajuste manual do admin.
  function workingDaysInMonth(year, month) {
    let total = 0;
    for (let day = 1; day <= daysInMonth(year, month); day += 1) {
      if (isWorkingDay(year, month, day)) total += 1;
    }
    return total;
  }

  function dailyTarget(unitsTarget, workingDays) {
    const days = Math.max(1, Number(workingDays) || 0);
    return Math.max(0, Number(unitsTarget) || 0) / days;
  }

  function formatDaily(value) {
    return Number(value).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  }

  function monthLabel(key) {
    const {year, month} = parseMonthKey(key);
    const label = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {month: 'long', year: 'numeric'});
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  // A curva do previsto sobe só em dia útil, no ritmo meta/dias-úteis, e para na meta.
  function plannedSeries({month, unitsTarget, workingDays}) {
    const {year, month: monthNumber} = parseMonthKey(month);
    const target = Math.max(0, Number(unitsTarget) || 0);
    const rate = dailyTarget(target, workingDays);
    const series = [];
    let accumulated = 0;
    for (let day = 1; day <= daysInMonth(year, monthNumber); day += 1) {
      if (isWorkingDay(year, monthNumber, day)) accumulated = Math.min(target, accumulated + rate);
      series.push({day, value: accumulated});
    }
    return series;
  }

  function signedDay(opportunity, year, month) {
    if (opportunity.stage !== 'Assinada' || !opportunity.signed_at) return null;
    const date = new Date(opportunity.signed_at);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getFullYear() !== year || date.getMonth() + 1 !== month) return null;
    return date.getDate();
  }

  // Realizado acumulado por dia. Depois de hoje fica null — futuro não é dado.
  function realizedSeries(opportunities, {month, today = new Date()}) {
    const {year, month: monthNumber} = parseMonthKey(month);
    const total = daysInMonth(year, monthNumber);
    const perDay = new Array(total + 1).fill(0);
    for (const opportunity of opportunities || []) {
      const day = signedDay(opportunity, year, monthNumber);
      if (day) perDay[day] += Math.max(0, Number(opportunity.units_represented) || 0);
    }
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === monthNumber;
    const isFuture = new Date(year, monthNumber - 1, 1) > today;
    const lastKnownDay = isCurrentMonth ? today.getDate() : (isFuture ? 0 : total);
    const series = [];
    let accumulated = 0;
    for (let day = 1; day <= total; day += 1) {
      accumulated += perDay[day];
      series.push({day, value: day <= lastKnownDay ? accumulated : null});
    }
    return series;
  }

  function valueAtDay(series, day) {
    for (let index = series.length - 1; index >= 0; index -= 1) {
      if (series[index].day <= day && series[index].value != null) return series[index].value;
    }
    return 0;
  }

  // O número que decide a conversa do dia: estou à frente ou atrás do ritmo?
  function pace({planned, realized, month, today = new Date()}) {
    const {year, month: monthNumber} = parseMonthKey(month);
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === monthNumber;
    const isFuture = new Date(year, monthNumber - 1, 1) > today;
    const referenceDay = isCurrentMonth ? today.getDate() : (isFuture ? 0 : daysInMonth(year, monthNumber));
    const plannedToDate = referenceDay ? valueAtDay(planned, referenceDay) : 0;
    const realizedToDate = referenceDay ? valueAtDay(realized, referenceDay) : 0;
    return {
      referenceDay,
      plannedToDate: Math.round(plannedToDate),
      realizedToDate: Math.round(realizedToDate),
      delta: Math.round(realizedToDate - plannedToDate)
    };
  }

  function channelProgress(channels, opportunities, {month}) {
    const {year, month: monthNumber} = parseMonthKey(month);
    const list = (channels && channels.length ? channels : DEFAULT_CHANNELS)
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return list.map(channel => {
      const sameChannel = (opportunities || []).filter(item => item.type === channel.channel);
      const pipeline = sameChannel
        .filter(item => !['Assinada', 'Perdida'].includes(item.stage))
        .reduce((sum, item) => sum + (Number(item.units_represented) || 0), 0);
      const signed = sameChannel
        .filter(item => signedDay(item, year, monthNumber))
        .reduce((sum, item) => sum + (Number(item.units_represented) || 0), 0);
      const perDeal = Math.max(1, Number(channel.units_per_deal) || 1);
      return {
        channel: channel.channel,
        unitsTarget: Number(channel.units_target) || 0,
        unitsPerDeal: perDeal,
        dealsNeeded: (Number(channel.units_target) || 0) / perDeal,
        pipeline,
        signed
      };
    });
  }

  function channelTotal(channels) {
    return (channels || []).reduce((sum, channel) => sum + (Number(channel.units_target) || 0), 0);
  }

  function niceCeiling(value) {
    if (value <= 0) return 10;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
  }

  function linePath(series, x, y) {
    let path = '';
    let open = false;
    for (const point of series) {
      if (point.value == null) { open = false; continue; }
      path += `${open ? 'L' : 'M'}${x(point.day).toFixed(1)} ${y(point.value).toFixed(1)}`;
      open = true;
    }
    return path;
  }

  // Linha acumulada, duas séries, um eixo. Sem segundo eixo e sem número em cada ponto.
  function chartSvg({planned, realized, unitsTarget, month, today = new Date()}) {
    const {year, month: monthNumber} = parseMonthKey(month);
    const total = daysInMonth(year, monthNumber);
    const width = 720;
    const height = 260;
    const pad = {top: 18, right: 64, bottom: 30, left: 44};
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const maxRealized = realized.reduce((max, point) => Math.max(max, point.value ?? 0), 0);
    const ceiling = niceCeiling(Math.max(Number(unitsTarget) || 0, maxRealized));
    const x = day => pad.left + ((day - 1) / Math.max(1, total - 1)) * plotWidth;
    const y = value => pad.top + plotHeight - (value / ceiling) * plotHeight;

    const ticks = [0, 0.25, 0.5, 0.75, 1].map(fraction => {
      const value = ceiling * fraction;
      return `<line x1="${pad.left}" x2="${pad.left + plotWidth}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" stroke="#E8EBF1" stroke-width="1"/>
        <text x="${pad.left - 8}" y="${(y(value) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#667085">${Math.round(value)}</text>`;
    }).join('');

    const dayTicks = [...new Set([1, 5, 10, 15, 20, 25, total])].filter(day => day <= total);
    const xLabels = dayTicks.map(day =>
      `<text x="${x(day).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="10" fill="#667085">${day}</text>`).join('');

    const lastRealized = [...realized].reverse().find(point => point.value != null);
    const lastPlanned = planned[planned.length - 1];
    const hits = Array.from({length: total}, (_, index) => {
      const day = index + 1;
      const realizedPoint = realized.find(point => point.day === day);
      const plannedPoint = planned.find(point => point.day === day);
      return `<rect class="hit" data-day="${day}" data-x="${x(day).toFixed(1)}"
        data-planned="${Math.round(plannedPoint ? plannedPoint.value : 0)}"
        data-realized="${realizedPoint && realizedPoint.value != null ? Math.round(realizedPoint.value) : ''}"
        x="${(x(day) - plotWidth / total / 2).toFixed(1)}" y="${pad.top}"
        width="${(plotWidth / total).toFixed(1)}" height="${plotHeight}" fill="transparent"/>`;
    }).join('');

    return `<svg viewBox="0 0 ${width} ${height}" role="img" preserveAspectRatio="xMidYMid meet"
      aria-label="Unidades acumuladas no mês: previsto contra realizado.">
      ${ticks}${xLabels}
      <path d="${linePath(planned, x, y)}" fill="none" stroke="${PLANNED_COLOR}" stroke-width="2"
        stroke-dasharray="6 4" stroke-linecap="round"/>
      <path d="${linePath(realized, x, y)}" fill="none" stroke="${REALIZED_COLOR}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round"/>
      ${lastPlanned ? `<text x="${(x(lastPlanned.day) + 8).toFixed(1)}" y="${(y(lastPlanned.value) + 4).toFixed(1)}"
        font-size="11" font-weight="600" fill="${PLANNED_COLOR}">${Math.round(lastPlanned.value)}</text>` : ''}
      ${lastRealized ? `<circle cx="${x(lastRealized.day).toFixed(1)}" cy="${y(lastRealized.value).toFixed(1)}" r="4.5"
        fill="${REALIZED_COLOR}" stroke="#FFFFFF" stroke-width="2"/>
        <text x="${(x(lastRealized.day) + 10).toFixed(1)}" y="${(y(lastRealized.value) + 4).toFixed(1)}"
        font-size="11" font-weight="600" fill="${REALIZED_COLOR}">${Math.round(lastRealized.value)}</text>` : ''}
      <line x1="${pad.left}" x2="${pad.left + plotWidth}" y1="${pad.top + plotHeight}" y2="${pad.top + plotHeight}"
        stroke="#D6D9E2" stroke-width="1"/>
      ${hits}
    </svg>`;
  }

  return {
    PLANNED_COLOR,
    REALIZED_COLOR,
    DEFAULT_CHANNELS,
    monthKey,
    parseMonthKey,
    monthLabel,
    daysInMonth,
    isWorkingDay,
    workingDaysInMonth,
    dailyTarget,
    formatDaily,
    plannedSeries,
    realizedSeries,
    valueAtDay,
    pace,
    channelProgress,
    channelTotal,
    chartSvg
  };
});
