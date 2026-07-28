-- Identidade externa dos imóveis, para o portfólio da 7Cantos poder ser
-- reimportado sem duplicar.
--
-- Motivo: a API externa (api-externa-…herokuapp.com/api/v1/imoveis) é a fonte
-- de verdade do que a 7Cantos administra. Sem uma chave estável, cada rodada
-- de importação criaria 301 linhas novas e a cobertura por polo — que é o que
-- decide se o Demand pode ativar um parceiro — passaria a contar fantasma.
--
-- A coluna fica nula para tudo que entrou por captação do hunter: só o que vem
-- da API tem external_id.

alter table public.properties
  add column source text,
  add column external_id text,
  add column source_synced_at timestamptz;

comment on column public.properties.source is
  'De onde a linha veio. ''api_7cantos'' é o portfólio administrado; null é captação do hunter.';
comment on column public.properties.external_id is
  'Id do imóvel na fonte. Junto com source forma a chave de reimportação.';
comment on column public.properties.source_synced_at is
  'Última vez que a linha foi confirmada contra a fonte. Serve para detectar imóvel que saiu da carteira.';

create unique index properties_source_external_idx
  on public.properties (source, external_id)
  where source is not null and external_id is not null;
