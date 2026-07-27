create or replace function private.normalize_company_name(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(
          lower(coalesce(value, '')),
          'áàãâäéèêëíìîïóòõôöúùûüç',
          'aaaaaeeeeiiiiooooouuuuc'
        ),
        '[^a-z0-9]+', '', 'g'
      ),
      'sa$', '', 'g'
    ),
    '(incorporadora|construtora|empreendimentos|imoveis|realty)$', '', 'g'
  );
$$;

create table public.clay_companies (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'clay' check (source = 'clay'),
  source_workspace_id text not null,
  source_task_id text,
  source_entity_id text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  profile_type text not null check (profile_type in ('incorporadora', 'administradora', 'proprietario')),
  name text not null,
  normalized_name text generated always as (private.normalize_company_name(name)) stored,
  domain text,
  website_url text,
  linkedin_url text,
  logo_url text,
  industry text,
  locality text,
  description text,
  employee_count integer check (employee_count is null or employee_count >= 0),
  employee_growth_12m numeric(8,2),
  annual_revenue text,
  funding_range text,
  fit_summary text,
  recent_news text,
  raw_data jsonb not null default '{}'::jsonb,
  last_enriched_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_entity_id)
);

create table public.clay_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.clay_companies(id) on delete cascade,
  source text not null default 'clay' check (source = 'clay'),
  source_entity_id text not null,
  name text not null,
  title text,
  linkedin_url text,
  location text,
  email text,
  phone text,
  work_history text,
  raw_data jsonb not null default '{}'::jsonb,
  last_enriched_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_entity_id)
);

create table public.clay_company_opportunities (
  company_id uuid not null references public.clay_companies(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('proprietaria', 'incorporadora', 'administradora', 'operadora', 'outra')),
  match_method text not null check (match_method in ('exact', 'normalized', 'alias', 'manual')),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (company_id, opportunity_id, relationship_type)
);

create index clay_companies_normalized_name_idx on public.clay_companies (normalized_name);
create index clay_companies_organization_idx on public.clay_companies (organization_id);
create index clay_contacts_company_idx on public.clay_contacts (company_id);
create index clay_contacts_email_idx on public.clay_contacts (lower(email)) where email is not null;
create index clay_company_opportunities_opportunity_idx on public.clay_company_opportunities (opportunity_id);

create trigger clay_companies_touch_updated_at before update on public.clay_companies
for each row execute function private.touch_updated_at();
create trigger clay_contacts_touch_updated_at before update on public.clay_contacts
for each row execute function private.touch_updated_at();

alter table public.clay_companies enable row level security;
alter table public.clay_contacts enable row level security;
alter table public.clay_company_opportunities enable row level security;

create policy clay_companies_team_access on public.clay_companies
for all to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('hunter', 'admin')
  and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'false')
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('hunter', 'admin')
  and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'false');

create policy clay_contacts_team_access on public.clay_contacts
for all to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('hunter', 'admin')
  and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'false')
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('hunter', 'admin')
  and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'false');

create policy clay_company_opportunities_team_access on public.clay_company_opportunities
for all to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('hunter', 'admin')
  and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'false')
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') in ('hunter', 'admin')
  and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'false');

revoke all on public.clay_companies, public.clay_contacts, public.clay_company_opportunities from anon;
grant select, insert, update, delete on public.clay_companies, public.clay_contacts, public.clay_company_opportunities to authenticated;
grant all on public.clay_companies, public.clay_contacts, public.clay_company_opportunities to service_role;

comment on table public.clay_companies is 'Empresas e perfis enriquecidos no Clay, disponíveis apenas ao time autenticado.';
comment on table public.clay_contacts is 'Contatos profissionais enriquecidos no Clay, protegidos por RLS.';
comment on table public.clay_company_opportunities is 'Vínculos auditáveis entre empresas do Clay e oportunidades do cockpit.';
