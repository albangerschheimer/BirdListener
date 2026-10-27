"""Télécharge les métadonnées xeno-canto (API v3) d'une zone, page par page.

Usage : python scripts/fetch_metadata.py europe
Sortie : data/metadata/xc_<zone>.jsonl (une ligne par enregistrement), reprend où il s'était arrêté.
"""
import json
import os
import sys
import time
from pathlib import Path

import requests

RACINE = Path(__file__).resolve().parents[1]
API = "https://xeno-canto.org/api/3/recordings"
CHAMPS = ["id", "gen", "sp", "ssp", "en", "rec", "cnt", "lat", "lon", "type", "file",
          "lic", "q", "length", "date", "also", "smp"]


def cle_api():
    if os.environ.get("XC_API_KEY"):
        return os.environ["XC_API_KEY"]
    for ligne in (RACINE / ".env").read_text().splitlines():
        if ligne.startswith("XC_API_KEY="):
            return ligne.split("=", 1)[1].strip()
    raise SystemExit("XC_API_KEY manquante")


def page(cle, zone, n):
    for essai in range(6):
        try:
            r = requests.get(API, params={"query": f"grp:birds area:{zone}", "per_page": 500,
                                          "page": n, "key": cle}, timeout=60)
            if r.status_code == 200:
                return r.json()
        except requests.RequestException:
            pass
        time.sleep(2 ** essai)
    raise RuntimeError(f"page {n} introuvable")


def main(zone):
    cle = cle_api()
    sortie = RACINE / "data" / "metadata" / f"xc_{zone}.jsonl"
    sortie.parent.mkdir(parents=True, exist_ok=True)
    etat = sortie.with_suffix(".page")
    debut = int(etat.read_text()) + 1 if etat.exists() else 1
    total = page(cle, zone, 1)["numPages"]
    with sortie.open("a", encoding="utf-8") as f:
        for n in range(debut, total + 1):
            d = page(cle, zone, n)
            for r in d["recordings"]:
                f.write(json.dumps({k: r.get(k) for k in CHAMPS}, ensure_ascii=False) + "\n")
            f.flush()
            etat.write_text(str(n))
            print(f"{zone} : page {n}/{total}", flush=True)
            time.sleep(1)


if __name__ == "__main__":
    main(sys.argv[1])
