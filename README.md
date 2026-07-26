# Supply Hunter — 7Cantos São Paulo

Cockpit operacional e coletor Python para originar oferta de locação long stay em escala de lote. A métrica central é **unidades representadas**, não anúncios ou contatos.

## Arquitetura

```
portais → collector/coletor_v0.py → Supabase/Postgres → cockpit
                                      ↕
                               Auth + RLS do time
```

O cockpit continua estático e sem build. O design system da 7Cantos está em `index.html`; a persistência, autenticação e regras de interface estão em `app.js`.

## 1. Configurar o Supabase

Crie um projeto e aplique a migração e o seed:

```bash
npx --yes supabase@2.109.1 login
npx --yes supabase@2.109.1 link --project-ref SEU_PROJECT_REF
npx --yes supabase@2.109.1 db push
```

A migração cria RLS e grants explícitos. O acesso é permitido somente a usuários autenticados com este `app_metadata` definido pelo administrador:

```json
{"role":"hunter"}
```

Também é aceito `{"role":"admin"}`. Convide os usuários pelo Supabase Auth e mantenha cadastro público e login anônimo desativados.

Copie a configuração pública do navegador:

```bash
cp config.example.js config.js
```

Edite `config.js` com a URL e a **publishable key**. Esse arquivo é ignorado pelo Git. Nunca coloque `sb_secret_...` ou a chave legada `service_role` nele.

## 2. Rodar o cockpit

```bash
python3 -m http.server 8000
# http://localhost:8000
```

A aplicação exige login. O formulário de contato grava a interação, unidades confirmadas, critérios de qualificação e próximo passo no Supabase. Nenhuma mensagem é enviada automaticamente.

## 3. Rodar o coletor Python

Requer Python 3.9 ou superior.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r collector/requirements.txt
cp .env.example .env
```

Carregue as variáveis do `.env` no shell e rode:

```bash
python collector/coletor_v0.py --dry-run
python collector/coletor_v0.py
python collector/coletor_v0.py --so-relatorio
```

A secret key é usada somente no processo Python local. Os seletores em `PORTAIS` ainda são placeholders: valide o HTML real, `robots.txt` e os termos de cada fonte antes de uma rodada gravável.

## Estrutura

```
index.html                         design system e markup do cockpit
app.js                            Auth e persistência Supabase
config.example.js                 modelo de configuração pública
collector/coletor_v0.py           coleta, eventos, score e criação de alvos
supabase/migrations/              esquema, RLS, índices e regras
supabase/seed.sql                 dez oportunidades iniciais
docs/                             especificação e base pontuada
CLAUDE.md                         contexto operacional permanente
```

## Segurança e regras operacionais

- A publishable key pode ficar no navegador porque RLS protege as linhas; a secret key nunca pode.
- Cadastro é por convite e o papel vem de `app_metadata`, nunca de `user_metadata`.
- Contato pessoal entra por ação humana. O coletor não captura telefone, e-mail ou WhatsApp.
- Nenhum envio ocorre sem aprovação humana.
- Unidades HIS/HMP nunca entram em fluxo de curta temporada.
- Campo desconhecido permanece `null`; estimativa é marcada como hipótese.

## Validação local do banco

Com Docker disponível:

```bash
npx --yes supabase@2.109.1 start
npx --yes supabase@2.109.1 db reset
npx --yes supabase@2.109.1 migration list --local
```

## Publicar na Vercel

```bash
npx vercel --prod
```

Configure `config.js` no artefato publicado ou gere-o no fluxo de deploy usando apenas URL e publishable key.
