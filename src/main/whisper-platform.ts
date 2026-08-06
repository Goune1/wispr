export interface WhisperReleaseAsset {
  name: string
  browser_download_url: string
}

export type WhisperBinarySource =
  | { kind: 'bundled'; binaryName: 'whisper-cli' }
  | { kind: 'release'; binaryName: string; asset: WhisperReleaseAsset }

/** Selects a release asset without assuming GitHub publishes every platform. */
export function selectWhisperBinarySource(
  platform: NodeJS.Platform,
  arch: string,
  assets: WhisperReleaseAsset[]
): WhisperBinarySource {
  if (platform === 'darwin' && arch === 'arm64') return { kind: 'bundled', binaryName: 'whisper-cli' }

  const zipAssets = assets.filter((asset) => asset.name.endsWith('.zip'))
  let candidates: WhisperReleaseAsset[]
  if (platform === 'win32') {
    candidates = zipAssets.filter((asset) => /cublas|cuda/i.test(asset.name) && /x64|win/i.test(asset.name))
    if (!candidates.length) candidates = zipAssets.filter((asset) => /whisper-bin-x64/i.test(asset.name))
  } else {
    const architecture = arch === 'arm64' ? /arm64|aarch64/i : /x64|x86_64/i
    candidates = zipAssets.filter((asset) => architecture.test(asset.name) && !/android/i.test(asset.name))
  }
  const asset = candidates[0]
  if (!asset) throw new Error(`Aucun binaire whisper.cpp compatible avec ${platform}/${arch} dans la dernière release.`)
  return { kind: 'release', binaryName: platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli', asset }
}
