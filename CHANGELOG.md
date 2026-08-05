# Changelog

Toutes les modifications notables de FAC Transcript sont documentées ici.

## [0.1.0] - 2026-08-05

### Added

- Enregistrement continu de cours longs depuis le microphone et import de fichiers audio existants.
- Transcription locale accélérée par CUDA avec Whisper.cpp, avec alternative OpenAI.
- Nettoyage fidèle des transcriptions et génération de fiches de révision via Claude Code ou Codex.
- Sélection du modèle utilisé par les CLI Claude Code et Codex.
- Affichage Markdown, renommage, copie, export `.md` et envoi vers Notion.
- Indicateur animé `connecting` pendant la transcription, le nettoyage et la création des fiches.
- Conservation systématique de l’audio source et relance indépendante des traitements en erreur.

### Fixed

- Réparation automatique des chemins Whisper déjà présents sur disque.
- Détection et installation du runtime cuBLAS nécessaire aux builds CUDA Windows.
- Messages actionnables pour les expirations OAuth et les limites de requêtes Claude Code.
- Consignes empêchant les providers de renvoyer le Markdown dans un bloc de code global.
