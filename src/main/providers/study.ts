import { tmpdir } from 'node:os'
import type { AppSettings, Course, JobProgress } from '../../shared/types'
import { buildClaudeArgs } from '../claude-cli'
import { formatClaudeCliError } from '../cli-errors'
import { stripModelCommentary } from '../model-output'
import { runProcess } from '../process-utils'
import { buildStudyPrompt } from '../study-prompt'

export interface StudyContext {
  course: Course
  cleanTranscript: string
  studentNotes: string
  settings: AppSettings
  emit(progress: JobProgress): void
}

export interface StudyProvider {
  generate(context: StudyContext): Promise<string>
}

function parseCodexOutput(stdout: string): string {
  let result = ''
  for (const line of stdout.split('\n').filter(Boolean)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>
      const item = event.item as Record<string, unknown> | undefined
      if (item?.type === 'agent_message' && typeof item.text === 'string') result = item.text
      if (typeof event.result === 'string') result = event.result
    } catch { /* les lignes non JSON sont ignorées */ }
  }
  return result
}

export class ClaudeStudyProvider implements StudyProvider {
  async generate({ course, cleanTranscript, studentNotes, settings, emit }: StudyContext): Promise<string> {
    emit({ courseId: course.id, stage: 'study', progress: 10, message: 'Analyse du cours et construction de la fiche…' })
    try {
      const { stdout } = await runProcess('claude', buildClaudeArgs(settings), {
        input: buildStudyPrompt(course.title, cleanTranscript, course.subject, studentNotes),
        cwd: tmpdir()
      })
      const parsed = JSON.parse(stdout) as { result?: string; error?: string; is_error?: boolean }
      if (parsed.error || parsed.is_error || !parsed.result) {
        throw new Error(formatClaudeCliError(parsed.error || parsed.result || 'Claude Code n’a renvoyé aucune fiche.', 'la création de la fiche de révision'))
      }
      return stripModelCommentary(parsed.result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/Claude Code n’est plus authentifié|Limite de requêtes Claude|Claude Code a refusé/.test(message)) throw error
      throw new Error(formatClaudeCliError(error, 'la création de la fiche de révision'))
    }
  }
}

export class CodexStudyProvider implements StudyProvider {
  async generate({ course, cleanTranscript, studentNotes, settings, emit }: StudyContext): Promise<string> {
    emit({ courseId: course.id, stage: 'study', progress: 10, message: 'Analyse du cours et construction de la fiche…' })
    const args = ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check']
    if (settings.codexModel) args.push('--model', settings.codexModel)
    args.push('-')
    const { stdout } = await runProcess('codex', args, {
      input: buildStudyPrompt(course.title, cleanTranscript, course.subject, studentNotes),
      cwd: tmpdir()
    })
    const result = parseCodexOutput(stdout)
    if (!result) throw new Error('Codex n’a renvoyé aucune fiche de révision exploitable.')
    return stripModelCommentary(result)
  }
}
