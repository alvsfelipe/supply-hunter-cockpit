create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in (
    'incorporadora', 'administradora', 'imobiliaria', 'holding',
    'family_office', 'condominio', 'investidor_pf'
  )),
  website text,
  estimated_units integer check (estimated_units is null or estimated_units > 0),
  estimated_units_is_hypothesis boolean not null default true,
  polo text check (polo is null or polo in ('Z1', 'Z2', 'Z3', 'Z4-Z6')),
  source text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  name text,
  address text not null,
  neighborhood text not null,
  polo text not null check (polo in ('Z1', 'Z2', 'Z3', 'Z4-Z6')),
  total_units_estimated integer check (total_units_estimated is null or total_units_estimated > 0),
  units_identified integer not null default 0 check (units_identified >= 0),
  units_7cantos integer not null default 0 check (units_7cantos >= 0),
  tier text check (tier is null or tier in ('A', 'B', 'C')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  building_id uuid references public.buildings(id) on delete set null,
  neighborhood text not null,
  polo text not null check (polo in ('Z1', 'Z2', 'Z3', 'Z4-Z6')),
  property_type text,
  area_m2 numeric(8,2) check (area_m2 is null or area_m2 > 0),
  bedrooms smallint check (bedrooms is null or bedrooms >= 0),
  estimated_rent numeric(12,2) check (estimated_rent is null or estimated_rent >= 0),
  his_hmp_flag boolean,
  availability_class text check (availability_class is null or availability_class in (
    'ocupada_migracao', 'disponibilidade_futura', 'vaga_pronta'
  )),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.property_listings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  source text not null,
  external_id text not null,
  url text not null,
  advertiser_name text,
  advertiser_type text,
  rent_price numeric(12,2) check (rent_price is null or rent_price >= 0),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  active boolean not null default true,
  neighborhood text,
  polo text check (polo is null or polo in ('Z1', 'Z2', 'Z3', 'Z4-Z6')),
  address text,
  address_normalized text,
  area_m2 numeric(8,2),
  bedrooms smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  building_id uuid references public.buildings(id) on delete set null,
  polo text not null check (polo in ('Z1', 'Z2', 'Z3', 'Z4-Z6')),
  units_represented integer not null check (units_represented > 0),
  units_are_hypothesis boolean not null default true,
  supply_score smallint not null check (supply_score between 0 and 100),
  priority_score numeric(10,2) generated always as (
    round((supply_score::numeric * log(10::numeric, (units_represented + 1)::numeric)), 2)
  ) stored,
  stage text not null default 'Identificado' check (stage in (
    'Identificado', 'Pesquisado', 'Contatado', 'Diagnóstico',
    'Qualificada', 'Proposta', 'Assinada', 'Perdida'
  )),
  owner_id uuid references auth.users(id) on delete set null default auth.uid(),
  next_action text,
  next_action_at timestamptz,
  why_now text,
  qualified_criteria smallint not null default 0 check (qualified_criteria between 0 and 6),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stage <> 'Qualificada' or qualified_criteria = 6)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,
  task_type text not null,
  priority text not null check (priority in ('hoje', '48h', 'monitorar')),
  reason text not null,
  suggested_action text not null,
  due_at timestamptz,
  status text not null default 'aberta' check (status in ('aberta', 'em_andamento', 'concluida', 'cancelada')),
  outcome text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.touchpoints (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  channel text not null,
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  contact_name text,
  contact_role text,
  occurred_at timestamptz not null default now(),
  response_category text,
  notes text,
  units_confirmed integer check (units_confirmed is null or units_confirmed > 0),
  qualified_criteria smallint check (qualified_criteria is null or qualified_criteria between 0 and 6),
  next_step text,
  next_step_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.property_listings(id) on delete cascade,
  event_date date not null default current_date,
  type text not null check (type in (
    'anuncio_novo', 'reducao_preco', 'mais_30d', 'mais_60d',
    'republicado', 'saiu_do_ar', 'troca_anunciante'
  )),
  value_before numeric,
  value_after numeric,
  created_at timestamptz not null default now()
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  script text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  rows_in integer not null default 0 check (rows_in >= 0),
  rows_out integer not null default 0 check (rows_out >= 0),
  cost numeric(12,4) check (cost is null or cost >= 0),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error_message text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  closing_date date not null default current_date,
  represented_units_touched integer check (represented_units_touched is null or represented_units_touched >= 0),
  repeated_objection text,
  larger_than_expected_organization text,
  tomorrow_change text,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (closing_date, created_by)
);

create index organizations_name_idx on public.organizations (lower(name));
create index buildings_polo_tier_idx on public.buildings (polo, tier);
create index properties_building_idx on public.properties (building_id);
create index property_listings_advertiser_idx on public.property_listings (lower(advertiser_name)) where active;
create index property_listings_last_seen_idx on public.property_listings (last_seen_at desc);
create index opportunities_queue_idx on public.opportunities (stage, priority_score desc);
create index opportunities_owner_idx on public.opportunities (owner_id);
create index tasks_due_idx on public.tasks (status, due_at);
create index touchpoints_opportunity_idx on public.touchpoints (opportunity_id, occurred_at desc);
create index events_listing_date_idx on public.events (listing_id, event_date desc);
create index agent_runs_started_idx on public.agent_runs (started_at desc);

create trigger organizations_touch_updated_at before update on public.organizations
for each row execute function private.touch_updated_at();
create trigger buildings_touch_updated_at before update on public.buildings
for each row execute function private.touch_updated_at();
create trigger properties_touch_updated_at before update on public.properties
for each row execute function private.touch_updated_at();
create trigger property_listings_touch_updated_at before update on public.property_listings
for each row execute function private.touch_updated_at();
create trigger opportunities_touch_updated_at before update on public.opportunities
for each row execute function private.touch_updated_at();
create trigger tasks_touch_updated_at before update on public.tasks
for each row execute function private.touch_updated_at();
create trigger daily_closings_touch_updated_at before update on public.daily_closings
for each row execute function private.touch_updated_at();

alter table public.organizations enable row level security;
alter table public.buildings enable row level security;
alter table public.properties enable row level security;
alter table public.property_listings enable row level security;
alter table public.opportunities enable row level security;
alter table public.tasks enable row level security;
alter table public.touchpoints enable row level security;
alter table public.events enable row level security;
alter table public.agent_runs enable row level security;
alter table public.daily_closings enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'buildings', 'properties', 'property_listings',
    'opportunities', 'tasks', 'touchpoints', 'events', 'agent_runs', 'daily_closings'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (((select auth.jwt()) -> ''app_metadata'' ->> ''role'') in (''hunter'', ''admin'') and coalesce((select auth.jwt()) ->> ''is_anonymous'', ''false'') = ''false'') with check (((select auth.jwt()) -> ''app_metadata'' ->> ''role'') in (''hunter'', ''admin'') and coalesce((select auth.jwt()) ->> ''is_anonymous'', ''false'') = ''false'')',
      table_name || '_team_access', table_name
    );
  end loop;
end;
$$;

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
