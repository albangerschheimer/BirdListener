#!/usr/bin/env bash
# Récupère des photos pendant ~1 h 55 dans un dossier d'attente (hors dépôt), puis les verse
# dans webapp/photos, met à jour l'app web et pousse sur GitHub en une seule fois.
set -uo pipefail
cd "$(dirname "$0")/.."
ATTENTE=data/photos_attente
mkdir -p "$ATTENTE"
cp webapp/photos/credits.json "$ATTENTE/credits.json"
PHOTOS_DOSSIER="$ATTENTE" timeout 6900 .venv/bin/python scripts/fetch_photos.py europe >> data/logs/photos.log 2>&1
cp "$ATTENTE"/*.jpg webapp/photos/ 2>/dev/null
cp "$ATTENTE/credits.json" webapp/photos/credits.json
rm -f "$ATTENTE"/*.jpg
.venv/bin/python scripts/export_web.py monde_v1 | tail -1
git add webapp/photos webapp/modele/meta.json
git commit -qm "Photos d'espèces : nouvel arrivage" && git push -q 2>&1 | grep -v "^remote:"
tail -1 data/logs/photos.log
