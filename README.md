# Supply Hunter — 7Cantos São Paulo

Cockpit operacional e coletor Python para originar oferta de locação long stay em escala de lote. A métrica central é **unidades representadas**, não anúncios ou contatos.

## Arquitetura

```
portais → collector/coletor_v0.py → Supabase/Postgres → cockpit
                                      ↕
                               Auth + RLS do time
```

O cockpit continua estático e sem build. O design system da 7Cantos está em `public/index.html`; a persistência, autenticação e regras de interface estão em `public/app.js`.

## 1. Configurar o Supabase

**Não é necessário instalar Docker nem Postgres local.** O banco roda no Supabase hospedado.

O projeto hospedado `supply-hunter-cockpit` já está criado e recebeu as migrações. Para vincular outra máquina:

```bash
npx --yes supabase@2.109.1 login
npx --yes supabase@2.109.1 link --project-ref etoycmxfntqfukhxyngm
npx --yes supabase@2.109.1 migration list --linked
```

Para enviar uma nova migração no futuro:

```bash
npx --yes supabase@2.109.1 db push --dry-run
npx --yes supabase@2.109.1 db push
```

Esses comandos acessam o projeto remoto e não iniciam containers. Se o `link` pedir uma senha, use a senha do banco definida nas configurações do projeto — não use uma API key.

Alternativa sem CLI: abra **SQL Editor** no painel do Supabase e execute o novo arquivo de migração. O seed inicial já foi carregado.

A migração cria RLS e grants explícitos. O acesso é permitido somente a usuários autenticados com este `app_metadata` definido pelo administrador:

```json
{"role":"hunter"}
```

Também é aceito `{"role":"admin"}`. Convide os usuários pelo Supabase Auth e mantenha cadastro público e login anônimo desativados.

O arquivo `public/config.js` já contém a URL e a **publishable key** deste projeto e pode ser versionado: esses valores são públicos e dependem de RLS. Nunca coloque `sb_secret_...` ou a chave legada `service_role` nele.

## 2. Rodar o cockpit

```bash
python3 -m http.server 8000 --directory public
# http://localhost:8000
```

Sirva somente `public/`. A raiz contém `.env` com a secret key do coletor e nunca deve ser exposta por um servidor HTTP.

A aplicação exige login. O formulário de contato grava a interação, unidades confirmadas, critérios de qualificação e próximo passo no Supabase. Nenhuma mensagem é enviada automaticamente.

## 3. Rodar o coletor Python

Requer Python 3.9 ou superior.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r collector/requirements.txt
cp -n .env.example .env
```

O coletor carrega automaticamente o `.env` da raiz, sem sobrescrever variáveis
que você tenha exportado manualmente. Rode:

```bash
python collector/coletor_v0.py --mostrar-url --bairro moema --preco-min 3000 --preco-max 6000
python collector/coletor_v0.py --portal meu_imovel --bairro moema --max-itens 3 --dry-run
python collector/coletor_v0.py --portal meu_imovel --max-itens 30
python collector/coletor_v0.py --portal ghar --bairro moema --max-itens 3 --dry-run
python collector/coletor_v0.py --portal ghar --max-itens 30
python collector/coletor_v0.py --so-relatorio
```

A primeira linha apenas gera uma URL navegável, sem fazer requisição e sem usar o
Supabase. Bairros aceitos: `brooklin`, `campo-belo`, `cidade-moncoes`, `indianopolis`,
`ipiranga`, `itaim-bibi`, `moema`, `nova-klabin`, `paraiso`, `santo-amaro`,
`vila-clementino`, `vila-mariana` e `vila-olimpia`. Também é possível passar
`--pagina 2`.

A secret key é usada somente no processo Python local.

### Meu Imóvel: adaptador público

O adaptador lê a listagem e as fichas públicas do Meu Imóvel, limita a coleta
aos bairros Z1/Z2 e espera 6 segundos entre fichas. Ele não acessa `/api/`, para
imediatamente em HTTP 403/429 e não usa técnicas de contorno. Rode primeiro com
`--dry-run`; sem essa opção, incorporadoras e empreendimentos são gravados no
Supabase. A fonte não exibe total de unidades ou pavimentos nas fichas verificadas,
portanto esses valores permanecem `null` até confirmação primária.

### Ghar: confirmação técnica

O adaptador do Ghar lê a página pública de imóveis prontos e as fichas dos polos
Z1/Z2. Além de incorporadora e tipologia, ele grava quantidade de residências e
andares somente quando esses números aparecem explicitamente no texto da ficha.
O URL da fonte acompanha a contagem. Fichas sem endereço são ignoradas, sem
preenchimento artificial.

### Coleta pela interface

Depois de entrar no cockpit como `hunter` ou `admin`, abra **Scripts**. Os botões
de Meu Imóvel e Ghar invocam a Edge Function autenticada `collect-portals` e
coletam de uma a três fichas por rodada no bairro escolhido. A função usa `@supabase/server`, valida a
sessão e grava com o cliente sujeito às políticas RLS do usuário. Para outros
bairros ou lotes maiores, use os comandos Python locais.

O resultado aparece em **Radar**, não diretamente na fila comercial. Cada ficha
mantém o vínculo com o empreendimento, a incorporadora e a URL de origem. Use
**Criar oportunidade** para promover o alvo ao pipeline. Quando o Ghar publica o
total de unidades, o formulário vem preenchido com essa contagem; quando o Meu
Imóvel não informa o total, o hunter precisa preenchê-lo e confirmar a origem
antes de salvar. A mesma ficha não é promovida duas vezes pela interface.

### OLX: limite operacional atual

Em 26/07/2026, o `robots.txt` público da OLX bloqueia as URLs de busca que usam os
parâmetros `q`, `ps`, `pe` e `o`. Por isso o projeto **gera a URL para revisão
manual, mas não automatiza o scraping da OLX**. Intervalo aleatório, rotação de
identidade, proxy ou solução de CAPTCHA não fazem parte do projeto.

O schema já comporta os dados públicos necessários para consolidação de carteira:
`advertiser_name` e `advertiser_type` (`profissional` ou `particular`). Telefone,
e-mail e WhatsApp não são coletados. Para automatizar a OLX, use uma API/parceria
autorizada e implemente-a como um adaptador em `collector/`, mantendo a mesma saída.

### Entrada rápida OLX no cockpit

Depois de entrar, abra **Entrada rápida**: gere a busca, escolha o anúncio na OLX,
copie manualmente o bloco visível e cole no cockpit. O navegador sugere URL, código,
anunciante, tipo, preço, área, quartos e bairro; revise e confirme para gravar em
`property_listings`. O salvamento atualiza anúncios repetidos e mostra quantos
anúncios já foram associados ao mesmo anunciante. Ao chegar a cinco, a interface
marca o anunciante como alvo de carteira. Telefone/e-mail presentes na colagem são
detectados, ignorados e não gravados automaticamente.

## Estrutura

```
public/index.html                  design system e markup do cockpit
public/app.js                     Auth e persistência Supabase
public/quick-entry.js             geração e interpretação local da entrada OLX
public/radar.js                   validação da promoção de empreendimentos
public/config.js                  configuração pública do projeto hospedado
public/config.example.js          modelo de configuração pública
collector/coletor_v0.py           coleta, eventos, score e criação de alvos
supabase/functions/collect-portals função autenticada usada pelo cockpit
supabase/migrations/              esquema, RLS, índices e regras
supabase/seed.sql                 dez oportunidades iniciais
docs/                             especificação e base pontuada
CLAUDE.md                         contexto operacional permanente
```

## Segurança e regras operacionais

- A publishable key pode ficar no navegador porque RLS protege as linhas; a secret key nunca pode.
- Cadastro é por convite e o papel vem de `app_metadata`, nunca de `user_metadata`.
- Contato pessoal entra por ação humana. O coletor não captura telefone, e-mail ou WhatsApp.
- A Entrada rápida interpreta somente conteúdo colado pelo hunter e ignora telefone/e-mail.
- Nenhum envio ocorre sem aprovação humana.
- Unidades HIS/HMP nunca entram em fluxo de curta temporada.
- Campo desconhecido permanece `null`; estimativa é marcada como hipótese.

## Validar o banco hospedado

Após aplicar a migração:

```bash
npx --yes supabase@2.109.1 migration list --linked
npx --yes supabase@2.109.1 db push --dry-run
```

O segundo comando deve informar que não há novas migrações para aplicar.

## Publicar na Vercel

```bash
npx vercel --prod
```

Configure `config.js` no artefato publicado ou gere-o no fluxo de deploy usando apenas URL e publishable key.
