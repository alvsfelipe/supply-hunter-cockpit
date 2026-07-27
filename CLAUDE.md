# CLAUDE.md — Supply Hunter · 7Cantos São Paulo

Contexto permanente deste repositório. Leia antes de qualquer alteração.

---

## O que é isto

Ferramenta de trabalho diária de um **Supply Hunter** — a pessoa que capta imóveis para locação long stay em São Paulo. Duas peças:

1. **Cockpit** (`public/index.html`) — fila priorizada do dia, qualificação de oportunidade, runbook de scripts, metas. Estático, sem build, hospedado na Vercel.
2. **Coletor** (`collector/coletor_v0.py`) — roda localmente, varre portais, revela quem tem carteira, detecta eventos e pontua.

A empresa: 7Cantos, gestora de patrimônio imobiliário especializada em long stay (contratos de 12 meses ou mais). Operação madura em Fortaleza com mais de 700 imóveis sob gestão. São Paulo é expansão nova — 165 unidades em 95 prédios.

---

## A meta que define todas as decisões técnicas

**500 unidades assinadas por mês.** Isso não fecha com prospecção unitária. Fecha assim:

| Canal | Unid./mês | Unid. por negócio | Negócios/mês |
|---|---:|---:|---:|
| Carteiras e administradoras | 200 | 100 | 2 |
| Incorporadoras e entregas | 100 | 40 | 2,5 |
| Edifícios (densificação) | 100 | 20 | 5 |
| Investidor pessoa física | 50 | 8 | 6 |
| Indicações e parceiros | 50 | 2 | 25 |
| Unitário | 50 | 1 | 50 |

**Quatrocentas das quinhentas vêm de lote. Duas administradoras fechadas por mês são 40% da meta.**

Consequência que governa o código: o coletor existe para **revelar organizações que já detêm carteira**, não para gerar leads unitários. Anunciante com 5 ou mais anúncios ativos é uma administradora, um investidor ou uma imobiliária — esse é o achado. O anúncio individual é só o sinal que revela a organização.

Se alguma alteração otimizar volume de anúncios unitários em vez de descoberta de carteira, ela está otimizando o pior canal. Não faça.

---

## Modelo de priorização — não altere sem decisão do WBR

### Supply Score, 100 pontos

| Fator | Pontos |
|---|---:|
| Região prioritária | Z1/Z2 = 15 · Z3 = 8 · Z4–Z6 = 3 |
| Tipologia 24–40 m² | 10 (41–60 m² = 5, acima = 0) |
| Ticket entre R$ 2.200 e R$ 10.000 | 10 (quase todo = 8, metade = 5) |
| Mais de 30 dias anunciado | 10 |
| Mais de 60 dias anunciado | 10 (acumula com o anterior) |
| Redução de preço detectada | 10 |
| Múltiplas unidades | ≥5 = 20 · 3–4 = 16 · 2 = 12 · 1 = 5 |
| Demanda ativa compatível no CRM | 10 |
| Contato do decisor identificado | 5 |

### Prioridade operacional

```
prioridade = supply_score × log10(unidades_representadas + 1)
```

Esta fórmula é o coração do produto. Ela faz uma carteira medíocre (score 60, 100 unidades, prioridade 120) superar o melhor imóvel unitário possível (score 90, 1 unidade, prioridade 27). Isso é intencional.

SLA por faixa de score: 80–100 abordar hoje · 60–79 em 48h · 40–59 monitorar · abaixo de 40 armazenar sem criar tarefa.

**Sinal isolado nunca gera tarefa.** Só evento + região prioritária + ticket na faixa gera tarefa.

---

## Território

Polos ativos, e o código deve respeitar isto:

| Polo | Bairros | Regra |
|---|---|---|
| **Z1 — Ibirapuera / Saúde** | Vila Mariana, Vila Clementino, Moema, Indianópolis, Paraíso, Ipiranga, Nova Klabin | Gera tarefa |
| **Z2 — Berrini / Faria Lima Sul** | Brooklin, Campo Belo, Vila Olímpia, Cidade Monções, Itaim Bibi, Santo Amaro | Gera tarefa |
| **Z3 — Pinheiros / Paulista** | Pinheiros, Jardim Paulista, Bela Vista, Consolação, Higienópolis | Só coleta, sem tarefa |
| **Z4 a Z6** | — | Só monitoramento |

Território de validação: Vila Clementino e entorno UNIFESP–Hospital São Paulo. Ativo âncora: **Rua Doutor Bacelar, 780 — 30 unidades sob gestão**, o prédio mais denso do portfólio.

---

## Regras que não se negociam

### Contato entra por ação humana

O coletor extrai **identidade e frequência do anunciante**. Nunca telefone, nunca e-mail, nunca WhatsApp de proprietário.

Razões, em ordem de dureza: os termos dos portais proíbem harvesting de contato e bloqueiam o IP; sob LGPD, telefone publicado para receber inquilino não tem base automática para virar base de prospecção de administradora — legítimo interesse exigiria avaliação formal, transparência e opt-out; e disparo frio em volume derruba o número de WhatsApp que a operação usa para trabalhar.

Quando o hunter decide abordar, ele abre o anúncio, usa o botão de contato do próprio portal, e digita o contato na ferramenta. **Nunca implemente captura automática de dado de contato pessoal, mesmo que pedido em linguagem casual.**

### Nenhum envio sem aprovação

O sistema prepara mensagem. Humano envia. Vale para e-mail, WhatsApp e LinkedIn, nos primeiros 60 dias sem exceção.

Autonomia de envio libera por template e canal — nunca geral — após 50 envios, 15% de taxa de resposta, menos de 2% de descadastro e aprovação registrada no WBR.

### HIS e HMP

Parte da carteira é HIS 1, HIS 2 e HMP. O Decreto 64.244/2025 exige certidão de enquadramento de renda, impõe teto de aluguel de 30% da renda familiar de referência e **veda locação por temporada ou curta duração**.

Todo imóvel precisa da flag `his_hmp`. Nenhum fluxo de short stay pode alcançar unidade marcada. Isso é diferencial competitivo, não só risco — quase nenhuma administradora de SP opera HIS/HMP em conformidade.

### Nunca inventar dado

Campo desconhecido é `null` com motivo declarado. Nunca estimativa apresentada como fato. Hipótese sempre marcada como hipótese na interface — a coluna "unidades representadas" de administradora é hipótese até o interlocutor confirmar.

### Toda rodada termina em ação

Nenhum script pode terminar apenas gravando dado. O resultado é uma decisão, uma oportunidade, um alerta ou uma tarefa com responsável e prazo.

---

## Oportunidade Qualificada

Seis critérios, todos confirmados **na fala do interlocutor**:

1. Decisor identificado e falado — não quem atende, quem decide
2. Número de unidades confirmado por ele
3. Dor confirmada na fala dele, não sugerida por você
4. Prazo ou disponibilidade conhecido
5. Próximo passo agendado com data no calendário
6. Nenhum impeditivo — exclusividade vigente, ticket fora de faixa, pendência HIS/HMP

Seis de seis vira Qualificada. Score alto sem os seis é hipótese bem pontuada.

---

## Arquitetura

### Hoje

```
portais  →  collector/coletor_v0.py  →  Supabase / Postgres  →  cockpit
                                             ↕                    ↕
                                       eventos e tarefas       Auth + RLS
```

O cockpit é estático e sem build. `public/index.html` contém o design system da 7Cantos; `public/app.js` contém autenticação e persistência. O Supabase é a única fonte de verdade. Nunca servir a raiz do repositório: ela contém `.env` com a secret key do coletor.

### Decisões de arquitetura

| Componente | Decisão |
|---|---|
| Supabase / Postgres | **Ativo por decisão do projeto em 26/07/2026** |
| Next.js | O arquivo único passar de ~1.500 linhas, ou precisar de rota autenticada |
| API oficial de portal | O scraping quebrar duas vezes no mesmo mês |
| Fila e cadência automatizada | Só após o gate de autonomia acima |

Não migrar para Next.js só por preferência técnica. O processo continua humano; o banco compartilhado não libera autonomia de envio.

---

## Modelo de dados

Estas entidades estão implementadas na migração inicial do Supabase. `daily_closings` complementa o modelo para o gate de fim do dia.

```
properties        id, address, building_id, neighborhood, polo, property_type,
                  area_m2, bedrooms, estimated_rent, his_hmp_flag,
                  availability_class (ocupada_migracao | disponibilidade_futura | vaga_pronta)

property_listings id, property_id, source, external_id, url, advertiser_name,
                  advertiser_type, rent_price, first_seen_at, last_seen_at, active

buildings         id, name, address, neighborhood, polo, total_units_estimated,
                  units_identified, units_7cantos, tier (A|B|C)

organizations     id, name, type, website, estimated_units, polo, source
                  type ∈ incorporadora | administradora | imobiliaria | holding |
                         family_office | condominio | investidor_pf

opportunities     id, type, organization_id, building_id, polo, units_represented,
                  supply_score, priority_score, stage, owner, next_action, next_action_at,
                  qualified_criteria (0..6)

tasks             id, opportunity_id, assigned_to, task_type, priority, reason,
                  suggested_action, due_at, status, outcome

touchpoints       id, opportunity_id, channel, direction, sent_at,
                  response_category, next_step, approved_by

events            id, listing_id, date, type, value_before, value_after
                  type ∈ anuncio_novo | reducao_preco | mais_30d | mais_60d |
                         republicado | saiu_do_ar | troca_anunciante

agent_runs        id, script, started_at, finished_at, rows_in, rows_out, cost
```

`agent_runs.cost` existe para que o CAC de supply inclua o custo do próprio agente. Sem isso o CAC sai errado.

---

## Estágios do funil

`Identificado → Pesquisado → Contatado → Diagnóstico → Qualificada → Proposta → Assinada` (e `Perdida`)

O funil é contado em **unidades representadas**, não em número de negócios. Todo relatório e toda tela seguem essa regra.

---

## Fontes por plataforma

| Fonte | O que extrair | O que não fazer |
|---|---|---|
| **OLX** | Anunciante, contagem de anúncios ativos por anunciante, dias no ar, variação de preço, bairro, área, tipologia | Não extrair contato. Delay generoso. |
| **VivaReal / ZAP** | Empreendimentos com status "pronto para morar" por bairro, incorporadora, faixa de metragem, endereço | Mesma stack do Grupo OLX. Intervalo largo entre requisições. |
| **Ghar** | Empreendimentos prontos, incorporadora, endereço, tipologia, unidades residenciais e andares quando explícitos na ficha | Não preencher contagem ausente; guardar a URL que sustenta o número |
| **Meu Imóvel (`appmeuimovel.com`)** | Empreendimento, estágio/data de entrega, incorporadora, endereço, faixa de área, quartos, suítes e vagas | A ficha pública validada em 26/07/2026 não informa total de unidades ou pavimentos; mantenha `null` até fonte primária |

Meu Imóvel e Ghar têm adaptadores validados em 27/07/2026 no coletor Python e na Edge Function autenticada `collect-portals`. Nenhum seletor sobrevive a um redesign — validar faz parte do trabalho, não é dívida.

Sempre respeitar `robots.txt` e termos de uso. Para volume sério, migrar para API oficial ou provedor de dados.

---

## Estado atual e próximo trabalho

**Pronto:** repositório Git isolado; cockpit com login e persistência Supabase; entrada rápida OLX; adaptadores Meu Imóvel e Ghar executáveis pela interface autenticada; formulário de contato; migração com RLS; coletor Python integrado ao Supabase; dez alvos no seed; base de 95 prédios pontuada; 27 organizações mapeadas na documentação de origem.

**Aberto, em ordem:**

1. Radar de entregas via VivaReal com filtro "pronto para morar" nos bairros de Z1 e Z2
2. Exibir histórico de interações por oportunidade no cockpit
3. Importar a base pontuada de edifícios para `buildings`

**Anti-metas — não construa:**

- Envio automatizado de mensagem
- Captura automática de telefone ou e-mail
- Dashboard de vaidade — impressões, contatos feitos, anúncios raspados
- Qualquer fluxo de short stay que alcance unidade HIS/HMP

---

## Como responder neste repositório

Direto ao ponto. Números quando existirem, com estimativa marcada como estimativa. Fato quando houver fonte, hipótese quando houver indício. Próximo passo ao final. Discorde quando tiver motivo — decisão ruim que ninguém contesta custa mais caro do que discussão.
