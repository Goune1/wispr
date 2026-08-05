interface ClaudeResult {
  is_error?: boolean
  result?: string
  terminal_reason?: string
}

function parseEmbeddedJson(message: string): ClaudeResult | null {
  for (let index = message.indexOf('{'); index >= 0; index = message.indexOf('{', index + 1)) {
    try {
      return JSON.parse(message.slice(index)) as ClaudeResult
    } catch { /* le préfixe peut contenir une accolade avant le JSON utile */ }
  }
  return null
}

export function formatClaudeCliError(error: unknown, action = 'le nettoyage'): string {
  const message = error instanceof Error ? error.message : String(error)
  const result = parseEmbeddedJson(message)?.result || message
  if (/oauth session expired|failed to authenticate|authentication/i.test(result)) {
    return 'Claude Code n’est plus authentifié. Ouvrez PowerShell, exécutez « claude auth login », terminez la connexion dans le navigateur, puis cliquez sur « Réessayer ». Les sources et documents déjà produits sont conservés.'
  }
  if (/rate.?limit|429|quota|too many requests/i.test(result)) {
    return `Limite de requêtes Claude atteinte. Réessayez plus tard. Détail : ${result}`
  }
  return `Claude Code a refusé ${action} : ${result}`
}
