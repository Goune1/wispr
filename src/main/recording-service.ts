import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Course, RecordingStartInput } from '../shared/types'
import type { AppDatabase } from './database'

interface ActiveRecording {
  stream: WriteStream
  path: string
}

const recordingExtensions = new Set(['.m4a', '.webm', '.ogg'])

export function recordingExtensionFor(input: RecordingStartInput): '.m4a' | '.webm' | '.ogg' {
  if (input.extension !== undefined) {
    if (!recordingExtensions.has(input.extension)) throw new Error('Extension d’enregistrement invalide.')
    return input.extension
  }
  return input.mimeType.includes('ogg') ? '.ogg' : input.mimeType.includes('mp4') ? '.m4a' : '.webm'
}

export class RecordingService {
  private readonly active = new Map<string, ActiveRecording>()
  private readonly database: AppDatabase

  constructor(database: AppDatabase) {
    this.database = database
  }

  start(input: RecordingStartInput): Course {
    const settings = this.database.getSettings()
    mkdirSync(settings.audioStoragePath, { recursive: true })
    const id = randomUUID()
    const extension = recordingExtensionFor(input)
    const sourceAudioPath = join(settings.audioStoragePath, `${id}${extension}`)
    const course: Course = {
      id,
      title: input.title.trim() || `Cours du ${new Date().toLocaleDateString('fr-FR')}`,
      createdAt: new Date().toISOString(),
      durationMs: 0,
      status: 'recording',
      sourceAudioPath,
      wavPath: null,
      rawTranscript: null,
      cleanTranscript: null,
      studyMarkdown: null,
      errorStage: null,
      errorMessage: null
    }
    const stream = createWriteStream(sourceAudioPath, { flags: 'wx' })
    this.active.set(id, { stream, path: sourceAudioPath })
    return this.database.createCourse(course)
  }

  async writeChunk(courseId: string, chunk: Uint8Array): Promise<void> {
    const recording = this.active.get(courseId)
    if (!recording) throw new Error('Aucun enregistrement actif pour ce cours.')
    await new Promise<void>((resolve, reject) => {
      const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      const ready = recording.stream.write(buffer, (error) => error ? reject(error) : resolve())
      if (!ready) recording.stream.once('drain', () => undefined)
    })
  }

  async finish(courseId: string, durationMs: number): Promise<Course> {
    const recording = this.active.get(courseId)
    if (!recording) throw new Error('Aucun enregistrement actif pour ce cours.')
    this.active.delete(courseId)
    await new Promise<void>((resolve, reject) => {
      recording.stream.once('error', reject)
      recording.stream.end(resolve)
    })
    return this.database.updateCourse(courseId, { durationMs, status: 'recorded' })
  }

  async cancel(courseId: string): Promise<void> {
    const recording = this.active.get(courseId)
    if (!recording) return
    this.active.delete(courseId)
    await new Promise<void>((resolve) => recording.stream.end(resolve))
    this.database.updateCourse(courseId, {
      status: 'error',
      errorStage: 'recording',
      errorMessage: `Enregistrement interrompu. Le fichier ${basename(recording.path)} a été conservé.`
    })
  }

  static wavPathFor(course: Course): string {
    return course.sourceAudioPath.slice(0, -extname(course.sourceAudioPath).length) + '.16k.wav'
  }
}
