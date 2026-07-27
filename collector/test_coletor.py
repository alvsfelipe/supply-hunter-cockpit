import importlib.util
import json
import unittest
from pathlib import Path


MODULO = Path(__file__).with_name("coletor_v0.py")
SPEC = importlib.util.spec_from_file_location("coletor_v0", MODULO)
coletor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(coletor)


class MontarUrlOlxTest(unittest.TestCase):
    def test_moema_com_faixa_de_preco(self):
        self.assertEqual(
            coletor.montar_url_olx("Moema", 3000, 6000),
            "https://www.olx.com.br/imoveis/aluguel/apartamentos/estado-sp/"
            "sao-paulo-e-regiao/zona-sul/moema?ps=3000&pe=6000",
        )

    def test_segunda_pagina(self):
        self.assertTrue(coletor.montar_url_olx("campo belo", pagina=2).endswith("?o=2"))

    def test_rejeita_faixa_invertida(self):
        with self.assertRaisesRegex(ValueError, "mínimo"):
            coletor.montar_url_olx("moema", 6000, 3000)

    def test_rejeita_bairro_desconhecido(self):
        with self.assertRaisesRegex(ValueError, "não configurado"):
            coletor.montar_url_olx("bairro inventado")


class MeuImovelParserTest(unittest.TestCase):
    def test_filtra_json_ld_por_bairro_e_polo(self):
        dados = {
            "@type": "CollectionPage",
            "mainEntity": {
                "itemListElement": [
                    {"item": {
                        "name": "Most Moema",
                        "url": "https://appmeuimovel.com/apartamentos/sp/sao-paulo/moema/most-moema",
                    }},
                    {"item": {
                        "name": "Fora dos polos",
                        "url": "https://appmeuimovel.com/apartamentos/sp/sao-paulo/tatuape/outro",
                    }},
                ]
            },
        }
        html = (
            '<script type="application/ld+json">'
            + json.dumps(dados)
            + "</script>"
        )
        itens = coletor.extrair_links_meu_imovel(html, bairro="moema")
        self.assertEqual(len(itens), 1)
        self.assertEqual(itens[0]["external_id"], "most-moema")
        self.assertEqual(itens[0]["polo"], "Z1")

    def test_extrai_ficha_sem_inventar_unidades(self):
        item = {
            "portal": "meu_imovel",
            "url": "https://appmeuimovel.com/apartamentos/sp/sao-paulo/moema/most-moema",
            "external_id": "most-moema",
            "nome": "Fallback",
            "bairro": "moema",
            "polo": "Z1",
        }
        html = """
        <h1 id="realtyName">Most Moema Home</h1>
        <div class="single-endereco-mobile"><p>Avenida Cotovia, 107</p></div>
        <div class="single-destaque-dados-imovel-item">Área <span class="numero">80 a 300 m²</span></div>
        <div class="single-destaque-dados-imovel-item">Quartos <span class="numero">2 a 4</span></div>
        <div class="single-destaque-dados-imovel-item">Suítes <span class="numero">2 a 4</span></div>
        <div class="single-destaque-dados-imovel-item">Vagas <span class="numero">1 a 3</span></div>
        <div>Data de entrega: Pronto para morar Valor R$ 1.000.000</div>
        <div class="single-incorporadora"><img alt="MPD"></div>
        """
        detalhe = coletor.extrair_detalhe_meu_imovel(html, item)
        self.assertEqual(detalhe["nome"], "Most Moema Home")
        self.assertEqual(detalhe["area_min"], 80)
        self.assertEqual(detalhe["area_max"], 300)
        self.assertEqual(detalhe["bedrooms_max"], 4)
        self.assertEqual(detalhe["delivery_status"], "pronto")
        self.assertEqual(detalhe["incorporadora"], "MPD")
        self.assertNotIn("total_units", detalhe)

    def test_bloqueia_api(self):
        with self.assertRaisesRegex(ValueError, "não acessa"):
            coletor.requisicao_publica("https://appmeuimovel.com/api/imoveis")


if __name__ == "__main__":
    unittest.main()
