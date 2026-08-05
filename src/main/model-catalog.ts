import { tmpdir } from 'node:os'
import type { CliModelOption, CleanupProviderName } from '../shared/types'
import { runProcess } from './process-utils'
import { parseClaudeModelAliases, parseCodexModelCatalog } from './model-catalog-parsers'

export async function listCliModels(provider: CleanupProviderName): Promise<CliModelOption[]> {
  if (provider === 'codex') {
    try {
      const { stdout } = await runProcess('codex', ['debug', 'models'], { cwd: tmpdir() })
      return parseCodexModelCatalog(stdout)
    } catch {
      const { stdout } = await runProcess('codex', ['debug', 'models', '--bundled'], { cwd: tmpdir() })
      return parseCodexModelCatalog(stdout)
    }
  }
  const { stdout } = await runProcess('claude', ['--help'], { cwd: tmpdir() })
  return parseClaudeModelAliases(stdout)
}
