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
public/index.html                  design system e markup do cockpit
public/app.js                     Auth e persistência Supabase
public/config.js                  configuração pública do projeto hospedado
public/config.example.js          modelo de configuração pública
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
