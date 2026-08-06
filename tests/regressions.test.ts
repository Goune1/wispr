import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AssetManager, preserveManagedAssetPaths, provisionBundledWhisper, requiredCublasDll } from '../src/main/asset-manager.ts'
import { formatClaudeCliError } from '../src/main/cli-errors.ts'
import { buildStudyPrompt } from '../src/main/study-prompt.ts'
import { buildCleanupPrompt } from '../src/main/cleanup-prompt.ts'
import { parseClaudeModelAliases, parseCodexModelCatalog } from '../src/main/model-catalog-parsers.ts'
import { selectWhisperBinarySource } from '../src/main/whisper-platform.ts'
import { cliExecutionPath, resolveCliExecutable } from '../src/main/cli-path.ts'
import { selectRecordingFormat } from '../src/renderer/src/recording-format.ts'
import { recordingExtensionFor } from '../src/main/recording-service.ts'
import type { AppSettings } from '../src/shared/types.ts'

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    sttProvider: 'local-whisper', cleanupProvider: 'claude-code', claudeModel: '', codexModel: '', openaiApiKey: '', notionToken: '',
    notionParentId: '', notionParentType: 'page_id', audioStoragePath: 'audio', whisperBinaryPath: '',
    whisperModelPath: '', whisperVadModelPath: '', ...overrides
  }
}

test('les réglages du renderer ne peuvent pas effacer les chemins Whisper gérés par le main process', () => {
  const current = settings({ whisperBinaryPath: 'whisper.exe', whisperModelPath: 'model.bin', whisperVadModelPath: 'vad.bin' })
  const merged = preserveManagedAssetPaths(current, settings({ audioStoragePath: 'nouveau-dossier' }))
  assert.equal(merged.audioStoragePath, 'nouveau-dossier')
  assert.equal(merged.whisperBinaryPath, 'whisper.exe')
  assert.equal(merged.whisperModelPath, 'model.bin')
  assert.equal(merged.whisperVadModelPath, 'vad.bin')
})

test('AssetManager répare une installation présente sur disque mais absente de SQLite', () => {
  const root = join(tmpdir(), `fac-assets-${process.pid}-${Date.now()}`)
  const binary = join(root, 'whisper.cpp', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')
  const model = join(root, 'models', 'ggml-large-v3-turbo-q5_0.bin')
  const vad = join(root, 'models', 'ggml-silero-v6.2.0.bin')
  mkdirSync(join(root, 'whisper.cpp'), { recursive: true })
  mkdirSync(join(root, 'models'), { recursive: true })
  for (const path of [binary, model, vad]) writeFileSync(path, 'test')
  let stored = settings()
  const database = {
    getSettings: () => stored,
    saveSettings: (value: AppSettings) => (stored = value)
  }
  try {
    const status = new AssetManager(database as never, root, () => undefined).status()
    assert.deepEqual([status.binaryReady, status.modelReady, status.vadReady], [true, true, true])
    assert.equal(stored.whisperBinaryPath, binary)
    assert.equal(stored.whisperModelPath, model)
    assert.equal(stored.whisperVadModelPath, vad)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('une expiration OAuth Claude devient une instruction courte et actionnable', () => {
  const payload = JSON.stringify({ is_error: true, terminal_reason: 'api_error', result: 'Failed to authenticate: OAuth session expired and could not be refreshed' })
  const message = formatClaudeCliError(new Error(`claude s’est arrêté avec le code 1. ${payload}`))
  assert.match(message, /claude auth login/)
  assert.match(message, /sources et documents déjà produits sont conservés/)
  assert.doesNotMatch(message, /session_id|duration_api_ms/)
})

test('une archive CUDA incomplète déclenche le téléchargement du bon runtime cuBLAS', () => {
  assert.equal(requiredCublasDll(['whisper-cli.exe', 'ggml-cuda.dll', 'cudart64_110.dll']), 'cublas64_11.dll')
  assert.equal(requiredCublasDll(['ggml-cuda.dll', 'cudart64_12.dll']), 'cublas64_12.dll')
  assert.equal(requiredCublasDll(['ggml-cuda.dll', 'cudart64_110.dll', 'cublas64_11.dll']), null)
  assert.equal(requiredCublasDll(['whisper-cli.exe']), null)
})

test('le prompt de fiche autorise la synthèse mais interdit les références inventées', () => {
  const prompt = buildStudyPrompt('Droit des sociétés', 'Le professeur cite l’article 1832 du Code civil.')
  assert.match(prompt, /synthétiser, reformuler et condenser/)
  assert.match(prompt, /N’invente jamais/)
  assert.match(prompt, /À vérifier/)
  assert.match(prompt, /# Droit des sociétés/)
  assert.match(prompt, /article 1832/)
  assert.match(prompt, /N’entoure jamais la réponse avec ```markdown/)
})

test('les prompts de nettoyage interdisent une enveloppe de bloc de code', () => {
  const prompt = buildCleanupPrompt('Texte brut', 1, 1)
  assert.match(prompt, /N’entoure jamais la réponse avec ```markdown/)
  assert.match(prompt, /La réponse doit commencer directement par le contenu du document/)
})

test('les catalogues des CLI sont réduits à des options de modèles sûres pour le renderer', () => {
  const codex = parseCodexModelCatalog(JSON.stringify({ models: [
    { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', description: 'Polished', visibility: 'list' },
    { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hide' }
  ] }))
  assert.deepEqual(codex, [{ id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', description: 'Polished' }])

  const claude = parseClaudeModelAliases("Provide an alias for the latest model (e.g.\n'fable', 'opus', or 'sonnet') or a\nmodel's full name")
  assert.deepEqual(claude.map((model) => model.id), ['fable', 'opus', 'sonnet', 'haiku'])
})

test('macOS Apple Silicon sélectionne le binaire Whisper embarqué plutôt qu’un asset GitHub absent', () => {
  const source = selectWhisperBinarySource('darwin', 'arm64', [
    { name: 'whisper-bin-x64.zip', browser_download_url: 'https://example.invalid/x64.zip' },
    { name: 'whisper-bin-ubuntu-arm64.zip', browser_download_url: 'https://example.invalid/linux.zip' }
  ])
  assert.deepEqual(source, { kind: 'bundled', binaryName: 'whisper-cli' })
})

test('Windows conserve la préférence CUDA puis le repli CPU pour Whisper', () => {
  const source = selectWhisperBinarySource('win32', 'x64', [
    { name: 'whisper-bin-x64.zip', browser_download_url: 'https://example.invalid/cpu.zip' },
    { name: 'whisper-bin-x64-cuda.zip', browser_download_url: 'https://example.invalid/cuda.zip' }
  ])
  assert.equal(source.kind, 'release')
  if (source.kind === 'release') assert.equal(source.asset.name, 'whisper-bin-x64-cuda.zip')
})

test('le provisionnement macOS copie et rend exécutable le binaire vendor', () => {
  const root = join(tmpdir(), `fac-vendor-${process.pid}-${Date.now()}`)
  const source = join(root, 'source')
  const destination = join(root, 'runtime')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'whisper-cli'), '#!/bin/sh\nexit 0\n')
  try {
    const binary = provisionBundledWhisper(source, destination)
    assert.equal(binary, join(destination, 'whisper-cli'))
    assert.equal(existsSync(binary), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('la résolution CLI macOS trouve Homebrew sans shell', () => {
  const resolved = resolveCliExecutable('codex', {
    platform: 'darwin', home: '/Users/ada', path: '/usr/bin', exists: (path) => path === '/opt/homebrew/bin/codex'
  })
  assert.equal(resolved, '/opt/homebrew/bin/codex')
})

test('le PATH d’exécution conserve le runtime Node voisin d’une CLI installée par nvm', () => {
  const executable = '/Users/ada/.nvm/versions/node/v22.0.0/bin/claude'
  const path = cliExecutionPath(executable, '/usr/bin', '/Users/ada')
  assert.equal(path.split(':')[0], '/Users/ada/.nvm/versions/node/v22.0.0/bin')
})

test('la capture préfère AAC dans MP4 lorsque Chromium le prend en charge', () => {
  const recording = selectRecordingFormat((mime) => mime === 'audio/mp4;codecs=mp4a.40.2')
  assert.deepEqual(recording, { mimeType: 'audio/mp4;codecs=mp4a.40.2', extension: '.m4a' })
})

test('la capture WebM garde une extension WebM lorsque MP4 est indisponible', () => {
  const recording = selectRecordingFormat((mime) => mime === 'audio/webm;codecs=opus')
  assert.deepEqual(recording, { mimeType: 'audio/webm;codecs=opus', extension: '.webm' })
})

test('le main process rejette une extension audio injectée hors de la liste autorisée', () => {
  assert.throws(
    () => recordingExtensionFor({ title: 'Cours', mimeType: 'audio/mp4', extension: '/../escape' as '.m4a' }),
    /Extension d’enregistrement invalide/
  )
})
