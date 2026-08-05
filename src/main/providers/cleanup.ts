import type { AppSettings, Course, JobProgress } from '../../shared/types'
import { runProcess } from '../process-utils'
import { tmpdir } from 'node:os'
import { formatClaudeCliError } from '../cli-errors'
import { buildCleanupPrompt } from '../cleanup-prompt'

export interface CleanupContext {
  course: Course
  transcript: string
  settings: AppSettings
  emit(progress: JobProgress): void
}

export interface CleanupProvider {
  clean(context: CleanupContext): Promise<string>
}

function splitTranscript(text: string, maxChars = 32_000): string[] {
  const paragraphs = text.split(/\n/)
  const chunks: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) { chunks.push(current); current = '' }
      for (let offset = 0; offset < paragraph.length; offset += maxChars) chunks.push(paragraph.slice(offset, offset + maxChars))
    } else if ((current + '\n' + paragraph).length > maxChars) {
      chunks.push(current)
      current = paragraph
    } else current += `${current ? '\n' : ''}${paragraph}`
  }
  if (current) chunks.push(current)
  return chunks
}

abstract class CliCleanupProvider implements CleanupProvider {
  protected abstract execute(prompt: string, settings: AppSettings): Promise<string>

  async clean({ course, transcript, settings, emit }: CleanupContext): Promise<string> {
    const chunks = splitTranscript(transcript)
    const cleaned: string[] = []
    for (let index = 0; index < chunks.length; index += 1) {
      emit({
        courseId: course.id,
        stage: 'cleanup',
        progress: Math.round(index / chunks.length * 100),
        message: `Nettoyage — section ${index + 1}/${chunks.length}`
      })
      const prompt = buildCleanupPrompt(chunks[index], index + 1, chunks.length)
      try {
        cleaned.push((await this.execute(prompt, settings)).trim())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/rate.?limit|429|quota|too many requests/i.test(message)) {
          throw new Error(`Limite de requêtes du provider atteinte. Réessayez plus tard. Détail : ${message}`)
        }
        throw error
      }
    }
    return cleaned.join('\n\n')
  }
}

export class ClaudeCodeProvider extends CliCleanupProvider {
  protected async execute(prompt: string, settings: AppSettings): Promise<string> {
    let stdout: string
    try {
      const args = ['-p', '--output-format', 'json']
      if (settings.claudeModel) args.push('--model', settings.claudeModel)
      ;({ stdout } = await runProcess('claude', args, { input: prompt, cwd: tmpdir() }))
    } catch (error) {
      throw new Error(formatClaudeCliError(error))
    }
    const parsed = JSON.parse(stdout) as { result?: string; error?: string }
    if (parsed.error) throw new Error(formatClaudeCliError(parsed.error))
    if (!parsed.result) throw new Error('Claude Code n’a renvoyé aucun texte.')
    return parsed.result
  }
}

export class CodexProvider extends CliCleanupProvider {
  protected async execute(prompt: string, settings: AppSettings): Promise<string> {
    const args = ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check']
    if (settings.codexModel) args.push('--model', settings.codexModel)
    args.push('-')
    const { stdout } = await runProcess('codex', args, { input: prompt, cwd: tmpdir() })
    const lines = stdout.split('\n').filter(Boolean)
    let result = ''
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        const item = event.item as Record<string, unknown> | undefined
        if (item?.type === 'agent_message' && typeof item.text === 'string') result = item.text
        if (typeof event.result === 'string') result = event.result
      } catch { /* sortie non JSON ignorée */ }
    }
    if (!result) throw new Error('Codex n’a renvoyé aucun texte exploitable.')
    return result
  }
}
