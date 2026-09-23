# FAC Transcript

Application Electron personnelle pour enregistrer et transcrire des cours longs sans garder l’audio en mémoire.

## Branches de distribution

- `windows` : version Windows x64 et installeur NSIS `.exe`.
- `macos` : version macOS Apple Silicon et installeur `.dmg`, avec Whisper natif ARM64/Metal.
- `main` : historique de la première version Windows.

Les installateurs sont publiés dans les releases GitHub.

## Mises à jour de l’application

L’application installée vérifie les releases de `Goune1/wispr` au démarrage, puis toutes les six heures. Une nouvelle version est proposée dans l’application ; son téléchargement et le redémarrage pour l’installer restent à l’initiative de l’utilisateur. Le bouton **Réglages > Mises à jour > Vérifier** permet aussi de lancer une recherche manuelle. Cette fonction est désactivée pendant le développement local.

Pour publier une version mise à jour :

1. Définir la nouvelle version dans `package.json` et `package-lock.json`, puis pousser le code sur le dépôt.
2. Pour activer les mises à jour automatiques macOS, configurer les secrets GitHub Actions `MAC_CSC_LINK` (certificat Developer ID Application `.p12` encodé en base64), `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` et `APPLE_TEAM_ID`.
3. Créer et pousser un tag `vX.Y.Z` correspondant exactement à la version du paquet. Le workflow `.github/workflows/release.yml` construit uniquement macOS et crée une release brouillon. Avec les secrets Apple, il publie un DMG signé et notarisé, un ZIP et `latest-mac.yml` ; sans eux, il publie seulement le DMG non signé pour installation manuelle.
4. Vérifier le brouillon puis publier la release. Les applications déjà installées avec ce système de mise à jour détecteront alors la nouvelle version.

La release `v0.3.0` ne contient qu’un DMG et ne possède pas les métadonnées de mise à jour. Une installation manuelle de la première version contenant ce système est donc nécessaire. Sur macOS, une application non signée ne peut pas installer de mise à jour automatique.

## État de la V1

- Capture microphone `MediaRecorder` en WebM/Opus, envoyée par chunks au main process.
- Écriture continue sur disque, puis conversion WAV PCM 16 kHz mono avec `ffmpeg-static`.
- Persistance SQLite des cours, statuts, erreurs, transcriptions et réglages.
- Whisper local par `whisper-cli`, ou transcription OpenAI avec découpage automatique sous la limite de taille.
- Nettoyage séquentiel et fiches de révision par `claude -p` ou `codex exec`, avec sélection du modèle détecté dans la CLI installée.
- Vue Cours complet/Fiche de révision, source technique secondaire, copie, export `.md` et export Notion par lots de 100 blocks.
- Import d’un fichier audio existant, retranscription et renettoyage à volonté.
- Reprise après crash : les traitements interrompus passent en erreur au redémarrage, l’audio reste intact.

## Développement

Prérequis : Node.js 22 ou plus récent.

```powershell
npm install
npm run dev
```

Sur certains environnements d’agents, `ELECTRON_RUN_AS_NODE=1` peut être défini. Il faut le retirer avant de lancer Electron :

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
```

## Build

### Windows

```powershell
npm run build
npm run package:win
```

Le paquet Windows est produit dans `dist/`. La stratégie CUDA/cuBLAS et le repli CPU x64 existants restent inchangés.

### macOS Apple Silicon (arm64)

Le DMG doit être construit sur un Mac Apple Silicon : le binaire `whisper-cli` n’est pas publié par whisper.cpp pour macOS arm64 et est compilé localement avant le packaging.

**Prérequis** : macOS arm64, Node.js 22+, Xcode Command Line Tools (`xcode-select --install`), Git et CMake (`brew install cmake`). Ouvrir ensuite un terminal dans le dépôt :

```bash
npm ci
npm run prepare:whisper:mac
npm run dev
```

`prepare:whisper:mac` clone la révision épinglée `whisper.cpp` `v1.9.2` (commit `306c88f4d1286aec1bf96e544632897886af5501`, vérifié par le script), construit `whisper-cli` arm64 avec Metal embarqué (`GGML_METAL=ON`) et bibliothèques statiques, puis le pose dans `vendor/whisper.cpp/darwin-arm64/`. En développement, l’application lit ce dossier ; s’il manque, le bouton Whisper affiche la commande de préparation à exécuter.

Pour créer un DMG arm64 non signé :

```bash
npm run package:mac
```

Cette commande régénère le binaire vendor et produit le DMG dans `dist/`. `electron-builder` copie le binaire et les éventuels sidecars Metal dans `Contents/Resources/vendor/...`; au premier téléchargement Whisper, l’application les copie dans `userData/runtime/whisper.cpp`, applique `chmod 755`, puis télécharge les deux modèles dans `userData/runtime/models`.

Au premier enregistrement, macOS demande l’accès au microphone. La description `NSMicrophoneUsageDescription` est incluse dans l’application ; l’autorisation se gère dans **Réglages Système > Confidentialité et sécurité > Microphone**. Un DMG non signé déclenche Gatekeeper : utilisez clic droit > Ouvrir pour un test local. Il ne doit pas être distribué comme produit final : une distribution publique requiert un certificat Developer ID, la signature avec hardened runtime/entitlements adaptés et une notarisation Apple, qui ne sont volontairement pas configurés ici.

## Providers

### Whisper local

Dans Réglages, choisir « Whisper local » puis « Télécharger ». L’application :

1. sous Windows, interroge la dernière release `ggml-org/whisper.cpp` et préfère une archive CUDA/cuBLAS x64 (avec repli CPU) ;
2. sous macOS Apple Silicon, copie le `whisper-cli` Metal embarqué par `prepare:whisper:mac` vers `userData` ;
3. télécharge `ggml-large-v3-turbo-q5_0.bin` et le modèle Silero VAD ;
4. stocke les exécutables et modèles actifs dans le dossier `userData` Electron, jamais dans l’archive de l’app.

Sous macOS, si la ressource vendor est absente en développement, exécuter `npm run prepare:whisper:mac` sur le Mac avant de cliquer « Télécharger ».

### Nettoyage CLI

Le provider choisi doit être installé et authentifié dans le `PATH` :

- Claude Code : `claude -p --output-format json`
- Codex : `codex exec --json --sandbox read-only`

Les commandes sont lancées depuis le dossier temporaire système, et la transcription est transmise sur stdin.

### Notion

L’intégration Notion doit avoir accès à la page ou à la base parente. Renseigner le token interne, le type de parent et son ID. Pour une base, l’application détecte automatiquement la propriété de titre.

## Données

SQLite, les réglages et les assets sont dans `app.getPath('userData')`. Les tokens OpenAI et Notion sont chiffrés avec `safeStorage` lorsque le système le permet. Le dossier audio est configurable. Le fichier capturé reste la source de vérité ; le WAV et les transcriptions sont toujours régénérables.
