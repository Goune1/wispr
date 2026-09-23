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
  subject: string
  folderId: string | null
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

// Sous-dossier personnalisé d'une matière (cours magistral, travaux dirigés…). La matière
// elle-même n'est pas une entité : c'est le texte porté par les cours et les dossiers.
export interface CourseFolder {
  id: string
  subject: string
  name: string
  createdAt: string
}

// Notes prises à la main dans l'éditeur : `blocks` est le document BlockNote (JSON) qui fait foi,
// `markdown` sa conversion, utilisée pour l'export, Notion et la fiche de révision.
export interface CourseNotes {
  blocks: string | null
  markdown: string
  updatedAt: string | null
}

export interface CourseNotesInput {
  blocks: string
  markdown: string
}

export interface CoursePlacement {
  subject: string
  folderId: string | null
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

export interface UpdateStatus {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'error' | 'unavailable'
  currentVersion: string
  version?: string
  percent?: number
  message?: string
}

export type JobStage = 'download' | 'conversion' | 'transcription' | 'cleanup' | 'study' | 'notion'
export type DocumentVariant = 'course' | 'study' | 'notes'

export interface JobProgress {
  courseId?: string
  stage: JobStage
  progress: number
  message: string
}

export interface RecordingStartInput {
  title: string
  subject: string
  folderId?: string | null
  mimeType: string
  extension?: '.m4a' | '.webm' | '.ogg'
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
    move(id: string, placement: CoursePlacement): Promise<Course>
    duplicate(id: string, placement: CoursePlacement): Promise<Course>
    remove(id: string): Promise<void>
    retry(id: string): Promise<void>
    startProcessing(id: string): Promise<void>
    rerunCleanup(id: string): Promise<void>
    generateStudyGuide(id: string): Promise<void>
    importAudio(): Promise<Course | null>
    exportMarkdown(id: string, variant: DocumentVariant): Promise<ExportResult>
    sendToNotion(id: string, variant: DocumentVariant): Promise<{ url: string }>
  }
  folders: {
    list(): Promise<CourseFolder[]>
    create(subject: string, name: string): Promise<CourseFolder>
    rename(id: string, name: string): Promise<CourseFolder>
    remove(id: string): Promise<void>
  }
  subjects: {
    rename(from: string, to: string): Promise<void>
  }
  notes: {
    get(courseId: string): Promise<CourseNotes>
    save(courseId: string, notes: CourseNotesInput): Promise<void>
  }
  recording: {
    start(input: RecordingStartInput): Promise<RecordingStartResult>
    writeChunk(courseId: string, chunk: Uint8Array): Promise<void>
    finish(input: RecordingFinishInput): Promise<Course>
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
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    download(): Promise<UpdateStatus>
    install(): Promise<void>
  }
  events: {
    onProgress(callback: (progress: JobProgress) => void): () => void
    onCourseUpdated(callback: (course: Course) => void): () => void
    onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
  }
}

export const IPC = {
  coursesList: 'courses:list',
  coursesGet: 'courses:get',
  coursesRename: 'courses:rename',
  coursesMove: 'courses:move',
  coursesDuplicate: 'courses:duplicate',
  coursesRemove: 'courses:remove',
  coursesRetry: 'courses:retry',
  coursesProcess: 'courses:process',
  coursesCleanup: 'courses:cleanup',
  coursesStudy: 'courses:study',
  coursesImport: 'courses:import',
  coursesExport: 'courses:export',
  coursesNotion: 'courses:notion',
  foldersList: 'folders:list',
  foldersCreate: 'folders:create',
  foldersRename: 'folders:rename',
  foldersRemove: 'folders:remove',
  subjectsRename: 'subjects:rename',
  notesGet: 'notes:get',
  notesSave: 'notes:save',
  recordingStart: 'recording:start',
  recordingChunk: 'recording:chunk',
  recordingFinish: 'recording:finish',
  recordingCancel: 'recording:cancel',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  assetsStatus: 'assets:status',
  assetsDownload: 'assets:download',
  modelsList: 'models:list',
  updatesStatus: 'updates:status',
  updatesCheck: 'updates:check',
  updatesDownload: 'updates:download',
  updatesInstall: 'updates:install',
  updateStatus: 'events:update-status',
  progress: 'events:progress',
  courseUpdated: 'events:course-updated'
} as const
