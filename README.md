# FAC Transcript

Application Electron personnelle pour enregistrer et transcrire des cours longs sans garder l’audio en mémoire.

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

```powershell
npm run build
npm run package:win
```

Le paquet Windows est produit dans `dist/`. Le script macOS cible Apple Silicon avec `npm run package:mac` ; il doit être exécuté sur macOS pour produire et signer le DMG.

## Providers

### Whisper local

Dans Réglages, choisir « Whisper local » puis « Télécharger ». L’application :

1. interroge la dernière release `ggml-org/whisper.cpp` ;
2. préfère une archive CUDA/cuBLAS x64 sous Windows et conserve les DLL voisines ;
3. télécharge `ggml-large-v3-turbo-q5_0.bin` et le modèle Silero VAD ;
4. stocke ces fichiers dans le dossier `userData` Electron, jamais dans l’archive de l’app.

En l’absence d’asset CUDA correspondant, le binaire CPU x64 est utilisé comme repli.

### Nettoyage CLI

Le provider choisi doit être installé et authentifié dans le `PATH` :

- Claude Code : `claude -p --output-format json`
- Codex : `codex exec --json --sandbox read-only`

Les commandes sont lancées depuis le dossier temporaire système, et la transcription est transmise sur stdin.

### Notion

L’intégration Notion doit avoir accès à la page ou à la base parente. Renseigner le token interne, le type de parent et son ID. Pour une base, l’application détecte automatiquement la propriété de titre.

## Données

SQLite, les réglages et les assets sont dans `app.getPath('userData')`. Les tokens OpenAI et Notion sont chiffrés avec `safeStorage` lorsque le système le permet. Le dossier audio est configurable. Le fichier capturé reste la source de vérité ; le WAV et les transcriptions sont toujours régénérables.
