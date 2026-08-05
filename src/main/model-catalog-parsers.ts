import type { CliModelOption } from '../shared/types'

interface CodexCatalogEntry {
  slug?: unknown
  display_name?: unknown
  description?: unknown
  visibility?: unknown
}

export function parseCodexModelCatalog(output: string): CliModelOption[] {
  const parsed = JSON.parse(output) as { models?: CodexCatalogEntry[] }
  return (parsed.models || [])
    .filter((model) => model.visibility === 'list' && typeof model.slug === 'string')
    .map((model) => ({
      id: model.slug as string,
      label: typeof model.display_name === 'string' ? model.display_name : model.slug as string,
      description: typeof model.description === 'string' ? model.description : undefined
    }))
}

export function parseClaudeModelAliases(output: string): CliModelOption[] {
  const modelHelp = output.match(/alias for the latest model\s*\(e\.g\.\s*([\s\S]*?)\)\s*or\s+a\s+model/i)?.[1] || ''
  const aliases = [...modelHelp.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
  return [...new Set([...aliases, 'haiku'])].map((id) => ({
    id,
    label: `Claude ${id.charAt(0).toUpperCase()}${id.slice(1)}`,
    description: 'Alias proposé par la version installée de Claude Code.'
  }))
}
