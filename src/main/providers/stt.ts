import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import type { AppSettings, Course, JobProgress } from '../../shared/types'
import { runProcess } from '../process-utils'

export interface STTContext {
  course: Course
  wavPath: string
  settings: AppSettings
  emit(progress: JobProgress): void
}

export interface STTProvider {
  transcribe(context: STTContext): Promise<string>
}

function timestamp(seconds: number): string {
  const value = Math.max(0, Math.round(seconds))
  const hours = Math.floor(value / 3600).toString().padStart(2, '0')
  const minutes = Math.floor((value % 3600) / 60).toString().padStart(2, '0')
  const secs = (value % 60).toString().padStart(2, '0')
  return `${hours}:${minutes}:${secs}`
}

export class LocalWhisperProvider implements STTProvider {
  async transcribe({ course, wavPath, settings, emit }: STTContext): Promise<string> {
    if (!existsSync(settings.whisperBinaryPath) || !existsSync(settings.whisperModelPath)) {
      throw new Error('Whisper local n’est pas installé. Ouvrez les réglages puis téléchargez le moteur et le modèle.')
    }
    const outputPrefix = join(dirname(wavPath), `${course.id}.whisper`)
    const args = [
      '-m', settings.whisperModelPath,
      '-f', wavPath,
      '-l', 'fr',
      '--output-json-full',
      '--output-file', outputPrefix,
      '--print-progress'
    ]
    if (settings.whisperVadModelPath && existsSync(settings.whisperVadModelPath)) {
      args.push('--vad', '--vad-model', settings.whisperVadModelPath)
    }
    let buffered = ''
    const result = await runProcess(settings.whisperBinaryPath, args, {
      onStderr: (text) => {
        buffered += text
        const matches = [...buffered.matchAll(/(?:progress\s*=\s*|\[)(\d{1,3})%/gi)]
        const latest = matches.at(-1)
        if (latest) emit({ courseId: course.id, stage: 'transcription', progress: Number(latest[1]), message: 'Transcription locale…' })
        buffered = buffered.slice(-500)
      }
    })
    const jsonPath = `${outputPrefix}.json`
    if (existsSync(jsonPath)) {
      const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
        transcription?: Array<{ text?: string; offsets?: { from?: number; to?: number }; timestamps?: { from?: string; to?: string } }>
        segments?: Array<{ text?: string; start?: number; end?: number; t0?: number; t1?: number }>
      }
      const segments = parsed.transcription || parsed.segments || []
      const lines = segments.map((segment) => {
        const offsets = 'offsets' in segment ? segment.offsets : undefined
        const times = 'timestamps' in segment ? segment.timestamps : undefined
        const startSeconds = offsets?.from != null ? offsets.from / 1000
          : 'start' in segment ? segment.start || 0
          : 't0' in segment ? (segment.t0 || 0) / 100 : 0
        const endSeconds = offsets?.to != null ? offsets.to / 1000
          : 'end' in segment ? segment.end || 0
          : 't1' in segment ? (segment.t1 || 0) / 100 : 0
        const start = times?.from || timestamp(startSeconds)
        const end = times?.to || timestamp(endSeconds)
        return `[${start} → ${end}] ${(segment.text || '').trim()}`
      }).filter((line) => line.trim()).join('\n')
      if (lines) return lines
    }
    const fallback = result.stdout.split('\n').filter((line) => /^\s*\[\d\d:/.test(line)).join('\n')
    if (!fallback) throw new Error('Whisper s’est terminé sans produire de transcription lisible.')
    return fallback
  }
}

export class OpenAIProvider implements STTProvider {
  async transcribe({ course, wavPath, settings, emit }: STTContext): Promise<string> {
    if (!settings.openaiApiKey) throw new Error('La clé API OpenAI est absente des réglages.')
    const chunks = await this.createChunks(wavPath, course.id)
    try {
      const output: string[] = []
      for (let index = 0; index < chunks.length; index += 1) {
        emit({
          courseId: course.id,
          stage: 'transcription',
          progress: Math.round(index / chunks.length * 100),
          message: `Transcription OpenAI — partie ${index + 1}/${chunks.length}`
        })
        const data = new FormData()
        data.append('model', 'whisper-1')
        data.append('language', 'fr')
        data.append('response_format', 'verbose_json')
        const bytes = readFileSync(chunks[index])
        data.append('file', new Blob([bytes], { type: 'audio/wav' }), basename(chunks[index]))
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${settings.openaiApiKey}` },
          body: data
        })
        if (!response.ok) throw new Error(`OpenAI (${response.status}) : ${await response.text()}`)
        const result = await response.json() as { text: string; segments?: Array<{ start: number; end: number; text: string }> }
        const offset = index * 600
        if (result.segments?.length) {
          output.push(...result.segments.map((segment) =>
            `[${timestamp(segment.start + offset)} → ${timestamp(segment.end + offset)}] ${segment.text.trim()}`
          ))
        } else output.push(result.text)
      }
      return output.join('\n')
    } finally {
      if (chunks.length > 1) rmSync(dirname(chunks[0]), { recursive: true, force: true })
    }
  }

  private async createChunks(wavPath: string, courseId: string): Promise<string[]> {
    if (statSync(wavPath).size < 23 * 1024 * 1024) return [wavPath]
    if (!ffmpegPath) throw new Error('ffmpeg-static est introuvable.')
    const chunksDirectory = join(dirname(wavPath), `${courseId}-api-chunks`)
    mkdirSync(chunksDirectory, { recursive: true })
    await runProcess(ffmpegPath, [
      '-hide_banner', '-y', '-i', wavPath,
      '-f', 'segment', '-segment_time', '600', '-c', 'copy',
      join(chunksDirectory, 'chunk-%03d.wav')
    ])
    return readdirSync(chunksDirectory)
      .filter((entry) => extname(entry) === '.wav')
      .sort()
      .map((entry) => join(chunksDirectory, entry))
  }
}
