export type CourseStatus =
  | 'recording'
  | 'converting'
  | 'recorded'
  | 'transcribing'
  | 'cleaning'
  | 'studying'
  | 'complete'
  | 'error'

export type STTProviderName = 'local-whisper' | 'openai'
export type CleanupProviderName = 'claude-code' | 'codex'

export interface Course {
  id: string
  title: string
  createdAt: string
  durationMs: number
  status: CourseStatus
  sourceAudioPath: string
  wavPath: string | null
  rawTranscript: string | null
  cleanTranscript: string | null
  studyMarkdown: string | null
  errorStage: string | null
  errorMessage: string | null
}

export interface AppSettings {
  sttProvider: STTProviderName
  cleanupProvider: CleanupProviderName
  claudeModel: string
  codexModel: string
  openaiApiKey: string
  notionToken: string
  notionParentId: string
  notionParentType: 'page_id' | 'database_id'
  audioStoragePath: string
  whisperBinaryPath: string
  whisperModelPath: string
  whisperVadModelPath: string
}

export interface AssetStatus {
  binaryReady: boolean
  modelReady: boolean
  vadReady: boolean
  binaryPath: string
  modelPath: string
  vadModelPath: string
}

export type JobStage = 'download' | 'conversion' | 'transcription' | 'cleanup' | 'study' | 'notion'
export type DocumentVariant = 'course' | 'study'

export interface JobProgress {
  courseId?: string
  stage: JobStage
  progress: number
  message: string
}

export interface RecordingStartInput {
  title: string
  mimeType: string
}

export interface RecordingStartResult {
  course: Course
}

export interface RecordingFinishInput {
  courseId: string
  durationMs: number
}

export interface ExportResult {
  canceled: boolean
  filePath?: string
}

export interface CliModelOption {
  id: string
  label: string
  description?: string
}

export interface AppApi {
  courses: {
    list(): Promise<Course[]>
    get(id: string): Promise<Course | null>
    rename(id: string, title: string): Promise<Course>
    remove(id: string): Promise<void>
    retry(id: string): Promise<void>
    rerunCleanup(id: string): Promise<void>
    generateStudyGuide(id: string): Promise<void>
    importAudio(): Promise<Course | null>
    exportMarkdown(id: string, variant: DocumentVariant): Promise<ExportResult>
    sendToNotion(id: string, variant: DocumentVariant): Promise<{ url: string }>
  }
  recording: {
    start(input: RecordingStartInput): Promise<RecordingStartResult>
    writeChunk(courseId: string, chunk: Uint8Array): Promise<void>
    finish(input: RecordingFinishInput): Promise<void>
    cancel(courseId: string): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    save(settings: AppSettings): Promise<AppSettings>
  }
  assets: {
    status(): Promise<AssetStatus>
    downloadWhisper(): Promise<void>
  }
  models: {
    list(provider: CleanupProviderName): Promise<CliModelOption[]>
  }
  events: {
    onProgress(callback: (progress: JobProgress) => void): () => void
    onCourseUpdated(callback: (course: Course) => void): () => void
  }
}

export const IPC = {
  coursesList: 'courses:list',
  coursesGet: 'courses:get',
  coursesRename: 'courses:rename',
  coursesRemove: 'courses:remove',
  coursesRetry: 'courses:retry',
  coursesCleanup: 'courses:cleanup',
  coursesStudy: 'courses:study',
  coursesImport: 'courses:import',
  coursesExport: 'courses:export',
  coursesNotion: 'courses:notion',
  recordingStart: 'recording:start',
  recordingChunk: 'recording:chunk',
  recordingFinish: 'recording:finish',
  recordingCancel: 'recording:cancel',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  assetsStatus: 'assets:status',
  assetsDownload: 'assets:download',
  modelsList: 'models:list',
  progress: 'events:progress',
  courseUpdated: 'events:course-updated'
} as const
