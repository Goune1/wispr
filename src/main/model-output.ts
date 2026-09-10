// Filet de sécurité : même avec un prompt système strict, un modèle glisse parfois une phrase
// d'introduction ou un rappel de la consigne avant le document. On retire ces lignes, jamais
// plus de quelques-unes, et seulement si elles parlent visiblement du travail demandé.

const CODE_FENCE = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i
const ANNOUNCEMENT = /^(voici|voilà|here (is|are)|below is)\b/i
const SELF_REPORT = /^(j['’]ai|je vais|note\s*:|remarque\s*:|\*\*note)/i
const INSTRUCTION_ECHO = /balises?\b|pas une instruction|^section\s*\d+\s*(\/|sur)\s*\d+/i
const WORK_SUBJECT = /nettoy|corrig|[ée]dit|transcription|version|texte|fiche|markdown|r[ée]sultat|document|contenu|section|cours/i

const MAX_STRIPPED_LINES = 4
const MAX_COMMENTARY_LENGTH = 300

function isCommentary(line: string): boolean {
  const text = line.trim()
  if (!text || text.length > MAX_COMMENTARY_LENGTH) return false
  if (/^#{1,6}\s/.test(text)) return false
  if (INSTRUCTION_ECHO.test(text)) return true
  if (!WORK_SUBJECT.test(text)) return false
  return ANNOUNCEMENT.test(text) || SELF_REPORT.test(text)
}

export function stripModelCommentary(raw: string): string {
  const trimmed = raw.trim()
  const fenced = CODE_FENCE.exec(trimmed)
  const lines = (fenced ? fenced[1].trim() : trimmed).split('\n')

  let start = 0
  for (let removed = 0; removed < MAX_STRIPPED_LINES && start < lines.length;) {
    if (!lines[start].trim()) { start += 1; continue }
    if (!isCommentary(lines[start])) break
    start += 1
    removed += 1
  }

  let end = lines.length
  for (let removed = 0; removed < MAX_STRIPPED_LINES && end > start;) {
    if (!lines[end - 1].trim()) { end -= 1; continue }
    if (!isCommentary(lines[end - 1])) break
    end -= 1
    removed += 1
  }

  const cleaned = lines.slice(start, end).join('\n').trim()
  return cleaned || trimmed
}
