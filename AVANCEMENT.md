# Avancement

Démarré le 27/10/2026. Budget : 98 $, 7 jours maximum. Estimation : 2 à 3 jours.

| Étape | État |
|---|---|
| 0. Dépôt, plan, outils | ✅ fait |
| 1. Espèces d'Europe (755) avec noms français (liste IOC 15.2) | ✅ fait |
| 2-3. 50 674 enregistrements xeno-canto écoutés par BirdNET (jusqu'à 120 par espèce) | ✅ fait |
| 4. Modèle Europe `europe_v1` | ✅ fait |
| 5. Évaluation et comparaison avec BirdNET | ✅ fait |
| 6. Application web en ligne, sans serveur (https://birdlistener.vercel.app), identité « Huppe » | ✅ fait |
| 7. Modèle monde `monde_v1` (10 281 espèces), en ligne dans l'app | ✅ fait |
| 8. Filtre pays et saison, photos, carte partagée, écoute continue, guide, jeu | ✅ fait (photos en cours) |

## Résultats `europe_v1` (746 espèces)

Test sur 8 629 enregistrements d'auteurs **jamais entendus** pendant l'entraînement.

| | Bonne réponse en 1er | Moyenne par espèce | Espèces connues de BirdNET |
|---|---|---|---|
| BirdNET seul (limité aux mêmes espèces) | 69,6 % | 60,8 % | 73,3 % |
| BirdListener seul | 74,4 % | 66,4 % | 75,7 % |
| **Combinaison (utilisée par l'application)** | **76,0 %** | **68,3 %** | **77,8 %** |

Bonne réponse dans les 5 premières : 87,5 % (BirdListener seul).
Le poids de la combinaison a été choisi sur ce même test : chiffre un peu optimiste, à corriger en v2.

Espèces courantes : Rougegorge familier 94 %, Pinson des arbres 94 %, Pouillot véloce 94 %,
Pouillot fitis 94 %, Chouette hulotte 100 %, Coucou gris 83 %, Merle noir 82 %,
Mésange charbonnière 78 %, Vautour fauve 78 % (environ 18 enregistrements de test chacune).

Plus difficiles : oiseaux marins (puffins, guillemots), Gypaète barbu, espèces rares en Europe
avec peu d'enregistrements.

## Utiliser l'application

```
git clone https://github.com/albangerschheimer/BirdListener
cd BirdListener
python -m venv .venv
.venv/bin/pip install -r requirements.txt      # Windows : .venv\Scripts\pip
.venv/bin/python app.py                        # puis ouvrir http://localhost:5000
```

## Journal

- **27/10** : dépôt créé. L'oreille pré-entraînée (BirdNET) est récupérable via PyPI.
  Les sites xeno-canto.org et huggingface.co sont encore refusés par le réseau de la session cloud.
- **27/10, après-midi** : réseau débloqué. BirdNET tourne à ~30x le temps réel par processeur.
  Pipeline complet en place (`scripts/pipeline.sh`) : métadonnées → sélection → empreintes → entraînement.
  Premier essai sur 15 espèces : 92 % de bonnes réponses sur des auteurs jamais entendus.
- **27/10, 18 h** : le conteneur cloud s'endort quand aucune tâche n'est suivie par la session ;
  les calculs sont maintenant lancés comme tâches suivies, et tout reprend où ça s'était arrêté.
  Application web locale prête (`python app.py`), et script de comparaison avec BirdNET.
  Essai sur 81 espèces (4 passes seulement) : BirdListener 71 %, BirdNET seul 68,5 %.
- **28/10, 3 h** : 50 674 enregistrements écoutés, modèle `europe_v1` entraîné en 35 min.
  BirdListener bat BirdNET seul (74,4 % contre 69,6 %), la combinaison des deux atteint 76 %.
  Application testée dans un navigateur : Merle noir reconnu en 1er. Détection « pas d'oiseau entendu ».
- **28/10, après-midi** : application web autonome en ligne sur https://birdlistener.vercel.app
  (BirdNET exécuté dans le navigateur avec LiteRT.js, hors ligne, installable sur iPhone).
  Photos d'espèces depuis Wikimedia Commons (en cours). Écoute du monde entier en cours
  (10 458 espèces sélectionnées ; xeno-canto lent par moments).
- **28/10, soir** : identité définitive « Huppe » : logo huppe à crête en éventail, couleurs de terrain
  (olive, orange rubalise, aluminium, lichen), police Big Shoulders, anneau d'écoute zébré,
  ouverture animée (huppe en vol qui se pose et ouvre sa crête), libellés en phrases simples,
  carnet des dernières écoutes. Pistes explorées dans Figma : pages V2 et V3.
- **28/10, nuit** : logo et couleurs fournis (forêt, gorge or, crème, feuillage, ardoise), ouverture
  avec l'oiseau du logo qui s'envole, passable d'un toucher. Nouveautés de l'app :
  - **Carte partagée** (Vercel Blob) : position arrondie à ~1 km, sans identifiant, me localiser,
    espèces autour de moi (10 km), filtres 30 jours / 7 jours / les miennes, zoom sur un groupe.
  - **Écoute continue** : analyse toutes les 3 s pendant une balade, espèces ajoutées en direct ;
    **spectrogramme** défilant pendant toute écoute.
  - **Onglet Espèces** : guide des 746 espèces (présentes ce mois-ci ou A à Z, recherche), chant de
    référence xeno-canto pour 743 espèces, fiches dans un panneau, jeu **« Quel est ce chant ? »**.
  - **Mes espèces** (collection), carnet, partage d'une **image** de l'observation.
- **29-30/10** : modèle monde `monde_v1` entraîné sur 272 600 enregistrements (10 281 espèces).
  Test sur 51 793 enregistrements d'auteurs jamais entendus : 57,0 % seul, 60,7 % avec BirdNET,
  **66,5 %** avec le filtre pays + mois (BirdNET seul : 54,9 %). Sur les espèces d'Europe, dans les
  conditions de l'app, il fait mieux que le modèle Europe (72,1 % contre 71,0 %) : il le remplace.
  L'app reconnaît maintenant les oiseaux du monde entier ; 9 910 espèces ont un chant de référence.
