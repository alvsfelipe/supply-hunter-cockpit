-- Troca o índice único parcial por um íntegro.
--
-- Motivo: `on conflict (source, external_id)` não consegue inferir um índice
-- parcial sem repetir o predicado, e o PostgREST — que é como a função
-- agendada sync-imoveis grava — não tem como expressar esse predicado. O
-- upsert falhava com 42P10.
--
-- Índice sem predicado resolve e não custa nada: no Postgres, NULL é distinto
-- de NULL em índice único, então as linhas de captação do hunter (source e
-- external_id nulos) continuam podendo existir aos milhares.
drop index if exists public.properties_source_external_idx;

create unique index properties_source_external_idx
  on public.properties (source, external_id);
