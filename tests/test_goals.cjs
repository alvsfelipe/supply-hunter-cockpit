const assert = require('node:assert/strict');
const goals = require('../public/goals.js');

// Julho de 2026: 1 é quarta, 31 é sexta. 23 dias úteis.
assert.equal(goals.monthKey(new Date(2026, 6, 27)), '2026-07-01');
assert.equal(goals.daysInMonth(2026, 7), 31);
assert.equal(goals.workingDaysInMonth(2026, 7), 23);
assert.equal(goals.isWorkingDay(2026, 7, 4), false);
assert.equal(goals.isWorkingDay(2026, 7, 27), true);
assert.deepEqual(goals.parseMonthKey('2026-07-01'), {year: 2026, month: 7});
assert.throws(() => goals.parseMonthKey('2026-13-01'), /Mês inválido/);

// Cascata: a meta do dia é a meta do mês dividida pelos dias úteis declarados.
assert.equal(goals.dailyTarget(500, 20), 25);
assert.equal(goals.formatDaily(goals.dailyTarget(500, 21)), '23,8');
assert.equal(goals.dailyTarget(500, 0), 500, 'dias úteis zerados não podem dividir por zero');

const planned = goals.plannedSeries({month: '2026-07-01', unitsTarget: 460, workingDays: 23});
assert.equal(planned.length, 31);
assert.equal(planned[0].value, 20, 'dia 1 é quarta-feira: sobe um passo');
assert.equal(planned[3].value, planned[2].value, 'sábado dia 4 não sobe');
assert.equal(Math.round(planned[30].value), 460, 'a curva fecha exatamente na meta');
assert.ok(planned.every(point => point.value <= 460), 'previsto nunca passa da meta');

// Só Assinada com signed_at no mês entra no realizado.
const opportunities = [
  {stage: 'Assinada', signed_at: '2026-07-03T10:00:00Z', units_represented: 100, type: 'Carteira / administradora'},
  {stage: 'Assinada', signed_at: '2026-07-20T10:00:00Z', units_represented: 40, type: 'Incorporadora'},
  {stage: 'Assinada', signed_at: '2026-06-30T10:00:00Z', units_represented: 999, type: 'Incorporadora'},
  {stage: 'Proposta', signed_at: null, units_represented: 80, type: 'Carteira / administradora'},
  {stage: 'Perdida', signed_at: null, units_represented: 70, type: 'Unitário'}
];
const today = new Date(2026, 6, 27, 12);
const realized = goals.realizedSeries(opportunities, {month: '2026-07-01', today});
assert.equal(realized[2].value, 100, 'dia 3 acumula a primeira assinatura');
assert.equal(realized[25].value, 140, 'dia 26 acumula as duas do mês');
assert.equal(realized[26].value, 140, 'hoje ainda tem valor');
assert.equal(realized[27].value, null, 'depois de hoje é null, não zero');

const past = goals.realizedSeries(opportunities, {month: '2026-06-01', today});
assert.equal(past[29].value, 999, 'mês fechado mostra o mês inteiro');
const future = goals.realizedSeries(opportunities, {month: '2026-08-01', today});
assert.equal(future[0].value, null, 'mês futuro não tem realizado');

const progress = goals.pace({planned, realized, month: '2026-07-01', today});
assert.equal(progress.referenceDay, 27);
assert.equal(progress.realizedToDate, 140);
assert.equal(progress.plannedToDate, 380, '19 dias úteis até 27/07 a 20 por dia');
assert.equal(progress.delta, -240);

const channels = goals.channelProgress(
  [
    {channel: 'Carteira / administradora', units_target: 200, units_per_deal: 100, sort_order: 2},
    {channel: 'Incorporadora', units_target: 100, units_per_deal: 40, sort_order: 1}
  ],
  opportunities,
  {month: '2026-07-01'}
);
assert.equal(channels[0].channel, 'Incorporadora', 'respeita sort_order');
assert.equal(channels[0].signed, 40, 'a assinada de junho não conta em julho');
assert.equal(channels[1].pipeline, 80, 'pipeline exclui assinada e perdida');
assert.equal(channels[1].dealsNeeded, 2);
// O mix herdado do CLAUDE.md soma 550 contra meta de 500. A divergência é real e a
// tela de administração a mostra em vez de escondê-la.
assert.equal(goals.channelTotal(goals.DEFAULT_CHANNELS), 550);

// O gráfico é string pura: dá para conferir sem navegador.
const svg = goals.chartSvg({planned, realized, unitsTarget: 460, month: '2026-07-01', today});
assert.ok(svg.startsWith('<svg'));
assert.ok(svg.includes('aria-label='), 'gráfico precisa de rótulo acessível');
assert.ok(svg.includes('stroke-dasharray'), 'previsto tem traço próprio, não só cor');
assert.ok(svg.includes(goals.REALIZED_COLOR) && svg.includes(goals.PLANNED_COLOR));
assert.equal((svg.match(/class="hit"/g) || []).length, 31, 'uma área de hover por dia');
assert.ok(svg.includes('data-realized=""'), 'dias sem realizado não inventam zero');
assert.ok(!svg.includes('NaN'));

assert.equal(goals.monthLabel('2026-07-01'), 'Julho de 2026');
console.log('goals: ok');
