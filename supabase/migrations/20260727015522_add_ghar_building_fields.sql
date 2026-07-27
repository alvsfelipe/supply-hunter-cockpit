alter table public.buildings
  add column total_floors smallint
    check (total_floors is null or total_floors > 0),
  add column total_units_source_url text;
