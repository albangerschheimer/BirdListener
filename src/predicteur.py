"""Reconnaît les oiseaux dans un son : oreille BirdNET + classifieur BirdListener.

L'avis final combine BirdListener et BirdNET (poids choisi par scripts/evaluate.py),
ce qui donne de meilleurs résultats que chacun des deux seul.
"""
import json
from pathlib import Path

import numpy as np
import torch

from contexte import Contexte
from modele import Classifieur
from oreille import FREQ, Oreille, chemin_modele

RACINE = Path(__file__).resolve().parents[1]
SEUIL_OISEAU = 0.25     # en dessous, BirdNET n'entend aucune de nos espèces clairement
BETA_CONTEXTE = 0.3     # force du filtre pays + mois (choisie sur le test Europe)
SEUIL_INCERTAIN = 0.4   # en dessous, la meilleure réponse est présentée comme incertaine


class Predicteur:
    def __init__(self, nom="europe_v1", threads=2):
        sauvegarde = torch.load(RACINE / "models" / f"{nom}.pt", map_location="cpu")
        self.especes = sauvegarde["especes"]
        self.modele = Classifieur(len(self.especes))
        self.modele.load_state_dict(sauvegarde["etat"])
        self.modele.eval()
        self.oreille = Oreille(threads=threads)
        self.infos = json.load(open(RACINE / "data" / "especes.json", encoding="utf-8"))
        credits = RACINE / "web" / "photos" / "credits.json"
        self.photos = json.load(open(credits, encoding="utf-8")) if credits.exists() else {}
        evaluation = RACINE / "models" / f"{nom}_evaluation.json"
        self.poids_birdnet = json.load(open(evaluation))["poids_birdnet"] if evaluation.exists() else 0.0
        # Colonne BirdListener de chaque classe BirdNET (-1 si l'espèce n'est pas dans BirdListener)
        etiquettes = (chemin_modele().parent / "BirdNET_GLOBAL_6K_V2.4_Labels.txt").read_text().splitlines()
        num = {e: k for k, e in enumerate(self.especes)}
        self.colonne = np.array([num.get(e.split("_")[0], -1) for e in etiquettes])
        self.contexte = Contexte(self.especes)

    def fiche(self, espece, proba):
        i = self.infos.get(espece, {})
        photo = self.photos.get(espece, {})
        credit = " · ".join(x for x in (photo.get("auteur"), photo.get("licence")) if x)
        return {"scientifique": espece, "fr": i.get("fr") or i.get("en") or espece, "en": i.get("en", ""),
                "famille": i.get("famille", ""), "proba": round(float(proba), 4),
                "photo": f"photos/{photo['fichier']}" if photo else None,
                "credit_photo": credit or "Wikimedia Commons", "source_photo": photo.get("source")}

    def predire(self, son, top=5, pays=None, mois=None):
        """son : signal mono 48 kHz (float32). pays (nom anglais xeno-canto, ex. « France ») et
        mois (1-12) sont facultatifs. Renvoie les espèces probables, chant/cri et la frise."""
        son = np.asarray(son, dtype=np.float32)
        tranches = self.oreille.tranches(son)
        emb, bn = [], []
        for k in range(0, len(tranches), 10):
            e, s = self.oreille.ecouter(tranches[k:k + 10])
            emb.append(e)
            bn.append(s)
        emb, bn = np.concatenate(emb), 1 / (1 + np.exp(-np.concatenate(bn)))
        x = torch.from_numpy(emb)[None]
        with torch.no_grad():
            s, c, st = self.modele(x, torch.ones(1, len(emb), dtype=torch.bool))
        p_bl = torch.softmax(s[0], 0).numpy()

        # Avis de BirdNET sur les mêmes espèces : meilleure tranche, ramené à une distribution
        p_bn = np.zeros(len(self.especes), dtype=np.float32)
        garde = self.colonne >= 0
        np.maximum.at(p_bn, self.colonne[garde], bn.max(0)[garde])
        p_bn /= max(p_bn.sum(), 1e-6)
        w = self.poids_birdnet
        p = (1 - w) * p_bl + w * p_bn if p_bn.sum() > 0 else p_bl
        if pays or mois:
            p = p * self.contexte.a_priori(pays, mois) ** BETA_CONTEXTE
            p /= p.sum()

        oiseaux = bn[:, garde].max(1)                   # meilleure espèce connue, par tranche
        meilleurs = np.argsort(-p)[:top]
        pt = torch.softmax(st[0], -1).numpy()           # probabilités par tranche de 3 s
        frise = [{"debut": 3 * k, "espece": self.fiche(self.especes[int(pt[k].argmax())], pt[k].max()),
                  "oiseau": bool(oiseaux[k] >= SEUIL_OISEAU)} for k in range(len(pt))]
        return {"especes": [self.fiche(self.especes[i], p[i]) for i in meilleurs],
                "oiseau_entendu": bool(oiseaux.max() >= SEUIL_OISEAU),
                "incertain": bool(p[meilleurs[0]] < SEUIL_INCERTAIN),
                "chant": round(float(torch.sigmoid(c[0])), 3), "duree": round(len(son) / FREQ, 1),
                "frise": frise}
