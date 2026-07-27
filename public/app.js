(() => {
  'use strict';

  const STAGES = ['Identificado', 'Pesquisado', 'Contatado', 'Diagnóstico', 'Qualificada', 'Proposta', 'Assinada', 'Perdida'];
  const CANAIS = [
    ['Carteira / administradora', 200, 100],
    ['Incorporadora', 100, 40],
    ['Edifício / densificação', 100, 20],
    ['Investidor PF', 50, 8],
    ['Indicação', 50, 2],
    ['Unitário', 50, 1]
  ];
  const SCRIPTS = [
    {id:'olx', t:'OLX', alvo:'Revelar quem tem carteira', extrai:'Identidade do anunciante, quantidade de anúncios ativos por anunciante, dias no ar, variação de preço, bairro, área e tipologia.', nao:'Não extrai telefone. O contato entra na ferramenta digitado por você depois de usar o botão de contato do próprio anúncio.', cmd:'python collector/coletor_v0.py --dry-run', ret:'Anunciantes com 5 ou mais anúncios ativos, candidatos a organização com carteira.'},
    {id:'vr', t:'VivaReal e ZAP', alvo:'Radar de entregas e vacância de estreia', extrai:'Empreendimentos prontos para morar, incorporadora, faixa de metragem e endereço.', nao:'Respeite termos de uso, robots.txt e intervalo largo entre requisições.', cmd:'python collector/coletor_v0.py --dry-run', ret:'Entregas recentes nos polos ativos para validação humana.'},
    {id:'ghar', t:'Ghar', alvo:'Mapear o universo de incorporadoras', extrai:'Diretório público de construtoras, incorporadoras e empreendimentos por status.', nao:'Serve para descobrir nomes; não trate curadoria de corretora como contagem de estoque.', cmd:'python collector/coletor_v0.py --dry-run', ret:'Nomes para cruzar com o radar de entregas.'},
    {id:'amv', t:'appmeuimovel', alvo:'Ficha técnica do empreendimento', extrai:'Número de unidades, pavimentos, plantas, incorporadora e endereço.', nao:'Use apenas para confirmar o tamanho real antes da abordagem.', cmd:'python collector/coletor_v0.py --dry-run', ret:'Contagem confirmada, substituindo hipótese quando houver fonte.'}
  ];

  const $ = selector => document.querySelector(selector);
  let db;
  let user;
  let sessionStarted = false;
  let opportunities = [];
  let runs = {};

  const config = window.SUPABASE_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.url || '')
    && /^(sb_publishable_|eyJ)/.test(config.publishableKey || '')
    && !config.url.includes('SEU-PROJETO')
    && !config.publishableKey.includes('SUBSTITUA_AQUI');

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('on');
    window.setTimeout(() => element.classList.remove('on'), 2400);
  }

  function setStatus(message, state = 'ok') {
    const element = $('#sync-status');
    element.textContent = message;
    element.dataset.state = state;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  }

  function priority(opportunity) {
    return +(opportunity.supply_score * Math.log10(opportunity.units_represented + 1)).toFixed(1);
  }

  function ticks(units) {
    const count = Math.max(1, Math.min(30, Math.round(Math.log10(units + 1) * 11)));
    return Array.from({length: count}, (_, index) => `<i class="tick${units >= 100 && index % 5 === 4 ? ' f' : ''}" style="height:${55 + (index % 5) * 11}%"></i>`).join('');
  }

  function friendlyError(error) {
    if (!error) return 'Erro inesperado.';
    if (error.code === '42501') return 'Seu usuário não tem o papel hunter/admin ou a tabela não foi liberada na Data API.';
    return error.message || String(error);
  }

  async function loadData() {
    setStatus('Sincronizando com o Supabase…');
    const [opportunityResult, runResult] = await Promise.all([
      db.from('opportunities').select('*').order('priority_score', {ascending: false}),
      db.from('agent_runs').select('script,finished_at').eq('status', 'completed').order('finished_at', {ascending: false}).limit(50)
    ]);
    if (opportunityResult.error) throw opportunityResult.error;
    if (runResult.error) throw runResult.error;
    opportunities = opportunityResult.data || [];
    runs = {};
    for (const run of runResult.data || []) {
      if (!runs[run.script]) runs[run.script] = new Date(run.finished_at).toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
    }
    renderAll();
    renderScripts();
    setStatus(`Supabase sincronizado · ${opportunities.length} oportunidades`);
  }

  function renderQueue() {
    const open = opportunities.filter(item => !['Assinada', 'Perdida'].includes(item.stage)).sort((a, b) => priority(b) - priority(a));
    $('#n-hoje').textContent = open.length;
    $('#n-pipe').textContent = opportunities.length;
    if (!open.length) {
      $('#fila').innerHTML = '<div class="empty">Nada na fila. Adicione uma oportunidade ou carregue o seed do Supabase.</div>';
      return;
    }
    $('#fila').innerHTML = open.map(item => `
      <div class="row">
        <div class="prio">${priority(item)}<span>prio</span></div>
        <div>
          <div class="nm">${escapeHtml(item.name)}</div>
          <div class="meta">${escapeHtml(item.type)} · ${escapeHtml(item.polo)} · score ${item.supply_score}/100</div>
          <div class="tally"><div class="ticks">${ticks(item.units_represented)}</div><span class="tallyn">${item.units_represented} unidades representadas${item.units_are_hypothesis ? ' · hipótese' : ''}</span></div>
          ${item.why_now ? `<div class="why">${escapeHtml(item.why_now)}</div>` : ''}
          <div class="tags"><span class="tag ${item.stage === 'Qualificada' ? 'p' : item.stage === 'Identificado' ? '' : 'g'}">${escapeHtml(item.stage)}</span>${item.units_represented >= 100 ? '<span class="tag b">lote grande</span>' : ''}${item.qualified_criteria ? `<span class="tag p">${item.qualified_criteria}/6 critérios</span>` : ''}</div>
        </div>
        <div class="act">
          <select class="st" data-id="${item.id}">${STAGES.map(stage => `<option${stage === item.stage ? ' selected' : ''}>${stage}</option>`).join('')}</select>
          <div class="mini"><button data-log="${item.id}">Registrar contato</button><button data-del="${item.id}">Remover</button></div>
        </div>
      </div>`).join('');
  }

  function renderSummary() {
    const signed = opportunities.filter(item => item.stage === 'Assinada').reduce((sum, item) => sum + item.units_represented, 0);
    const pipeline = opportunities.filter(item => !['Assinada', 'Perdida'].includes(item.stage)).reduce((sum, item) => sum + item.units_represented, 0);
    $('#s-ass').textContent = signed;
    $('#s-pipe').innerHTML = `${pipeline} <small>unid. repres.</small>`;
    $('#s-gap').textContent = Math.max(0, 500 - signed);
    $('#s-fill').style.width = `${Math.min(100, signed / 5)}%`;
  }

  function renderPipeline() {
    $('#funil').innerHTML = STAGES.map(stage => {
      const group = opportunities.filter(item => item.stage === stage);
      return `<tr><td>${stage}</td><td class="num">${group.length}</td><td class="num">${group.reduce((sum, item) => sum + item.units_represented, 0)}</td></tr>`;
    }).join('');
  }

  function renderMix() {
    $('#mix').innerHTML = CANAIS.map(([channel, target, perDeal]) => {
      const pipeline = opportunities.filter(item => item.type === channel && !['Assinada', 'Perdida'].includes(item.stage)).reduce((sum, item) => sum + item.units_represented, 0);
      return `<tr><td>${channel}</td><td class="num">${target}</td><td class="num">${perDeal}</td><td class="num">${(target / perDeal).toFixed(1)}</td><td class="num">${pipeline}</td></tr>`;
    }).join('');
  }

  function renderScripts() {
    $('#scripts').innerHTML = SCRIPTS.map(script => `
      <div class="panel"><h3>${script.t}</h3><div class="sub">${script.alvo}</div>
      <table><tbody><tr><td style="width:130px;color:var(--mute)">Extrai</td><td>${script.extrai}</td></tr><tr><td style="color:var(--mute)">Limite</td><td>${script.nao}</td></tr><tr><td style="color:var(--mute)">Devolve</td><td>${script.ret}</td></tr></tbody></table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:14px 0 6px"><span class="tallyn">Comando</span><button class="copy" data-cp="${script.id}">Copiar</button></div>
      <pre id="cmd-${script.id}">${escapeHtml(script.cmd)}</pre>
      <div style="display:flex;gap:10px;align-items:center;margin-top:12px"><button class="btn ghost" data-run="${script.id}">Registrar execução</button><span class="tallyn" id="run-${script.id}">${runs[script.id] ? `Última execução: ${runs[script.id]}` : 'Nunca executado'}</span></div></div>`).join('');
  }

  function renderAll() {
    renderQueue();
    renderSummary();
    renderPipeline();
    renderMix();
  }

  function calculateScore() {
    let total = 0;
    document.querySelectorAll('.qi').forEach(element => { total += Number(element.value); });
    document.querySelectorAll('.qc:checked').forEach(element => { total += Number(element.value); });
    const units = Math.max(1, Number($('#q-unid').value) || 1);
    $('#q-score').textContent = total;
    $('#q-prio').textContent = `prioridade ${(total * Math.log10(units + 1)).toFixed(1)} · ${units} unidades`;
  }

  function calculateCriteria() {
    const count = document.querySelectorAll('.qq:checked').length;
    $('#q-crit').textContent = `${count} / 6`;
    $('#q-lbl').textContent = count === 6 ? 'Oportunidade Qualificada' : `faltam ${6 - count} para qualificar`;
  }

  function openContact(id) {
    const opportunity = opportunities.find(item => item.id === id);
    if (!opportunity) return;
    $('#contact-form').reset();
    $('#contact-id').value = id;
    $('#contact-opportunity').textContent = opportunity.name;
    $('#contact-criteria').value = opportunity.qualified_criteria;
    $('#contact-modal').showModal();
  }

  async function saveContact(event) {
    event.preventDefault();
    const id = $('#contact-id').value;
    const opportunity = opportunities.find(item => item.id === id);
    if (!opportunity) return;
    const unitsValue = $('#contact-units').value;
    const criteria = Math.min(6, Math.max(0, Number($('#contact-criteria').value) || 0));
    const nextAt = $('#contact-next-at').value ? new Date($('#contact-next-at').value).toISOString() : null;
    const touchpoint = {
      opportunity_id: id,
      channel: $('#contact-channel').value,
      contact_name: $('#contact-name').value.trim() || null,
      contact_role: $('#contact-role').value.trim() || null,
      response_category: $('#contact-response').value || null,
      notes: $('#contact-notes').value.trim() || null,
      units_confirmed: unitsValue ? Number(unitsValue) : null,
      qualified_criteria: criteria,
      next_step: $('#contact-next').value.trim() || null,
      next_step_at: nextAt
    };
    $('#contact-save').disabled = true;
    try {
      const touchpointResult = await db.from('touchpoints').insert(touchpoint);
      if (touchpointResult.error) throw touchpointResult.error;
      const changes = {
        qualified_criteria: criteria,
        next_action: touchpoint.next_step,
        next_action_at: nextAt,
        stage: criteria === 6
          ? 'Qualificada'
          : opportunity.stage === 'Identificado'
            ? 'Contatado'
            : opportunity.stage === 'Qualificada'
              ? 'Diagnóstico'
              : opportunity.stage
      };
      if (touchpoint.units_confirmed) {
        changes.units_represented = touchpoint.units_confirmed;
        changes.units_are_hypothesis = false;
      }
      const updateResult = await db.from('opportunities').update(changes).eq('id', id).select().single();
      if (updateResult.error) throw updateResult.error;
      const index = opportunities.findIndex(item => item.id === id);
      opportunities[index] = updateResult.data;
      $('#contact-modal').close();
      renderAll();
      toast('Contato registrado no Supabase.');
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      $('#contact-save').disabled = false;
    }
  }

  function bindEvents() {
    document.querySelectorAll('nav button[data-t]').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('nav button[data-t]').forEach(item => item.setAttribute('aria-current', item === button));
        document.querySelectorAll('section').forEach(section => section.classList.toggle('on', section.id === `t-${button.dataset.t}`));
        window.scrollTo(0, 0);
      });
    });

    document.addEventListener('change', async event => {
      if (event.target.classList.contains('st')) {
        const item = opportunities.find(opportunity => opportunity.id === event.target.dataset.id);
        if (!item) return;
        const previous = item.stage;
        const next = event.target.value;
        if (next === 'Qualificada' && item.qualified_criteria !== 6) {
          event.target.value = previous;
          toast('Qualificada exige os 6 critérios confirmados.');
          return;
        }
        const result = await db.from('opportunities').update({stage: next}).eq('id', item.id).select().single();
        if (result.error) {
          event.target.value = previous;
          toast(friendlyError(result.error));
          return;
        }
        Object.assign(item, result.data);
        renderAll();
        toast(`${item.name} → ${next}`);
      }
      if (event.target.classList.contains('qi') || event.target.classList.contains('qc')) calculateScore();
      if (event.target.classList.contains('qq')) calculateCriteria();
    });

    $('#q-unid').addEventListener('input', calculateScore);
    document.addEventListener('click', async event => {
      const data = event.target.dataset;
      if (Object.hasOwn(data, 'closeContact')) $('#contact-modal').close();
      if (data.log) openContact(data.log);
      if (data.del) {
        const item = opportunities.find(opportunity => opportunity.id === data.del);
        if (!item || !window.confirm(`Remover “${item.name}”? O histórico de contatos também será removido.`)) return;
        const result = await db.from('opportunities').delete().eq('id', data.del);
        if (result.error) return toast(friendlyError(result.error));
        opportunities = opportunities.filter(opportunity => opportunity.id !== data.del);
        renderAll();
        toast('Oportunidade removida.');
      }
      if (data.cp) {
        const script = SCRIPTS.find(item => item.id === data.cp);
        navigator.clipboard?.writeText(script.cmd).then(() => toast('Comando copiado.'), () => toast('Copie manualmente o comando.'));
      }
      if (data.run) {
        const now = new Date().toISOString();
        const result = await db.from('agent_runs').insert({script: data.run, started_at: now, finished_at: now, status: 'completed'});
        if (result.error) return toast(friendlyError(result.error));
        runs[data.run] = new Date(now).toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
        renderScripts();
        toast('Execução registrada.');
      }
    });

    $('#add').addEventListener('click', async () => {
      const name = $('#f-nome').value.trim();
      if (!name) { $('#f-nome').focus(); return toast('Dê um nome à oportunidade.'); }
      const payload = {
        name,
        type: $('#f-canal').value,
        polo: $('#f-polo').value.replace('Z4–Z6', 'Z4-Z6'),
        units_represented: Math.max(1, Number($('#f-unid').value) || 1),
        supply_score: Math.min(100, Math.max(0, Number($('#f-score').value) || 0)),
        why_now: $('#f-why').value.trim() || null,
        stage: 'Identificado'
      };
      const result = await db.from('opportunities').insert(payload).select().single();
      if (result.error) return toast(friendlyError(result.error));
      opportunities.push(result.data);
      renderAll();
      $('#f-nome').value = '';
      $('#f-why').value = '';
      toast('Adicionada ao Supabase.');
    });

    $('#savefech').addEventListener('click', async () => {
      const touched = $('#d1').value.trim();
      const payload = {
        closing_date: new Date().toISOString().slice(0, 10),
        created_by: user.id,
        represented_units_touched: touched === '' ? null : Math.max(0, Number(touched) || 0),
        repeated_objection: $('#d2').value.trim() || null,
        larger_than_expected_organization: $('#d3').value.trim() || null,
        tomorrow_change: $('#d4').value.trim() || null
      };
      const result = await db.from('daily_closings').upsert(payload, {onConflict: 'closing_date,created_by'});
      if (result.error) return toast(friendlyError(result.error));
      toast('Fechamento salvo no Supabase.');
    });

    $('#contact-form').addEventListener('submit', saveContact);
    $('#logout').addEventListener('click', async () => { await db.auth.signOut(); window.location.reload(); });
  }

  async function startSession(session) {
    if (sessionStarted) return;
    sessionStarted = true;
    user = session.user;
    const role = user.app_metadata?.role;
    if (!['hunter', 'admin'].includes(role)) {
      $('#login-error').textContent = 'Usuário autenticado, mas sem app_metadata.role hunter/admin.';
      await db.auth.signOut();
      sessionStarted = false;
      return;
    }
    $('#auth-gate').hidden = true;
    $('#session').hidden = false;
    $('#session-email').textContent = user.email;
    bindEvents();
    calculateScore();
    calculateCriteria();
    try { await loadData(); } catch (error) { setStatus(friendlyError(error), 'error'); }
  }

  async function boot() {
    if (!configured || !window.supabase) {
      $('#login-form').innerHTML = '<h1>Configure o Supabase</h1><p>Copie <code>config.example.js</code> para <code>config.js</code> e informe a URL e a publishable key do projeto. O arquivo real é ignorado pelo Git.</p>';
      setStatus('Supabase ainda não configurado', 'error');
      return;
    }
    db = window.supabase.createClient(config.url, config.publishableKey);
    db.auth.onAuthStateChange((_event, session) => {
      if (session) startSession(session).catch(error => setStatus(friendlyError(error), 'error'));
    });
    const {data, error} = await db.auth.getSession();
    if (error) $('#login-error').textContent = friendlyError(error);
    if (data.session) await startSession(data.session);
    $('#login-form').addEventListener('submit', async event => {
      event.preventDefault();
      $('#login-button').disabled = true;
      $('#login-error').textContent = '';
      const result = await db.auth.signInWithPassword({email: $('#login-email').value.trim(), password: $('#login-password').value});
      if (result.error) {
        $('#login-error').textContent = friendlyError(result.error);
        $('#login-button').disabled = false;
        return;
      }
      await startSession(result.data.session);
    });
    $('#magic-link-button').addEventListener('click', async () => {
      const email = $('#login-email').value.trim();
      if (!email) {
        $('#login-error').textContent = 'Informe seu e-mail para receber o link de acesso.';
        return;
      }
      $('#magic-link-button').disabled = true;
      $('#login-error').textContent = '';
      try {
        const result = await db.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: `${window.location.origin}${window.location.pathname}`
          }
        });
        if (result.error) throw result.error;
        $('#login-error').textContent = 'Link enviado. Abra o e-mail para entrar.';
      } catch (error) {
        $('#login-error').textContent = friendlyError(error);
      } finally {
        $('#magic-link-button').disabled = false;
      }
    });
  }

  boot().catch(error => setStatus(friendlyError(error), 'error'));
})();
