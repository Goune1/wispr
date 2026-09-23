import Database from 'better-sqlite3'
import { safeStorage } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppSettings, Course, CourseFolder, CourseNotes, CourseNotesInput, CourseStatus } from '../shared/types'

interface CourseRow {
  id: string
  title: string
  subject: string
  folder_id: string | null
  created_at: string
  duration_ms: number
  status: CourseStatus
  source_audio_path: string
  wav_path: string | null
  raw_transcript: string | null
  clean_transcript: string | null
  study_markdown: string | null
  error_stage: string | null
  error_message: string | null
}

interface FolderRow {
  id: string
  subject: string
  name: string
  created_at: string
}

const secretKeys = new Set<keyof AppSettings>(['openaiApiKey', 'notionToken'])

export class AppDatabase {
  private readonly db: Database.Database

  constructor(databasePath: string, private readonly defaultAudioPath: string) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new Database(databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS courses (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        source_audio_path TEXT NOT NULL,
        wav_path TEXT,
        raw_transcript TEXT,
        clean_transcript TEXT,
        study_markdown TEXT,
        error_stage TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_courses_created_at ON courses(created_at DESC);
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_subject_name ON folders(subject, name COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS course_notes (
        course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
        blocks TEXT NOT NULL,
        markdown TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    const courseColumns = this.db.pragma('table_info(courses)') as Array<{ name: string }>
    if (!courseColumns.some((column) => column.name === 'study_markdown')) {
      this.db.exec('ALTER TABLE courses ADD COLUMN study_markdown TEXT')
    }
    if (!courseColumns.some((column) => column.name === 'subject')) {
      this.db.exec("ALTER TABLE courses ADD COLUMN subject TEXT NOT NULL DEFAULT ''")
    }
    if (!courseColumns.some((column) => column.name === 'folder_id')) {
      this.db.exec('ALTER TABLE courses ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL')
    }
  }

  listCourses(): Course[] {
    const rows = this.db.prepare('SELECT * FROM courses ORDER BY created_at DESC').all() as CourseRow[]
    return rows.map(this.mapCourse)
  }

  getCourse(id: string): Course | null {
    const row = this.db.prepare('SELECT * FROM courses WHERE id = ?').get(id) as CourseRow | undefined
    return row ? this.mapCourse(row) : null
  }

  createCourse(course: Course): Course {
    this.db.prepare(`
      INSERT INTO courses (
        id, title, subject, folder_id, created_at, duration_ms, status, source_audio_path, wav_path,
        raw_transcript, clean_transcript, study_markdown, error_stage, error_message
      ) VALUES (
        @id, @title, @subject, @folderId, @createdAt, @durationMs, @status, @sourceAudioPath, @wavPath,
        @rawTranscript, @cleanTranscript, @studyMarkdown, @errorStage, @errorMessage
      )
    `).run(course)
    return course
  }

  updateCourse(id: string, patch: Partial<Omit<Course, 'id'>>): Course {
    const keyMap: Record<string, string> = {
      title: 'title', subject: 'subject', folderId: 'folder_id', createdAt: 'created_at', durationMs: 'duration_ms', status: 'status',
      sourceAudioPath: 'source_audio_path', wavPath: 'wav_path', rawTranscript: 'raw_transcript',
      cleanTranscript: 'clean_transcript', studyMarkdown: 'study_markdown',
      errorStage: 'error_stage', errorMessage: 'error_message'
    }
    const entries = Object.entries(patch).filter(([key]) => key in keyMap)
    if (entries.length) {
      const values: Record<string, unknown> = { id }
      const assignments = entries.map(([key, value], index) => {
        const parameter = `value${index}`
        values[parameter] = value
        return `${keyMap[key]} = @${parameter}`
      })
      this.db.prepare(`UPDATE courses SET ${assignments.join(', ')} WHERE id = @id`).run(values)
    }
    const updated = this.getCourse(id)
    if (!updated) throw new Error('Cours introuvable après mise à jour.')
    return updated
  }

  deleteCourse(id: string): void {
    this.db.prepare('DELETE FROM courses WHERE id = ?').run(id)
  }

  getNotes(courseId: string): CourseNotes {
    const row = this.db.prepare('SELECT blocks, markdown, updated_at FROM course_notes WHERE course_id = ?').get(courseId) as
      { blocks: string; markdown: string; updated_at: string } | undefined
    return row ? { blocks: row.blocks, markdown: row.markdown, updatedAt: row.updated_at } : { blocks: null, markdown: '', updatedAt: null }
  }

  saveNotes(courseId: string, notes: CourseNotesInput): void {
    this.db.prepare(`
      INSERT INTO course_notes (course_id, blocks, markdown, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(course_id) DO UPDATE SET blocks = excluded.blocks, markdown = excluded.markdown, updated_at = excluded.updated_at
    `).run(courseId, notes.blocks, notes.markdown, new Date().toISOString())
  }

  listFolders(): CourseFolder[] {
    const rows = this.db.prepare('SELECT * FROM folders ORDER BY subject, created_at').all() as FolderRow[]
    return rows.map(this.mapFolder)
  }

  getFolder(id: string): CourseFolder | null {
    const row = this.db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined
    return row ? this.mapFolder(row) : null
  }

  createFolder(folder: CourseFolder): CourseFolder {
    this.assertFolderNameFree(folder.subject, folder.name)
    this.db.prepare('INSERT INTO folders (id, subject, name, created_at) VALUES (@id, @subject, @name, @createdAt)').run(folder)
    return folder
  }

  renameFolder(id: string, name: string): CourseFolder {
    const folder = this.getFolder(id)
    if (!folder) throw new Error('Dossier introuvable.')
    this.assertFolderNameFree(folder.subject, name, id)
    this.db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, id)
    return { ...folder, name }
  }

  // Renommer une matière la renomme sur tous ses cours et dossiers. Fusionner deux matières
  // existantes n'est pas proposé : leurs dossiers pourraient porter le même nom.
  renameSubject(from: string, to: string): void {
    if (from === to) return
    const caseOnly = from.toLocaleLowerCase('fr') === to.toLocaleLowerCase('fr')
    const taken = this.db.prepare('SELECT 1 FROM courses WHERE subject = ? UNION SELECT 1 FROM folders WHERE subject = ?').get(to, to)
    if (taken && !caseOnly) throw new Error(`La matière « ${to} » existe déjà.`)
    this.db.transaction(() => {
      this.db.prepare('UPDATE courses SET subject = ? WHERE subject = ?').run(to, from)
      this.db.prepare('UPDATE folders SET subject = ? WHERE subject = ?').run(to, from)
    })()
  }

  // Un cours ne peut être rangé que dans un dossier de sa propre matière.
  folderIdWithin(subject: string, folderId: string | null): string | null {
    if (!folderId) return null
    const folder = this.getFolder(folderId)
    if (!folder || folder.subject !== subject) throw new Error('Ce dossier n’appartient pas à la matière choisie.')
    return folder.id
  }

  // La clé étrangère ON DELETE SET NULL remet les cours du dossier à la racine de leur matière.
  deleteFolder(id: string): void {
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(id)
  }

  private assertFolderNameFree(subject: string, name: string, exceptId = ''): void {
    const taken = this.db.prepare('SELECT 1 FROM folders WHERE subject = ? AND name = ? COLLATE NOCASE AND id != ?').get(subject, name, exceptId)
    if (taken) throw new Error(`Un dossier « ${name} » existe déjà dans ${subject}.`)
  }

  recoverInterruptedCourses(): void {
    this.db.prepare(`
      UPDATE courses
      SET error_stage = CASE status
            WHEN 'converting' THEN 'conversion'
            WHEN 'transcribing' THEN 'transcription'
            WHEN 'cleaning' THEN 'cleanup'
            WHEN 'studying' THEN 'study'
            ELSE status
          END,
          status = 'error',
          error_message = 'L’application a été fermée pendant ce traitement. Les sources et documents déjà produits sont intacts : relancez le traitement.'
      WHERE status IN ('recording', 'converting', 'transcribing', 'cleaning', 'studying')
    `).run()
  }

  getSettings(): AppSettings {
    const defaults: AppSettings = {
      sttProvider: 'local-whisper',
      cleanupProvider: 'claude-code',
      claudeModel: '',
      codexModel: '',
      openaiApiKey: '',
      notionToken: '',
      notionParentId: '',
      notionParentType: 'page_id',
      audioStoragePath: this.defaultAudioPath,
      whisperBinaryPath: '',
      whisperModelPath: '',
      whisperVadModelPath: ''
    }
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: keyof AppSettings; value: string }>
    for (const row of rows) {
      if (!(row.key in defaults)) continue
      let value = row.value
      if (secretKeys.has(row.key) && value.startsWith('encrypted:') && safeStorage.isEncryptionAvailable()) {
        try { value = safeStorage.decryptString(Buffer.from(value.slice(10), 'base64')) } catch { value = '' }
      }
      ;(defaults as unknown as Record<string, string>)[row.key] = value
    }
    return defaults
  }

  saveSettings(settings: AppSettings): AppSettings {
    const insert = this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    const transaction = this.db.transaction(() => {
      for (const [key, rawValue] of Object.entries(settings) as Array<[keyof AppSettings, string]>) {
        let value = rawValue
        if (secretKeys.has(key) && value && safeStorage.isEncryptionAvailable()) {
          value = `encrypted:${safeStorage.encryptString(value).toString('base64')}`
        }
        insert.run(key, value)
      }
    })
    transaction()
    return this.getSettings()
  }

  close(): void {
    this.db.close()
  }

  private mapCourse(row: CourseRow): Course {
    return {
      id: row.id,
      title: row.title,
      subject: row.subject,
      folderId: row.folder_id,
      createdAt: row.created_at,
      durationMs: row.duration_ms,
      status: row.status,
      sourceAudioPath: row.source_audio_path,
      wavPath: row.wav_path,
      rawTranscript: row.raw_transcript,
      cleanTranscript: row.clean_transcript,
      studyMarkdown: row.study_markdown,
      errorStage: row.error_stage,
      errorMessage: row.error_message
    }
  }

  private mapFolder(row: FolderRow): CourseFolder {
    return { id: row.id, subject: row.subject, name: row.name, createdAt: row.created_at }
  }
}
