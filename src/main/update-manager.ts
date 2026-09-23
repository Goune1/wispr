import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

export class UpdateManager {
  private status: UpdateStatus = { phase: 'idle', currentVersion: app.getVersion() }
  private pending: Promise<UpdateStatus> | null = null

  constructor(private readonly emit: (status: UpdateStatus) => void) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('update-available', (info) => this.set({ phase: 'available', version: info.version }))
    autoUpdater.on('update-not-available', () => this.set({ phase: 'current' }))
    autoUpdater.on('download-progress', (progress) => this.set({ phase: 'downloading', version: this.status.version, percent: Math.round(progress.percent) }))
    autoUpdater.on('update-downloaded', (info) => this.set({ phase: 'downloaded', version: info.version }))
    autoUpdater.on('error', (error) => this.set({ phase: 'error', message: error.message }))
  }

  getStatus(): UpdateStatus { return this.status }

  check(): Promise<UpdateStatus> {
    if (this.pending) return this.pending
    if (!app.isPackaged) {
      this.set({ phase: 'unavailable', message: 'Les mises à jour sont disponibles dans l’application installée.' })
      return Promise.resolve(this.status)
    }
    if (this.status.phase === 'downloading' || this.status.phase === 'downloaded') return Promise.resolve(this.status)
    this.set({ phase: 'checking' })
    return this.run(async () => { await autoUpdater.checkForUpdates() })
  }

  download(): Promise<UpdateStatus> {
    if (this.pending) return this.pending
    if (this.status.phase !== 'available') return Promise.resolve(this.status)
    this.set({ phase: 'downloading', version: this.status.version, percent: 0 })
    return this.run(async () => { await autoUpdater.downloadUpdate() })
  }

  install(): void {
    if (this.status.phase !== 'downloaded') throw new Error('Aucune mise à jour prête à installer.')
    autoUpdater.quitAndInstall(false, true)
  }

  private run(task: () => Promise<void>): Promise<UpdateStatus> {
    this.pending = task()
      .catch((error: unknown) => this.set({ phase: 'error', message: error instanceof Error ? error.message : String(error) }))
      .then(() => this.status)
      .finally(() => { this.pending = null })
    return this.pending
  }

  private set(patch: Pick<UpdateStatus, 'phase'> & Partial<UpdateStatus>): void {
    this.status = { currentVersion: app.getVersion(), ...patch }
    this.emit(this.status)
  }
}
