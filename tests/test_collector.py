import unittest

from collector.coletor_v0 import norm_endereco, norm_texto, num, score


class CollectorRulesTest(unittest.TestCase):
    def test_normalizes_accents_spacing_and_address(self):
        self.assertEqual(norm_texto("  Vila   Clementino "), "vila clementino")
        self.assertEqual(norm_endereco("Rua Doutor Bacelar, 780"), "r dr bacelar|780")

    def test_parses_brazilian_currency(self):
        self.assertEqual(num("R$ 3.250,00"), 3250.0)
        self.assertIsNone(num(None))

    def test_supply_score_keeps_documented_weights(self):
        result = score(
            {"polo": "Z1", "area": 30, "preco": 3500},
            dias=61,
            teve_reducao=True,
            unid_anunciante=5,
            tem_contato=True,
        )
        self.assertEqual(result, 90)

    def test_unitary_never_gets_portfolio_weight(self):
        result = score(
            {"polo": "Z2", "area": 30, "preco": 3500},
            dias=0,
            teve_reducao=False,
            unid_anunciante=1,
            tem_contato=False,
        )
        self.assertEqual(result, 40)


if __name__ == "__main__":
    unittest.main()
