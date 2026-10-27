"""Construit la table des espèces (noms français, anglais, famille) depuis la liste IOC.

Usage : python scripts/build_species_table.py
Sortie : data/especes.json  {nom scientifique: {fr, en, famille, ordre, n_enregistrements}}
"""
import csv
import json
from collections import Counter
from pathlib import Path

import pandas as pd

RACINE = Path(__file__).resolve().parents[1]


def main():
    ioc = pd.read_excel(RACINE / "data" / "models" / "ioc_multiling.xlsx")
    ioc["IOC_15.2"] = ioc["IOC_15.2"].astype(str).str.strip()
    # Les lignes de famille n'ont pas de nom d'espèce : on propage famille et ordre
    ioc["Family"] = ioc["Family"].ffill()
    ioc["Order"] = ioc["Order"].ffill()
    infos = {r["IOC_15.2"]: r for _, r in ioc.iterrows()}

    compte = Counter(r["espece"] for r in csv.DictReader(open(RACINE / "data" / "selection.csv", encoding="utf-8")))
    table, sans_nom = {}, []
    for espece, n in sorted(compte.items()):
        r = infos.get(espece)
        if r is None:
            sans_nom.append(espece)
        texte = lambda c: str(r[c]) if r is not None and pd.notna(r[c]) else ""  # noqa: E731
        table[espece] = {"fr": texte("French"), "en": texte("English"), "famille": texte("Family"),
                         "ordre": texte("Order"), "n_enregistrements": n}
    json.dump(table, open(RACINE / "data" / "especes.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(table)} espèces, {len(sans_nom)} sans nom IOC : {sans_nom[:10]}")


if __name__ == "__main__":
    main()
