#!/usr/bin/env bash
# Enchaîne : métadonnées d'une zone → sélection → empreintes → entraînement.
# Usage : scripts/pipeline.sh <max_par_espece> <nom_modele> <zone> [<zone> ...]
# Reprend où il s'était arrêté : chaque étape saute ce qui est déjà fait.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
MAXI=$1; NOM=$2; shift 2
mkdir -p data/logs

# Attendre la fin de tout téléchargement de métadonnées ou d'empreintes déjà lancé
while pgrep -f "fetch_metadata.py|build_embeddings.py" > /dev/null; do sleep 30; done

for zone in "$@"; do
  $PY scripts/fetch_metadata.py "$zone" >> "data/logs/meta_$zone.log" 2>&1
done
$PY scripts/select_recordings.py "$MAXI" "$@"
$PY scripts/build_embeddings.py data/selection.csv 4 2>&1 | grep -v INFO >> data/logs/emb.log
$PY scripts/train.py "$NOM" > "data/logs/train_$NOM.log" 2>&1
echo "pipeline terminé : $NOM"
