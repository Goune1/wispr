# Changelog

Toutes les modifications notables de FAC Transcript sont documentées ici.

## [0.3.0] - 2026-09-10

### Added

- Modale de préparation à l’ouverture d’un enregistrement : nom du cours et matière obligatoires, date attachée automatiquement.
- Modale de fin d’enregistrement permettant de lancer la transcription et le nettoyage tout de suite ou plus tard.
- Matière associée à chaque cours, affichée dans la bibliothèque et transmise au prompt de fiche de révision.
- Pause et reprise pendant un enregistrement, sans que le temps en pause n’allonge la durée du cours.
- Barre de recherche insensible aux accents, à la casse et à l’ordre des mots sur la page d’accueil.
- Tri par matière ne proposant que les matières portées par un enregistrement existant.

### Changed

- Un enregistrement terminé ne lance plus la chaîne de traitement automatiquement : le cours attend la décision de l’utilisateur et peut être traité depuis sa fiche.

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
