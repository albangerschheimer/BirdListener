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


def lire_meta(ids):
    """Pays et mois de chaque enregistrement (métadonnées xeno-canto)."""
    meta, cibles = {}, set(ids)
    for fichier in (RACINE / "data" / "metadata").glob("xc_*.jsonl"):
        for ligne in fichier.open(encoding="utf-8"):
            if '"id": "' in ligne and ligne[8:ligne.index('"', 8)] in cibles:
                r = json.loads(ligne)
                meta[r["id"]] = (r.get("cnt"), int((r.get("date") or "0000-00")[5:7] or 0))
    return meta


class Juge:
    """Un modèle BirdListener et ses avis, enregistrement par enregistrement (sans tout garder
    en mémoire : avec 10 000 espèces, les matrices complètes ne tiendraient pas)."""

    def __init__(self, nom):
        sauv = torch.load(RACINE / "models" / f"{nom}.pt", map_location="cpu")
        self.especes = sauv["especes"]
        self.num = {e: k for k, e in enumerate(self.especes)}
        self.modele = Classifieur(len(self.especes))
        self.modele.load_state_dict(sauv["etat"])
        self.modele.eval()
        etiquettes = (RACINE / "data" / "models" / "BirdNET_GLOBAL_6K_V2.4_Labels.txt").read_text().splitlines()
        self.sci_bn = [e.split("_")[0] for e in etiquettes]
        self.colonne = np.array([self.num.get(x, -1) for x in self.sci_bn])

    def avis(self, xc_id):
        """Avis BirdListener (softmax) et BirdNET (normalisé en distribution)."""
        d = np.load(RACINE / "data" / "emb" / f"{xc_id}.npz")
        e = torch.from_numpy(d["emb"][:MAX_TRANCHES].astype(np.float32))[None]
        with torch.no_grad():
            s, _, _ = self.modele(e, torch.ones(1, e.shape[1], dtype=torch.bool))
        bn = scores_birdnet(d, self.colonne, len(self.especes))
        return torch.softmax(s[0], 0).numpy(), bn / max(bn.sum(), 1e-6)


POIDS = (0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0)
BETAS = (0.0, 0.3, 0.5, 0.7, 1.0)


def main(nom):
    from contexte import Contexte
    juge = Juge(nom)
    especes, num = juge.especes, juge.num
    ev = json.load(open(RACINE / "models" / f"{nom}_eval.json", encoding="utf-8"))
    connues_bn = set(juge.sci_bn)

    # Combinaison : moyenne pondérée des deux avis. Le poids est choisi sur la validation
    # (sur le test seulement pour les anciens modèles qui n'ont pas gardé leur validation).
    if ev.get("val_ids"):
        bons = defaultdict(int)
        for xc_id, n in zip(ev["val_ids"], ev["val_especes"]):
            p_bl, p_bn = juge.avis(xc_id)
            for w in POIDS:
                bons[w] += int(((1 - w) * p_bl + w * p_bn).argmax() == num[n])
        w_val, choix = max(POIDS, key=lambda w: bons[w]), "validation"
        print(f"poids BirdNET choisi sur la validation : {w_val}", flush=True)
    else:
        w_val, choix = None, "test"

    # Test : précision pour chaque poids ; filtre « où et quand » (l'enregistrement testé est
    # retiré des fréquences, sinon il s'aiderait lui-même)
    ctx, meta = Contexte(especes), lire_meta(ev["test_ids"])
    ok = {w: [] for w in POIDS}
    ok_ctx = {w: {b: [] for b in BETAS} for w in POIDS}
    vrais, connue = [], []
    for k, (xc_id, n) in enumerate(zip(ev["test_ids"], ev["test_especes"])):
        p_bl, p_bn = juge.avis(xc_id)
        v = num[n]
        vrais.append(v)
        connue.append(n in connues_bn)
        pays, mois = meta.get(xc_id, (None, 0))
        a = ctx.a_priori(pays, mois, retirer=v)
        for w in POIDS:
            P = (1 - w) * p_bl + w * p_bn
            ok[w].append(P.argmax() == v)
            if w_val is None or w == w_val:
                for b in BETAS:
                    ok_ctx[w][b].append((P * a ** b).argmax() == v)
        if k % 5000 == 4999:
            print(f"{k + 1}/{len(ev['test_ids'])}", flush=True)
    vrais, connue = np.array(vrais), np.array(connue)

    def precision(o, masque=None):
        o = np.array(o)
        m = np.ones(len(o), bool) if masque is None else masque
        par_esp = defaultdict(list)
        for v, x in zip(vrais[m], o[m]):
            par_esp[v].append(x)
        return float(o[m].mean()), float(np.mean([np.mean(x) for x in par_esp.values()])), par_esp

    resultats = {}
    for w in POIDS:
        t, tm, _ = precision(ok[w])
        resultats[f"w={w}"] = {"tout": t, "par_espece": tm, "connues_birdnet": precision(ok[w], connue)[0]}
    w = w_val if w_val is not None else max(POIDS, key=lambda w: resultats[f"w={w}"]["par_espece"])
    _, _, par_esp = precision(ok[w])
    sortie = {"poids_birdnet": w, "poids_choisi_sur": choix, "n": len(vrais), "n_especes_inconnues_birdnet": int((~connue).sum()),
              "resultats": resultats,
              "par_espece": {especes[k]: {"precision": float(np.mean(v)), "n": len(v)} for k, v in par_esp.items()}}
    sortie["filtre_lieu_saison"] = {f"beta={b}": float(np.mean(ok_ctx[w][b])) for b in BETAS}
    for b in BETAS:
        print(f"filtre lieu + saison, β={b} : {np.mean(ok_ctx[w][b]):.1%}", flush=True)
    json.dump(sortie, open(RACINE / "models" / f"{nom}_evaluation.json", "w"), ensure_ascii=False, indent=1)
    print(f"{len(vrais)} enregistrements de test, dont {(~connue).sum()} d'espèces inconnues de BirdNET")
    print(f"{'':22s} {'tout':>8s} {'par espèce':>11s} {'connues BirdNET':>16s}")
    for nom_ligne, cle in (("BirdListener seul", "w=0.0"), ("BirdNET seul", "w=1.0"), (f"Combinaison (w={w})", f"w={w}")):
        r = resultats[cle]
        print(f"{nom_ligne:22s} {r['tout']:8.1%} {r['par_espece']:11.1%} {r['connues_birdnet']:16.1%}")


if __name__ == "__main__":
    main(sys.argv[1])
