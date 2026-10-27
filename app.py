"""Application BirdListener : ouvrir http://localhost:5000 puis enregistrer ou déposer un son.

Usage : python app.py [nom_du_modele]
Le navigateur décode et rééchantillonne le son à 48 kHz ; le serveur reçoit le signal brut.
"""
import sys
from pathlib import Path

import numpy as np
from flask import Flask, jsonify, request, send_from_directory

RACINE = Path(__file__).resolve().parent
sys.path.insert(0, str(RACINE / "src"))
from predicteur import Predicteur  # noqa: E402

app = Flask(__name__)
predicteur = Predicteur(sys.argv[1] if len(sys.argv) > 1 else "europe_v1")
DUREE_MAX = 5 * 60 * 48000   # 5 minutes au plus


@app.get("/")
def accueil():
    return send_from_directory(RACINE / "web", "index.html")


@app.post("/predire")
def predire():
    son = np.frombuffer(request.get_data(), dtype=np.float32)[:DUREE_MAX]
    if len(son) < 24000:
        return jsonify({"erreur": "Son trop court (au moins une demi-seconde)."}), 400
    return jsonify(predicteur.predire(son))


if __name__ == "__main__":
    print("BirdListener : ouvre http://localhost:5000 dans ton navigateur")
    app.run(host="127.0.0.1", port=5000)
