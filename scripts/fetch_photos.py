"""Récupère une photo par espèce (image principale de l'article Wikipédia) avec son auteur et sa licence.

Usage : python scripts/fetch_photos.py [europe|tout]
Sortie : webapp/photos/<Genre_espece>.jpg (320 px de large) et webapp/photos/credits.json
  {nom scientifique: {fichier, auteur, licence, source}}
Reprend où il s'était arrêté. Requêtes espacées, pour respecter Wikimedia.
Auteur et licence : complétés par completer_credits() quand l'API classique répond.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import requests

RACINE = Path(__file__).resolve().parents[1]
DOSSIER = Path(os.environ.get("PHOTOS_DOSSIER", RACINE / "webapp" / "photos"))   # dossier d'attente possible
API = "https://{}.wikipedia.org/w/api.php"
SESSION = requests.Session()
SESSION.headers["User-Agent"] = "BirdListener/0.1 (https://github.com/albangerschheimer/BirdListener)"


def appel(langue, **params):
    for essai in range(5):
        r = SESSION.get(API.format(langue), params={"action": "query", "format": "json", **params}, timeout=60)
        if r.status_code == 200:
            return r.json()
        time.sleep(5 * 2 ** essai)
    raise RuntimeError(f"Wikipédia ne répond pas ({r.status_code})")


def obtenir(url):
    """GET qui survit aux coupures réseau passagères."""
    for attente in (5, 20, 60, 180):
        try:
            return SESSION.get(url, timeout=60)
        except requests.RequestException:
            time.sleep(attente)
    return SESSION.get(url, timeout=60)


def reessayer(r):
    """Wikimedia limite les requêtes depuis le cloud (429) : on attend de plus en plus longtemps."""
    for attente in (10, 30, 60, 120, 300):
        if r.status_code != 429:
            break
        time.sleep(attente)
        r = obtenir(r.url)
    return r


def reduire(contenu, sortie):
    """Réduit la photo à 320 px de large (JPEG ~15 Ko) avec ffmpeg."""
    p = subprocess.run(["ffmpeg", "-v", "quiet", "-y", "-f", "image2pipe", "-i", "pipe:0", "-vf", "scale=320:-2",
                        "-q:v", "5", str(sortie)], input=contenu)
    return p.returncode == 0


def image_principale(nom):
    """(url miniature 400 px, nom du fichier Commons) de l'article Wikipédia de l'espèce, ou None.
    Passe par l'API REST (l'API classique limite trop les requêtes depuis le cloud)."""
    for langue in ("en", "fr"):
        r = obtenir(f"https://{langue}.wikipedia.org/api/rest_v1/page/summary/{nom.replace(' ', '_')}")
        r = reessayer(r)
        if r.status_code != 200:
            continue
        d = r.json()
        if "originalimage" in d:
            original = d["originalimage"]["source"]
            m = re.search(r"/commons/(?:thumb/)?[0-9a-f]/[0-9a-f]{2}/([^/?]+)", original)
            fichier = requests.utils.unquote(m.group(1)) if m else ""
            vignette = d.get("thumbnail", {}).get("source", original)
            # Wikimedia ne sert que certaines largeurs : 500 px, réduite ensuite à 320 px
            vignette = re.sub(r"/\d+px-", "/500px-", vignette)
            return vignette, fichier
    return None


def credits(fichiers, langue):
    """{fichier: (auteur, licence)} d'après les métadonnées de l'image (Commons)."""
    d = appel(langue, titles="|".join("File:" + f for f in fichiers), prop="imageinfo",
              iiprop="extmetadata")["query"]
    res = {}
    for p in d.get("pages", {}).values():
        meta = (p.get("imageinfo") or [{}])[0].get("extmetadata", {})
        auteur = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip()
        licence = meta.get("LicenseShortName", {}).get("value", "")
        res[p["title"].split(":", 1)[1].replace(" ", "_")] = (auteur[:200], licence)
    return res


def main(zone="europe"):
    especes = json.load(open(RACINE / "data" / "especes.json", encoding="utf-8"))
    if zone == "europe":
        europe = set()
        for l in (RACINE / "data" / "metadata" / "xc_europe.jsonl").open(encoding="utf-8"):
            try:
                r = json.loads(l)
            except json.JSONDecodeError:
                continue
            europe.add(f"{r['gen']} {r['sp']}")
        noms = [e for e in especes if e in europe]
    else:
        noms = list(especes)
    DOSSIER.mkdir(parents=True, exist_ok=True)
    fichier_credits = DOSSIER / "credits.json"
    faits = json.load(open(fichier_credits, encoding="utf-8")) if fichier_credits.exists() else {}
    restants = [n for n in noms if n not in faits]
    print(f"{len(noms)} espèces, {len(restants)} photos à chercher", flush=True)

    for k, nom in enumerate(restants):
        trouve = image_principale(nom)
        if trouve:
            url, fichier = trouve
            r = reessayer(obtenir(url))
            nom_fichier = nom.replace(" ", "_") + ".jpg"
            if r.status_code == 200 and reduire(r.content, DOSSIER / nom_fichier):
                faits[nom] = {"fichier": nom_fichier, "auteur": "", "licence": "",
                              "source": f"https://commons.wikimedia.org/wiki/File:{fichier}"}
        if k % 25 == 24 or k == len(restants) - 1:
            json.dump(faits, open(fichier_credits, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            print(f"{k + 1}/{len(restants)} : {len(faits)} photos", flush=True)
        time.sleep(2)

if __name__ == "__main__":
    main(*sys.argv[1:2])
