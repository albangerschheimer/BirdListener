"""Probabilité a priori d'une espèce selon le pays et le mois (filtre « où et quand »).

Une espèce jamais enregistrée dans le pays n'est pas exclue (elle peut être de passage),
mais elle pèse beaucoup moins : on mélange la fréquence du pays avec un fond très faible.
"""
import json
from pathlib import Path

import numpy as np

RACINE = Path(__file__).resolve().parents[1]


class Contexte:
    def __init__(self, especes):
        f = json.load(open(RACINE / "data" / "frequences.json", encoding="utf-8"))
        self.especes = especes
        self.pays = f["pays"]
        self.mois = np.array([f["mois"].get(e, [0] * 12) for e in especes], dtype=np.float32)

    def liste_pays(self):
        return sorted(self.pays, key=lambda p: -sum(self.pays[p].values()))

    def a_priori(self, pays=None, mois=None, fond=0.002):
        """Vecteur de probabilités a priori sur les espèces (somme 1)."""
        n = len(self.especes)
        p = np.ones(n, dtype=np.float32)
        if pays in self.pays:
            c = np.array([self.pays[pays].get(e, 0) for e in self.especes], dtype=np.float32)
            p = (1 - fond) * c / max(c.sum(), 1) + fond / n
        if mois and 1 <= mois <= 12:
            total = self.mois.sum(1)
            part = (self.mois[:, mois - 1] + 1) / (total + 12)        # part de l'année, lissée
            p = p * (0.3 + part * 12)                                   # saison : effet modéré
        return p / p.sum()
