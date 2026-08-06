import { chmodSync, copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, join } from 'node:path'
import { selectWhisperBinarySource, type WhisperReleaseAsset } from './whisper-platform.ts'
import extract from 'extract-zip'
import type { AppSettings, AssetStatus, JobProgress } from '../shared/types'
import type { AppDatabase } from './database'

type ProgressCallback = (progress: JobProgress) => void

const managedAssetKeys = ['whisperBinaryPath', 'whisperModelPath', 'whisperVadModelPath'] as const

export function preserveManagedAssetPaths(current: AppSettings, incoming: AppSettings): AppSettings {
  return {
    ...incoming,
    ...Object.fromEntries(managedAssetKeys.map((key) => [key, current[key]]))
  } as AppSettings
}

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin'
const VAD_URL = 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin'
const NVIDIA_REDIST_ROOT = 'https://developer.download.nvidia.com/compute/cuda/redist'

export function requiredCublasDll(entries: string[]): string | null {
  if (!entries.some((entry) => entry.toLowerCase() === 'ggml-cuda.dll')) return null
  const cudart = entries.find((entry) => /^cudart64_\d+\.dll$/i.test(entry))
  if (!cudart) return null
  const version = cudart.match(/cudart64_(\d+)\.dll/i)?.[1] || ''
  const major = version.length >= 3 ? version.slice(0, 2) : version
  const cublas = `cublas64_${major}.dll`
  return entries.some((entry) => entry.toLowerCase() === cublas.toLowerCase()) ? null : cublas
}

export interface AssetManagerOptions {
  platform?: NodeJS.Platform
  arch?: string
  bundledWhisperDirectory?: string
}

export function bundledWhisperDirectory(resourcesPath: string): string {
  return join(resourcesPath, 'vendor', 'whisper.cpp', 'darwin-arm64')
}

export function provisionBundledWhisper(sourceDirectory: string, destinationDirectory: string): string {
  const sourceBinary = join(sourceDirectory, 'whisper-cli')
  if (!existsSync(sourceBinary)) throw new Error('Whisper Apple Silicon est absent. Sur macOS, exécutez `npm run prepare:whisper:mac` puis relancez l’application (ou utilisez un DMG qui inclut cette ressource).')
  cpSync(sourceDirectory, destinationDirectory, { recursive: true, force: true })
  const destinationBinary = join(destinationDirectory, 'whisper-cli')
  chmodSync(destinationBinary, 0o755)
  return destinationBinary
}

export class AssetManager {
  private readonly database: AppDatabase
  private readonly assetsDirectory: string
  private readonly emit: ProgressCallback
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly bundledWhisperDirectory: string

  constructor(
    database: AppDatabase,
    assetsDirectory: string,
    emit: ProgressCallback,
    options: AssetManagerOptions = {}
  ) {
    this.database = database
    this.assetsDirectory = assetsDirectory
    this.emit = emit
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.bundledWhisperDirectory = options.bundledWhisperDirectory ?? bundledWhisperDirectory(process.resourcesPath ?? process.cwd())
  }

  status(): AssetStatus {
    let settings = this.database.getSettings()
    const expected = {
      whisperBinaryPath: join(this.assetsDirectory, 'whisper.cpp', this.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'),
      whisperModelPath: join(this.assetsDirectory, 'models', 'ggml-large-v3-turbo-q5_0.bin'),
      whisperVadModelPath: join(this.assetsDirectory, 'models', 'ggml-silero-v6.2.0.bin')
    }
    const repaired = { ...settings }
    let changed = false
    for (const key of managedAssetKeys) {
      if ((!settings[key] || !existsSync(settings[key])) && existsSync(expected[key])) {
        repaired[key] = expected[key]
        changed = true
      }
    }
    if (changed) settings = this.database.saveSettings(repaired)
    return {
      binaryReady: Boolean(settings.whisperBinaryPath && existsSync(settings.whisperBinaryPath)),
      modelReady: Boolean(settings.whisperModelPath && existsSync(settings.whisperModelPath)),
      vadReady: Boolean(settings.whisperVadModelPath && existsSync(settings.whisperVadModelPath)),
      binaryPath: settings.whisperBinaryPath,
      modelPath: settings.whisperModelPath,
      vadModelPath: settings.whisperVadModelPath
    }
  }

  async downloadAll(): Promise<void> {
    mkdirSync(this.assetsDirectory, { recursive: true })
    const whisperDirectory = join(this.assetsDirectory, 'whisper.cpp')
    const modelsDirectory = join(this.assetsDirectory, 'models')
    mkdirSync(whisperDirectory, { recursive: true })
    mkdirSync(modelsDirectory, { recursive: true })

    const binaryName = this.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
    const binaryPath = join(whisperDirectory, binaryName)
    if (!existsSync(binaryPath)) {
      const source = this.platform === 'darwin' && this.arch === 'arm64'
        ? selectWhisperBinarySource(this.platform, this.arch, [])
        : selectWhisperBinarySource(this.platform, this.arch, (await this.fetchRelease()).assets)
      if (source.kind === 'bundled') {
        provisionBundledWhisper(this.bundledWhisperDirectory, whisperDirectory)
      } else {
        const archivePath = join(this.assetsDirectory, basename(source.asset.name))
        const extractionPath = join(this.assetsDirectory, `extract-${Date.now()}`)
        await this.download(source.asset.browser_download_url, archivePath, 0, 20, `Téléchargement de ${source.asset.name}`)
        mkdirSync(extractionPath, { recursive: true })
        await extract(archivePath, { dir: extractionPath })
        const discoveredBinary = this.findFile(extractionPath, binaryName)
        if (!discoveredBinary) throw new Error(`Le binaire ${binaryName} est absent de l’archive téléchargée.`)
        if (existsSync(whisperDirectory)) rmSync(whisperDirectory, { recursive: true, force: true })
        cpSync(dirname(discoveredBinary), whisperDirectory, { recursive: true })
        rmSync(archivePath, { force: true })
        rmSync(extractionPath, { recursive: true, force: true })
      }
    }
    if (this.platform !== 'win32') chmodSync(binaryPath, 0o755)
    if (this.platform === 'win32') await this.ensureCudaRuntime(whisperDirectory)

    const modelPath = join(modelsDirectory, 'ggml-large-v3-turbo-q5_0.bin')
    const vadModelPath = join(modelsDirectory, 'ggml-silero-v6.2.0.bin')
    if (!existsSync(modelPath)) await this.download(MODEL_URL, modelPath, 45, 95, 'Téléchargement du modèle large-v3-turbo Q5')
    if (!existsSync(vadModelPath)) await this.download(VAD_URL, vadModelPath, 95, 100, 'Téléchargement du modèle VAD')

    this.database.saveSettings({
      ...this.database.getSettings(),
      whisperBinaryPath: binaryPath,
      whisperModelPath: modelPath,
      whisperVadModelPath: vadModelPath
    })
    this.emit({ stage: 'download', progress: 100, message: 'Whisper local est prêt.' })
  }

  private async fetchRelease(): Promise<{ assets: WhisperReleaseAsset[] }> {
    const response = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FAC-Transcript' }
    })
    if (!response.ok) throw new Error(`GitHub a refusé la recherche du binaire Whisper (${response.status}).`)
    return response.json() as Promise<{ assets: Array<{ name: string; browser_download_url: string }> }>
  }

  private async ensureCudaRuntime(whisperDirectory: string): Promise<void> {
    const requirement = requiredCublasDll(readdirSync(whisperDirectory))
    if (!requirement) return
    const major = requirement.match(/_(\d+)\.dll$/)?.[1]
    const redistribVersion = major === '12' ? '12.4.1' : major === '11' ? '11.8.0' : null
    if (!redistribVersion) throw new Error(`Runtime CUDA non pris en charge : ${requirement}.`)
    this.emit({ stage: 'download', progress: 20, message: `Installation de l’accélération NVIDIA CUDA ${major}` })
    const manifestResponse = await fetch(`${NVIDIA_REDIST_ROOT}/redistrib_${redistribVersion}.json`)
    if (!manifestResponse.ok) throw new Error(`NVIDIA a refusé le manifeste CUDA (${manifestResponse.status}).`)
    const manifest = await manifestResponse.json() as {
      libcublas?: Record<string, { relative_path?: string } | string>
    }
    const target = manifest.libcublas?.['windows-x86_64']
    const relativePath = typeof target === 'object' ? target.relative_path : null
    if (!relativePath) throw new Error(`Le manifeste NVIDIA CUDA ${redistribVersion} ne contient pas cuBLAS pour Windows x64.`)
    const archivePath = join(this.assetsDirectory, `cublas-${redistribVersion}.zip`)
    const extractionPath = join(this.assetsDirectory, `cublas-extract-${Date.now()}`)
    await this.download(`${NVIDIA_REDIST_ROOT}/${relativePath}`, archivePath, 20, 45, 'Téléchargement du runtime NVIDIA cuBLAS')
    mkdirSync(extractionPath, { recursive: true })
    await extract(archivePath, { dir: extractionPath })
    const cublasPath = this.findFile(extractionPath, requirement)
    if (!cublasPath) throw new Error(`${requirement} est absent du runtime NVIDIA téléchargé.`)
    for (const entry of readdirSync(dirname(cublasPath))) {
      if (entry.toLowerCase().endsWith('.dll')) copyFileSync(join(dirname(cublasPath), entry), join(whisperDirectory, entry))
    }
    rmSync(archivePath, { force: true })
    rmSync(extractionPath, { recursive: true, force: true })
  }

  private async download(url: string, destination: string, start: number, end: number, message: string): Promise<void> {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`Téléchargement impossible (${response.status}) : ${url}`)
    const total = Number(response.headers.get('content-length') || 0)
    let received = 0
    const partialPath = `${destination}.part`
    rmSync(partialPath, { force: true })
    const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
    source.on('data', (chunk: Buffer) => {
      received += chunk.length
      const ratio = total ? received / total : 0
      this.emit({ stage: 'download', progress: Math.round(start + (end - start) * ratio), message })
    })
    try {
      await pipeline(source, createWriteStream(partialPath))
      rmSync(destination, { force: true })
      renameSync(partialPath, destination)
    } catch (error) {
      rmSync(partialPath, { force: true })
      throw error
    }
  }

  private findFile(directory: string, filename: string): string | null {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) {
        const nested = this.findFile(path, filename)
        if (nested) return nested
      } else if (entry.toLowerCase() === filename.toLowerCase()) return path
    }
    return null
  }
}
