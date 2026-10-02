import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { electronApp, is } from '@electron-toolkit/utils'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, extname, join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'
import { copyFile, cp, mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { AppSettings, CleanupProviderName, Course, CourseNotesInput, CoursePlacement, DocumentVariant, JobProgress, MergeInput, RecordingFinishInput, RecordingStartInput } from '../shared/types'
import { IPC } from '../shared/types'
import { AppDatabase } from './database'
import { RecordingService } from './recording-service'
import { JobManager } from './job-manager'
import { AssetManager, preserveManagedAssetPaths } from './asset-manager'
import { NotionService } from './notion'
import { UpdateManager } from './update-manager'
import { listCliModels } from './model-catalog'
import { MAX_TITLE_LENGTH, normalizeFolderName, normalizeSubject } from '../shared/course-metadata'
import { localImagesToFileUrls, MAX_NOTE_IMAGE_BYTES, NOTE_IMAGE_EXTENSIONS, NOTE_IMAGE_SCHEME, noteImageUrl, resolveNoteImagePath, retargetNoteImages, stripLocalImages } from './note-images'

let database: AppDatabase
let recordingService: RecordingService
let jobManager: JobManager
let assetManager: AssetManager
let notionService: NotionService
let updateManager: UpdateManager
let downloadPromise: Promise<void> | null = null
let noteImagesRoot: string

// Doit être déclaré avant que l'application soit prête pour que les <img> puissent charger ce schéma.
protocol.registerSchemesAsPrivileged([{ scheme: NOTE_IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])

// L'application empaquetée prend son icône dans le bundle ; en développement il faut la poser
// à la main, sinon la barre des tâches et le Dock affichent celle d'Electron.
const developmentIconPath = join(__dirname, '../../build/icon.png')

function applyDevelopmentIcon(): void {
  if (app.isPackaged || !existsSync(developmentIconPath)) return
  if (process.platform === 'darwin') app.dock?.setIcon(developmentIconPath)
}

function broadcast(channel: string, value: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, value)
}

function emitProgress(progress: JobProgress): void {
  broadcast(IPC.progress, progress)
}

function emitCourse(course: Course): void {
  broadcast(IPC.courseUpdated, course)
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#0f0f0f',
    ...(app.isPackaged || !existsSync(developmentIconPath) ? {} : { icon: developmentIconPath }),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f0f0f', symbolColor: '#9b9b9b', height: 44 },
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  window.on('ready-to-show', () => window.show())
  // Le renderer bloque la fermeture pendant un enregistrement : on laisse l'utilisateur trancher.
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['Continuer l’enregistrement', 'Quitter quand même'],
      defaultId: 0,
      cancelId: 0,
      message: 'Un cours est en cours d’enregistrement.',
      detail: 'Si vous quittez maintenant, la suite du cours ne sera pas captée. L’audio déjà enregistré et vos notes sont conservés.'
    })
    if (choice === 1) event.preventDefault()
  })
  if (process.env.FAC_SMOKE_TEST === '1') {
    window.webContents.once('did-finish-load', () => {
      console.info('FAC_SMOKE_READY')
      setTimeout(() => app.quit(), 750)
    })
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
}

function requireCourse(id: string): Course {
  const course = database.getCourse(id)
  if (!course) throw new Error('Cours introuvable.')
  return course
}

function registerIpc(): void {
  ipcMain.handle(IPC.coursesList, () => database.listCourses())
  ipcMain.handle(IPC.coursesGet, (_event, id: string) => database.getCourse(id))
  ipcMain.handle(IPC.coursesRename, (_event, id: string, title: unknown) => {
    const course = requireCourse(id)
    if (typeof title !== 'string') throw new Error('Le titre est invalide.')
    const nextTitle = title.replace(/\s+/g, ' ').trim()
    if (!nextTitle) throw new Error('Le titre ne peut pas être vide.')
    if (nextTitle.length > 200) throw new Error('Le titre ne peut pas dépasser 200 caractères.')

    const renameHeading = (markdown: string | null): string | null => {
      if (!markdown) return markdown
      const lines = markdown.split('\n')
      if (lines[0]?.trim() === `# ${course.title}`) lines[0] = `# ${nextTitle}`
      return lines.join('\n')
    }
    const updated = database.updateCourse(id, {
      title: nextTitle,
      cleanTranscript: renameHeading(course.cleanTranscript),
      studyMarkdown: renameHeading(course.studyMarkdown)
    })
    emitCourse(updated)
    return updated
  })
  ipcMain.handle(IPC.coursesMove, (_event, id: string, placement: CoursePlacement) => {
    requireCourse(id)
    const subject = normalizeSubject(String(placement?.subject ?? ''))
    const updated = database.updateCourse(id, { subject, folderId: database.folderIdWithin(subject, placement.folderId ?? null) })
    emitCourse(updated)
    return updated
  })
  // Copier-coller un cours en fait un double complet : audio, transcriptions, fiche et notes.
  // Collé au même endroit que l'original, le double est suffixé « (copie) » pour les distinguer.
  ipcMain.handle(IPC.coursesDuplicate, async (_event, id: string, placement: CoursePlacement) => {
    const course = requireCourse(id)
    if (course.status === 'recording' || jobManager.isActive(id)) throw new Error(`Attendez la fin de l’enregistrement ou du traitement de « ${course.title} » avant de le copier.`)
    const subject = normalizeSubject(String(placement?.subject ?? ''))
    const folderId = database.folderIdWithin(subject, placement.folderId ?? null)
    const copyId = randomUUID()
    const copyAudio = async (path: string | null, suffix: string): Promise<string | null> => {
      if (!path || !existsSync(path)) return null
      const destination = join(dirname(path), `${copyId}${suffix}`)
      await copyFile(path, destination)
      return destination
    }
    const sourceAudioPath = course.mergedFrom ? '' : await copyAudio(course.sourceAudioPath, extname(course.sourceAudioPath))
    if (sourceAudioPath === null) throw new Error(`L’audio de « ${course.title} » est introuvable : impossible de le copier.`)
    const wavPath = await copyAudio(course.wavPath, '.16k.wav')
    const samePlace = subject === course.subject && folderId === course.folderId
    const copy = database.createCourse({ ...course, id: copyId, title: samePlace ? `${course.title} (copie)` : course.title, subject, folderId, sourceAudioPath, wavPath })
    const notes = database.getNotes(id)
    if (notes.blocks) {
      const images = join(noteImagesRoot, id)
      if (existsSync(images)) await cp(images, join(noteImagesRoot, copyId), { recursive: true })
      database.saveNotes(copyId, { blocks: retargetNoteImages(notes.blocks, id, copyId), markdown: retargetNoteImages(notes.markdown, id, copyId) })
    }
    emitCourse(copy)
    return copy
  })
  ipcMain.handle(IPC.subjectsRename, (_event, from: unknown, to: unknown) => database.renameSubject(normalizeSubject(String(from ?? '')), normalizeSubject(String(to ?? ''))))
  ipcMain.handle(IPC.foldersList, () => database.listFolders())
  ipcMain.handle(IPC.foldersCreate, (_event, subject: unknown, name: unknown) => database.createFolder({
    id: randomUUID(),
    subject: normalizeSubject(String(subject ?? '')),
    name: normalizeFolderName(String(name ?? '')),
    createdAt: new Date().toISOString()
  }))
  ipcMain.handle(IPC.foldersRename, (_event, id: string, name: unknown) => database.renameFolder(id, normalizeFolderName(String(name ?? ''))))
  ipcMain.handle(IPC.foldersRemove, (_event, id: string) => database.deleteFolder(id))
  ipcMain.handle(IPC.coursesRetry, (_event, id: string) => {
    const course = requireCourse(id)
    if (course.errorStage === 'study' && course.cleanTranscript) jobManager.startStudy(id)
    else if (course.mergedFrom) jobManager.startMerge(id)
    else if (course.errorStage === 'cleanup' && course.rawTranscript) jobManager.startCleanup(id)
    else jobManager.start(id)
  })
  ipcMain.handle(IPC.coursesProcess, (_event, id: string) => {
    const course = requireCourse(id)
    if (course.status === 'recording') throw new Error('L’enregistrement est encore en cours.')
    if (course.mergedFrom) jobManager.startMerge(id)
    else jobManager.start(id)
  })
  ipcMain.handle(IPC.coursesCleanup, (_event, id: string) => {
    requireCourse(id)
    jobManager.startCleanup(id)
  })
  ipcMain.handle(IPC.coursesStudy, (_event, id: string) => {
    requireCourse(id)
    jobManager.startStudy(id)
  })
  // Fusionner crée un nouveau cours, sans audio, rangé avec le plus ancien des cours fusionnés.
  // Les cours d'origine restent intacts.
  ipcMain.handle(IPC.coursesMerge, (_event, input: MergeInput) => {
    const ids = [...new Set(Array.isArray(input?.courseIds) ? input.courseIds.filter((id): id is string => typeof id === 'string') : [])]
    if (ids.length < 2) throw new Error('Sélectionnez au moins deux cours à fusionner.')
    const title = String(input?.title ?? '').replace(/\s+/g, ' ').trim()
    if (!title) throw new Error('Donnez un titre au cours fusionné.')
    if (title.length > MAX_TITLE_LENGTH) throw new Error(`Le titre ne peut pas dépasser ${MAX_TITLE_LENGTH} caractères.`)
    const sources = ids.map(requireCourse).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (const source of sources) {
      if (source.status === 'recording' || jobManager.isActive(source.id)) throw new Error(`Attendez la fin de l’enregistrement ou du traitement de « ${source.title} » avant de le fusionner.`)
      if (!source.cleanTranscript) throw new Error(`« ${source.title} » n’a pas encore de cours nettoyé : transcrivez-le avant de le fusionner.`)
    }
    const course = database.createCourse({
      id: randomUUID(),
      title,
      subject: sources[0].subject,
      folderId: sources[0].folderId,
      createdAt: new Date().toISOString(),
      durationMs: sources.reduce((sum, source) => sum + source.durationMs, 0),
      status: 'merging',
      sourceAudioPath: '',
      wavPath: null,
      rawTranscript: null,
      cleanTranscript: null,
      studyMarkdown: null,
      errorStage: null,
      errorMessage: null,
      mergedFrom: sources.map((source) => source.id)
    })
    emitCourse(course)
    jobManager.startMerge(course.id)
    return course
  })
  ipcMain.handle(IPC.coursesRemove, async (_event, id: string) => {
    const course = requireCourse(id)
    if (jobManager.isActive(id)) throw new Error('Attendez la fin du traitement avant de supprimer ce cours.')
    for (const path of [course.sourceAudioPath, course.wavPath, join(noteImagesRoot, id)]) {
      if (path && existsSync(path)) await shell.trashItem(path)
    }
    database.deleteCourse(id)
  })
  ipcMain.handle(IPC.coursesImport, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Importer un enregistrement',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['webm', 'wav', 'mp3', 'm4a', 'ogg', 'flac', 'mp4'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const source = result.filePaths[0]
    const settings = database.getSettings()
    mkdirSync(settings.audioStoragePath, { recursive: true })
    const id = randomUUID()
    const destination = join(settings.audioStoragePath, `${id}${extname(source).toLowerCase()}`)
    copyFileSync(source, destination)
    const course = database.createCourse({
      id,
      title: parse(basename(source)).name,
      subject: '',
      folderId: null,
      createdAt: new Date().toISOString(),
      durationMs: 0,
      status: 'recorded',
      sourceAudioPath: destination,
      wavPath: null,
      rawTranscript: null,
      cleanTranscript: null,
      studyMarkdown: null,
      errorStage: null,
      errorMessage: null,
      mergedFrom: null
    })
    emitCourse(course)
    jobManager.start(id)
    return course
  })
  const documentMarkdown = (course: Course, variant: DocumentVariant): string | null => variant === 'notes'
    ? database.getNotes(course.id).markdown.trim() || null
    : variant === 'study' ? course.studyMarkdown : course.cleanTranscript
  ipcMain.handle(IPC.coursesExport, async (_event, id: string, variant: DocumentVariant) => {
    const course = requireCourse(id)
    const markdown = documentMarkdown(course, variant)
    const content = markdown && variant === 'notes' ? localImagesToFileUrls(markdown, noteImagesRoot) : markdown
    if (!content) throw new Error(variant === 'notes' ? 'Vos notes sont vides.' : 'Aucune transcription à exporter.')
    const result = await dialog.showSaveDialog({
      title: 'Exporter la transcription',
      defaultPath: `${course.title.replace(/[<>:"/\\|?*]/g, '-')}${variant === 'study' ? ' - fiche de révision' : variant === 'notes' ? ' - mes notes' : ''}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(result.filePath, content, 'utf8')
    return { canceled: false, filePath: result.filePath }
  })
  ipcMain.handle(IPC.coursesNotion, async (_event, id: string, variant: DocumentVariant) => {
    const course = requireCourse(id)
    const markdown = documentMarkdown(course, variant)
    return notionService.send(course, variant, markdown && variant === 'notes' ? stripLocalImages(markdown) || null : markdown)
  })
  ipcMain.handle(IPC.notesGet, (_event, courseId: string) => {
    requireCourse(courseId)
    return database.getNotes(courseId)
  })
  ipcMain.handle(IPC.notesUploadImage, async (_event, courseId: string, name: unknown, bytes: unknown) => {
    requireCourse(courseId)
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error('Image invalide.')
    if (bytes.byteLength > MAX_NOTE_IMAGE_BYTES) throw new Error(`L’image dépasse ${MAX_NOTE_IMAGE_BYTES / 1024 / 1024} Mo.`)
    const extension = extname(String(name ?? '')).toLowerCase()
    if (!NOTE_IMAGE_EXTENSIONS.includes(extension)) throw new Error(`Seules les images peuvent être ajoutées aux notes (${NOTE_IMAGE_EXTENSIONS.join(', ')}).`)
    const fileName = `${randomUUID()}${extension}`
    const directory = join(noteImagesRoot, courseId)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, fileName), bytes)
    return noteImageUrl(courseId, fileName)
  })
  ipcMain.handle(IPC.notesSave, (_event, courseId: string, notes: CourseNotesInput) => {
    requireCourse(courseId)
    if (typeof notes?.blocks !== 'string' || typeof notes?.markdown !== 'string') throw new Error('Notes invalides.')
    database.saveNotes(courseId, { blocks: notes.blocks, markdown: notes.markdown })
  })

  ipcMain.handle(IPC.recordingStart, (_event, input: RecordingStartInput) => {
    const course = recordingService.start(input)
    emitCourse(course)
    return { course }
  })
  ipcMain.handle(IPC.recordingChunk, (_event, courseId: string, chunk: Uint8Array) => recordingService.writeChunk(courseId, chunk))
  ipcMain.handle(IPC.recordingFinish, async (_event, input: RecordingFinishInput) => {
    const course = await recordingService.finish(input.courseId, input.durationMs)
    emitCourse(course)
    return course
  })
  ipcMain.handle(IPC.recordingCancel, (_event, courseId: string) => recordingService.cancel(courseId))

  ipcMain.handle(IPC.settingsGet, () => database.getSettings())
  ipcMain.handle(IPC.settingsSave, (_event, settings: AppSettings) => {
    if (!settings.audioStoragePath.trim()) throw new Error('Le dossier audio ne peut pas être vide.')
    const validModel = (model: string): boolean => !model || /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)
    if (!validModel(settings.claudeModel) || !validModel(settings.codexModel)) throw new Error('Le nom du modèle sélectionné est invalide.')
    mkdirSync(settings.audioStoragePath, { recursive: true })
    assetManager.status()
    return database.saveSettings(preserveManagedAssetPaths(database.getSettings(), settings))
  })
  ipcMain.handle(IPC.assetsStatus, () => assetManager.status())
  ipcMain.handle(IPC.assetsDownload, async () => {
    if (!downloadPromise) downloadPromise = assetManager.downloadAll().finally(() => { downloadPromise = null })
    return downloadPromise
  })
  ipcMain.handle(IPC.modelsList, (_event, provider: CleanupProviderName) => {
    if (provider !== 'claude-code' && provider !== 'codex') throw new Error('Provider de nettoyage invalide.')
    return listCliModels(provider)
  })
  ipcMain.handle(IPC.updatesStatus, () => updateManager.getStatus())
  ipcMain.handle(IPC.updatesCheck, () => updateManager.check())
  ipcMain.handle(IPC.updatesDownload, () => updateManager.download())
  ipcMain.handle(IPC.updatesInstall, () => updateManager.install())
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('fr.factranscript.app')
  applyDevelopmentIcon()
  const userData = app.getPath('userData')
  database = new AppDatabase(join(userData, 'fac-transcript.sqlite3'), join(userData, 'audio'))
  database.recoverInterruptedCourses()
  noteImagesRoot = join(userData, 'note-images')
  protocol.handle(NOTE_IMAGE_SCHEME, (request) => {
    const path = resolveNoteImagePath(noteImagesRoot, request.url)
    if (!path || !existsSync(path)) return new Response('Image introuvable', { status: 404 })
    return net.fetch(pathToFileURL(path).href)
  })
  recordingService = new RecordingService(database)
  jobManager = new JobManager(database, emitProgress, emitCourse)
  assetManager = new AssetManager(database, join(userData, 'runtime'), emitProgress, {
    bundledWhisperDirectory: app.isPackaged
      ? join(process.resourcesPath, 'vendor', 'whisper.cpp', 'darwin-arm64')
      : join(app.getAppPath(), 'vendor', 'whisper.cpp', 'darwin-arm64')
  })
  notionService = new NotionService(database, emitProgress)
  updateManager = new UpdateManager((status) => broadcast(IPC.updateStatus, status))
  registerIpc()
  createWindow()
  if (app.isPackaged && process.env.FAC_SMOKE_TEST !== '1') {
    setTimeout(() => void updateManager.check(), 10_000)
    setInterval(() => void updateManager.check(), 6 * 60 * 60 * 1000)
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => database?.close())
