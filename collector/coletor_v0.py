#!/usr/bin/env python3
"""
7CANTOS — SUPPLY HUNTER · COLETOR v0
====================================
Objetivo: revelar QUEM TEM CARTEIRA. Não é um gerador de leads unitários.

O coletor grava no Supabase, compara com o histórico e emite três coisas:
  1. eventos       (+30d, +60d, redução de preço, republicação, novo, sumiu)
  2. organizações  (anunciantes com >= MIN_CARTEIRA anúncios ativos = alvo de carteira)
  3. supply score  (100 pontos, conforme spec do agente v2)

RODAR LOCALMENTE. O ambiente do Claude não tem saída de rede para portais.

    pip install -r requirements.txt
    export SUPABASE_URL=https://SEU-PROJETO.supabase.co
    export SUPABASE_SECRET_KEY=sb_secret_...
    python coletor_v0.py --dry-run     # valida parsing sem gravar
    python coletor_v0.py               # roda e grava snapshot

IMPORTANTE — LEIA ANTES DE RODAR
  · Os seletores CSS em PORTAIS são PLACEHOLDERS. Abra o portal, inspecione o HTML
    e substitua. Nenhum seletor sobrevive a um redesign; validar é parte do trabalho.
  · Respeite robots.txt e os termos de uso de cada portal. Use DELAY generoso.
  · Para volume sério, contrate API oficial ou provedor de dados. Scraping é o v0.
"""

import argparse, json, math, os, re, sys, time, unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

try:
    import requests
    from bs4 import BeautifulSoup
    from supabase import Client, create_client
except ImportError:
    sys.exit("Faltam dependências: pip install -r collector/requirements.txt")

# ─────────────────────────────── CONFIG ────────────────────────────────

DELAY = 2.5           # segundos entre requisições — não reduza
MIN_CARTEIRA = 5      # anúncios ativos do mesmo anunciante para virar alvo de carteira
TICKET_MIN, TICKET_MAX = 2200, 10000
AREA_MIN, AREA_MAX = 24, 40

# Polos ativos. Só Z1 e Z2 geram tarefa (spec do agente v2).
BAIRROS = {
    "Z1": ["vila-mariana", "vila-clementino", "moema", "paraiso", "ipiranga", "indianopolis"],
    "Z2": ["brooklin", "campo-belo", "vila-olimpia", "itaim-bibi", "cidade-moncoes"],
}

PORTAIS = {
    # nome: (template de URL, seletor do card, seletores dos campos)
    # >>> SUBSTITUA os seletores após inspecionar o HTML real de cada portal <<<
    "portal_a": {
        "url": "https://EXEMPLO.com.br/aluguel/sp/sao-paulo/{bairro}?pagina={pagina}",
        "card": "div[data-testid='listing-card']",
        "campos": {
            "url":        ("a", "href"),
            "preco":      ("[data-testid='price']", "text"),
            "area":       ("[data-testid='area']", "text"),
            "quartos":    ("[data-testid='bedrooms']", "text"),
            "endereco":   ("[data-testid='address']", "text"),
            "anunciante": ("[data-testid='advertiser']", "text"),
        },
    },
}

HEADERS = {"User-Agent": "7Cantos-SupplyHunter/0.2"}

# ─────────────────────────────── BANCO ─────────────────────────────────

def conectar() -> Client:
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

# ─────────────────────────────── COLETA ────────────────────────────────

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
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="1 página por bairro, não grava")
    ap.add_argument("--so-relatorio", action="store_true", help="só reimprime o brief")
    a = ap.parse_args()

    hoje = date.today().isoformat()

    if a.so_relatorio:
        relatorio(conectar(), hoje)
        return

    todos = []
    for polo, bairros in BAIRROS.items():
        for bairro in bairros:
            for portal, cfg in PORTAIS.items():
                todos += coletar(portal, cfg, polo, bairro, dry=a.dry_run)

    print(f"\ncoletados: {len(todos)}")
    if a.dry_run:
        print(json.dumps(todos[:3], ensure_ascii=False, indent=2))
        print("\nDRY RUN — nada gravado. Se os campos vieram null, corrija os seletores em PORTAIS.")
        return

    con = conectar()
    inicio = datetime.now(timezone.utc).isoformat()
    execucao = con.table("agent_runs").insert({
        "script": "collector/coletor_v0.py", "started_at": inicio, "status": "running",
    }).execute().data[0]
    try:
        novos, reducoes, removidos = gravar(con, todos, hoje)
        oportunidades = materializar_alvos(con, hoje)
        print(f"novos: {novos} · reduções de preço: {reducoes} · removidos: {removidos}")
        print(f"novas oportunidades de carteira: {len(oportunidades)}")
        relatorio(con, hoje)
        con.table("agent_runs").update({
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "rows_in": len(todos),
            "rows_out": novos + reducoes + removidos + len(oportunidades),
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
