#!/bin/bash
# Fabrique BirdListener.ipa, non signé (SideStore ou AltStore le signent à l'installation).
# Demande un Mac avec Xcode ; le projet Xcode est régénéré à chaque fois depuis webapp/.
set -euo pipefail
cd "$(dirname "$0")"

npm ci
npm run www
rm -rf ios build Payload BirdListener.ipa
npx cap add ios

ASSETS=ios/App/App/Assets.xcassets
cp icone.png "$ASSETS/AppIcon.appiconset/AppIcon-512@2x.png"
for f in "$ASSETS"/Splash.imageset/*.png; do cp fond.png "$f"; done

PLIST=ios/App/App/Info.plist
reglage() { /usr/libexec/PlistBuddy -c "$1" "$PLIST"; }
reglage "Add :NSMicrophoneUsageDescription string 'BirdListener écoute les oiseaux. Le son reste sur le téléphone.'"
reglage "Add :NSLocationWhenInUseUsageDescription string 'Pour placer tes observations sur la carte, si tu choisis de les partager.'"
reglage "Add :UIBackgroundModes array"
reglage "Add :UIBackgroundModes:0 string audio"
reglage "Add :UIUserInterfaceStyle string Light"
reglage "Delete :UIRequiredDeviceCapabilities"
reglage "Delete :UISupportedInterfaceOrientations"
reglage "Add :UISupportedInterfaceOrientations array"
reglage "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait"

xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -sdk iphoneos \
  -destination generic/platform=iOS -derivedDataPath build \
  CURRENT_PROJECT_VERSION="${GITHUB_RUN_NUMBER:-1}" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build

mkdir Payload
cp -R build/Build/Products/Release-iphoneos/App.app Payload/
# le paquet doit contenir l'app web, le modèle et l'autorisation du micro
test -f Payload/App.app/public/index.html
test -f Payload/App.app/public/modele/birdnet.tflite
test ! -e Payload/App.app/public/api
/usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" Payload/App.app/Info.plist
zip -qry BirdListener.ipa Payload
ls -lh BirdListener.ipa
