import { existsSync, readdirSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

export interface CliResolutionOptions {
  platform?: NodeJS.Platform
  home?: string
  path?: string
  exists?: (path: string) => boolean
  readDir?: (path: string) => string[]
}

/** Finds user-installed CLIs when Finder launches Electron with a minimal PATH. */
export function resolveCliExecutable(executable: 'claude' | 'codex', options: CliResolutionOptions = {}): string {
  const platform = options.platform ?? process.platform
  if (platform === 'win32') return executable
  const home = options.home ?? process.env.HOME ?? ''
  const exists = options.exists ?? existsSync
  const readDir = options.readDir ?? ((path: string) => readdirSync(path))
  const pathEntries = (options.path ?? process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const candidates = [
    ...pathEntries,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    home && join(home, '.local', 'bin'),
    home && join(home, '.npm-global', 'bin'),
    home && join(home, 'Library', 'pnpm')
  ].filter(Boolean)

  if (home) {
    try {
      for (const version of readDir(join(home, '.nvm', 'versions', 'node'))) candidates.push(join(home, '.nvm', 'versions', 'node', version, 'bin'))
    } catch { /* nvm is optional */ }
  }
  for (const directory of [...new Set(candidates)]) {
    const candidate = join(directory, executable)
    if (exists(candidate)) return candidate
  }
  return executable
}

export function augmentedCliPath(envPath = process.env.PATH ?? '', home = process.env.HOME ?? ''): string {
  if (process.platform === 'win32') return envPath
  return [...new Set([envPath, '/opt/homebrew/bin', '/usr/local/bin', home && join(home, '.local', 'bin'), home && join(home, '.npm-global', 'bin'), home && join(home, 'Library', 'pnpm')].filter(Boolean))].join(delimiter)
}

/** Keeps the resolved executable's runtime (notably nvm's node) on PATH. */
export function cliExecutionPath(resolvedExecutable: string, envPath = process.env.PATH ?? '', home = process.env.HOME ?? ''): string {
  const baseEntries = augmentedCliPath(envPath, home).split(delimiter).filter(Boolean)
  const executableDirectory = resolvedExecutable.includes('/') ? dirname(resolvedExecutable) : ''
  return [...new Set([executableDirectory, ...baseEntries].filter(Boolean))].join(delimiter)
}
