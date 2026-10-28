"""Calcule la fréquence des espèces par pays et par mois, à partir des métadonnées xeno-canto.

Usage : python scripts/build_priors.py
Sortie : data/frequences.json
  pays  : {pays: {espece: nombre d'enregistrements}}
  mois  : {espece: [12 nombres]}  (tous pays confondus)
"""
import json
from collections import Counter, defaultdict
from pathlib import Path

RACINE = Path(__file__).resolve().parents[1]


def main():
    pays, mois, vus = defaultdict(Counter), defaultdict(lambda: [0] * 12), set()
    for fichier in sorted((RACINE / "data" / "metadata").glob("xc_*.jsonl")):
        for ligne in fichier.open(encoding="utf-8"):
            try:
                r = json.loads(ligne)
            except json.JSONDecodeError:
                continue
            if r["id"] in vus or not r["sp"]:
                continue
            vus.add(r["id"])
            espece = f"{r['gen']} {r['sp']}"
            if r.get("cnt"):
                pays[r["cnt"]][espece] += 1
            try:
                m = int((r.get("date") or "")[5:7])
            except ValueError:
                m = 0
            if 1 <= m <= 12:
                mois[espece][m - 1] += 1
    json.dump({"pays": {p: dict(c) for p, c in pays.items()}, "mois": dict(mois)},
              open(RACINE / "data" / "frequences.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{len(vus)} enregistrements, {len(pays)} pays, {len(mois)} espèces datées")


if __name__ == "__main__":
    main()
