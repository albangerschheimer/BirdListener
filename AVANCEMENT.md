# Avancement

Démarré le 27/10/2026. Budget : 98 $, 7 jours maximum. Estimation : 2 à 3 jours.

| Étape | État |
|---|---|
| 0. Dépôt, plan, outils | ✅ fait |
| 1. Liste des espèces : Europe (769 espèces, 426 725 enregistrements sur xeno-canto), noms français (liste mondiale IOC 15.2, 11 227 espèces) | 🔄 métadonnées en cours |
| 2. Téléchargement des sons xeno-canto (jusqu'à 120 par espèce, en alternant les auteurs) | 🔄 en cours, ~7 800/h |
| 3. Empreintes audio avec l'oreille pré-entraînée (BirdNET V2.4) | 🔄 en cours (sons effacés après écoute) |
| 4. Entraînement du classifieur BirdListener | ✅ testé sur 15 espèces (92 % au test), version Europe à venir |
| 5. Évaluation (sons jamais entendus) + comparaison avec BirdNET | ⏳ |
| 6. Page web (micro / fichier) | ⏳ |
| 7. (option) Version allégée ESP32 | ⏳ |

## Journal

- **27/10** : dépôt créé. L'oreille pré-entraînée (BirdNET) est récupérable via PyPI.
  Les sites xeno-canto.org et huggingface.co sont encore refusés par le réseau de la session cloud.
- **27/10, après-midi** : réseau débloqué. BirdNET tourne à ~30x le temps réel par processeur.
  Pipeline complet en place (`scripts/pipeline.sh`) : métadonnées → sélection → empreintes → entraînement.
  Premier essai sur 15 espèces : 92 % de bonnes réponses sur des auteurs jamais entendus.
