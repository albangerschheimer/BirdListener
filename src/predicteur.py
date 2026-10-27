"""Reconnaît les oiseaux dans un son : oreille BirdNET + classifieur BirdListener."""
import json
from pathlib import Path

import numpy as np
import torch

from modele import Classifieur
from oreille import FREQ, Oreille

RACINE = Path(__file__).resolve().parents[1]


class Predicteur:
    def __init__(self, nom="europe_v1", threads=2):
        sauvegarde = torch.load(RACINE / "models" / f"{nom}.pt", map_location="cpu")
        self.especes = sauvegarde["especes"]
        self.modele = Classifieur(len(self.especes))
        self.modele.load_state_dict(sauvegarde["etat"])
        self.modele.eval()
        self.oreille = Oreille(threads=threads)
        self.infos = json.load(open(RACINE / "data" / "especes.json", encoding="utf-8"))

    def fiche(self, espece, proba):
        i = self.infos.get(espece, {})
        return {"scientifique": espece, "fr": i.get("fr") or i.get("en") or espece, "en": i.get("en", ""),
                "famille": i.get("famille", ""), "proba": round(float(proba), 4)}

    def predire(self, son, top=5):
        """son : signal mono 48 kHz (float32). Renvoie les espèces probables, chant/cri et la frise."""
        son = np.asarray(son, dtype=np.float32)
        tranches = self.oreille.tranches(son)
        emb = np.concatenate([self.oreille.ecouter(tranches[k:k + 10])[0] for k in range(0, len(tranches), 10)])
        x = torch.from_numpy(emb)[None]
        with torch.no_grad():
            s, c, st = self.modele(x, torch.ones(1, len(emb), dtype=torch.bool))
        p = torch.softmax(s[0], 0).numpy()
        meilleurs = np.argsort(-p)[:top]
        pt = torch.softmax(st[0], -1).numpy()           # probabilités par tranche de 3 s
        frise = [{"debut": 3 * k, "espece": self.fiche(self.especes[int(pt[k].argmax())], pt[k].max())}
                 for k in range(len(pt))]
        return {"especes": [self.fiche(self.especes[i], p[i]) for i in meilleurs],
                "chant": round(float(torch.sigmoid(c[0])), 3), "duree": round(len(son) / FREQ, 1),
                "frise": frise}
