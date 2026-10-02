import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { AppSettings, AssetStatus, CliModelOption, Course, CoursePlacement, JobProgress, UpdateStatus } from '../../shared/types'
import { MAX_TITLE_LENGTH } from '../../shared/course-metadata'
import { placeLabel, QuickStart, type LibraryView } from './components'
import type { RecordingMetadata } from './use-recorder'
import { foldForSearch } from './course-filter'
import { collapseSpaces, formatRelativeDate, Icon, isBusy, Kbd, plural, ProgressBar } from './ui'

interface Destination { key: string; placement: CoursePlacement; label: string; hint?: string; nested: boolean }

// « Déplacer vers… » : choisir une matière ou un dossier au clavier ou à la souris.
export function MoveDialog({ lib, count, onChoose, onClose }: {
  lib: LibraryView; count: number; onChoose(placement: CoursePlacement): void; onClose(): void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const destinations = useMemo<Destination[]>(() => {
    const needle = foldForSearch(query.trim())
    const matches = (value: string): boolean => !needle || needle.split(' ').every((part) => foldForSearch(value).includes(part))
    return lib.tree.filter((node) => node.subject).flatMap((node): Destination[] => [
      { key: `s:${node.subject}`, placement: { subject: node.subject, folderId: null }, label: node.subject, nested: false },
      ...node.folders.map(({ folder }) => ({ key: `f:${folder.id}`, placement: { subject: node.subject, folderId: folder.id }, label: folder.name, hint: node.subject, nested: true }))
    ]).filter((item) => matches(`${item.label} ${item.hint ?? ''}`))
  }, [lib.tree, query])

  useEffect(() => setCursor(0), [query])
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [cursor])
  const choose = (item: Destination | undefined): void => { if (item) onChoose(item.placement) }

  return <div className="modal-backdrop palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Déplacer vers">
      <div className="palette-input"><Icon name="move" size={18}/>
        <input autoFocus value={query} placeholder={`Déplacer ${plural(count, 'cours', 'cours')} vers…`} aria-label="Destination"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((value) => Math.min(destinations.length - 1, value + 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((value) => Math.max(0, value - 1)) }
            else if (event.key === 'Enter') { event.preventDefault(); choose(destinations[cursor]) }
            else if (event.key === 'Escape') { event.preventDefault(); onClose() }
          }}/>
        <Kbd>Échap</Kbd>
      </div>
      <div className="palette-list" ref={list} role="listbox">
        {destinations.length === 0 && <p className="palette-empty">Aucune matière ni dossier ne correspond.</p>}
        {destinations.map((item, index) => <button key={item.key} role="option" aria-selected={index === cursor} data-active={index === cursor}
          className={`palette-item ${item.nested ? 'nested' : ''}`} onMouseMove={() => setCursor(index)} onClick={() => choose(item)}>
          <Icon name={item.nested ? 'folder' : 'book'}/><span className="palette-label">{item.label}</span>
          {item.hint && query.trim() && <span className="palette-hint">{item.hint}</span>}
          {index === cursor && <Icon name="enter" size={14}/>}
        </button>)}
      </div>
    </div>
  </div>
}

function mergeBlocker(course: Course): string | null {
  if (course.status === 'recording') return 'En cours d’enregistrement'
  if (isBusy(course)) return 'Traitement en cours'
  if (!course.cleanTranscript) return 'Pas encore de cours nettoyé'
  return null
}

// Fusionner plusieurs enregistrements d'un même chapitre en un seul cours rédigé par l'IA.
export function MergeDialog({ lib, courses, onMerge, onClose }: {
  lib: LibraryView; courses: Course[]; onMerge(title: string): Promise<boolean>; onClose(): void
}): JSX.Element {
  const sorted = useMemo(() => [...courses].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [courses])
  const [title, setTitle] = useState(() => `${sorted[0]?.title ?? 'Cours'} (fusion)`)
  const [merging, setMerging] = useState(false)
  const blocked = sorted.some((course) => mergeBlocker(course))
  const canMerge = sorted.length >= 2 && !blocked && Boolean(collapseSpaces(title)) && !merging
  const submit = async (): Promise<void> => {
    if (!canMerge) return
    setMerging(true)
    if (!(await onMerge(collapseSpaces(title)))) setMerging(false)
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
    <section className="modal compact" role="dialog" aria-modal="true" aria-labelledby="merge-title">
      <header><h2 id="merge-title">Fusionner {plural(sorted.length, 'cours', 'cours')}</h2><button className="icon-button" onClick={onClose}><Icon name="close"/><span className="sr-only">Annuler</span></button></header>
      <div className="modal-body merge-body">
        <p className="merge-intro">L’IA réunit ces enregistrements en un seul cours : les redites sont supprimées, les compléments de chaque séance intégrés et les contradictions signalées « À vérifier ». Les cours d’origine sont conservés.</p>
        <ol className="merge-sources">
          {sorted.map((course) => {
            const blocker = mergeBlocker(course)
            return <li key={course.id} className={blocker ? 'blocked' : ''}>
              <Icon name="page" size={15}/>
              <span className="merge-source-title">{course.title}</span>
              <span className="merge-source-meta">{blocker ?? `${placeLabel(course, lib.folderById)} · ${formatRelativeDate(course.createdAt)}`}</span>
            </li>
          })}
        </ol>
        <label className="merge-field"><span>Titre du cours fusionné</span>
          <input autoFocus value={title} maxLength={MAX_TITLE_LENGTH} onChange={(event) => setTitle(event.target.value)}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submit() } }}/>
        </label>
        {blocked && <p className="form-error" role="alert">Seuls des cours transcrits et nettoyés peuvent être fusionnés.</p>}
      </div>
      <footer><button className="button subtle" onClick={onClose}>Annuler</button><button className="button primary" onClick={() => void submit()} disabled={!canMerge}><Icon name="merge" size={14}/>{merging ? 'Lancement…' : 'Fusionner'}</button></footer>
    </section>
  </div>
}

export function QuickStartModal({ lib, placement, starting, onStart, onClose }: {
  lib: LibraryView; placement: Partial<CoursePlacement>; starting: boolean; onStart(metadata: RecordingMetadata): void; onClose(): void
}): JSX.Element {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
    <section className="modal compact" role="dialog" aria-modal="true" aria-labelledby="quick-start-title">
      <header><h2 id="quick-start-title">Nouveau cours</h2><button className="icon-button" onClick={onClose}><Icon name="close"/><span className="sr-only">Annuler</span></button></header>
      <div className="modal-body"><QuickStart lib={lib} placement={placement} starting={starting} autoFocus onStart={onStart}/></div>
    </section>
  </div>
}

export function SettingsModal({ initial, assets, progress, updateStatus, recording, onClose, onSaved, onDownload, onCheckUpdate, onDownloadUpdate, onInstallUpdate }: {
  initial: AppSettings; assets: AssetStatus | null; progress?: JobProgress; updateStatus: UpdateStatus | null; recording: boolean; onClose(): void
  onSaved(settings: AppSettings): void; onDownload(): void; onCheckUpdate(): void; onDownloadUpdate(): void; onInstallUpdate(): void
}): JSX.Element {
  const [settings, setSettings] = useState(initial)
  const [modelOptions, setModelOptions] = useState<CliModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => setSettings((current) => ({ ...current, [key]: value }))
  const modelKey: 'claudeModel' | 'codexModel' = settings.cleanupProvider === 'codex' ? 'codexModel' : 'claudeModel'
  const configuredModel = settings[modelKey]

  useEffect(() => {
    let active = true
    setModelsLoading(true)
    setModelsError(null)
    void window.api.models.list(settings.cleanupProvider)
      .then((models) => { if (active) setModelOptions(models) })
      .catch((error) => {
        if (!active) return
        setModelOptions([])
        setModelsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { if (active) setModelsLoading(false) })
    return () => { active = false }
  }, [settings.cleanupProvider])

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header><h2 id="settings-title">Réglages</h2><button className="icon-button" onClick={onClose}><Icon name="close"/><span className="sr-only">Fermer</span></button></header>
      <div className="settings-grid">
        <label><span>Transcription</span><select value={settings.sttProvider} onChange={(e) => update('sttProvider', e.target.value as AppSettings['sttProvider'])}><option value="local-whisper">Whisper local</option><option value="openai">OpenAI</option></select></label>
        <label><span>Nettoyage</span><select value={settings.cleanupProvider} onChange={(e) => update('cleanupProvider', e.target.value as AppSettings['cleanupProvider'])}><option value="claude-code">Claude Code</option><option value="codex">Codex</option></select></label>
        <label className="wide model-setting"><span>Modèle {settings.cleanupProvider === 'codex' ? 'Codex' : 'Claude Code'}</span><select value={configuredModel} onChange={(event) => update(modelKey, event.target.value)} disabled={modelsLoading}>
          <option value="">Par défaut de la CLI</option>
          {configuredModel && !modelOptions.some((model) => model.id === configuredModel) && <option value={configuredModel}>{configuredModel} · configuré</option>}
          {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select><small>{modelsLoading ? 'Lecture des modèles de la CLI installée…' : modelsError ? `Catalogue indisponible : ${modelsError}` : `${modelOptions.length} modèle${modelOptions.length > 1 ? 's' : ''} détecté${modelOptions.length > 1 ? 's' : ''}. Ce choix s’applique au nettoyage et aux fiches.`}</small></label>
        <label className="wide"><span>Clé API OpenAI</span><input type="password" value={settings.openaiApiKey} onChange={(e) => update('openaiApiKey', e.target.value)} placeholder="sk-…" /></label>
        <label className="wide"><span>Dossier audio</span><input value={settings.audioStoragePath} onChange={(e) => update('audioStoragePath', e.target.value)} /></label>
        <div className="settings-separator wide"><span>Notion</span></div>
        <label className="wide"><span>Token d’intégration</span><input type="password" value={settings.notionToken} onChange={(e) => update('notionToken', e.target.value)} placeholder="secret_…" /></label>
        <label><span>Type de parent</span><select value={settings.notionParentType} onChange={(e) => update('notionParentType', e.target.value as AppSettings['notionParentType'])}><option value="page_id">Page</option><option value="database_id">Base de données</option></select></label>
        <label><span>ID du parent</span><input value={settings.notionParentId} onChange={(e) => update('notionParentId', e.target.value)} /></label>
      </div>
      <div className="engine-card">
        <div><strong>Moteur Whisper local</strong><span>{assets?.binaryReady && assets.modelReady && assets.vadReady ? 'Binaire, modèle Q5 et VAD installés' : 'Téléchargement requis avant la première transcription locale'}</span></div>
        <button className="button" onClick={onDownload} disabled={progress?.stage === 'download'}>{assets?.binaryReady && assets.modelReady ? 'Réinstaller' : 'Télécharger'}</button>
        {progress?.stage === 'download' && <ProgressBar progress={progress}/>}
      </div>
      <div className="engine-card">
        <div><strong>Mises à jour</strong><span>{updateStatus?.phase === 'available' ? `Version ${updateStatus.version} disponible` : updateStatus?.phase === 'downloading' ? `Téléchargement de la version ${updateStatus.version} : ${updateStatus.percent ?? 0} %` : updateStatus?.phase === 'downloaded' ? `Version ${updateStatus.version} prête à installer` : updateStatus?.phase === 'checking' ? 'Recherche en cours…' : updateStatus?.phase === 'current' ? `Version ${updateStatus.currentVersion} à jour` : updateStatus?.phase === 'error' || updateStatus?.phase === 'unavailable' ? updateStatus.message : `Version actuelle : ${updateStatus?.currentVersion ?? '…'}`}</span></div>
        {updateStatus?.phase === 'available' ? <button className="button" onClick={onDownloadUpdate}>Télécharger</button>
          : updateStatus?.phase === 'downloaded' ? <button className="button" onClick={onInstallUpdate} disabled={recording} title={recording ? 'Terminez l’enregistrement avant de redémarrer.' : undefined}>Redémarrer et installer</button>
            : <button className="button" onClick={onCheckUpdate} disabled={updateStatus?.phase === 'checking' || updateStatus?.phase === 'downloading'}>Vérifier</button>}
        {updateStatus?.phase === 'downloading' && <div className="update-progress"><span style={{ width: `${updateStatus.percent ?? 0}%` }}/></div>}
      </div>
      <footer><button className="button subtle" onClick={onClose}>Annuler</button><button className="button primary" onClick={() => onSaved(settings)}>Enregistrer</button></footer>
    </section>
  </div>
}
