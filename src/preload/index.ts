import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, AppSettings, JobProgress, RecordingFinishInput, RecordingStartInput, UpdateStatus } from '../shared/types'
import { IPC } from '../shared/types'

const api: AppApi = {
  courses: {
    list: () => ipcRenderer.invoke(IPC.coursesList),
    get: (id) => ipcRenderer.invoke(IPC.coursesGet, id),
    rename: (id, title) => ipcRenderer.invoke(IPC.coursesRename, id, title),
    move: (id, placement) => ipcRenderer.invoke(IPC.coursesMove, id, placement),
    duplicate: (id, placement) => ipcRenderer.invoke(IPC.coursesDuplicate, id, placement),
    remove: (id) => ipcRenderer.invoke(IPC.coursesRemove, id),
    retry: (id) => ipcRenderer.invoke(IPC.coursesRetry, id),
    startProcessing: (id) => ipcRenderer.invoke(IPC.coursesProcess, id),
    rerunCleanup: (id) => ipcRenderer.invoke(IPC.coursesCleanup, id),
    generateStudyGuide: (id) => ipcRenderer.invoke(IPC.coursesStudy, id),
    importAudio: () => ipcRenderer.invoke(IPC.coursesImport),
    exportMarkdown: (id, variant) => ipcRenderer.invoke(IPC.coursesExport, id, variant),
    sendToNotion: (id, variant) => ipcRenderer.invoke(IPC.coursesNotion, id, variant)
  },
  folders: {
    list: () => ipcRenderer.invoke(IPC.foldersList),
    create: (subject, name) => ipcRenderer.invoke(IPC.foldersCreate, subject, name),
    rename: (id, name) => ipcRenderer.invoke(IPC.foldersRename, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.foldersRemove, id)
  },
  subjects: {
    rename: (from, to) => ipcRenderer.invoke(IPC.subjectsRename, from, to)
  },
  notes: {
    get: (courseId) => ipcRenderer.invoke(IPC.notesGet, courseId),
    save: (courseId, notes) => ipcRenderer.invoke(IPC.notesSave, courseId, notes)
  },
  recording: {
    start: (input: RecordingStartInput) => ipcRenderer.invoke(IPC.recordingStart, input),
    writeChunk: (courseId: string, chunk: Uint8Array) => ipcRenderer.invoke(IPC.recordingChunk, courseId, chunk),
    finish: (input: RecordingFinishInput) => ipcRenderer.invoke(IPC.recordingFinish, input),
    cancel: (courseId: string) => ipcRenderer.invoke(IPC.recordingCancel, courseId)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (settings: AppSettings) => ipcRenderer.invoke(IPC.settingsSave, settings)
  },
  assets: {
    status: () => ipcRenderer.invoke(IPC.assetsStatus),
    downloadWhisper: () => ipcRenderer.invoke(IPC.assetsDownload)
  },
  models: {
    list: (provider) => ipcRenderer.invoke(IPC.modelsList, provider)
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updatesStatus),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    download: () => ipcRenderer.invoke(IPC.updatesDownload),
    install: () => ipcRenderer.invoke(IPC.updatesInstall)
  },
  events: {
    onProgress: (callback: (progress: JobProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: JobProgress): void => callback(value)
      ipcRenderer.on(IPC.progress, listener)
      return () => ipcRenderer.removeListener(IPC.progress, listener)
    },
    onCourseUpdated: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]): void => callback(value)
      ipcRenderer.on(IPC.courseUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.courseUpdated, listener)
    },
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: UpdateStatus): void => callback(value)
      ipcRenderer.on(IPC.updateStatus, listener)
      return () => ipcRenderer.removeListener(IPC.updateStatus, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
