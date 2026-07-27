#!/usr/bin/env python3
"""
7CANTOS — SUPPLY HUNTER · COLETOR v0
====================================
Objetivo: revelar QUEM TEM CARTEIRA. Não é um gerador de leads unitários.

O coletor grava no Supabase, compara com o histórico e emite três coisas:
  1. eventos       (+30d, +60d, redução de preço, republicação, novo, sumiu)
  2. organizações  (anunciantes com >= MIN_CARTEIRA anúncios ativos = alvo de carteira)
  3. supply score  (100 pontos, conforme spec do agente v2)

RODAR LOCALMENTE.

    pip install -r requirements.txt
    export SUPABASE_URL=https://SEU-PROJETO.supabase.co
    export SUPABASE_SECRET_KEY=sb_secret_...
    python coletor_v0.py --mostrar-url --bairro moema --preco-min 3000 --preco-max 6000
    python coletor_v0.py --portal meu_imovel --bairro moema --max-itens 3 --dry-run
    python coletor_v0.py --portal meu_imovel --max-itens 30

IMPORTANTE — LEIA ANTES DE RODAR
  · O gerador de URL da OLX não executa scraping. Em 26/07/2026, o robots.txt da
    OLX bloqueia buscas automatizadas com q, ps, pe e o.
  · A OLX permanece em fluxo manual assistido. O adaptador Meu Imóvel usa apenas
    HTML e JSON-LD das páginas públicas; nunca acessa /api/.
  · Respeite robots.txt e os termos de uso de cada portal.
  · Para volume sério, contrate API oficial ou provedor de dados. Scraping é o v0.
"""

import argparse, json, math, os, re, sys, time, unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
    from supabase import Client, create_client
except ImportError:
    sys.exit("Faltam dependências: pip install -r collector/requirements.txt")

# ─────────────────────────────── CONFIG ────────────────────────────────

DELAY = 6.0           # mínimo para fontes autorizadas; não é mecanismo antidetecção
MIN_CARTEIRA = 5      # anúncios ativos do mesmo anunciante para virar alvo de carteira
TICKET_MIN, TICKET_MAX = 2200, 10000
AREA_MIN, AREA_MAX = 24, 40

# Polos ativos. Só Z1 e Z2 geram tarefa (spec do agente v2).
BAIRROS = {
    "Z1": ["vila-mariana", "vila-clementino", "moema", "paraiso", "ipiranga", "indianopolis", "nova-klabin"],
    "Z2": ["brooklin", "campo-belo", "vila-olimpia", "itaim-bibi", "cidade-moncoes", "santo-amaro"],
}

OLX_BASE = "https://www.olx.com.br/imoveis/aluguel/apartamentos/estado-sp/sao-paulo-e-regiao"
OLX_ROTAS = {
    bairro: f"zona-sul/{bairro}"
    for bairros in BAIRROS.values()
    for bairro in bairros
}

PORTAIS = {
    "meu_imovel": {
        "url": "https://appmeuimovel.com/apartamentos?estagio=pronto",
        "tipo": "empreendimentos",
    },
    "ghar": {
        "url": "https://ghar.com.br/imoveis/prontos/",
        "tipo": "empreendimentos",
    },
}

HEADERS = {"User-Agent": "7Cantos-SupplyHunter/0.2"}


def montar_url_olx(bairro, preco_min=None, preco_max=None, pagina=1):
    """Monta uma URL navegável da OLX sem realizar qualquer requisição."""
    bairro = norm_texto(bairro).replace(" ", "-")
    if bairro not in OLX_ROTAS:
        permitidos = ", ".join(sorted(OLX_ROTAS))
        raise ValueError(f"Bairro não configurado: {bairro}. Opções: {permitidos}")
    if preco_min is not None and preco_min < 0:
        raise ValueError("O valor mínimo não pode ser negativo.")
    if preco_max is not None and preco_max < 0:
        raise ValueError("O valor máximo não pode ser negativo.")
    if preco_min is not None and preco_max is not None and preco_min > preco_max:
        raise ValueError("O valor mínimo não pode ser maior que o máximo.")
    if pagina < 1:
        raise ValueError("A página deve ser maior ou igual a 1.")

    parametros = {}
    if preco_min is not None:
        parametros["ps"] = int(preco_min)
    if preco_max is not None:
        parametros["pe"] = int(preco_max)
    if pagina > 1:
        parametros["o"] = pagina
    url = f"{OLX_BASE}/{OLX_ROTAS[bairro]}"
    return f"{url}?{urlencode(parametros)}" if parametros else url

# ─────────────────────────────── BANCO ─────────────────────────────────

def carregar_env_local():
    """Carrega o .env da raiz sem sobrescrever variáveis já exportadas."""
    arquivo = Path(__file__).resolve().parent.parent / ".env"
    if not arquivo.is_file():
        return
    for linha_bruta in arquivo.read_text(encoding="utf-8").splitlines():
        linha = linha_bruta.strip()
        if not linha or linha.startswith("#"):
            continue
        if linha.startswith("export "):
            linha = linha[7:].strip()
        nome, separador, valor = linha.partition("=")
        nome, valor = nome.strip(), valor.strip()
        if not separador or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", nome):
            continue
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in {'"', "'"}:
            valor = valor[1:-1]
        os.environ.setdefault(nome, valor)


def conectar() -> Client:
    carregar_env_local()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        sys.exit(
            "Defina SUPABASE_URL e SUPABASE_SECRET_KEY. "
            "A secret key fica apenas neste script local; nunca no navegador."
        )
    if not key.startswith(("sb_secret_", "eyJ")):
        sys.exit("SUPABASE_SECRET_KEY não parece uma secret/service_role key válida.")
    return create_client(url, key)


def validar_fontes():
    placeholders = [
        nome for nome, cfg in PORTAIS.items()
        if "EXEMPLO" in cfg.get("url", "").upper()
    ]
    if not placeholders:
        return
    nomes = ", ".join(placeholders)
    sys.exit(
        f"Fontes ainda não configuradas: {nomes}. "
        "O acesso ao Supabase está separado da coleta: substitua a URL e os "
        "seletores placeholder em PORTAIS após validar o HTML e os termos da fonte."
    )

# ────────────────────────── NORMALIZAÇÃO ───────────────────────────────

def sem_acento(s):
    return "".join(ch for ch in unicodedata.normalize("NFD", s or "")
                   if unicodedata.category(ch) != "Mn")

def norm_texto(s):
    return re.sub(r"\s+", " ", sem_acento(s).lower().strip())

ABREV = {r"\brua\b": "r", r"\bavenida\b": "av", r"\balameda\b": "al",
         r"\bpraca\b": "pc", r"\bdoutor\b": "dr", r"\bdoutora\b": "dra",
         r"\bprofessor\b": "prof", r"\bengenheiro\b": "eng"}

def norm_endereco(s):
    t = norm_texto(s)
    for pat, rep in ABREV.items():
        t = re.sub(pat, rep, t)
    t = re.sub(r"[^\w\s,]", "", t)
    m = re.search(r"(\d{1,6})", t)
    numero = m.group(1) if m else ""
    via = re.sub(r"\d+", "", t).strip(" ,")
    return f"{via}|{numero}"

def num(s):
    if s is None: return None
    t = re.sub(r"[^\d,\.]", "", str(s)).replace(".", "").replace(",", ".")
    try: return float(t)
    except ValueError: return None

def polo_do_bairro(bairro):
    bairro = norm_texto(bairro).replace(" ", "-")
    return next((polo for polo, bairros in BAIRROS.items() if bairro in bairros), None)

def faixa_numerica(texto):
    valores = [float(valor.replace(",", ".")) for valor in re.findall(r"\d+(?:[.,]\d+)?", texto or "")]
    if not valores:
        return None, None
    return min(valores), max(valores)

# ─────────────────────────────── COLETA ────────────────────────────────

def extrair_links_meu_imovel(html, bairro=None):
    """Lê a lista pública JSON-LD e devolve apenas bairros dos polos ativos."""
    links, vistos = [], set()
    bairro_filtro = norm_texto(bairro).replace(" ", "-") if bairro else None
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            dados = json.loads(script.string or script.get_text())
        except (json.JSONDecodeError, TypeError):
            continue
        objetos = dados if isinstance(dados, list) else [dados]
        for objeto in objetos:
            if not isinstance(objeto, dict):
                continue
            itens = (objeto.get("mainEntity") or {}).get("itemListElement") or []
            for entrada in itens:
                item = entrada.get("item", entrada) if isinstance(entrada, dict) else {}
                url = item.get("url") if isinstance(item, dict) else None
                if not url or url in vistos:
                    continue
                partes = [p for p in urlparse(url).path.split("/") if p]
                try:
                    indice = partes.index("sao-paulo")
                    bairro_url = partes[indice + 1]
                except (ValueError, IndexError):
                    continue
                polo = polo_do_bairro(bairro_url)
                if not polo or (bairro_filtro and bairro_url != bairro_filtro):
                    continue
                vistos.add(url)
                links.append({
                    "portal": "meu_imovel", "url": url,
                    "external_id": partes[-1], "nome": item.get("name"),
                    "bairro": bairro_url, "polo": polo,
                })
    return links

def _ultimo_texto(soup, seletor):
    textos = [el.get_text(" ", strip=True) for el in soup.select(seletor)]
    return next((texto for texto in reversed(textos) if texto), None)

def extrair_detalhe_meu_imovel(html, item):
    """Extrai somente campos presentes na ficha pública do empreendimento."""
    soup = BeautifulSoup(html, "html.parser")
    detalhe = dict(item)
    detalhe["nome"] = _ultimo_texto(soup, "h1#realtyName") or item.get("nome")
    detalhe["endereco"] = (
        _ultimo_texto(soup, ".single-endereco-mobile p")
        or _ultimo_texto(soup, ".single-destaque-titulo-infos p")
    )

    campos = {}
    for bloco in soup.select(".single-destaque-dados-imovel-item"):
        texto = bloco.get_text(" ", strip=True)
        valor = _ultimo_texto(bloco, ".numero")
        if valor:
            campos[norm_texto(texto.replace(valor, "", 1))] = valor
    for rotulo, prefixo in (("area", "area"), ("quartos", "bedrooms"),
                            ("suites", "suites"), ("vagas", "parking")):
        valor = next((v for k, v in campos.items() if rotulo in k), None)
        minimo, maximo = faixa_numerica(valor)
        if prefixo != "area":
            minimo = int(minimo) if minimo is not None else None
            maximo = int(maximo) if maximo is not None else None
        detalhe[f"{prefixo}_min"] = minimo
        detalhe[f"{prefixo}_max"] = maximo

    texto_pagina = soup.get_text(" ", strip=True)
    entrega = re.search(
        r"Data de entrega:\s*(.+?)(?=\s+(?:Valor|Preço|Conheça|Sobre|Características|R\$)|$)",
        texto_pagina, re.I,
    )
    entrega_texto = entrega.group(1).strip(" .|") if entrega else None
    detalhe["delivery_date_text"] = entrega_texto
    entrega_norm = norm_texto(entrega_texto)
    detalhe["delivery_status"] = (
        "pronto" if "pronto" in entrega_norm
        else ("em_construcao" if entrega_texto else None)
    )

    incorporadoras = [
        img.get("alt", "").strip()
        for img in soup.select(".single-incorporadora img[alt]")
    ]
    detalhe["incorporadora"] = next(
        (nome for nome in reversed(incorporadoras) if nome), None
    )
    if not detalhe["incorporadora"]:
        match = re.search(r"equipe da\s+([^.!|]+)", texto_pagina, re.I)
        detalhe["incorporadora"] = match.group(1).strip() if match else None
    return detalhe

def requisicao_publica(url):
    if urlparse(url).path.startswith("/api/"):
        raise ValueError("O adaptador Meu Imóvel não acessa /api/.")
    resposta = requests.get(url, headers=HEADERS, timeout=20)
    if resposta.status_code in (403, 429):
        raise RuntimeError(
            f"Coleta interrompida: HTTP {resposta.status_code}; "
            "nenhuma tentativa de contorno foi feita."
        )
    resposta.raise_for_status()
    return resposta.text

def coletar_meu_imovel(bairro=None, max_itens=30):
    html_lista = requisicao_publica(PORTAIS["meu_imovel"]["url"])
    links = extrair_links_meu_imovel(html_lista, bairro=bairro)[:max_itens]
    achados = []
    for indice, item in enumerate(links, 1):
        time.sleep(DELAY)
        try:
            detalhe = extrair_detalhe_meu_imovel(
                requisicao_publica(item["url"]), item
            )
        except (requests.RequestException, RuntimeError) as erro:
            print(f"  ! Meu Imóvel {indice}/{len(links)}: {erro}")
            break
        if not detalhe.get("endereco"):
            print(
                f"  ! Meu Imóvel {indice}/{len(links)}: "
                "ficha sem endereço; ignorada"
            )
            continue
        achados.append(detalhe)
        print(
            f"  Meu Imóvel {indice}/{len(links)}: "
            f"{detalhe.get('nome')} [{detalhe['bairro']}]"
        )
    return achados

def extrair_links_ghar(html, bairro=None):
    """Extrai fichas de empreendimento da página pública de imóveis prontos."""
    links, vistos = [], set()
    bairro_filtro = norm_texto(bairro).replace(" ", "-") if bairro else None
    soup = BeautifulSoup(html, "html.parser")
    for ancora in soup.select("a[href]"):
        url = ancora.get("href", "").split("#", 1)[0]
        partes = [p for p in urlparse(url).path.split("/") if p]
        if len(partes) != 5 or partes[:3] != ["imoveis", "sp", "sao-paulo"]:
            continue
        bairro_url, external_id = partes[3], partes[4]
        polo = polo_do_bairro(bairro_url)
        if not polo or (bairro_filtro and bairro_url != bairro_filtro):
            continue
        url = f"https://ghar.com.br/{'/'.join(partes)}/"
        if url in vistos:
            continue
        vistos.add(url)
        links.append({
            "portal": "ghar", "url": url, "external_id": external_id,
            "bairro": bairro_url, "polo": polo,
        })
    return links

def extrair_detalhe_ghar(html, item):
    """Extrai os campos técnicos explícitos na ficha pública do Ghar."""
    soup = BeautifulSoup(html, "html.parser")
    detalhe = dict(item)
    detalhe["nome"] = _ultimo_texto(
        soup, "h1.elementor-heading-title"
    ) or _ultimo_texto(soup, "h1")

    icones = [
        el.get_text(" ", strip=True)
        for el in soup.select(
            ".elementor-icon-list-text, .jet-listing-dynamic-field__content"
        )
    ]
    def valor_icone(prefixo):
        return next(
            (texto for texto in icones if norm_texto(texto).startswith(prefixo)),
            None,
        )

    for rotulo, prefixo in (("quartos", "bedrooms"), ("suites", "suites"),
                            ("vagas", "parking")):
        minimo, maximo = faixa_numerica(valor_icone(rotulo))
        detalhe[f"{prefixo}_min"] = int(minimo) if minimo is not None else None
        detalhe[f"{prefixo}_max"] = int(maximo) if maximo is not None else None
    areas = next((texto for texto in icones if "m²" in texto), None)
    detalhe["area_min"], detalhe["area_max"] = faixa_numerica(areas)

    entrega = valor_icone("entrega:")
    detalhe["delivery_date_text"] = (
        entrega.split(":", 1)[1].strip() if entrega and ":" in entrega else None
    )
    detalhe["delivery_status"] = "pronto"

    texto = soup.get_text(" ", strip=True)
    endereco = re.search(
        r"\b((?:Avenida|Av\.?|Rua|Alameda|Al\.?)\s+[^,.]{2,80},\s*\d+[A-Za-z]?)",
        texto, re.I,
    )
    detalhe["endereco"] = endereco.group(1).strip() if endereco else None

    unidades = re.search(
        r"\b(?:totalizando|com|contempla)\s+(\d+)\s+"
        r"(?:unidades residenciais|residencias)\b",
        norm_texto(texto),
    )
    detalhe["total_units"] = int(unidades.group(1)) if unidades else None
    andares = re.search(r"\b(\d+)\s+andares\b", norm_texto(texto))
    detalhe["total_floors"] = int(andares.group(1)) if andares else None

    incorporadora = re.search(
        r"(?:pela|da)\s*<strong>([^<]{2,80})</strong>"
        r"(?=.{0,100}(?:incorporadora|construtora))",
        html, re.I | re.S,
    )
    detalhe["incorporadora"] = (
        BeautifulSoup(incorporadora.group(1), "html.parser").get_text(" ", strip=True)
        if incorporadora else None
    )
    if not detalhe["incorporadora"]:
        classe = re.search(
            r"construtoras-incorporadoras-([a-z0-9-]+)", html, re.I
        )
        if classe:
            detalhe["incorporadora"] = classe.group(1).replace("-", " ").title()
    return detalhe

def coletar_ghar(bairro=None, max_itens=30):
    html_lista = requisicao_publica(PORTAIS["ghar"]["url"])
    links = extrair_links_ghar(html_lista, bairro=bairro)
    achados = []
    for indice, item in enumerate(links, 1):
        if len(achados) >= max_itens:
            break
        time.sleep(DELAY)
        try:
            detalhe = extrair_detalhe_ghar(
                requisicao_publica(item["url"]), item
            )
        except (requests.RequestException, RuntimeError) as erro:
            print(f"  ! Ghar {indice}/{len(links)}: {erro}")
            break
        if not detalhe.get("endereco"):
            print(f"  ! Ghar {indice}/{len(links)}: ficha sem endereço; ignorada")
            continue
        achados.append(detalhe)
        unidades = detalhe.get("total_units")
        print(
            f"  Ghar {indice}/{len(links)}: {detalhe.get('nome')} "
            f"[{detalhe['bairro']}] · "
            f"{unidades if unidades is not None else '?'} unidades"
        )
    return achados

def extrair(card, seletores):
    out = {}
    for campo, (sel, attr) in seletores.items():
        el = card.select_one(sel)
        if el is None:
            out[campo] = None
        elif attr == "text":
            out[campo] = el.get_text(" ", strip=True)
        else:
            out[campo] = el.get(attr)
    return out

def coletar(portal, cfg, polo, bairro, max_paginas=10, dry=False):
    achados = []
    for pagina in range(1, max_paginas + 1):
        url = cfg["url"].format(bairro=bairro, pagina=pagina)
        if "EXEMPLO" in url:
            print(f"  ! {portal}: URL placeholder; valide a fonte antes de coletar")
            break
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
        except requests.RequestException as e:
            print(f"  ! {portal}/{bairro} p{pagina}: {e}")
            break
        if r.status_code != 200:
            print(f"  ! {portal}/{bairro} p{pagina}: HTTP {r.status_code}")
            break
        cards = BeautifulSoup(r.text, "html.parser").select(cfg["card"])
        if not cards:
            break
        for card in cards:
            d = extrair(card, cfg["campos"])
            if not d.get("url"):
                continue
            achados.append({
                "portal": portal, "polo": polo, "bairro": bairro,
                "url": d["url"],
                "external_id": re.sub(r"\D", "", d["url"])[-12:] or d["url"][-40:],
                "endereco": d.get("endereco"),
                "endereco_norm": norm_endereco(d.get("endereco")),
                "preco": num(d.get("preco")),
                "area": num(d.get("area")),
                "quartos": int(num(d.get("quartos")) or 0),
                "anunciante": d.get("anunciante"),
                "anunciante_norm": norm_texto(d.get("anunciante")),
                "anunciante_tipo": norm_texto(d.get("anunciante_tipo")) or None,
            })
        print(f"  {portal}/{bairro} p{pagina}: {len(cards)} cards")
        if dry and pagina >= 1:
            break
        time.sleep(DELAY)
    return achados

# ─────────────────────────── PERSISTIR + EVENTOS ───────────────────────

def gravar(con: Client, itens, hoje):
    """Persiste anúncios e eventos. A secret key é restrita a este processo local."""
    agora = datetime.now(timezone.utc).isoformat()
    novos, alterados, removidos = 0, 0, 0

    for it in itens:
        encontrado = (
            con.table("property_listings")
            .select("id,rent_price,first_seen_at")
            .eq("source", it["portal"])
            .eq("external_id", it["external_id"])
            .limit(1)
            .execute()
            .data
        )
        payload = {
            "source": it["portal"],
            "external_id": it["external_id"],
            "url": it["url"],
            "polo": it["polo"],
            "neighborhood": it["bairro"],
            "address": it["endereco"],
            "address_normalized": it["endereco_norm"],
            "area_m2": it["area"],
            "bedrooms": it["quartos"],
            "rent_price": it["preco"],
            "advertiser_name": it["anunciante"],
            "advertiser_type": it.get("anunciante_tipo"),
            "last_seen_at": agora,
            "active": True,
        }

        if not encontrado:
            payload["first_seen_at"] = agora
            criado = con.table("property_listings").insert(payload).execute().data[0]
            con.table("events").insert({
                "listing_id": criado["id"], "event_date": hoje,
                "type": "anuncio_novo", "value_after": it["preco"],
            }).execute()
            novos += 1
            continue

        anterior = encontrado[0]
        con.table("property_listings").update(payload).eq("id", anterior["id"]).execute()
        preco_anterior = anterior.get("rent_price")
        if preco_anterior and it["preco"] and it["preco"] < float(preco_anterior) * 0.98:
            con.table("events").insert({
                "listing_id": anterior["id"], "event_date": hoje,
                "type": "reducao_preco", "value_before": preco_anterior,
                "value_after": it["preco"],
            }).execute()
            alterados += 1

        dias = max(0, (date.fromisoformat(hoje) - datetime.fromisoformat(anterior["first_seen_at"].replace("Z", "+00:00")).date()).days)
        for limite_dias, tipo in ((30, "mais_30d"), (60, "mais_60d")):
            if dias < limite_dias:
                continue
            ja_registrado = (
                con.table("events").select("id")
                .eq("listing_id", anterior["id"])
                .eq("type", tipo)
                .limit(1)
                .execute().data
            )
            if not ja_registrado:
                con.table("events").insert({
                    "listing_id": anterior["id"], "event_date": hoje, "type": tipo,
                }).execute()

    # Só considera removido após duas rodadas ausente. Com coleta vazia não desativa nada.
    if itens:
        fontes = sorted({it["portal"] for it in itens})
        polos = sorted({it["polo"] for it in itens})
        limite = (date.fromisoformat(hoje) - timedelta(days=1)).isoformat()
        ausentes = (
            con.table("property_listings")
            .select("id")
            .eq("active", True)
            .in_("source", fontes)
            .in_("polo", polos)
            .lt("last_seen_at", f"{limite}T00:00:00+00:00")
            .execute()
            .data
        )
        for item in ausentes:
            con.table("property_listings").update({"active": False}).eq("id", item["id"]).execute()
            con.table("events").insert({
                "listing_id": item["id"], "event_date": hoje, "type": "saiu_do_ar",
            }).execute()
            removidos += 1

    return novos, alterados, removidos

def gravar_empreendimentos(con: Client, itens):
    """Faz upsert de incorporadoras e edifícios sem estimar unidades ausentes."""
    agora = datetime.now(timezone.utc).isoformat()
    criados, atualizados = 0, 0
    for item in itens:
        fonte = item["portal"]
        fonte_nome = "Meu Imóvel" if fonte == "meu_imovel" else "Ghar"
        incorporadora_id = None
        nome_incorporadora = item.get("incorporadora")
        if nome_incorporadora:
            existentes = (
                con.table("organizations").select("id")
                .ilike("name", nome_incorporadora).limit(1).execute().data
            )
            if existentes:
                incorporadora_id = existentes[0]["id"]
            else:
                organizacao = con.table("organizations").insert({
                    "name": nome_incorporadora,
                    "type": "incorporadora",
                    "polo": item["polo"],
                    "source": fonte_nome,
                }).execute().data[0]
                incorporadora_id = organizacao["id"]

        payload = {
            "name": item.get("nome"),
            "address": item["endereco"],
            "neighborhood": item["bairro"],
            "polo": item["polo"],
            "source": fonte,
            "source_external_id": item["external_id"],
            "source_url": item["url"],
            "developer_organization_id": incorporadora_id,
            "delivery_status": item.get("delivery_status"),
            "delivery_date_text": item.get("delivery_date_text"),
            "area_min_m2": item.get("area_min"),
            "area_max_m2": item.get("area_max"),
            "bedrooms_min": item.get("bedrooms_min"),
            "bedrooms_max": item.get("bedrooms_max"),
            "suites_min": item.get("suites_min"),
            "suites_max": item.get("suites_max"),
            "parking_min": item.get("parking_min"),
            "parking_max": item.get("parking_max"),
            "last_seen_at": agora,
        }
        if item.get("total_units") is not None:
            payload["total_units_estimated"] = item["total_units"]
            payload["total_units_source_url"] = item["url"]
        if item.get("total_floors") is not None:
            payload["total_floors"] = item["total_floors"]
        existentes = (
            con.table("buildings").select("id")
            .eq("source", fonte)
            .eq("source_external_id", item["external_id"])
            .limit(1).execute().data
        )
        if existentes:
            con.table("buildings").update(payload).eq(
                "id", existentes[0]["id"]
            ).execute()
            atualizados += 1
        else:
            con.table("buildings").insert(payload).execute()
            criados += 1
    return criados, atualizados


def dias_no_ar(listing, hoje):
    inicio = datetime.fromisoformat(listing["first_seen_at"].replace("Z", "+00:00")).date()
    return max(0, (date.fromisoformat(hoje) - inicio).days)


def materializar_alvos(con: Client, hoje):
    """Transforma anunciantes recorrentes em organizações, oportunidades e tarefas."""
    listings = con.table("property_listings").select("*").eq("active", True).execute().data
    eventos = con.table("events").select("listing_id,type").eq("event_date", hoje).execute().data
    evento_por_listing = defaultdict(set)
    for evento in eventos:
        if evento.get("listing_id"):
            evento_por_listing[evento["listing_id"]].add(evento["type"])

    grupos = defaultdict(list)
    for listing in listings:
        chave = norm_texto(listing.get("advertiser_name"))
        if chave:
            grupos[chave].append(listing)

    criados = []
    for grupo in grupos.values():
        if len(grupo) < MIN_CARTEIRA:
            continue
        nome = grupo[0]["advertiser_name"]
        polos = Counter(item.get("polo") for item in grupo if item.get("polo"))
        polo = polos.most_common(1)[0][0] if polos else None
        estimativa = len(grupo) * 3  # hipótese declarada; confirmar com o interlocutor.

        organizacoes = con.table("organizations").select("id").eq("name", nome).limit(1).execute().data
        if organizacoes:
            organizacao_id = organizacoes[0]["id"]
            con.table("organizations").update({
                "estimated_units": estimativa,
                "estimated_units_is_hypothesis": True,
                "polo": polo,
            }).eq("id", organizacao_id).execute()
        else:
            organizacao = con.table("organizations").insert({
                "name": nome,
                "type": "administradora",
                "estimated_units": estimativa,
                "estimated_units_is_hypothesis": True,
                "polo": polo,
                "source": ", ".join(sorted({item["source"] for item in grupo})),
            }).execute().data[0]
            organizacao_id = organizacao["id"]

        oportunidades = con.table("opportunities").select("id,stage").eq("organization_id", organizacao_id).execute().data
        abertas = [item for item in oportunidades if item["stage"] not in ("Assinada", "Perdida")]
        reduziu = any("reducao_preco" in evento_por_listing[item["id"]] for item in grupo)
        representante = max(grupo, key=lambda item: item.get("rent_price") or 0)
        supply_score = score(
            {"polo": polo, "area": representante.get("area_m2"), "preco": representante.get("rent_price")},
            max(dias_no_ar(item, hoje) for item in grupo), reduziu, len(grupo), False,
        )
        if abertas:
            oportunidade_id = abertas[0]["id"]
            con.table("opportunities").update({
                "units_represented": estimativa,
                "units_are_hypothesis": True,
                "supply_score": supply_score,
                "why_now": f"{len(grupo)} anúncios ativos detectados no portal; carteira estimada é hipótese.",
            }).eq("id", oportunidade_id).execute()
        else:
            oportunidade = con.table("opportunities").insert({
                "name": nome,
                "type": "Carteira / administradora",
                "organization_id": organizacao_id,
                "polo": polo or "Z4-Z6",
                "units_represented": estimativa,
                "units_are_hypothesis": True,
                "supply_score": supply_score,
                "why_now": f"{len(grupo)} anúncios ativos detectados no portal; carteira estimada é hipótese.",
            }).execute().data[0]
            oportunidade_id = oportunidade["id"]
            criados.append(nome)

        tem_evento = any(evento_por_listing[item["id"]] for item in grupo)
        ticket_ok = any(TICKET_MIN <= float(item.get("rent_price") or 0) <= TICKET_MAX for item in grupo)
        if tem_evento and polo in ("Z1", "Z2") and ticket_ok and supply_score >= 40:
            motivo = f"evento + {polo} + ticket na faixa em {hoje}"
            tarefas = (
                con.table("tasks").select("id")
                .eq("opportunity_id", oportunidade_id)
                .eq("reason", motivo)
                .neq("status", "cancelada")
                .limit(1)
                .execute().data
            )
            if not tarefas:
                prioridade = "hoje" if supply_score >= 80 else "48h" if supply_score >= 60 else "monitorar"
                prazo = None
                if prioridade == "hoje":
                    prazo = datetime.now(timezone.utc).isoformat()
                elif prioridade == "48h":
                    prazo = (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat()
                con.table("tasks").insert({
                    "opportunity_id": oportunidade_id,
                    "task_type": "validar_carteira",
                    "priority": prioridade,
                    "reason": motivo,
                    "suggested_action": "Abrir o anúncio no portal, usar o canal oficial e confirmar decisor e unidades. Envio só após aprovação humana.",
                    "due_at": prazo,
                }).execute()
    return criados

# ─────────────────────────── SUPPLY SCORE (100) ────────────────────────

def score(row, dias, teve_reducao, unid_anunciante, tem_contato):
    polo, area, preco = row["polo"], row["area"], row["preco"]
    p = 0
    p += {"Z1": 15, "Z2": 15, "Z3": 8}.get(polo, 3)                       # região
    if area and AREA_MIN <= area <= AREA_MAX: p += 10                      # tipologia
    elif area and area <= 60: p += 5
    if preco and TICKET_MIN <= preco <= TICKET_MAX: p += 10                # ticket
    if dias > 30: p += 10                                                  # +30d
    if dias > 60: p += 10                                                  # +60d
    if teve_reducao: p += 10                                               # redução
    p += 20 if unid_anunciante >= 5 else 16 if unid_anunciante >= 3 else 12 if unid_anunciante == 2 else 5
    # demanda ativa compatível (10 pts) exige CRM — não calculável aqui
    if tem_contato: p += 5
    return p

# ─────────────────────────────── RELATÓRIO ─────────────────────────────

def relatorio(con: Client, hoje):
    print("\n" + "=" * 70)
    print(f"SUPPLY BRIEF — {hoje}")
    print("=" * 70)

    eventos = con.table("events").select("listing_id,type").eq("event_date", hoje).execute().data
    ev = Counter(item["type"] for item in eventos)
    print("\nEVENTOS DE HOJE")
    for t, n in ev.most_common() or [("nenhum", 0)]:
        print(f"  {n:>5}  {t}")

    listings = con.table("property_listings").select("*").eq("active", True).execute().data
    por_anunciante = defaultdict(list)
    for listing in listings:
        chave = norm_texto(listing.get("advertiser_name"))
        if chave:
            por_anunciante[chave].append(listing)

    print(f"\nALVOS DE CARTEIRA — anunciantes com >= {MIN_CARTEIRA} anúncios ativos")
    alvos = sorted((grupo for grupo in por_anunciante.values() if len(grupo) >= MIN_CARTEIRA), key=len, reverse=True)[:40]
    if not alvos:
        print("  (nenhum ainda — rode por 2-3 dias para acumular base)")
    for grupo in alvos:
        nome, n = grupo[0]["advertiser_name"], len(grupo)
        precos = [float(item["rent_price"]) for item in grupo if item.get("rent_price") is not None]
        tk = round(sum(precos) / len(precos)) if precos else 0
        bairros = ",".join(sorted({item.get("neighborhood") or "?" for item in grupo}))
        rep = n * 3   # hipótese: portal expõe ~1/3 da carteira real. VALIDAR.
        print(f"  {n:>4} anúncios · ticket médio R$ {tk or 0:>6.0f} · ~{rep} unid. representadas (hip.) · {nome}  [{bairros}]")

    print("\nTOP 15 OPORTUNIDADES UNITÁRIAS")
    evento_por_listing = defaultdict(set)
    for evento in eventos:
        if evento.get("listing_id"):
            evento_por_listing[evento["listing_id"]].add(evento["type"])
    linhas = []
    for listing in listings:
        if listing.get("polo") not in ("Z1", "Z2"):
            continue
        n = len(por_anunciante.get(norm_texto(listing.get("advertiser_name")), [])) or 1
        dias = dias_no_ar(listing, hoje)
        row = {"polo": listing.get("polo"), "area": listing.get("area_m2"), "preco": listing.get("rent_price")}
        s = score(row, dias, "reducao_preco" in evento_por_listing[listing["id"]], n, False)
        prio = round(s * math.log10(max(n, 1) * 3 + 1), 1)
        linhas.append((prio, s, dias, n, listing.get("address"), listing.get("advertiser_name")))
    linhas.sort(key=lambda item: item[0], reverse=True)
    for prio, s, dias, n, end, anun in linhas[:15]:
        print(f"  prio {prio:>6} · score {s:>3}/100 · {int(dias):>3}d no ar · anunciante com {n:>3} anúncios · {str(end)[:38]:<38} {str(anun)[:24]}")

    tarefas = con.table("tasks").select("id").eq("status", "aberta").execute().data
    print(f"\nAÇÃO DA RODADA: {len(tarefas)} tarefa(s) aberta(s) no cockpit.")
    if not listings:
        print("ALERTA: nenhum anúncio ativo. Valide os seletores placeholder antes da próxima rodada.")
    print("\nREGRA: nada disto vira abordagem sem aprovação humana.")
    print("=" * 70)

# ──────────────────────────────── MAIN ─────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="Coletor autorizado e gerador de URLs de pesquisa do Supply Hunter."
    )
    ap.add_argument("--dry-run", action="store_true", help="coleta uma amostra e não grava")
    ap.add_argument("--portal", choices=sorted(PORTAIS), default="meu_imovel")
    ap.add_argument(
        "--max-itens", type=int,
        help="limite de fichas (padrão: 3 no dry-run; 30 ao gravar)",
    )
    ap.add_argument("--so-relatorio", action="store_true", help="só reimprime o brief")
    ap.add_argument("--mostrar-url", action="store_true", help="gera a URL da OLX sem acessá-la")
    ap.add_argument("--bairro", help="bairro configurado, por exemplo: moema")
    ap.add_argument("--preco-min", type=float, help="aluguel mínimo em reais")
    ap.add_argument("--preco-max", type=float, help="aluguel máximo em reais")
    ap.add_argument("--pagina", type=int, default=1, help="página da busca (padrão: 1)")
    a = ap.parse_args()

    hoje = date.today().isoformat()

    if a.so_relatorio:
        relatorio(conectar(), hoje)
        return

    if a.mostrar_url:
        if not a.bairro:
            ap.error("--mostrar-url exige --bairro")
        try:
            print(montar_url_olx(a.bairro, a.preco_min, a.preco_max, a.pagina))
        except ValueError as erro:
            ap.error(str(erro))
        return

    if a.bairro and not polo_do_bairro(a.bairro):
        ap.error(f"bairro não configurado: {a.bairro}")
    max_itens = a.max_itens if a.max_itens is not None else (3 if a.dry_run else 30)
    if max_itens < 1:
        ap.error("--max-itens deve ser maior que zero")
    coletores = {
        "meu_imovel": coletar_meu_imovel,
        "ghar": coletar_ghar,
    }
    todos = coletores[a.portal](a.bairro, max_itens)

    print(f"\ncoletados: {len(todos)}")
    if a.dry_run:
        print(json.dumps(todos[:3], ensure_ascii=False, indent=2))
        print("\nDRY RUN — nada gravado. Campos ausentes permanecem null.")
        return

    con = conectar()
    inicio = datetime.now(timezone.utc).isoformat()
    execucao = con.table("agent_runs").insert({
        "script": "collector/coletor_v0.py", "started_at": inicio, "status": "running",
    }).execute().data[0]
    try:
        novos, atualizados = gravar_empreendimentos(con, todos)
        print(f"empreendimentos novos: {novos} · atualizados: {atualizados}")
        if a.portal == "ghar":
            confirmados = sum(item.get("total_units") is not None for item in todos)
            print(
                f"AÇÃO: {confirmados} ficha(s) com contagem pública de unidades; "
                "abrir a fonte vinculada antes da abordagem."
            )
        else:
            print(
                "AÇÃO: confirmar total de unidades com a incorporadora ou fonte "
                "primária antes de criar oportunidade."
            )
        con.table("agent_runs").update({
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "rows_in": len(todos),
            "rows_out": novos + atualizados,
            "status": "completed",
        }).eq("id", execucao["id"]).execute()
    except Exception as erro:
        con.table("agent_runs").update({
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "rows_in": len(todos),
            "status": "failed",
            "error_message": str(erro)[:2000],
        }).eq("id", execucao["id"]).execute()
        raise

if __name__ == "__main__":
    main()
