# BirdListener

IA qui reconnaît les oiseaux à leurs chants et à leurs cris.
Priorité : la France, puis toute l'Europe, puis une base élargie autant que possible.

## Principe

1. **Oreille pré-entraînée** : un modèle déjà entraîné sur des milliers d'espèces
   (BirdNET, livré via `birdnetlib`) transforme 3 s de son en une « empreinte » numérique.
2. **Classifieur BirdListener** : entraîné ici sur les enregistrements de
   [xeno-canto](https://xeno-canto.org), avec les noms français et le type de son
   (chant ou cri).
3. **Évaluation** sur des enregistrements jamais entendus, et comparaison avec BirdNET seul.
4. **Page web** : enregistrer au micro ou déposer un fichier pour obtenir l'espèce.

Voir [AVANCEMENT.md](AVANCEMENT.md) pour l'état du projet.

## Crédits

Les enregistrements viennent de xeno-canto (licences Creative Commons, auteurs crédités
dans `data/metadata`). BirdNET : K. Lab of Ornithology / TU Chemnitz, licence CC BY-NC-SA 4.0,
usage non commercial uniquement.
