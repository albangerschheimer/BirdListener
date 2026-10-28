"""Prépare l'application web (webapp/) : modèle BirdNET avec empreinte, classifieur, espèces, photos.

Usage : python scripts/export_web.py <nom_modele>
Sortie dans webapp/modele/ :
  birdnet.tflite    BirdNET V2.4 avec l'empreinte (1024) en 2e sortie (data/web_models)
  classifieur.bin   poids du classifieur en float16, à la suite
  meta.json         formes et positions des poids, espèces, correspondance BirdNET, réglages
  frequences.json   fréquences par pays et par mois (filtre « où et quand »)
Les photos sont déjà dans webapp/photos/ (scripts/fetch_photos.py).
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import torch

RACINE = Path(__file__).resolve().parents[1]
SORTIE = RACINE / "webapp" / "modele"
ORDRE = ["tronc.0.weight", "tronc.0.bias", "tronc.1.weight", "tronc.1.bias",
         "especes.weight", "especes.bias", "chant.weight", "chant.bias"]


def main(nom):
    SORTIE.mkdir(parents=True, exist_ok=True)
    sauv = torch.load(RACINE / "models" / f"{nom}.pt", map_location="cpu")
    etat, especes = sauv["etat"], sauv["especes"]
    num = {e: k for k, e in enumerate(especes)}

    # Poids du classifieur, en float16 les uns à la suite des autres
    poids, position, blocs = {}, 0, []
    for cle in ORDRE:
        t = etat[cle].numpy().astype(np.float16)
        poids[cle] = {"forme": list(t.shape), "debut": position, "taille": int(t.size)}
        position += t.size
        blocs.append(t.ravel())
    (SORTIE / "classifieur.bin").write_bytes(np.concatenate(blocs).tobytes())

    infos = json.load(open(RACINE / "data" / "especes.json", encoding="utf-8"))
    credits_f = RACINE / "webapp" / "photos" / "credits.json"
    credits = json.load(open(credits_f, encoding="utf-8")) if credits_f.exists() else {}
    liste = []
    for e in especes:
        i, c = infos.get(e, {}), credits.get(e)
        liste.append({"sci": e, "fr": i.get("fr") or i.get("en") or e, "en": i.get("en", ""),
                      "famille": i.get("famille", ""), "photo": c["fichier"] if c else None,
                      "credit": " · ".join(x for x in (c.get("auteur"), c.get("licence")) if x) if c else "",
                      "source": c.get("source") if c else None})

    etiquettes = (RACINE / "data" / "models" / "BirdNET_GLOBAL_6K_V2.4_Labels.txt").read_text().splitlines()
    colonne = [num.get(e.split("_")[0], -1) for e in etiquettes]
    evaluation = RACINE / "models" / f"{nom}_evaluation.json"
    w = json.load(open(evaluation))["poids_birdnet"] if evaluation.exists() else 0.0
    sys.path.insert(0, str(RACINE / "src"))
    import predicteur
    json.dump({"modele": nom, "poids": poids, "especes": liste, "colonne_birdnet": colonne,
               "poids_birdnet": w, "seuil_oiseau": predicteur.SEUIL_OISEAU,
               "seuil_incertain": predicteur.SEUIL_INCERTAIN, "beta_contexte": predicteur.BETA_CONTEXTE},
              open(SORTIE / "meta.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # Fréquences limitées aux espèces du modèle, indexées par numéro d'espèce
    f = json.load(open(RACINE / "data" / "frequences.json", encoding="utf-8"))
    pays = {}
    for p, c in f["pays"].items():
        d = {num[e]: n for e, n in c.items() if e in num}
        if sum(d.values()) >= 20:
            pays[p] = d
    mois = [f["mois"].get(e, [0] * 12) for e in especes]
    json.dump({"pays": pays, "mois": mois}, open(SORTIE / "frequences.json", "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))

    shutil.copy(RACINE / "data" / "web_models" / "birdnet_empreinte.tflite", SORTIE / "birdnet.tflite")
    print(f"{len(especes)} espèces, {sum(p['photo'] is not None for p in liste)} avec photo, "
          f"{len(pays)} pays, poids BirdNET {w}")


if __name__ == "__main__":
    main(sys.argv[1])
