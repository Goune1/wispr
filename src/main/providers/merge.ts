import { tmpdir } from 'node:os'
import type { AppSettings, Course, JobProgress } from '../../shared/types'
import { buildClaudeArgs } from '../claude-cli'
import { formatClaudeCliError } from '../cli-errors'
import { buildMergePlanPrompt, buildMergePrompt, buildMergeSectionPrompt, parseMergePlan, SINGLE_PASS_MAX_CHARS, type MergeSource } from '../merge-prompt'
import { stripModelCommentary } from '../model-output'
import { runProcess } from '../process-utils'
import { parseCodexOutput } from './study'

export interface MergeContext {
  course: Course
  sources: MergeSource[]
  settings: AppSettings
  emit(progress: JobProgress): void
}

export interface MergeProvider {
  merge(context: MergeContext): Promise<string>
}

abstract class CliMergeProvider implements MergeProvider {
  protected abstract execute(prompt: string, settings: AppSettings): Promise<string>

  async merge({ course, sources, settings, emit }: MergeContext): Promise<string> {
    const emitMerge = (progress: number, message: string): void => emit({ courseId: course.id, stage: 'merge', progress, message })
    const totalChars = sources.reduce((sum, source) => sum + source.transcript.length, 0)

    if (totalChars <= SINGLE_PASS_MAX_CHARS) {
      emitMerge(10, `Fusion de ${sources.length} cours…`)
      return stripModelCommentary(await this.execute(buildMergePrompt(course.title, course.subject, sources), settings))
    }

    emitMerge(5, 'Construction du plan commun…')
    const plan = parseMergePlan(stripModelCommentary(await this.execute(buildMergePlanPrompt(course.title, course.subject, sources), settings)))
    if (plan.length < 2) {
      emitMerge(10, `Fusion de ${sources.length} cours…`)
      return stripModelCommentary(await this.execute(buildMergePrompt(course.title, course.subject, sources), settings))
    }
    const sections: string[] = []
    for (let index = 0; index < plan.length; index += 1) {
      emitMerge(10 + Math.round(index / plan.length * 90), `Rédaction — partie ${index + 1}/${plan.length} : ${plan[index].heading}`)
      sections.push(stripModelCommentary(await this.execute(buildMergeSectionPrompt(course.title, course.subject, sources, plan, index), settings)))
    }
    return `# ${course.title}\n\n${sections.join('\n\n')}`
  }
}

export class ClaudeMergeProvider extends CliMergeProvider {
  protected async execute(prompt: string, settings: AppSettings): Promise<string> {
    let stdout: string
    try {
      ;({ stdout } = await runProcess('claude', buildClaudeArgs(settings), { input: prompt, cwd: tmpdir() }))
    } catch (error) {
      throw new Error(formatClaudeCliError(error, 'la fusion des cours'))
    }
    const parsed = JSON.parse(stdout) as { result?: string; error?: string; is_error?: boolean }
    if (parsed.error || parsed.is_error || !parsed.result) {
      throw new Error(formatClaudeCliError(parsed.error || parsed.result || 'Claude Code n’a renvoyé aucun texte.', 'la fusion des cours'))
    }
    return parsed.result
  }
}

export class CodexMergeProvider extends CliMergeProvider {
  protected async execute(prompt: string, settings: AppSettings): Promise<string> {
    const args = ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check']
    if (settings.codexModel) args.push('--model', settings.codexModel)
    args.push('-')
    const { stdout } = await runProcess('codex', args, { input: prompt, cwd: tmpdir() })
    const result = parseCodexOutput(stdout)
    if (!result) throw new Error('Codex n’a renvoyé aucun cours fusionné exploitable.')
    return result
  }
}
