"""Évaluation détaillée sur les enregistrements de test (auteurs jamais entendus).

Usage : python scripts/evaluate.py <nom_modele>
Compare BirdListener, BirdNET seul (limité aux mêmes espèces) et leur combinaison,
sur toutes les espèces puis sur les seules espèces connues de BirdNET.
Sortie : models/<nom>_evaluation.json (dont le poids de combinaison retenu et les scores par espèce).
"""
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


def evaluer_contexte(test_ids, especes, P, vrais):
    """Effet du filtre pays + mois : P × a_priori^β. L'enregistrement testé est retiré des
    fréquences (sinon il s'aiderait lui-même)."""
    from contexte import Contexte
    ctx = Contexte(especes)
    meta = {}
    cibles = set(test_ids)
    for fichier in (RACINE / "data" / "metadata").glob("xc_*.jsonl"):
        for ligne in fichier.open(encoding="utf-8"):
            if '"id": "' in ligne and ligne[8:ligne.index('"', 8)] in cibles:
                r = json.loads(ligne)
                meta[r["id"]] = (r.get("cnt"), int((r.get("date") or "0000-00")[5:7] or 0))
    res = {}
    for beta in (0.0, 0.3, 0.5, 0.7, 1.0):
        ok = []
        for k, xc_id in enumerate(test_ids):
            pays, mois = meta.get(xc_id, (None, 0))
            v = vrais[k]
            if pays in ctx.pays:            # retrait de l'enregistrement testé
                ctx.pays[pays][especes[v]] = ctx.pays[pays].get(especes[v], 1) - 1
            if 1 <= mois <= 12:
                ctx.mois[v, mois - 1] -= 1
            a = ctx.a_priori(pays, mois)
            if pays in ctx.pays:
                ctx.pays[pays][especes[v]] += 1
            if 1 <= mois <= 12:
                ctx.mois[v, mois - 1] += 1
            ok.append((P[k] * a ** beta).argmax() == v)
        res[f"beta={beta}"] = float(np.mean(ok))
        print(f"filtre lieu + saison, β={beta} : {np.mean(ok):.1%}", flush=True)
    return res


def main(nom):
    sauv = torch.load(RACINE / "models" / f"{nom}.pt", map_location="cpu")
    especes = sauv["especes"]
    num = {e: k for k, e in enumerate(especes)}
    modele = Classifieur(len(especes))
    modele.load_state_dict(sauv["etat"])
    modele.eval()
    ev = json.load(open(RACINE / "models" / f"{nom}_eval.json", encoding="utf-8"))
    etiquettes = (RACINE / "data" / "models" / "BirdNET_GLOBAL_6K_V2.4_Labels.txt").read_text().splitlines()
    sci_bn = [e.split("_")[0] for e in etiquettes]
    colonne = np.array([num.get(s, -1) for s in sci_bn])
    connues_bn = set(sci_bn)

    def avis(ids, noms):
        """Avis BirdListener et BirdNET (normalisé en distribution) sur une liste d'enregistrements."""
        P_bl, P_bn = [], []
        with torch.no_grad():
            for xc_id in ids:
                d = np.load(RACINE / "data" / "emb" / f"{xc_id}.npz")
                e = torch.from_numpy(d["emb"][:MAX_TRANCHES].astype(np.float32))[None]
                s, _, _ = modele(e, torch.ones(1, e.shape[1], dtype=torch.bool))
                P_bl.append(torch.softmax(s[0], 0).numpy())
                P_bn.append(scores_birdnet(d, colonne, len(especes)))
        P_bn = np.array(P_bn)
        return np.array(P_bl), P_bn / np.clip(P_bn.sum(1, keepdims=True), 1e-6, None), np.array([num[n] for n in noms])

    P_bl, P_bn_norm, vrais = avis(ev["test_ids"], ev["test_especes"])
    connue = np.array([especes[v] in connues_bn for v in vrais])

    def precision(P, masque=None):
        ok = P.argmax(1) == vrais
        m = np.ones(len(ok), bool) if masque is None else masque
        par_esp = defaultdict(list)
        for v, o in zip(vrais[m], ok[m]):
            par_esp[v].append(o)
        return float(ok[m].mean()), float(np.mean([np.mean(x) for x in par_esp.values()])), par_esp

    # Combinaison : moyenne pondérée des deux avis. Le poids est choisi sur la validation
    # (sur le test seulement pour les anciens modèles qui n'ont pas gardé leur validation).
    poids = (0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0)
    resultats = {}
    for w in poids:
        P = (1 - w) * P_bl + w * P_bn_norm
        t, tm, _ = precision(P)
        resultats[f"w={w}"] = {"tout": t, "par_espece": tm, "connues_birdnet": precision(P, connue)[0]}
    if ev.get("val_ids"):
        V_bl, V_bn, v_vrais = avis(ev["val_ids"], ev["val_especes"])
        w = max(poids, key=lambda w: (((1 - w) * V_bl + w * V_bn).argmax(1) == v_vrais).mean())
        choix = "validation"
    else:
        w = max(poids, key=lambda w: resultats[f"w={w}"]["par_espece"])
        choix = "test"
    _, _, par_esp = precision((1 - w) * P_bl + w * P_bn_norm)
    sortie = {"poids_birdnet": w, "poids_choisi_sur": choix, "n": len(vrais), "n_especes_inconnues_birdnet": int((~connue).sum()),
              "resultats": resultats,
              "par_espece": {especes[k]: {"precision": float(np.mean(v)), "n": len(v)} for k, v in par_esp.items()}}
    sortie["filtre_lieu_saison"] = evaluer_contexte(ev["test_ids"], especes, (1 - w) * P_bl + w * P_bn_norm, vrais)
    json.dump(sortie, open(RACINE / "models" / f"{nom}_evaluation.json", "w"), ensure_ascii=False, indent=1)
    print(f"{len(vrais)} enregistrements de test, dont {(~connue).sum()} d'espèces inconnues de BirdNET")
    print(f"{'':22s} {'tout':>8s} {'par espèce':>11s} {'connues BirdNET':>16s}")
    for nom_ligne, cle in (("BirdListener seul", "w=0.0"), ("BirdNET seul", "w=1.0"), (f"Combinaison (w={w})", f"w={w}")):
        r = resultats[cle]
        print(f"{nom_ligne:22s} {r['tout']:8.1%} {r['par_espece']:11.1%} {r['connues_birdnet']:16.1%}")


if __name__ == "__main__":
    main(sys.argv[1])
