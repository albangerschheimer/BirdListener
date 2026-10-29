"""Le modèle monde peut-il remplacer le modèle Europe dans l'application ?

Usage : python scripts/comparer_modeles.py europe_v1 monde_v1
Compare les deux modèles sur les enregistrements de test qu'aucun des deux n'a entendus,
d'espèces européennes, comme dans l'application : combinaison avec BirdNET (poids retenu à
l'évaluation de chaque modèle), puis filtre pays + mois (β = 0,3), l'enregistrement testé
étant retiré des fréquences.
Sortie : models/<monde>_contre_<europe>.json
"""
import json
import sys
from pathlib import Path

import numpy as np

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE / "src"))
sys.path.insert(0, str(RACINE / "scripts"))
from contexte import Contexte  # noqa: E402
from evaluate import Juge, lire_meta  # noqa: E402

BETA = 0.3


def main(nom_europe, nom_monde):
    juges = [Juge(nom_europe), Juge(nom_monde)]
    evals = [json.load(open(RACINE / "models" / f"{n}_eval.json", encoding="utf-8")) for n in (nom_europe, nom_monde)]
    poids = [json.load(open(RACINE / "models" / f"{n}_evaluation.json", encoding="utf-8"))["poids_birdnet"]
             for n in (nom_europe, nom_monde)]
    communs = set(evals[0]["test_ids"]) & set(evals[1]["test_ids"])
    tests = [(i, e) for i, e in zip(evals[0]["test_ids"], evals[0]["test_especes"]) if i in communs]
    print(f"{len(tests)} enregistrements de test communs ({len({e for _, e in tests})} espèces)", flush=True)
    contextes = [Contexte(j.especes) for j in juges]
    meta = lire_meta([i for i, _ in tests])

    ok = {(m, f): [] for m in (0, 1) for f in (False, True)}
    top5 = {m: [] for m in (0, 1)}
    for k, (xc_id, espece) in enumerate(tests):
        pays, mois = meta.get(xc_id, (None, 0))
        for m, (juge, ctx, w) in enumerate(zip(juges, contextes, poids)):
            p_bl, p_bn = juge.avis(xc_id)
            v = juge.num[espece]
            P = (1 - w) * p_bl + w * p_bn
            ok[m, False].append(P.argmax() == v)
            Pc = P * ctx.a_priori(pays, mois, retirer=v) ** BETA
            ok[m, True].append(Pc.argmax() == v)
            top5[m].append(v in np.argpartition(-Pc, 5)[:5])
        if k % 2000 == 1999:
            print(f"{k + 1}/{len(tests)}", flush=True)

    sortie = {"n": len(tests), "beta": BETA, "poids_birdnet": dict(zip((nom_europe, nom_monde), poids))}
    for m, nom in enumerate((nom_europe, nom_monde)):
        sortie[nom] = {"top1": float(np.mean(ok[m, False])), "top1_filtre": float(np.mean(ok[m, True])),
                       "top5_filtre": float(np.mean(top5[m])), "especes": len(juges[m].especes)}
        print(f"{nom:12s} ({len(juges[m].especes):5d} espèces) : top-1 {np.mean(ok[m, False]):.1%}, "
              f"avec pays + mois {np.mean(ok[m, True]):.1%}, top-5 {np.mean(top5[m]):.1%}")
    json.dump(sortie, open(RACINE / "models" / f"{nom_monde}_contre_{nom_europe}.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
