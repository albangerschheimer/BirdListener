"""Entraîne le classifieur BirdListener sur les empreintes BirdNET.

Usage : python scripts/train.py [nom]
Sortie : models/<nom>.pt (poids + liste des espèces) et models/<nom>_eval.json

Principe : chaque enregistrement est découpé en tranches de 3 s. On ne sait pas lesquelles
contiennent l'oiseau ; le modèle donne un score par tranche et par espèce, et le score de
l'enregistrement est une moyenne « douce » qui privilégie les meilleures tranches
(log-sum-exp). Ainsi il apprend seul à repérer les tranches utiles.

Une seconde sortie dit si le son est un chant ou un cri.

Séparation : pour chaque espèce, les enregistrements de certains auteurs sont mis de côté
(15 % pour le test, 10 % pour la validation) : le modèle n'entend jamais ces auteurs, ni leurs
micros, ni leurs lieux, pendant l'entraînement.
"""
import csv
import json
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE / "src"))
from modele import Classifieur  # noqa: E402

MAX_TRANCHES = 20
torch.set_num_threads(4)


def type_son(texte):
    t = (texte or "").lower()
    chant, cri = "song" in t, "call" in t
    return 1 if chant and not cri else 0 if cri and not chant else -1   # -1 : inconnu ou les deux


def separer(lignes, graine=0):
    """Répartit les enregistrements en entraînement / validation / test, par auteur et par espèce."""
    rng = random.Random(graine)
    par_espece = defaultdict(lambda: defaultdict(list))
    for l in lignes:
        par_espece[l["espece"]][l["auteur"]].append(l)
    for auteurs in par_espece.values():
        noms = list(auteurs)
        rng.shuffle(noms)
        n = sum(len(v) for v in auteurs.values())
        if len(noms) >= 3 and n >= 8:
            cumul = 0
            for a in noms:
                part = "test" if cumul < 0.15 * n else "val" if cumul < 0.25 * n else "train"
                for l in auteurs[a]:
                    l["part"] = part
                cumul += len(auteurs[a])
        else:   # trop peu d'auteurs : séparation par enregistrement
            tous = [l for v in auteurs.values() for l in v]
            rng.shuffle(tous)
            for k, l in enumerate(tous):
                l["part"] = "test" if n >= 4 and k < max(1, n * 0.15) else "train"
    return lignes


def charger(lignes):
    X, ids = [], []
    for l in lignes:
        p = RACINE / "data" / "emb" / f"{l['id']}.npz"
        try:
            e = np.load(p)["emb"][:MAX_TRANCHES]
        except Exception:
            continue
        X.append(e)
        ids.append(l)
    return X, ids


def lot(X, idx, augmente=False):
    T = max(min(len(X[i]), MAX_TRANCHES) for i in idx)
    xb = torch.zeros(len(idx), T, 1024)
    m = torch.zeros(len(idx), T, dtype=torch.bool)
    for k, i in enumerate(idx):
        e = torch.from_numpy(X[i].astype(np.float32))
        if augmente and len(e) > 2:   # sous-ensemble aléatoire de tranches
            garde = torch.randperm(len(e))[:random.randint(max(1, len(e) // 3), len(e))]
            e = e[garde]
        xb[k, :len(e)] = e
        m[k, :len(e)] = True
    return xb, m


def evaluer(modele, X, y, idx, especes):
    modele.eval()
    rangs, preds = [], []
    with torch.no_grad():
        for d in range(0, len(idx), 256):
            b = idx[d:d + 256]
            xb, m = lot(X, b)
            s, _, _ = modele(xb, m)
            vrai = torch.tensor([y[i] for i in b])
            rang = (s > s.gather(1, vrai[:, None])).sum(1)
            rangs += rang.tolist()
            preds += s.argmax(1).tolist()
    rangs = np.array(rangs)
    vrais = np.array([y[i] for i in idx])
    par_esp = defaultdict(list)
    for v, r in zip(vrais, rangs):
        par_esp[v].append(r == 0)
    return {"top1": float((rangs == 0).mean()), "top5": float((rangs < 5).mean()),
            "top1_moyen_par_espece": float(np.mean([np.mean(v) for v in par_esp.values()])),
            "n": len(idx), "par_espece": {especes[k]: float(np.mean(v)) for k, v in par_esp.items()}}


def main(nom="birdlistener", epoques=40):
    lignes = list(csv.DictReader(open(RACINE / "data" / "selection.csv", encoding="utf-8")))
    lignes = separer(lignes)
    X, lignes = charger(lignes)
    especes = sorted({l["espece"] for l in lignes})
    num = {e: k for k, e in enumerate(especes)}
    y = [num[l["espece"]] for l in lignes]
    chant = [type_son(l["type"]) for l in lignes]
    part = defaultdict(list)
    for i, l in enumerate(lignes):
        part[l["part"]].append(i)
    print(f"{len(especes)} espèces ; entraînement {len(part['train'])}, validation {len(part['val'])}, "
          f"test {len(part['test'])}", flush=True)

    # Les espèces rares sont tirées plus souvent (racine carrée de l'inverse de la fréquence)
    compte = np.bincount([y[i] for i in part["train"]], minlength=len(especes))
    poids = np.array([1 / np.sqrt(compte[y[i]]) for i in part["train"]])
    poids /= poids.sum()

    modele = Classifieur(len(especes))
    opt = torch.optim.AdamW(modele.parameters(), lr=1e-3, weight_decay=1e-2)
    pas_par_epoque = len(part["train"]) // 128 + 1
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 1e-3, total_steps=epoques * pas_par_epoque)
    meilleur, etat, debut = -1, None, 0
    # Reprise après une interruption (les tâches de la session cloud sont limitées à 2 h)
    reprise = RACINE / "models" / f"{nom}_reprise.pt"
    if reprise.exists():
        r = torch.load(reprise, weights_only=False)
        modele.load_state_dict(r["modele"])
        opt.load_state_dict(r["opt"])
        sched.load_state_dict(r["sched"])
        meilleur, etat, debut = r["meilleur"], r["etat"], r["epoque"]
        print(f"reprise à l'époque {debut + 1}", flush=True)
    for ep in range(debut, epoques):
        modele.train()
        t, perte_tot = time.time(), 0
        for _ in range(pas_par_epoque):
            b = list(np.random.choice(part["train"], 128, p=poids))
            xb, m = lot(X, b, augmente=True)
            s, c, _ = modele(xb, m)
            vrai = torch.tensor([y[i] for i in b])
            perte = F.cross_entropy(s, vrai, label_smoothing=0.1)
            ct = torch.tensor([chant[i] for i in b], dtype=torch.float32)
            connu = ct >= 0
            if connu.any():
                perte = perte + 0.2 * F.binary_cross_entropy_with_logits(c[connu], ct[connu])
            opt.zero_grad()
            perte.backward()
            opt.step()
            sched.step()
            perte_tot += perte.item()
        ev = evaluer(modele, X, y, part["val"] or part["test"], especes)
        print(f"époque {ep + 1}/{epoques} : perte {perte_tot / pas_par_epoque:.3f}, "
              f"validation top-1 {ev['top1']:.3f}, top-5 {ev['top5']:.3f} ({time.time() - t:.0f} s)", flush=True)
        if ev["top1_moyen_par_espece"] > meilleur:
            meilleur, etat = ev["top1_moyen_par_espece"], {k: v.clone() for k, v in modele.state_dict().items()}
        (RACINE / "models").mkdir(exist_ok=True)
        torch.save({"modele": modele.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(),
                    "meilleur": meilleur, "etat": etat, "epoque": ep + 1}, reprise)

    modele.load_state_dict(etat)
    test = evaluer(modele, X, y, part["test"], especes)
    print(f"TEST : top-1 {test['top1']:.3f}, top-5 {test['top5']:.3f}, "
          f"top-1 moyen par espèce {test['top1_moyen_par_espece']:.3f} sur {test['n']} enregistrements", flush=True)
    (RACINE / "models").mkdir(exist_ok=True)
    torch.save({"etat": etat, "especes": especes}, RACINE / "models" / f"{nom}.pt")
    json.dump({"test": test, "especes": len(especes), "repartition": {k: len(v) for k, v in part.items()},
               "test_ids": [lignes[i]["id"] for i in part["test"]],
               "test_especes": [lignes[i]["espece"] for i in part["test"]]},
              open(RACINE / "models" / f"{nom}_eval.json", "w"), ensure_ascii=False, indent=1)
    reprise.unlink()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "birdlistener", int(sys.argv[2]) if len(sys.argv) > 2 else 30)
