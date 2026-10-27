"""L'« oreille » pré-entraînée : BirdNET V2.4 (TFLite).

Découpe un son en tranches de 3 s à 48 kHz et renvoie, pour chaque tranche,
l'empreinte (1024 nombres) et les scores BirdNET (6522 classes).
"""
from pathlib import Path

import numpy as np

try:
    from ai_edge_litert.interpreter import Interpreter, OpResolverType
except ImportError:   # Windows : pas de paquet ai-edge-litert, on passe par TensorFlow
    import tensorflow as tf
    Interpreter, OpResolverType = tf.lite.Interpreter, tf.lite.experimental.OpResolverType

RACINE = Path(__file__).resolve().parents[1]
NOM_MODELE = "BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite"


def chemin_modele():
    """Le modèle BirdNET : dans data/models, sinon celui livré avec le paquet birdnetlib."""
    local = RACINE / "data" / "models" / NOM_MODELE
    if local.exists():
        return local
    import birdnetlib
    return Path(birdnetlib.__file__).parent / "models" / "analyzer" / NOM_MODELE
FREQ = 48000
TRANCHE = 3 * FREQ


class Oreille:
    def __init__(self, threads=1):
        # Sans le délégué XNNPACK, l'empreinte (couche intermédiaire) reste lisible après le calcul,
        # pour ~20 % de vitesse en moins (≈ 30x le temps réel par processeur)
        self.it = Interpreter(model_path=str(chemin_modele()), num_threads=threads,
                              experimental_op_resolver_type=OpResolverType.BUILTIN_WITHOUT_DEFAULT_DELEGATES)
        self.it.allocate_tensors()
        self.entree = self.it.get_input_details()[0]["index"]
        sortie = self.it.get_output_details()[0]["index"]
        self.i_scores, self.i_empreinte = sortie, sortie - 1

    def tranches(self, son, pas=TRANCHE):
        """Coupe un signal mono 48 kHz en tranches de 3 s (la dernière complétée par du silence)."""
        if len(son) < TRANCHE:
            son = np.pad(son, (0, TRANCHE - len(son)))
        debuts = range(0, max(len(son) - TRANCHE, 0) + 1, pas)
        return np.stack([son[d:d + TRANCHE] for d in debuts]).astype(np.float32)

    def ecouter(self, tranches):
        """Renvoie (empreintes [n, 1024], scores [n, 6522]) pour un lot de tranches."""
        n = len(tranches)
        self.it.resize_tensor_input(self.entree, [n, TRANCHE])
        self.it.allocate_tensors()
        self.it.set_tensor(self.entree, tranches)
        self.it.invoke()
        return self.it.get_tensor(self.i_empreinte).copy(), self.it.get_tensor(self.i_scores).copy()
