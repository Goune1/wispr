import { contextBridge, ipcRenderer } from 'electron'
import type { AppApi, AppSettings, JobProgress, RecordingFinishInput, RecordingStartInput } from '../shared/types'
import { IPC } from '../shared/types'

const api: AppApi = {
  courses: {
    list: () => ipcRenderer.invoke(IPC.coursesList),
    get: (id) => ipcRenderer.invoke(IPC.coursesGet, id),
    rename: (id, title) => ipcRenderer.invoke(IPC.coursesRename, id, title),
    remove: (id) => ipcRenderer.invoke(IPC.coursesRemove, id),
    retry: (id) => ipcRenderer.invoke(IPC.coursesRetry, id),
    rerunCleanup: (id) => ipcRenderer.invoke(IPC.coursesCleanup, id),
    generateStudyGuide: (id) => ipcRenderer.invoke(IPC.coursesStudy, id),
    importAudio: () => ipcRenderer.invoke(IPC.coursesImport),
    exportMarkdown: (id, variant) => ipcRenderer.invoke(IPC.coursesExport, id, variant),
    sendToNotion: (id, variant) => ipcRenderer.invoke(IPC.coursesNotion, id, variant)
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
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
