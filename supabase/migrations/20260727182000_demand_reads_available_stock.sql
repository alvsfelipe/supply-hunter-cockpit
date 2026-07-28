-- O papel `demand` passa a ler os imóveis DISPONÍVEIS — e só eles.
--
-- Motivo: o Demand Generator precisa direcionar parceiro e lead para o que
-- existe hoje. Até agora ele só enxergava o agregado por polo, o que responde
-- "posso ativar?" mas não "o que eu ofereço a esta pessoa?".
--
-- O recorte é deliberado: `vaga_pronta` é o que está à procura de inquilino.
-- Unidade ocupada é carteira do Supply e não interessa à geração de demanda —
-- expor tudo transformaria um papel restrito num papel com acesso ao portfólio
-- inteiro, que é exatamente o que a separação de papéis existe para impedir.
create policy properties_demand_reads_available on public.properties
for select to authenticated
using (
  ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'demand'
  and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'false'
  and availability_class = 'vaga_pronta'
);

comment on policy properties_demand_reads_available on public.properties is
  'Papel demand lê apenas vaga_pronta. Ocupadas e disponibilidade futura continuam restritas a hunter e admin.';
