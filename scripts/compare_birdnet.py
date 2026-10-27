"""Compare BirdListener et BirdNET seul, sur les mêmes enregistrements de test.

Usage : python scripts/compare_birdnet.py <nom_modele>
BirdNET est limité aux mêmes espèces candidates que BirdListener (comme son filtre par lieu),
pour une comparaison équitable. Score BirdNET d'un enregistrement : meilleure tranche par espèce.
Sortie : models/<nom>_comparaison.json et un résumé à l'écran.
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

RACINE = Path(__file__).resolve().parents[1]


def main(nom):
    ev = json.load(open(RACINE / "models" / f"{nom}_eval.json", encoding="utf-8"))
    especes_bl = set(ev["test"]["par_espece"]) | set(json.load(open(RACINE / "data" / "especes.json")))
    etiquettes = (RACINE / "data" / "models" / "BirdNET_GLOBAL_6K_V2.4_Labels.txt").read_text().splitlines()
    sci = [e.split("_")[0] for e in etiquettes]
    candidat = np.array([s in especes_bl for s in sci])
    espece_de = {l["id"]: l["espece"] for l in csv.DictReader(open(RACINE / "data" / "selection.csv", encoding="utf-8"))}

    bons, inconnus, par_esp = [], 0, defaultdict(list)
    for xc_id in ev["test_ids"]:
        vrai = espece_de[xc_id]
        if vrai not in sci:
            inconnus += 1        # espèce absente de BirdNET : BirdNET ne peut pas la trouver
            par_esp[vrai].append(False)
            bons.append(False)
            continue
        d = np.load(RACINE / "data" / "emb" / f"{xc_id}.npz")
        score = defaultdict(float)
        for ti, ts in zip(d["top_i"], d["top_s"]):
            for i, s in zip(ti, ts.astype(np.float32)):
                if candidat[i]:
                    score[sci[i]] = max(score[sci[i]], float(s))
        ok = bool(score) and max(score, key=score.get) == vrai
        bons.append(ok)
        par_esp[vrai].append(ok)
    resultat = {"birdnet_top1": float(np.mean(bons)),
                "birdnet_top1_moyen_par_espece": float(np.mean([np.mean(v) for v in par_esp.values()])),
                "birdlistener_top1": ev["test"]["top1"],
                "birdlistener_top1_moyen_par_espece": ev["test"]["top1_moyen_par_espece"],
                "especes_absentes_de_birdnet": inconnus, "n": len(bons),
                "birdnet_par_espece": {k: float(np.mean(v)) for k, v in par_esp.items()}}
    json.dump(resultat, open(RACINE / "models" / f"{nom}_comparaison.json", "w"), ensure_ascii=False, indent=1)
    print(f"Sur {len(bons)} enregistrements de test (auteurs jamais entendus) :")
    print(f"  BirdNET seul  : {resultat['birdnet_top1']:.1%} (moyenne par espèce {resultat['birdnet_top1_moyen_par_espece']:.1%})")
    print(f"  BirdListener  : {resultat['birdlistener_top1']:.1%} (moyenne par espèce {resultat['birdlistener_top1_moyen_par_espece']:.1%})")
    print(f"  {inconnus} enregistrements d'espèces absentes de BirdNET")


if __name__ == "__main__":
    main(sys.argv[1])
