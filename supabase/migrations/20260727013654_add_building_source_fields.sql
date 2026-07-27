alter table public.buildings
  add column source text,
  add column source_external_id text,
  add column source_url text,
  add column developer_organization_id uuid references public.organizations(id) on delete set null,
  add column delivery_status text,
  add column delivery_date_text text,
  add column area_min_m2 numeric(8,2) check (area_min_m2 is null or area_min_m2 > 0),
  add column area_max_m2 numeric(8,2) check (area_max_m2 is null or area_max_m2 > 0),
  add column bedrooms_min smallint check (bedrooms_min is null or bedrooms_min >= 0),
  add column bedrooms_max smallint check (bedrooms_max is null or bedrooms_max >= 0),
  add column suites_min smallint check (suites_min is null or suites_min >= 0),
  add column suites_max smallint check (suites_max is null or suites_max >= 0),
  add column parking_min smallint check (parking_min is null or parking_min >= 0),
  add column parking_max smallint check (parking_max is null or parking_max >= 0),
  add column last_seen_at timestamptz;

alter table public.buildings
  add constraint buildings_area_range_check
    check (area_min_m2 is null or area_max_m2 is null or area_min_m2 <= area_max_m2),
  add constraint buildings_bedrooms_range_check
    check (bedrooms_min is null or bedrooms_max is null or bedrooms_min <= bedrooms_max),
  add constraint buildings_suites_range_check
    check (suites_min is null or suites_max is null or suites_min <= suites_max),
  add constraint buildings_parking_range_check
    check (parking_min is null or parking_max is null or parking_min <= parking_max);

create unique index buildings_source_external_id_idx
  on public.buildings (source, source_external_id)
  where source is not null and source_external_id is not null;

create index buildings_developer_organization_idx
  on public.buildings (developer_organization_id);
