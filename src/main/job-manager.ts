import { existsSync } from 'node:fs'
import ffmpegPath from 'ffmpeg-static'
import type { CleanupProvider } from './providers/cleanup'
import { ClaudeCodeProvider, CodexProvider } from './providers/cleanup'
import type { STTProvider } from './providers/stt'
import { LocalWhisperProvider, OpenAIProvider } from './providers/stt'
import type { StudyProvider } from './providers/study'
import { ClaudeStudyProvider, CodexStudyProvider } from './providers/study'
import type { Course, JobProgress, JobStage } from '../shared/types'
import type { AppDatabase } from './database'
import { RecordingService } from './recording-service'
import { runProcess } from './process-utils'

export class JobManager {
  private readonly active = new Set<string>()

  constructor(
    private readonly database: AppDatabase,
    private readonly emitProgress: (progress: JobProgress) => void,
    private readonly emitCourse: (course: Course) => void
  ) {}

  isActive(courseId: string): boolean {
    return this.active.has(courseId)
  }

  start(courseId: string): void {
    if (this.active.has(courseId)) return
    this.active.add(courseId)
    void this.run(courseId).finally(() => this.active.delete(courseId))
  }

  startCleanup(courseId: string): void {
    if (this.active.has(courseId)) return
    this.active.add(courseId)
    void this.cleanupOnly(courseId).finally(() => this.active.delete(courseId))
  }

  startStudy(courseId: string): void {
    if (this.active.has(courseId)) return
    this.active.add(courseId)
    void this.studyOnly(courseId).finally(() => this.active.delete(courseId))
  }

  private async run(courseId: string): Promise<void> {
    let stage: JobStage = 'conversion'
    try {
      let course = this.requireCourse(courseId)
      let wavPath = course.wavPath
      if (!wavPath || !existsSync(wavPath)) {
        wavPath = RecordingService.wavPathFor(course)
        course = this.update(courseId, { status: 'converting', errorStage: null, errorMessage: null })
        await this.convert(course, wavPath)
        course = this.update(courseId, { wavPath, status: 'recorded' })
      }

      stage = 'transcription'
      course = this.update(courseId, { status: 'transcribing', errorStage: null, errorMessage: null })
      const settings = this.database.getSettings()
      const provider: STTProvider = settings.sttProvider === 'openai' ? new OpenAIProvider() : new LocalWhisperProvider()
      const rawTranscript = await provider.transcribe({
        course,
        wavPath,
        settings,
        emit: this.emitProgress
      })
      this.emitProgress({ courseId, stage: 'transcription', progress: 100, message: 'Transcription terminée.' })
      course = this.update(courseId, { rawTranscript, status: 'recorded' })

      stage = 'cleanup'
      await this.performCleanup(course)
    } catch (error) {
      this.fail(courseId, stage, error)
    }
  }

  private async cleanupOnly(courseId: string): Promise<void> {
    try {
      const course = this.requireCourse(courseId)
      if (!course.rawTranscript) throw new Error('La transcription brute est absente. Relancez d’abord la transcription.')
      await this.performCleanup(course)
    } catch (error) {
      this.fail(courseId, 'cleanup', error)
    }
  }

  private async studyOnly(courseId: string): Promise<void> {
    try {
      const course = this.requireCourse(courseId)
      await this.performStudy(course)
    } catch (error) {
      this.fail(courseId, 'study', error)
    }
  }

  private async performCleanup(course: Course): Promise<void> {
    if (!course.rawTranscript) throw new Error('La transcription brute est vide.')
    const rawTranscript = course.rawTranscript
    course = this.update(course.id, { status: 'cleaning', errorStage: null, errorMessage: null })
    const settings = this.database.getSettings()
    const provider: CleanupProvider = settings.cleanupProvider === 'codex' ? new CodexProvider() : new ClaudeCodeProvider()
    const cleanTranscript = await provider.clean({
      course,
      transcript: rawTranscript,
      settings,
      emit: this.emitProgress
    })
    this.emitProgress({ courseId: course.id, stage: 'cleanup', progress: 100, message: 'Nettoyage terminé.' })
    this.update(course.id, { cleanTranscript, studyMarkdown: null, status: 'complete', errorStage: null, errorMessage: null })
  }

  private async performStudy(course: Course): Promise<void> {
    if (!course.cleanTranscript) throw new Error('Le cours nettoyé doit être terminé avant de créer une fiche de révision.')
    const cleanTranscript = course.cleanTranscript
    course = this.update(course.id, { status: 'studying', errorStage: null, errorMessage: null })
    const settings = this.database.getSettings()
    const provider: StudyProvider = settings.cleanupProvider === 'codex' ? new CodexStudyProvider() : new ClaudeStudyProvider()
    const studentNotes = this.database.getNotes(course.id).markdown
    const studyMarkdown = await provider.generate({ course, cleanTranscript, studentNotes, settings, emit: this.emitProgress })
    this.emitProgress({ courseId: course.id, stage: 'study', progress: 100, message: 'Fiche de révision prête.' })
    this.update(course.id, { studyMarkdown, status: 'complete', errorStage: null, errorMessage: null })
  }

  private async convert(course: Course, wavPath: string): Promise<void> {
    if (!ffmpegPath) throw new Error('Le binaire ffmpeg-static est introuvable.')
    const executable = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
    let buffer = ''
    await runProcess(executable, [
      '-hide_banner', '-y', '-i', course.sourceAudioPath,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath
    ], {
      onStderr: (text) => {
        buffer = (buffer + text).slice(-1000)
        const match = buffer.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/)
        if (!match) return
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
        const total = course.durationMs / 1000
        this.emitProgress({
          courseId: course.id,
          stage: 'conversion',
          progress: total ? Math.min(99, Math.round(seconds / total * 100)) : 0,
          message: 'Préparation audio 16 kHz mono…'
        })
      }
    })
    this.emitProgress({ courseId: course.id, stage: 'conversion', progress: 100, message: 'Audio prêt.' })
  }

  private requireCourse(id: string): Course {
    const course = this.database.getCourse(id)
    if (!course) throw new Error('Cours introuvable.')
    return course
  }

  private update(id: string, patch: Partial<Omit<Course, 'id'>>): Course {
    const course = this.database.updateCourse(id, patch)
    this.emitCourse(course)
    return course
  }

  private fail(id: string, stage: JobStage, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.update(id, { status: 'error', errorStage: stage, errorMessage: message })
  }
}
