import { withSupabase } from "npm:@supabase/server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DELAY_MS = 6000;
const POLOS: Record<string, string> = {
  "vila-mariana": "Z1", "vila-clementino": "Z1", moema: "Z1",
  paraiso: "Z1", ipiranga: "Z1", indianopolis: "Z1", "nova-klabin": "Z1",
  brooklin: "Z2", "campo-belo": "Z2", "vila-olimpia": "Z2",
  "itaim-bibi": "Z2", "cidade-moncoes": "Z2", "santo-amaro": "Z2",
};
const SOURCES: Record<string, string> = {
  meu_imovel: "https://appmeuimovel.com/apartamentos?estagio=pronto",
  ghar: "https://ghar.com.br/imoveis/prontos/",
};

type Item = Record<string, string | number | null | undefined>;

function decode(value: string) {
  return value.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/&ndash;|&#8211;/g, "–").replace(/&mdash;|&#8212;/g, "—")
    .replace(/&sup2;/g, "²");
}

function text(value = "") {
  return decode(value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function norm(value = "") {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

function range(value?: string) {
  const numbers = [...(value || "").matchAll(/\d+(?:[.,]\d+)?/g)]
    .map((match) => Number(match[0].replace(",", ".")));
  return numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : [null, null];
}

function lastMatch(html: string, regex: RegExp) {
  return [...html.matchAll(regex)].map((match) => text(match[1])).filter(Boolean).at(-1);
}

function listLinks(html: string, portal: string, bairro?: string): Item[] {
  const isGhar = portal === "ghar";
  const regex = isGhar
    ? /https:\/\/ghar\.com\.br\/imoveis\/sp\/sao-paulo\/([a-z0-9-]+)\/([a-z0-9-]+)\//g
    : /https:\/\/appmeuimovel\.com\/apartamentos\/sp\/sao-paulo\/([a-z0-9-]+)\/([a-z0-9-]+)/g;
  const found = new Set<string>();
  const items: Item[] = [];
  for (const match of html.matchAll(regex)) {
    const neighborhood = match[1];
    const slug = match[2];
    if (!POLOS[neighborhood] || (bairro && bairro !== neighborhood)) continue;
    const url = isGhar
      ? "https://ghar.com.br/imoveis/sp/sao-paulo/" + neighborhood + "/" + slug + "/"
      : "https://appmeuimovel.com/apartamentos/sp/sao-paulo/" + neighborhood + "/" + slug;
    if (found.has(url)) continue;
    found.add(url);
    items.push({ portal, url, external_id: slug, bairro: neighborhood, polo: POLOS[neighborhood] });
  }
  return items;
}

function parseMeuImovel(html: string, item: Item): Item {
  const page = text(html);
  const delivery = page.match(/Data de entrega:\s*(.+?)(?=\s+(?:Valor|Preço|Conheça|Sobre|Características|R\$)|$)/i)?.[1]?.trim();
  const [areaMin, areaMax] = range(page.match(/Área\s*(\d+(?:[.,]\d+)?(?:\s*(?:a|-)\s*\d+(?:[.,]\d+)?)?\s*m²)/i)?.[1]);
  const [bedMin, bedMax] = range(page.match(/Quartos\s*(\d+(?:\s*(?:a|e|-)\s*\d+)?)/i)?.[1]);
  const [suiteMin, suiteMax] = range(page.match(/Suítes\s*(\d+(?:\s*(?:a|e|-)\s*\d+)?)/i)?.[1]);
  const [parkingMin, parkingMax] = range(page.match(/Vagas\s*(\d+(?:\s*(?:a|e|-)\s*\d+)?)/i)?.[1]);
  return {
    ...item,
    nome: lastMatch(html, /<h1[^>]*id=["']realtyName["'][^>]*>([\s\S]*?)<\/h1>/gi),
    endereco: lastMatch(html, /class=["'][^"']*single-endereco-mobile[^"']*["'][\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi),
    incorporadora: lastMatch(html, /class=["'][^"']*single-incorporadora[^"']*["'][\s\S]{0,800}?<img[^>]*alt=["']([^"']+)["']/gi),
    delivery_date_text: delivery,
    delivery_status: norm(delivery).includes("pronto") ? "pronto" : (delivery ? "em_construcao" : null),
    area_min: areaMin, area_max: areaMax, bedrooms_min: bedMin, bedrooms_max: bedMax,
    suites_min: suiteMin, suites_max: suiteMax, parking_min: parkingMin, parking_max: parkingMax,
  };
}

function parseGhar(html: string, item: Item): Item {
  const page = text(html);
  const normalized = norm(page);
  const [areaMin, areaMax] = range(page.match(/(\d+(?:[.,]\d+)?\s*(?:a|-)\s*\d+(?:[.,]\d+)?\s*m²)/i)?.[1]);
  const [bedMin, bedMax] = range(page.match(/Quartos\s*(\d+(?:\s*(?:a|e|-)\s*\d+)?)/i)?.[1]);
  const [suiteMin, suiteMax] = range(page.match(/Suítes\s*(\d+(?:\s*(?:a|e|-)\s*\d+)?)/i)?.[1]);
  const [parkingMin, parkingMax] = range(page.match(/Vagas\s*(\d+(?:\s*(?:a|e|-)\s*\d+)?)/i)?.[1]);
  const units = normalized.match(/\b(?:totalizando|com|contempla)\s+(\d+)\s+(?:unidades residenciais|residencias)\b/)?.[1];
  const floors = normalized.match(/\b(\d+)\s+andares\b/)?.[1];
  return {
    ...item,
    nome: lastMatch(html, /<h1[^>]*class=["'][^"']*elementor-heading-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/gi),
    endereco: page.match(/\b((?:Avenida|Av\.?|Rua|Alameda|Al\.?)\s+[^,.]{2,80},\s*\d+[A-Za-z]?)/i)?.[1],
    incorporadora: lastMatch(html, /(?:pela|da)\s*<strong>([^<]{2,80})<\/strong>(?=.{0,100}(?:incorporadora|construtora))/gis),
    delivery_date_text: page.match(/Entrega:\s*([0-9/]+)/i)?.[1],
    delivery_status: "pronto", area_min: areaMin, area_max: areaMax,
    bedrooms_min: bedMin, bedrooms_max: bedMax, suites_min: suiteMin, suites_max: suiteMax,
    parking_min: parkingMin, parking_max: parkingMax,
    total_units: units ? Number(units) : null, total_floors: floors ? Number(floors) : null,
  };
}

async function publicHtml(url: string) {
  if (new URL(url).pathname.startsWith("/api/")) throw new Error("Rotas /api/ não são acessadas.");
  const response = await fetch(url, { headers: { "User-Agent": "7Cantos-SupplyHunter/0.3" } });
  if ([403, 429].includes(response.status)) throw new Error("Coleta interrompida: HTTP " + response.status + ".");
  if (!response.ok) throw new Error("Fonte respondeu HTTP " + response.status + ".");
  return response.text();
}

const handler = withSupabase({ auth: "user" }, async (request, ctx) => {
  const { data: authData, error: authError } = await ctx.supabase.auth.getUser();
  const role = authData.user?.app_metadata?.role;
  if (authError || !["hunter", "admin"].includes(role)) {
    return Response.json({ error: "Sem permissão para executar coletores." }, { status: 403, headers: CORS });
  }
  const body = await request.json().catch(() => ({}));
  const portal = body.portal as string;
  const bairro = typeof body.bairro === "string" ? norm(body.bairro).replaceAll(" ", "-") : undefined;
  const maxItems = Math.max(1, Math.min(3, Number(body.max_items) || 1));
  if (!SOURCES[portal] || (bairro && !POLOS[bairro])) {
    return Response.json({ error: "Portal ou bairro inválido." }, { status: 400, headers: CORS });
  }

  const started = new Date().toISOString();
  const runResult = await ctx.supabase.from("agent_runs").insert({
    script: portal, started_at: started, status: "running",
  }).select("id").single();
  if (runResult.error) {
    return Response.json({ error: runResult.error.message }, { status: 403, headers: CORS });
  }
  const runId = runResult.data.id;
  try {
    const links = listLinks(await publicHtml(SOURCES[portal]), portal, bairro);
    const saved: Item[] = [];
    for (const link of links) {
      if (saved.length >= maxItems) break;
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      const detail = portal === "ghar"
        ? parseGhar(await publicHtml(String(link.url)), link)
        : parseMeuImovel(await publicHtml(String(link.url)), link);
      if (!detail.nome || !detail.endereco) continue;

      let developerId: string | null = null;
      if (detail.incorporadora) {
        const existing = await ctx.supabase.from("organizations").select("id")
          .ilike("name", String(detail.incorporadora)).limit(1).maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) developerId = existing.data.id;
        else {
          const created = await ctx.supabase.from("organizations").insert({
            name: detail.incorporadora, type: "incorporadora", polo: detail.polo,
            source: portal === "ghar" ? "Ghar" : "Meu Imóvel",
          }).select("id").single();
          if (created.error) throw created.error;
          developerId = created.data.id;
        }
      }
      const payload: Record<string, unknown> = {
        name: detail.nome, address: detail.endereco, neighborhood: detail.bairro,
        polo: detail.polo, source: portal, source_external_id: detail.external_id,
        source_url: detail.url, developer_organization_id: developerId,
        delivery_status: detail.delivery_status, delivery_date_text: detail.delivery_date_text,
        area_min_m2: detail.area_min, area_max_m2: detail.area_max,
        bedrooms_min: detail.bedrooms_min, bedrooms_max: detail.bedrooms_max,
        suites_min: detail.suites_min, suites_max: detail.suites_max,
        parking_min: detail.parking_min, parking_max: detail.parking_max,
        last_seen_at: new Date().toISOString(),
      };
      if (detail.total_units != null) {
        payload.total_units_estimated = detail.total_units;
        payload.total_units_source_url = detail.url;
      }
      if (detail.total_floors != null) payload.total_floors = detail.total_floors;
      const existingBuilding = await ctx.supabase.from("buildings").select("id")
        .eq("source", portal).eq("source_external_id", detail.external_id)
        .limit(1).maybeSingle();
      if (existingBuilding.error) throw existingBuilding.error;
      const result = existingBuilding.data
        ? await ctx.supabase.from("buildings").update(payload).eq("id", existingBuilding.data.id)
        : await ctx.supabase.from("buildings").insert(payload);
      if (result.error) throw result.error;
      saved.push(detail);
    }
    await ctx.supabase.from("agent_runs").update({
      finished_at: new Date().toISOString(), rows_in: saved.length,
      rows_out: saved.length, status: "completed",
    }).eq("id", runId);
    return Response.json({ portal, collected: saved.length, items: saved }, { headers: CORS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.supabase.from("agent_runs").update({
      finished_at: new Date().toISOString(), status: "failed",
      error_message: message.slice(0, 2000),
    }).eq("id", runId);
    return Response.json({ error: message }, { status: 502, headers: CORS });
  }
});

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (request.method !== "POST") {
      return Response.json({ error: "Método não permitido." }, { status: 405, headers: CORS });
    }
    return handler(request);
  },
};
