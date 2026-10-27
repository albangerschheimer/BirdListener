"""Choisit les enregistrements à écouter, espèce par espèce.

Usage : python scripts/select_recordings.py <max_par_espece> <zone> [<zone> ...]
Sortie : data/selection.csv (id, espece, qualite, auteur, type)

Règles :
- oiseaux uniquement (espèces de la liste mondiale IOC, ou genre connu d'IOC) ;
- qualité A puis B puis C puis D (E exclue), enregistrements de moins de 5 min d'abord ;
- on alterne entre auteurs pour varier les micros, les lieux et les individus.
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

RACINE = Path(__file__).resolve().parents[1]
RANG_QUALITE = {"A": 0, "B": 1, "C": 2, "D": 3, "no score": 3}


def duree(texte):
    try:
        parts = [int(x) for x in texte.split(":")]
    except (AttributeError, ValueError):
        return 9999
    s = 0
    for p in parts:
        s = s * 60 + p
    return s


def especes_ioc():
    ioc = pd.read_excel(RACINE / "data" / "models" / "ioc_multiling.xlsx")
    noms = set(ioc["IOC_15.2"].astype(str).str.strip())
    genres = {n.split()[0] for n in noms}
    return noms, genres


def main(maxi, zones):
    noms, genres = especes_ioc()
    par_espece, vus = defaultdict(list), set()
    for zone in zones:
        lignes = (RACINE / "data" / "metadata" / f"xc_{zone}.jsonl").read_text(encoding="utf-8").splitlines()
        for ligne in lignes:
            r = json.loads(ligne)
            espece = f"{r['gen']} {r['sp']}"
            if r["id"] in vus or r["q"] == "E" or r["sp"] in ("", "mystery", "sp"):
                continue
            if espece not in noms and r["gen"] not in genres:
                continue
            vus.add(r["id"])
            par_espece[espece].append(r)

    choisis = []
    for espece, rs in par_espece.items():
        rs.sort(key=lambda r: (RANG_QUALITE.get(r["q"], 3), duree(r["length"]) > 300, duree(r["length"])))
        # alternance entre auteurs : 1er enregistrement de chaque auteur, puis 2e, etc.
        par_auteur = defaultdict(list)
        for r in rs:
            par_auteur[r["rec"]].append(r)
        tour, k = [], 0
        while len(tour) < min(maxi, len(rs)):
            for liste in par_auteur.values():
                if k < len(liste) and len(tour) < maxi:
                    tour.append(liste[k])
            k += 1
        choisis += [(r["id"], espece, r["q"], r["rec"], r["type"]) for r in tour]

    with open(RACINE / "data" / "selection.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "espece", "qualite", "auteur", "type"])
        w.writerows(choisis)
    print(f"{len(par_espece)} espèces, {len(choisis)} enregistrements choisis")


if __name__ == "__main__":
    main(int(sys.argv[1]), sys.argv[2:])
