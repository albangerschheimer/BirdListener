"""Évaluation détaillée sur les enregistrements de test (auteurs jamais entendus).

Usage : python scripts/evaluate.py <nom_modele>
Compare BirdListener, BirdNET seul (limité aux mêmes espèces) et leur combinaison,
sur toutes les espèces puis sur les seules espèces connues de BirdNET.
Sortie : models/<nom>_evaluation.json (dont le poids de combinaison retenu et les scores par espèce).
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE / "src"))
from modele import Classifieur  # noqa: E402

MAX_TRANCHES = 20


def scores_birdnet(d, colonne, n):
    """Score BirdNET par espèce BirdListener : meilleure tranche (probabilité sigmoïde)."""
    s = np.zeros(n, dtype=np.float32)
    for ti, ts in zip(d["top_i"], d["top_s"]):
        for i, v in zip(ti, ts.astype(np.float32)):
            k = colonne[i]
            if k >= 0:
                s[k] = max(s[k], 1 / (1 + np.exp(-v)))
    return s


def main(nom):
    sauv = torch.load(RACINE / "models" / f"{nom}.pt", map_location="cpu")
    especes = sauv["especes"]
    num = {e: k for k, e in enumerate(especes)}
    modele = Classifieur(len(especes))
    modele.load_state_dict(sauv["etat"])
    modele.eval()
    ev = json.load(open(RACINE / "models" / f"{nom}_eval.json", encoding="utf-8"))
    espece_de = {l["id"]: l["espece"] for l in csv.DictReader(open(RACINE / "data" / "selection.csv", encoding="utf-8"))}
    etiquettes = (RACINE / "data" / "models" / "BirdNET_GLOBAL_6K_V2.4_Labels.txt").read_text().splitlines()
    sci_bn = [e.split("_")[0] for e in etiquettes]
    colonne = np.array([num.get(s, -1) for s in sci_bn])
    connues_bn = set(sci_bn)

    P_bl, P_bn, vrais = [], [], []
    with torch.no_grad():
        for xc_id in ev["test_ids"]:
            d = np.load(RACINE / "data" / "emb" / f"{xc_id}.npz")
            e = torch.from_numpy(d["emb"][:MAX_TRANCHES].astype(np.float32))[None]
            s, _, _ = modele(e, torch.ones(1, e.shape[1], dtype=torch.bool))
            P_bl.append(torch.softmax(s[0], 0).numpy())
            P_bn.append(scores_birdnet(d, colonne, len(especes)))
            vrais.append(num[espece_de[xc_id]])
    P_bl, P_bn, vrais = np.array(P_bl), np.array(P_bn), np.array(vrais)
    connue = np.array([especes[v] in connues_bn for v in vrais])

    def precision(P, masque=None):
        ok = P.argmax(1) == vrais
        m = np.ones(len(ok), bool) if masque is None else masque
        par_esp = defaultdict(list)
        for v, o in zip(vrais[m], ok[m]):
            par_esp[v].append(o)
        return float(ok[m].mean()), float(np.mean([np.mean(x) for x in par_esp.values()])), par_esp

    # Combinaison : moyenne pondérée des deux avis (BirdNET normalisé en distribution)
    P_bn_norm = P_bn / np.clip(P_bn.sum(1, keepdims=True), 1e-6, None)
    resultats, meilleur = {}, (0, None)
    for w in (0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0):
        P = (1 - w) * P_bl + w * P_bn_norm
        t, tm, _ = precision(P)
        resultats[f"w={w}"] = {"tout": t, "par_espece": tm, "connues_birdnet": precision(P, connue)[0]}
        if tm > meilleur[0]:
            meilleur = (tm, w)
    w = meilleur[1]
    _, _, par_esp = precision((1 - w) * P_bl + w * P_bn_norm)
    sortie = {"poids_birdnet": w, "n": len(vrais), "n_especes_inconnues_birdnet": int((~connue).sum()),
              "resultats": resultats,
              "par_espece": {especes[k]: {"precision": float(np.mean(v)), "n": len(v)} for k, v in par_esp.items()}}
    json.dump(sortie, open(RACINE / "models" / f"{nom}_evaluation.json", "w"), ensure_ascii=False, indent=1)
    print(f"{len(vrais)} enregistrements de test, dont {(~connue).sum()} d'espèces inconnues de BirdNET")
    print(f"{'':22s} {'tout':>8s} {'par espèce':>11s} {'connues BirdNET':>16s}")
    for nom_ligne, cle in (("BirdListener seul", "w=0.0"), ("BirdNET seul", "w=1.0"), (f"Combinaison (w={w})", f"w={w}")):
        r = resultats[cle]
        print(f"{nom_ligne:22s} {r['tout']:8.1%} {r['par_espece']:11.1%} {r['connues_birdnet']:16.1%}")


if __name__ == "__main__":
    main(sys.argv[1])
