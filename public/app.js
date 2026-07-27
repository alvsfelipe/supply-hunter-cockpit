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
    {id:'olx', t:'OLX', alvo:'Revelar quem tem carteira', extrai:'Identidade do anunciante, quantidade de anúncios ativos por anunciante, dias no ar, variação de preço, bairro, área e tipologia.', nao:'Fluxo manual assistido: não faz scraping nem extrai telefone. Gere a busca, use a aba Entrada rápida e revise antes de salvar.', cmd:'python collector/coletor_v0.py --mostrar-url --bairro moema --preco-min 3000 --preco-max 6000', ret:'URL pronta para abrir e registrar manualmente os anunciantes recorrentes.'},
    {id:'vr', t:'VivaReal e ZAP', alvo:'Radar de entregas e vacância de estreia', extrai:'Adaptador ainda não configurado.', nao:'Nenhuma coleta é executada até validar fonte, termos e campos públicos.', cmd:'Ainda não configurado — próximo portal', ret:'Sem dados nesta versão.'},
    {id:'ghar', t:'Ghar', alvo:'Confirmar tamanho e incorporadora dos empreendimentos', extrai:'Nome, endereço, entrega, área, quartos, suítes, vagas, incorporadora, unidades residenciais e andares quando publicados.', nao:'Não completa campos ausentes nem acessa áreas administrativas. Fichas sem endereço são ignoradas.', cmd:'python collector/coletor_v0.py --portal ghar --bairro moema --max-itens 3 --dry-run', ret:'Empreendimentos prontos com contagem confirmada na ficha pública.', collect:true},
    {id:'meu_imovel', t:'Meu Imóvel', alvo:'Radar de empreendimentos novos e prontos', extrai:'Nome, estágio/data de entrega, endereço, bairro, área, quartos, suítes, vagas e incorporadora responsável.', nao:'Lê apenas páginas públicas com pausa fixa de 6 s; não acessa /api/. Total de unidades e pavimentos continuam null.', cmd:'python collector/coletor_v0.py --portal meu_imovel --bairro moema --max-itens 3 --dry-run', ret:'Empreendimentos em Z1/Z2 para cruzar com incorporadora e validar tamanho do alvo.', collect:true}
  ];

  const $ = selector => document.querySelector(selector);
  let db;
  let user;
  let sessionStarted = false;
  let opportunities = [];
  let buildings = [];
  let organizations = new Map();
  let runs = {};
  let clayCompanies = [];
  let clayContacts = [];
  let clayLinks = [];
  const clayDrafts = new Map();

  const config = window.SUPABASE_CONFIG || {};
  const authRules = window.SupplyHunterAuth;
  let recoveryMode = window.location.hash.includes('type=recovery')
    || new URLSearchParams(window.location.search).get('type') === 'recovery'
    || new URLSearchParams(window.location.search).has('code');
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
    if (error.code === 'invalid_credentials') return 'E-mail ou senha inválidos.';
    if (error.code === 'weak_password') return 'Sua senha não atende à política atual. Use “Esqueci minha senha” para criar uma senha forte.';
    return error.message || String(error);
  }

  async function loadData() {
    setStatus('Sincronizando com o Supabase…');
    const [opportunityResult, buildingResult, organizationResult, runResult, clayCompanyResult, clayContactResult, clayLinkResult] = await Promise.all([
      db.from('opportunities').select('*').order('priority_score', {ascending: false}),
      db.from('buildings').select('*').order('last_seen_at', {ascending: false}),
      db.from('organizations').select('id,name'),
      db.from('agent_runs').select('script,finished_at').eq('status', 'completed').order('finished_at', {ascending: false}).limit(50),
      db.from('clay_companies').select('*').order('name'),
      db.from('clay_contacts').select('*').order('name'),
      db.from('clay_company_opportunities').select('*')
    ]);
    if (opportunityResult.error) throw opportunityResult.error;
    if (buildingResult.error) throw buildingResult.error;
    if (organizationResult.error) throw organizationResult.error;
    if (runResult.error) throw runResult.error;
    if (clayCompanyResult.error) throw clayCompanyResult.error;
    if (clayContactResult.error) throw clayContactResult.error;
    if (clayLinkResult.error) throw clayLinkResult.error;
    opportunities = opportunityResult.data || [];
    buildings = buildingResult.data || [];
    organizations = new Map((organizationResult.data || []).map(item => [item.id, item.name]));
    clayCompanies = clayCompanyResult.data || [];
    clayContacts = clayContactResult.data || [];
    clayLinks = clayLinkResult.data || [];
    runs = {};
    for (const run of runResult.data || []) {
      if (!runs[run.script]) runs[run.script] = new Date(run.finished_at).toLocaleString('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
    }
    renderAll();
    renderScripts();
    setStatus(`Supabase sincronizado · ${opportunities.length} oportunidades · ${buildings.length} no radar · ${clayCompanies.length} no Clay`);
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

  function renderRadar() {
    const promoted = new Map(opportunities.filter(item => item.building_id).map(item => [item.building_id, item]));
    const pending = buildings.filter(item => !promoted.has(item.id)).length;
    $('#n-radar').textContent = pending;
    if (!buildings.length) {
      $('#radar').innerHTML = '<div class="empty">Nenhum empreendimento coletado. Execute Ghar ou Meu Imóvel na aba Scripts.</div>';
      return;
    }
    $('#radar').innerHTML = buildings.map(building => {
      const opportunity = promoted.get(building.id);
      const developer = organizations.get(building.developer_organization_id);
      const source = window.SupplyHunterRadar.sourceLabel(building.source);
      const units = building.total_units_estimated;
      const area = building.area_min_m2 || building.area_max_m2
        ? `${building.area_min_m2 || '?'}–${building.area_max_m2 || '?'} m²`
        : 'não informada';
      const href = window.SupplyHunterRadar.safeUrl(building.source_url);
      return `<article class="radar-card">
        <div class="radar-head"><div><div class="source">${escapeHtml(source)}</div><div class="nm">${escapeHtml(building.name || building.address)}</div><div class="meta">${escapeHtml(building.address)} · ${escapeHtml(building.polo)}</div></div>${opportunity ? '<span class="tag p">no pipeline</span>' : '<span class="tag g">novo</span>'}</div>
        ${developer ? `<div class="why">Incorporadora: <b>${escapeHtml(developer)}</b></div>` : ''}
        <div class="radar-data"><div><b>${units || '—'}</b><span>unidades</span></div><div><b>${building.total_floors || '—'}</b><span>andares</span></div><div><b>${escapeHtml(area)}</b><span>área</span></div></div>
        <div class="radar-actions">${href !== '#' ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Abrir fonte ↗</a>` : '<span></span>'}${opportunity ? '<button class="btn ghost" type="button" disabled>Já promovido</button>' : `<button class="btn" type="button" data-promote="${building.id}">Criar oportunidade</button>`}</div>
      </article>`;
    }).join('');
  }

  function renderMix() {
    $('#mix').innerHTML = CANAIS.map(([channel, target, perDeal]) => {
      const pipeline = opportunities.filter(item => item.type === channel && !['Assinada', 'Perdida'].includes(item.stage)).reduce((sum, item) => sum + item.units_represented, 0);
      return `<tr><td>${channel}</td><td class="num">${target}</td><td class="num">${perDeal}</td><td class="num">${(target / perDeal).toFixed(1)}</td><td class="num">${pipeline}</td></tr>`;
    }).join('');
  }

  function compactClayText(value, limit = 360) {
    const clean = String(value || '')
      .replace(/#{1,6}\s*/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    return clean.length > limit ? `${clean.slice(0, limit).trim()}…` : clean;
  }

  function companyInitials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  }

  function renderClay() {
    const enrichment = window.SupplyHunterEnrichment;
    const filter = $('#clay-filter')?.value || '';
    const query = ($('#clay-search')?.value || '').trim().toLocaleLowerCase('pt-BR');
    const linksByCompany = new Map();
    const contactsByCompany = new Map();
    for (const link of clayLinks) {
      if (!linksByCompany.has(link.company_id)) linksByCompany.set(link.company_id, []);
      linksByCompany.get(link.company_id).push(link);
    }
    for (const contact of clayContacts) {
      if (!contactsByCompany.has(contact.company_id)) contactsByCompany.set(contact.company_id, []);
      contactsByCompany.get(contact.company_id).push(contact);
    }

    $('#n-clay').textContent = clayCompanies.length;
    $('#clay-company-count').textContent = clayCompanies.length;
    $('#clay-contact-count').textContent = clayContacts.length;
    $('#clay-link-count').textContent = clayLinks.length;
    clayDrafts.clear();

    const visible = clayCompanies.filter(company => {
      const links = linksByCompany.get(company.id) || [];
      const contacts = contactsByCompany.get(company.id) || [];
      if (filter === 'linked' && !links.length) return false;
      if (filter && filter !== 'linked' && company.profile_type !== filter) return false;
      if (!query) return true;
      const opportunityNames = links.map(link => opportunities.find(item => item.id === link.opportunity_id)?.name || '');
      const haystack = [company.name, company.description, company.fit_summary, ...contacts.flatMap(contact => [contact.name, contact.title]), ...opportunityNames].join(' ').toLocaleLowerCase('pt-BR');
      return haystack.includes(query);
    });

    if (!visible.length) {
      $('#clay-results').innerHTML = '<div class="empty panel">Nenhum enriquecimento corresponde aos filtros.</div>';
      return;
    }

    $('#clay-results').innerHTML = visible.map(company => {
      const links = linksByCompany.get(company.id) || [];
      const contacts = contactsByCompany.get(company.id) || [];
      const primaryLink = links[0];
      const opportunity = primaryLink ? opportunities.find(item => item.id === primaryLink.opportunity_id) : null;
      const website = enrichment.safeExternalUrl(company.website_url);
      const linkedin = enrichment.safeExternalUrl(company.linkedin_url);
      const profileLabel = {incorporadora: 'Incorporadora', administradora: 'Administradora', proprietario: 'Proprietário'}[company.profile_type] || company.profile_type;
      const companyLinks = [
        website !== '#' ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Site ↗</a>` : '',
        linkedin !== '#' ? `<a href="${escapeHtml(linkedin)}" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>` : ''
      ].filter(Boolean).join('');
      const fit = compactClayText(company.fit_summary || company.description) || 'Enriquecimento institucional disponível no Clay.';
      const linked = opportunity ? `<div class="clay-link"><b>Vinculada a ${escapeHtml(opportunity.name)}</b>${escapeHtml(opportunity.why_now || `${opportunity.units_represented} unidades representadas`)}<div class="tags"><span class="tag p">${escapeHtml(primaryLink.match_method)}</span><span class="tag">${Math.round(Number(primaryLink.confidence) * 100)}% confiança</span></div></div>` : '';
      const contactHtml = contacts.length ? contacts.map(contact => {
        const draft = enrichment.buildEmailDraft(company, contact, opportunity);
        const draftKey = `${company.id}:${contact.id}`;
        clayDrafts.set(draftKey, draft);
        const email = contact.email ? `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}` : '';
        const phone = String(contact.phone || '').replace(/[^+\d]/g, '');
        const contactLinkedin = enrichment.safeExternalUrl(contact.linkedin_url);
        return `<div class="clay-contact">
          <div class="clay-contact-head"><div><div class="clay-contact-name">${escapeHtml(contact.name)}</div><div class="clay-contact-title">${escapeHtml(contact.title || 'Cargo não informado')}</div></div>${contact.email ? '<span class="tag p">e-mail</span>' : '<span class="tag">LinkedIn</span>'}</div>
          <div class="contact-actions">${email ? `<a href="${escapeHtml(email)}">${escapeHtml(contact.email)}</a>` : ''}${phone ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(contact.phone)}</a>` : ''}${contactLinkedin !== '#' ? `<a href="${escapeHtml(contactLinkedin)}" target="_blank" rel="noopener noreferrer">Perfil ↗</a>` : ''}</div>
          <details class="email-draft"><summary>E-mail sugerido para este perfil</summary><pre><b>Assunto: ${escapeHtml(draft.subject)}</b>\n\n${escapeHtml(draft.body)}</pre><button class="copy" type="button" data-clay-draft="${escapeHtml(draftKey)}">Copiar e-mail</button></details>
        </div>`;
      }).join('') : '<div class="hint">Nenhum decisor enriquecido nesta carga.</div>';
      return `<article class="clay-card">
        <div class="clay-company-head"><div class="clay-avatar">${escapeHtml(companyInitials(company.name))}</div><div class="clay-company-main"><div class="nm">${escapeHtml(company.name)}</div><div class="tags"><span class="tag p">${escapeHtml(profileLabel)}</span><span class="tag g">Clay</span>${opportunity ? '<span class="tag b">vinculada</span>' : ''}</div><div class="clay-company-links">${companyLinks}</div></div></div>
        <div class="clay-metrics"><div><b>${company.employee_count ?? '—'}</b><span>pessoas</span></div><div><b>${escapeHtml(company.annual_revenue || '—')}</b><span>receita estimada</span></div><div><b>${company.employee_growth_12m == null ? '—' : `${Number(company.employee_growth_12m).toLocaleString('pt-BR')}%`}</b><span>crescimento 12m</span></div></div>
        <p class="clay-fit">${escapeHtml(fit)}</p>${linked}
        <div class="clay-contacts"><h4>${contacts.length} decisor${contacts.length === 1 ? '' : 'es'}</h4>${contactHtml}</div>
      </article>`;
    }).join('');
  }

  function renderScripts() {
    const neighborhoodOptions = Object.keys(window.SupplyHunterQuickEntry?.neighborhoods || {})
      .map(neighborhood => `<option value="${neighborhood}"${neighborhood === 'moema' ? ' selected' : ''}>${neighborhoodLabel(neighborhood)}</option>`)
      .join('');
    $('#scripts').innerHTML = SCRIPTS.map(script => `
      <div class="panel"><h3>${script.t}</h3><div class="sub">${script.alvo}</div>
      <table><tbody><tr><td style="width:130px;color:var(--mute)">Extrai</td><td>${script.extrai}</td></tr><tr><td style="color:var(--mute)">Limite</td><td>${script.nao}</td></tr><tr><td style="color:var(--mute)">Devolve</td><td>${script.ret}</td></tr></tbody></table>
      <div class="script-command-head"><span class="tallyn">Comando</span><button class="copy" data-cp="${script.id}">Copiar</button></div>
      <pre id="cmd-${script.id}">${escapeHtml(script.cmd)}</pre>
      <div class="script-controls">
        ${script.collect ? `
          <select aria-label="Bairro" data-collect-neighborhood="${script.id}" style="width:auto">${neighborhoodOptions}</select>
          <input aria-label="Quantidade de fichas" data-collect-count="${script.id}" type="number" min="1" max="3" value="1" style="width:72px">
          <button class="btn" data-collect="${script.id}">Coletar</button>
        ` : ''}
        <span class="tallyn" id="run-${script.id}">${runs[script.id] ? `Última execução: ${runs[script.id]}` : 'Nunca executado'}</span>
      </div></div>`).join('');
  }

  async function collectPortal(button) {
    const portal = button.dataset.collect;
    const bairro = document.querySelector(`[data-collect-neighborhood="${portal}"]`).value;
    const maxItems = Number(document.querySelector(`[data-collect-count="${portal}"]`).value) || 1;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Coletando…';
    setStatus(`Coletando ${portal} · aguarde`);
    try {
      const {data, error} = await db.functions.invoke('collect-portals', {
        body: {portal, bairro, max_items: maxItems}
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const count = data?.collected || 0;
      toast(count ? `${count} empreendimento gravado. Revise no Radar.` : 'Nenhuma ficha completa encontrada.');
      await loadData();
      if (count) document.querySelector('nav button[data-t="radar"]')?.click();
    } catch (error) {
      setStatus('Falha na coleta', 'error');
      toast(friendlyError(error));
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function renderAll() {
    renderQueue();
    renderSummary();
    renderPipeline();
    renderRadar();
    renderMix();
    renderClay();
  }

  function openPromotion(id) {
    const building = buildings.find(item => item.id === id);
    if (!building) return;
    if (opportunities.some(item => item.building_id === id)) return toast('Este empreendimento já está no pipeline.');
    const hasPublishedUnits = Number(building.total_units_estimated) > 0;
    const source = window.SupplyHunterRadar.sourceLabel(building.source);
    $('#promote-form').reset();
    $('#promote-id').value = building.id;
    $('#promote-building').textContent = `${building.name || building.address} · ${source}`;
    $('#promote-units').value = hasPublishedUnits ? building.total_units_estimated : '';
    $('#promote-score').value = hasPublishedUnits ? 65 : 55;
    $('#promote-units-hint').textContent = hasPublishedUnits
      ? 'Quantidade publicada na ficha coletada.'
      : 'Campo ausente na coleta. Confirme antes de continuar.';
    $('#promote-confirmed').checked = hasPublishedUnits;
    $('#promote-confirmed-label').textContent = hasPublishedUnits
      ? 'A quantidade veio da ficha pública vinculada abaixo.'
      : 'Conferi o número em uma fonte pública ou com a incorporadora.';
    const href = window.SupplyHunterRadar.safeUrl(building.source_url);
    $('#promote-source-note').innerHTML = href === '#'
      ? '<b>Fonte indisponível.</b> Confirme os dados antes de promover.'
      : `<b>Revise a origem:</b> <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">abrir ficha de ${escapeHtml(source)} ↗</a>`;
    $('#promote-modal').showModal();
  }

  async function savePromotion(event) {
    event.preventDefault();
    const building = buildings.find(item => item.id === $('#promote-id').value);
    if (!building) return toast('Empreendimento não encontrado. Atualize o radar.');
    const units = Number($('#promote-units').value);
    const score = Number($('#promote-score').value);
    if (!Number.isInteger(units) || units < 1) return toast('Informe uma quantidade válida de unidades.');
    if (!$('#promote-confirmed').checked) return toast('Confirme a quantidade antes de criar a oportunidade.');
    if (!Number.isFinite(score) || score < 0 || score > 100) return toast('O Supply Score deve ficar entre 0 e 100.');

    $('#promote-save').disabled = true;
    try {
      const duplicateResult = await db.from('opportunities').select('id').eq('building_id', building.id).limit(1).maybeSingle();
      if (duplicateResult.error) throw duplicateResult.error;
      if (duplicateResult.data) {
        await loadData();
        $('#promote-modal').close();
        return toast('Este empreendimento já estava no pipeline.');
      }
      const payload = window.SupplyHunterRadar.promotionPayload(building, units, score);
      const result = await db.from('opportunities').insert(payload).select().single();
      if (result.error) throw result.error;
      opportunities.push(result.data);
      $('#promote-modal').close();
      renderAll();
      toast('Oportunidade criada e vinculada ao empreendimento.');
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      $('#promote-save').disabled = false;
    }
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

  function neighborhoodLabel(value) {
    return value.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
      .replace('Paraiso', 'Paraíso').replace('Indianopolis', 'Indianópolis')
      .replace('Moncoes', 'Monções').replace('Olimpia', 'Olímpia');
  }

  function initQuickEntry() {
    const quick = window.SupplyHunterQuickEntry;
    if (!quick) return;
    const options = Object.entries(quick.neighborhoods)
      .map(([neighborhood, polo]) => `<option value="${neighborhood}">${neighborhoodLabel(neighborhood)} · ${polo}</option>`)
      .join('');
    $('#qe-search-neighborhood').innerHTML = options;
    $('#qe-neighborhood').innerHTML = `<option value="">Selecione</option>${options}`;
    $('#qe-search-neighborhood').value = 'moema';
  }

  function buildQuickSearch() {
    try {
      const url = window.SupplyHunterQuickEntry.buildOlxUrl({
        neighborhood: $('#qe-search-neighborhood').value,
        minPrice: $('#qe-search-min').value,
        maxPrice: $('#qe-search-max').value
      });
      $('#qe-search-url').textContent = url;
      $('#qe-open-search').href = url;
      $('#qe-open-search').hidden = false;
    } catch (error) {
      toast(error.message);
    }
  }

  function fillQuickEntry(parsed) {
    $('#qe-url').value = parsed.url || '';
    $('#qe-advertiser').value = parsed.advertiserName || '';
    $('#qe-advertiser-type').value = parsed.advertiserType || '';
    $('#qe-address').value = parsed.address || '';
    $('#qe-neighborhood').value = parsed.neighborhood || $('#qe-search-neighborhood').value || '';
    $('#qe-price').value = parsed.rentPrice ?? '';
    $('#qe-area').value = parsed.areaM2 ?? '';
    $('#qe-bedrooms').value = parsed.bedrooms ?? '';
    $('#qe-reviewed').checked = false;
    $('#qe-contact-warning').hidden = !parsed.containsContactData;
    $('#qe-result').textContent = parsed.externalId
      ? 'Sugestões preenchidas. Revise os campos antes de salvar.'
      : 'Não encontrei o código na URL. Cole a URL completa do anúncio no campo de revisão.';
    $('#qe-result').dataset.state = '';
    $('#qe-url').focus();
  }

  function clearQuickEntry({keepResult = false} = {}) {
    $('#qe-form').reset();
    $('#qe-paste').value = '';
    $('#qe-contact-warning').hidden = true;
    if (!keepResult) {
      $('#qe-result').textContent = '';
      $('#qe-result').dataset.state = '';
    }
    $('#qe-paste').focus();
  }

  async function saveQuickEntry(event) {
    event.preventDefault();
    const quick = window.SupplyHunterQuickEntry;
    const url = $('#qe-url').value.trim();
    const externalId = quick.externalIdFromUrl(url);
    const advertiserName = $('#qe-advertiser').value.trim();
    const neighborhood = $('#qe-neighborhood').value;
    if (!externalId) return toast('A URL não contém um código de anúncio OLX reconhecível.');
    if (!advertiserName) return toast('Confirme o nome do anunciante.');
    if (!neighborhood) return toast('Confirme o bairro.');
    if (!$('#qe-reviewed').checked) return toast('Revise os campos antes de salvar.');

    const now = new Date().toISOString();
    const payload = {
      source: 'olx',
      external_id: externalId,
      url,
      advertiser_name: advertiserName,
      advertiser_type: $('#qe-advertiser-type').value || null,
      rent_price: $('#qe-price').value === '' ? null : Number($('#qe-price').value),
      neighborhood,
      polo: quick.neighborhoods[neighborhood],
      address: $('#qe-address').value.trim() || null,
      area_m2: $('#qe-area').value === '' ? null : Number($('#qe-area').value),
      bedrooms: $('#qe-bedrooms').value === '' ? null : Number($('#qe-bedrooms').value),
      last_seen_at: now,
      active: true
    };
    $('#qe-save').disabled = true;
    try {
      const existingResult = await db.from('property_listings')
        .select('id,first_seen_at').eq('source', 'olx').eq('external_id', externalId).maybeSingle();
      if (existingResult.error) throw existingResult.error;
      let saved;
      if (existingResult.data) {
        const updateResult = await db.from('property_listings').update(payload)
          .eq('id', existingResult.data.id).select().single();
        if (updateResult.error) throw updateResult.error;
        saved = updateResult.data;
      } else {
        const insertResult = await db.from('property_listings').insert({...payload, first_seen_at: now}).select().single();
        if (insertResult.error) throw insertResult.error;
        saved = insertResult.data;
      }
      const countResult = await db.from('property_listings').select('id', {count: 'exact', head: true})
        .eq('source', 'olx').eq('active', true).eq('advertiser_name', advertiserName);
      if (countResult.error) throw countResult.error;
      const count = countResult.count || 1;
      const action = count >= 5
        ? `Alvo de carteira: ${advertiserName} já aparece em ${count} anúncios. Próxima ação: validar a organização na fila.`
        : `${advertiserName}: ${count}/5 anúncios identificados. Próxima ação: continuar o mapeamento.`;
      clearQuickEntry({keepResult: true});
      $('#qe-result').textContent = `${existingResult.data ? 'Anúncio atualizado' : 'Anúncio salvo'} (${saved.external_id}). ${action}`;
      $('#qe-result').dataset.state = count >= 5 ? 'target' : '';
      toast(existingResult.data ? 'Anúncio atualizado no Supabase.' : 'Anúncio salvo no Supabase.');
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      $('#qe-save').disabled = false;
    }
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
        if (window.matchMedia('(max-width: 860px)').matches) button.scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'center'});
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
    $('#clay-filter').addEventListener('change', renderClay);
    $('#clay-search').addEventListener('input', renderClay);
    $('#qe-build-url').addEventListener('click', buildQuickSearch);
    $('#qe-parse').addEventListener('click', () => {
      const text = $('#qe-paste').value;
      if (!text.trim()) return toast('Cole o conteúdo do anúncio primeiro.');
      fillQuickEntry(window.SupplyHunterQuickEntry.parseOlxText(text));
    });
    $('#qe-paste').addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        $('#qe-parse').click();
      }
    });
    $('#qe-clear').addEventListener('click', () => clearQuickEntry());
    $('#qe-form').addEventListener('submit', saveQuickEntry);
    document.addEventListener('click', async event => {
      const data = event.target.dataset;
      if (Object.hasOwn(data, 'closeContact')) $('#contact-modal').close();
      if (Object.hasOwn(data, 'closePromote')) $('#promote-modal').close();
      if (data.promote) openPromotion(data.promote);
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
      if (data.collect) await collectPortal(event.target);
      if (data.clayDraft) {
        const draft = clayDrafts.get(data.clayDraft);
        if (!draft) return;
        navigator.clipboard?.writeText(`Assunto: ${draft.subject}\n\n${draft.body}`)
          .then(() => toast('E-mail sugerido copiado.'), () => toast('Copie manualmente o e-mail sugerido.'));
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
    $('#promote-form').addEventListener('submit', savePromotion);
    $('#logout').addEventListener('click', async () => { await db.auth.signOut(); window.location.reload(); });
  }

  async function startSession(session) {
    if (sessionStarted) return;
    sessionStarted = true;
    user = session.user;
    if (!authRules.isAllowedCompanyEmail(user.email)) {
      $('#login-error').textContent = 'Acesso permitido somente para contas @7cantos.com.';
      await db.auth.signOut();
      $('#login-button').disabled = false;
      sessionStarted = false;
      return;
    }
    const role = user.app_metadata?.role;
    if (!['hunter', 'admin'].includes(role)) {
      $('#login-error').textContent = 'Usuário autenticado, mas sem app_metadata.role hunter/admin.';
      await db.auth.signOut();
      $('#login-button').disabled = false;
      sessionStarted = false;
      return;
    }
    $('#auth-gate').hidden = true;
    $('#session').hidden = false;
    $('#session-email').textContent = user.email;
    initQuickEntry();
    bindEvents();
    calculateScore();
    calculateCriteria();
    try { await loadData(); } catch (error) { setStatus(friendlyError(error), 'error'); }
  }

  function showAuthView(viewId) {
    for (const form of document.querySelectorAll('.auth-view')) form.hidden = form.id !== viewId;
  }

  function setAuthFeedback(selector, message, state = 'ok') {
    const element = $(selector);
    element.textContent = message;
    element.dataset.state = state;
  }

  async function showPasswordRecovery(session) {
    recoveryMode = true;
    if (!authRules.isAllowedCompanyEmail(session?.user?.email)) {
      await db.auth.signOut();
      showAuthView('login-form');
      $('#login-error').textContent = 'O link não pertence a uma conta @7cantos.com.';
      return;
    }
    showAuthView('new-password-form');
    setAuthFeedback('#new-password-message', 'Link validado. Crie sua nova senha.');
  }

  function bindAuthEvents() {
    $('#show-recovery').addEventListener('click', () => {
      $('#recovery-email').value = $('#login-email').value.trim();
      setAuthFeedback('#recovery-message', '');
      showAuthView('recovery-form');
      $('#recovery-email').focus();
    });

    $('#back-to-login').addEventListener('click', () => {
      $('#login-email').value = $('#recovery-email').value.trim();
      showAuthView('login-form');
      $('#login-email').focus();
    });

    $('#login-form').addEventListener('submit', async event => {
      event.preventDefault();
      const email = authRules.normalizeEmail($('#login-email').value);
      $('#login-error').textContent = '';
      setAuthFeedback('#login-message', '');
      if (!authRules.isAllowedCompanyEmail(email)) {
        $('#login-error').textContent = 'Use seu e-mail corporativo @7cantos.com.';
        return;
      }
      $('#login-button').disabled = true;
      const result = await db.auth.signInWithPassword({email, password: $('#login-password').value});
      if (result.error) {
        $('#login-error').textContent = friendlyError(result.error);
        $('#login-button').disabled = false;
        return;
      }
      await startSession(result.data.session);
    });

    $('#recovery-form').addEventListener('submit', async event => {
      event.preventDefault();
      const email = authRules.normalizeEmail($('#recovery-email').value);
      setAuthFeedback('#recovery-message', '');
      if (!authRules.isAllowedCompanyEmail(email)) {
        setAuthFeedback('#recovery-message', 'Use seu e-mail corporativo @7cantos.com.', 'error');
        return;
      }
      $('#recovery-button').disabled = true;
      try {
        const result = await db.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}${window.location.pathname}`
        });
        if (result.error) throw result.error;
        setAuthFeedback('#recovery-message', 'Se a conta estiver cadastrada, o link de recuperação chegará por e-mail.');
      } catch (error) {
        setAuthFeedback('#recovery-message', friendlyError(error), 'error');
      } finally {
        $('#recovery-button').disabled = false;
      }
    });

    $('#new-password-form').addEventListener('submit', async event => {
      event.preventDefault();
      const password = $('#new-password').value;
      const confirmation = $('#confirm-password').value;
      setAuthFeedback('#new-password-message', '');
      if (!authRules.isStrongPassword(password)) {
        setAuthFeedback('#new-password-message', authRules.passwordIssueMessage(password), 'error');
        return;
      }
      if (password !== confirmation) {
        setAuthFeedback('#new-password-message', 'As senhas não coincidem.', 'error');
        return;
      }
      $('#new-password-button').disabled = true;
      try {
        const result = await db.auth.updateUser({password});
        if (result.error) throw result.error;
        await db.auth.signOut();
        recoveryMode = false;
        window.history.replaceState({}, document.title, window.location.pathname);
        $('#new-password-form').reset();
        showAuthView('login-form');
        setAuthFeedback('#login-message', 'Senha atualizada. Entre novamente com a nova senha.');
      } catch (error) {
        setAuthFeedback('#new-password-message', friendlyError(error), 'error');
      } finally {
        $('#new-password-button').disabled = false;
      }
    });
  }

  async function boot() {
    if (!configured || !window.supabase || !authRules) {
      $('#login-form').innerHTML = '<h1>Configure o Supabase</h1><p>Copie <code>config.example.js</code> para <code>config.js</code> e informe a URL e a publishable key do projeto. O arquivo real é ignorado pelo Git.</p>';
      setStatus('Supabase ainda não configurado', 'error');
      return;
    }
    bindAuthEvents();
    db = window.supabase.createClient(config.url, config.publishableKey);
    db.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        window.setTimeout(() => showPasswordRecovery(session).catch(error => setAuthFeedback('#new-password-message', friendlyError(error), 'error')), 0);
        return;
      }
      if (session && !recoveryMode) {
        window.setTimeout(() => startSession(session).catch(error => setStatus(friendlyError(error), 'error')), 0);
      }
    });
    const {data, error} = await db.auth.getSession();
    if (error) $('#login-error').textContent = friendlyError(error);
    if (data.session && recoveryMode) await showPasswordRecovery(data.session);
    else if (data.session) await startSession(data.session);
  }

  boot().catch(error => setStatus(friendlyError(error), 'error'));
})();
