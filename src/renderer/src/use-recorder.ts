import { useEffect, useRef, useState } from 'react'
import type { Course } from '../../shared/types'
import type { CourseMetadataInput } from '../../shared/course-metadata'
import { selectRecordingFormat } from './recording-format'
import { capturedMsAt, IDLE_CLOCK, pauseCapture, resumeCapture, startCapture, type CaptureClock } from './recording-clock'
import { errorMessage } from './ui'

export type RecordingMetadata = CourseMetadataInput & { folderId: string | null }
export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'

export interface Recorder {
  state: RecorderState
  course: Course | null
  clock: CaptureClock
  start(metadata: RecordingMetadata): Promise<Course | null>
  togglePause(): void
  stop(): Promise<Course | null>
}

// La capture vit au niveau de l'application, pas dans une page : on peut consulter un autre
// cours, ses dossiers ou les réglages pendant que le micro continue d'enregistrer.
export function useRecorder(onError: (message: string) => void): Recorder {
  const [state, setState] = useState<RecorderState>('idle')
  const [course, setCourse] = useState<Course | null>(null)
  const [clock, setClock] = useState<CaptureClock>(IDLE_CLOCK)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const courseId = useRef<string | null>(null)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const clockRef = useRef<CaptureClock>(IDLE_CLOCK)
  const setBothClocks = (next: CaptureClock): void => { clockRef.current = next; setClock(next) }

  useEffect(() => () => { stream.current?.getTracks().forEach((track) => track.stop()) }, [])

  // Fermer la fenêtre en pleine capture perdrait la fin du cours : on demande confirmation.
  useEffect(() => {
    if (state === 'idle') return
    const guard = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [state])

  const start = async (metadata: RecordingMetadata): Promise<Course | null> => {
    if (state !== 'idle') return null
    setState('starting')
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } })
      const preferred = selectRecordingFormat((type) => MediaRecorder.isTypeSupported(type))
      const mediaRecorder = new MediaRecorder(media, preferred ? { mimeType: preferred.mimeType, audioBitsPerSecond: 64_000 } : undefined)
      const mimeType = mediaRecorder.mimeType || preferred?.mimeType || 'audio/webm'
      const result = await window.api.recording.start({ ...metadata, mimeType, extension: preferred?.extension })
      stream.current = media
      recorder.current = mediaRecorder
      courseId.current = result.course.id
      writeQueue.current = Promise.resolve()
      mediaRecorder.ondataavailable = (event) => {
        if (!event.data.size || !courseId.current) return
        const id = courseId.current
        writeQueue.current = writeQueue.current
          .then(async () => new Uint8Array(await event.data.arrayBuffer()))
          .then((chunk) => window.api.recording.writeChunk(id, chunk))
          .catch((error) => onError(errorMessage(error)))
      }
      mediaRecorder.onerror = () => onError('Le navigateur a interrompu la capture du microphone.')
      mediaRecorder.start(1000)
      setBothClocks(startCapture(Date.now()))
      setCourse(result.course)
      setState('recording')
      return result.course
    } catch (error) {
      stream.current?.getTracks().forEach((track) => track.stop())
      setState('idle')
      onError(error instanceof Error ? errorMessage(error) : 'Impossible d’accéder au microphone.')
      return null
    }
  }

  const togglePause = (): void => {
    const current = recorder.current
    if (!current) return
    if (state === 'recording') {
      current.pause()
      setBothClocks(pauseCapture(clockRef.current, Date.now()))
      setState('paused')
    } else if (state === 'paused') {
      current.resume()
      setBothClocks(resumeCapture(clockRef.current, Date.now()))
      setState('recording')
    }
  }

  const stop = async (): Promise<Course | null> => {
    const current = recorder.current
    const id = courseId.current
    if (!current || !id || state === 'stopping') return null
    setState('stopping')
    const stopped = new Promise<void>((resolve) => current.addEventListener('stop', () => resolve(), { once: true }))
    current.stop()
    await stopped
    await writeQueue.current
    stream.current?.getTracks().forEach((track) => track.stop())
    try {
      return await window.api.recording.finish({ courseId: id, durationMs: capturedMsAt(clockRef.current, Date.now()) })
    } catch (error) {
      onError(errorMessage(error))
      return null
    } finally {
      recorder.current = null
      courseId.current = null
      setBothClocks(IDLE_CLOCK)
      setCourse(null)
      setState('idle')
    }
  }

  return { state, course, clock, start, togglePause, stop }
}
