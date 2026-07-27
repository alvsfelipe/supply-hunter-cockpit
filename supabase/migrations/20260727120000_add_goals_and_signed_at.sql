-- Metas configuráveis, cascata para o dia e data de assinatura.
-- A meta é da operação de São Paulo, uma linha por mês. Só admin escreve.

create table public.monthly_goals (
  id uuid primary key default gen_random_uuid(),
  month date not null unique,
  units_target integer not null check (units_target > 0),
  working_days smallint not null check (working_days between 1 and 31),
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Cast explícito para timestamp: a variante timestamptz de date_trunc é STABLE
  -- e o Postgres recusa função não-IMMUTABLE dentro de CHECK.
  check (month = date_trunc('month', month::timestamp)::date)
);

comment on column public.monthly_goals.working_days is
  'Dias úteis do mês. O padrão sugerido conta segunda a sexta; feriados são ajuste manual do admin.';

create table public.goal_channels (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.monthly_goals(id) on delete cascade,
  channel text not null,
  units_target integer not null check (units_target >= 0),
  units_per_deal integer not null check (units_per_deal > 0),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (goal_id, channel)
);

create index goal_channels_goal_idx on public.goal_channels (goal_id, sort_order);

-- Sem esta coluna não existe curva de realizado por dia, só total acumulado.
alter table public.opportunities add column signed_at timestamptz;

comment on column public.opportunities.signed_at is
  'Carimbada pelo trigger na transição para Assinada. Linhas anteriores à migração foram preenchidas com updated_at — aproximação, não data confirmada.';

create index opportunities_signed_at_idx on public.opportunities (signed_at desc)
  where signed_at is not null;

create or replace function private.stamp_signed_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.stage = 'Assinada' then
    if tg_op = 'INSERT' or old.stage is distinct from 'Assinada' then
      new.signed_at = coalesce(new.signed_at, now());
    end if;
  else
    new.signed_at = null;
  end if;
  return new;
end;
$$;

create trigger opportunities_stamp_signed_at before insert or update on public.opportunities
for each row execute function private.stamp_signed_at();

-- Backfill declarado: usa updated_at como proxy da data de assinatura das linhas já existentes.
update public.opportunities set signed_at = updated_at
where stage = 'Assinada' and signed_at is null;

create trigger monthly_goals_touch_updated_at before update on public.monthly_goals
for each row execute function private.touch_updated_at();
create trigger goal_channels_touch_updated_at before update on public.goal_channels
for each row execute function private.touch_updated_at();

alter table public.monthly_goals enable row level security;
alter table public.goal_channels enable row level security;

-- Hunter lê a meta; só admin altera.
do $$
declare
  goal_table text;
begin
  foreach goal_table in array array['monthly_goals', 'goal_channels']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (((select auth.jwt()) -> ''app_metadata'' ->> ''role'') in (''hunter'', ''admin'') and coalesce((select auth.jwt()) ->> ''is_anonymous'', ''false'') = ''false'')',
      goal_table || '_team_read', goal_table
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (((select auth.jwt()) -> ''app_metadata'' ->> ''role'') = ''admin'' and coalesce((select auth.jwt()) ->> ''is_anonymous'', ''false'') = ''false'') with check (((select auth.jwt()) -> ''app_metadata'' ->> ''role'') = ''admin'' and coalesce((select auth.jwt()) ->> ''is_anonymous'', ''false'') = ''false'')',
      goal_table || '_admin_write', goal_table
    );
  end loop;
end;
$$;

grant select, insert, update, delete on public.monthly_goals to authenticated;
grant select, insert, update, delete on public.goal_channels to authenticated;
grant all on public.monthly_goals to service_role;
grant all on public.goal_channels to service_role;

-- Meta corrente com o mix que já estava no código, para o cockpit não nascer vazio.
insert into public.monthly_goals (month, units_target, working_days, notes)
values (date_trunc('month', current_date)::date, 500, 21, 'Meta inicial migrada do código do cockpit.')
on conflict (month) do nothing;

insert into public.goal_channels (goal_id, channel, units_target, units_per_deal, sort_order)
select goal.id, channel.name, channel.units_target, channel.units_per_deal, channel.sort_order
from public.monthly_goals goal
cross join (values
  ('Carteira / administradora', 200, 100, 1),
  ('Incorporadora', 100, 40, 2),
  ('Edifício / densificação', 100, 20, 3),
  ('Investidor PF', 50, 8, 4),
  ('Indicação', 50, 2, 5),
  ('Unitário', 50, 1, 6)
) as channel(name, units_target, units_per_deal, sort_order)
where goal.month = date_trunc('month', current_date)::date
on conflict (goal_id, channel) do nothing;
