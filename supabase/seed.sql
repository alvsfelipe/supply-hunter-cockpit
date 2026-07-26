insert into public.opportunities
  (id, name, type, polo, units_represented, units_are_hypothesis, supply_score, stage, why_now)
values
  ('10000000-0000-4000-8000-000000000001', 'Vitacon — ON Pixel Life Vila Mariana', 'Incorporadora', 'Z1', 245, false, 70, 'Identificado', 'Entregue no início de junho. 245 apartamentos, público investidor e unidades HIS/HMP.'),
  ('10000000-0000-4000-8000-000000000002', 'Ark Imóveis', 'Carteira / administradora', 'Z1', 100, true, 60, 'Identificado', 'Declara carteira de milhares de imóveis em Vila Mariana, Vila Clementino, Chácara Klabin e Ipiranga.'),
  ('10000000-0000-4000-8000-000000000003', 'Center Imóveis', 'Carteira / administradora', 'Z1', 100, true, 60, 'Identificado', 'Opera desde 1972 na Rua Jorge Tibiriçá, 119. Perfil de sucessão.'),
  ('10000000-0000-4000-8000-000000000004', 'IVO Imóveis', 'Carteira / administradora', 'Z1', 80, true, 60, 'Identificado', 'Estrutura de administração madura. Canal público no site.'),
  ('10000000-0000-4000-8000-000000000005', 'Setin Incorporadora', 'Incorporadora', 'Z1', 60, true, 65, 'Identificado', 'Studios de 25 a 39 m² em Vila Mariana e Brooklin.'),
  ('10000000-0000-4000-8000-000000000006', 'You,inc', 'Incorporadora', 'Z2', 60, true, 65, 'Identificado', 'Compactos de 23 a 30 m² e sede no Brooklin.'),
  ('10000000-0000-4000-8000-000000000007', 'Tegra + Exto — Ledge Brooklin Studios', 'Incorporadora', 'Z2', 40, true, 65, 'Identificado', 'Produto vendido explicitamente como investimento para locação.'),
  ('10000000-0000-4000-8000-000000000008', 'Site Location', 'Carteira / administradora', 'Z2', 60, true, 55, 'Identificado', 'Caça carteira ativamente e entende o valor do ativo.'),
  ('10000000-0000-4000-8000-000000000009', 'Rua Doutor Bacelar, 780', 'Edifício / densificação', 'Z1', 60, false, 53, 'Identificado', 'Ativo âncora: 30 unidades sob gestão. Falar com síndico e zelador.'),
  ('10000000-0000-4000-8000-000000000010', 'Rua Godói Colaço, 575', 'Edifício / densificação', 'Z2', 34, false, 55, 'Identificado', '17 unidades identificadas após consolidação do cadastro.')
on conflict (id) do nothing;
