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
        self.total = self.mois.sum(1)
        self._vecteurs = {}

    def liste_pays(self):
        return sorted(self.pays, key=lambda p: -sum(self.pays[p].values()))

    def vecteur_pays(self, pays):
        """Nombre d'enregistrements de chaque espèce dans le pays (calculé une fois par pays)."""
        if pays not in self._vecteurs:
            self._vecteurs[pays] = np.array([self.pays[pays].get(e, 0) for e in self.especes], dtype=np.float32)
        return self._vecteurs[pays]

    def a_priori(self, pays=None, mois=None, fond=0.002, retirer=None):
        """Vecteur de probabilités a priori sur les espèces (somme 1).
        retirer : indice d'une espèce dont on enlève un enregistrement des comptes (pour évaluer
        sans que l'enregistrement testé s'aide lui-même)."""
        n = len(self.especes)
        p = np.ones(n, dtype=np.float32)
        if pays in self.pays:
            c = self.vecteur_pays(pays)
            if retirer is not None:
                c = c.copy()
                c[retirer] = max(c[retirer] - 1, 0)
            p = (1 - fond) * c / max(c.sum(), 1) + fond / n
        if mois and 1 <= mois <= 12:
            m, total = self.mois[:, mois - 1], self.total
            if retirer is not None and m[retirer] > 0:
                m, total = m.copy(), total.copy()
                m[retirer] -= 1
                total[retirer] -= 1
            part = (m + 1) / (total + 12)                                # part de l'année, lissée
            p = p * (0.3 + part * 12)                                   # saison : effet modéré
        return p / p.sum()
