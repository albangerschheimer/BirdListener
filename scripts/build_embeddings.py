"""Télécharge chaque enregistrement choisi, le fait écouter par l'oreille, puis efface le son.

Usage : python scripts/build_embeddings.py data/selection.csv [nb_processus] [secondes_max] [connexions]
Pour chaque enregistrement XC<id> : data/emb/<id>.npz avec
  emb    : empreintes float16 [n_tranches, 1024]
  top_i / top_s : les 10 meilleures classes BirdNET et leurs scores, par tranche
Reprend où il s'était arrêté (les fichiers déjà faits sont sautés).
"""
import csv
import subprocess
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import requests

RACINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RACINE / "src"))
from oreille import FREQ, Oreille  # noqa: E402

DUREE_MAX = int(sys.argv[3]) if len(sys.argv) > 3 else 60   # secondes écoutées par enregistrement
SORTIE = RACINE / "data" / "emb"
_oreille = None


def telecharger(xc_id):
    """Télécharge seulement le début du fichier : de quoi couvrir DUREE_MAX secondes d'un MP3
    à 320 kbit/s (le serveur ne gère pas les téléchargements partiels, on coupe la connexion)."""
    url = f"https://xeno-canto.org/{xc_id}/download"
    limite = DUREE_MAX * 40_000
    for essai in range(4):
        try:
            with requests.get(url, timeout=120, stream=True) as r:
                if r.status_code == 404:
                    return b""          # enregistrement supprimé : définitif
                if r.status_code == 200:
                    contenu = bytearray()
                    for morceau in r.iter_content(65536):
                        contenu += morceau
                        if len(contenu) >= limite:
                            break
                    if len(contenu) > 1000:
                        return bytes(contenu)
        except requests.RequestException:
            pass
        time.sleep(2 ** essai)
    return None                         # échec réseau : on réessaiera au prochain passage


def decoder(contenu):
    """Décode n'importe quel format audio en mono 48 kHz (60 premières secondes) avec ffmpeg."""
    p = subprocess.run(["ffmpeg", "-v", "quiet", "-i", "pipe:0", "-t", str(DUREE_MAX), "-ac", "1",
                        "-ar", str(FREQ), "-f", "f32le", "pipe:1"], input=contenu, capture_output=True)
    return np.frombuffer(p.stdout, dtype=np.float32) if p.returncode == 0 else None


def traiter(xc_id):
    contenu = telecharger(xc_id)
    if contenu is None:
        return xc_id, 0
    global _oreille
    if _oreille is None:
        _oreille = Oreille(threads=1)
    son = decoder(contenu) if contenu else None
    if son is None or len(son) < FREQ // 2:
        (SORTIE / f"{xc_id}.vide").touch()
        return xc_id, 0
    tranches = _oreille.tranches(son)
    emb, scores = [], []
    for k in range(0, len(tranches), 10):
        e, s = _oreille.ecouter(tranches[k:k + 10])
        emb.append(e)
        scores.append(s)
    emb, scores = np.concatenate(emb), np.concatenate(scores)
    top_i = np.argsort(-scores, axis=1)[:, :10].astype(np.int16)
    top_s = np.take_along_axis(scores, top_i.astype(np.int64), axis=1).astype(np.float16)
    np.savez(SORTIE / f"{xc_id}.npz", emb=emb.astype(np.float16), top_i=top_i, top_s=top_s)
    return xc_id, len(tranches)


def main(selection, nb=4):
    SORTIE.mkdir(parents=True, exist_ok=True)
    faits = {p.stem for p in SORTIE.iterdir()}
    ids = [r["id"] for r in csv.DictReader(open(selection)) if r["id"] not in faits]
    print(f"{len(ids)} enregistrements à traiter ({len(faits)} déjà faits)", flush=True)
    debut, n = time.time(), 0
    # Chaque processus télécharge puis écoute. xeno-canto envoie lentement chaque fichier
    # (~16 s pour 2 Mo) : on en télécharge 4 fois plus que de processeurs en même temps
    with Pool(int(sys.argv[4]) if len(sys.argv) > 4 else nb * 4) as calcul:
        for xc_id, nt in calcul.imap_unordered(traiter, ids, chunksize=1):
            n += 1
            if n % 100 == 0:
                vitesse = n / (time.time() - debut) * 3600
                print(f"{n}/{len(ids)}  ({vitesse:.0f}/h, reste {(len(ids) - n) / vitesse:.1f} h)", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 4)
