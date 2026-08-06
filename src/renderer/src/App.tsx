import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ThinkingOrb } from 'thinking-orbs'
import { selectRecordingFormat } from './recording-format'
import type { AppSettings, AssetStatus, CliModelOption, Course, DocumentVariant, JobProgress } from '../../shared/types'

type IconName = 'record' | 'import' | 'settings' | 'copy' | 'export' | 'notion' | 'retry' | 'trash' | 'back' | 'close' | 'stop' | 'sparkles' | 'more' | 'edit'

function Icon({ name, size = 18 }: { name: IconName; size?: number }): JSX.Element {
  const paths: Record<IconName, JSX.Element> = {
    record: <circle cx="12" cy="12" r="5" fill="currentColor" />,
    import: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 17v3h14v-3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3"/></>,
    export: <><path d="M12 15V3m0 0 4 4m-4-4L8 7"/><path d="M5 13v7h14v-7"/></>,
    notion: <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 17V7l8 10V7"/></>,
    retry: <><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-2 5"/></>,
    trash: <><path d="M4 7h16M9 3h6l1 4H8l1-4Z"/><path d="m7 7 1 14h8l1-14M10 11v6m4-6v6"/></>,
    back: <path d="m15 18-6-6 6-6"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    stop: <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" />,
    sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z"/><path d="m18 14 .7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7L18 14Z"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
    edit: <><path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

const statusLabel: Record<Course['status'], string> = {
  recording: 'En cours', converting: 'Préparation', recorded: 'Audio prêt', transcribing: 'Transcription',
  cleaning: 'Nettoyage', studying: 'Fiche de révision', complete: 'Terminé', error: 'À reprendre'
}

const thinkingStatusLabel: Partial<Record<Course['status'], string>> = {
  transcribing: 'Transcription du cours en cours',
  cleaning: 'Nettoyage de la transcription en cours',
  studying: 'Création de la fiche de révision en cours'
}

function isThinkingStatus(status: Course['status']): boolean {
  return status === 'transcribing' || status === 'cleaning' || status === 'studying'
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return hours ? `${hours}:${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}` : `${minutes}:${rest.toString().padStart(2, '0')}`
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function ProgressBar({ progress, thinking = false }: { progress: JobProgress; thinking?: boolean }): JSX.Element {
  return <div className="job-progress">
    <div className="progress-meta">
      <span className="progress-message">{thinking && <ThinkingOrb state="connecting" size={20} theme="dark" aria-label={progress.message}/>}<span>{progress.message}</span></span>
      <strong>{progress.progress}%</strong>
    </div>
    <div className="progress-track"><span style={{ width: `${progress.progress}%` }} /></div>
  </div>
}

function CourseRow({ course, selected, progress, onClick }: { course: Course; selected: boolean; progress?: JobProgress; onClick(): void }): JSX.Element {
  const thinking = isThinkingStatus(course.status)
  return <button className={`course-row ${selected ? 'selected' : ''}`} onClick={onClick}>
    {thinking
      ? <span className="timeline-orb"><ThinkingOrb state="connecting" size={20} theme="dark" aria-label={thinkingStatusLabel[course.status]}/></span>
      : <span className={`timeline-dot status-${course.status}`} />}
    <span className="course-copy">
      <strong>{course.title}</strong>
      <span>{formatDate(course.createdAt)} · {formatDuration(course.durationMs)}</span>
      {progress && <span className="row-progress"><i style={{ width: `${progress.progress}%` }} /></span>}
    </span>
    <span className={`status-pill status-${course.status}`}>{statusLabel[course.status]}</span>
  </button>
}

function Recorder({ onFinished, onError }: { onFinished(courseId: string): void; onError(message: string): void }): JSX.Element {
  const [title, setTitle] = useState(`Cours du ${new Date().toLocaleDateString('fr-FR')}`)
  const [state, setState] = useState<'idle' | 'recording' | 'stopping'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const courseId = useRef<string | null>(null)
  const startedAt = useRef(0)
  const writeQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (state !== 'recording') return
    const interval = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 250)
    return () => window.clearInterval(interval)
  }, [state])

  useEffect(() => () => { stream.current?.getTracks().forEach((track) => track.stop()) }, [])

  const start = async (): Promise<void> => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } })
      const preferred = selectRecordingFormat((type) => MediaRecorder.isTypeSupported(type))
      const mediaRecorder = new MediaRecorder(media, preferred ? { mimeType: preferred.mimeType, audioBitsPerSecond: 64_000 } : undefined)
      const mimeType = mediaRecorder.mimeType || preferred?.mimeType || 'audio/webm'
      const result = await window.api.recording.start({ title, mimeType, extension: preferred?.extension })
      stream.current = media
      recorder.current = mediaRecorder
      courseId.current = result.course.id
      startedAt.current = Date.now()
      setElapsed(0)
      writeQueue.current = Promise.resolve()
      mediaRecorder.ondataavailable = (event) => {
        if (!event.data.size || !courseId.current) return
        const id = courseId.current
        writeQueue.current = writeQueue.current
          .then(async () => new Uint8Array(await event.data.arrayBuffer()))
          .then((chunk) => window.api.recording.writeChunk(id, chunk))
          .catch((error) => onError(error instanceof Error ? error.message : String(error)))
      }
      mediaRecorder.onerror = () => onError('Le navigateur a interrompu la capture du microphone.')
      mediaRecorder.start(1000)
      setState('recording')
    } catch (error) {
      stream.current?.getTracks().forEach((track) => track.stop())
      onError(error instanceof Error ? error.message : 'Impossible d’accéder au microphone.')
    }
  }

  const stop = async (): Promise<void> => {
    const currentRecorder = recorder.current
    const id = courseId.current
    if (!currentRecorder || !id) return
    setState('stopping')
    const stopped = new Promise<void>((resolve) => currentRecorder.addEventListener('stop', () => resolve(), { once: true }))
    currentRecorder.stop()
    await stopped
    await writeQueue.current
    stream.current?.getTracks().forEach((track) => track.stop())
    try {
      await window.api.recording.finish({ courseId: id, durationMs: Date.now() - startedAt.current })
      onFinished(id)
      setState('idle')
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
      setState('idle')
    }
  }

  return <section className={`recorder ${state !== 'idle' ? 'is-live' : ''}`}>
    <div className="recorder-intro">
      <span className="eyebrow">Nouvelle capture</span>
      <input aria-label="Titre du cours" value={title} onChange={(event) => setTitle(event.target.value)} disabled={state !== 'idle'} />
      <p>{state === 'idle' ? 'Le son est écrit sur le disque au fil de l’enregistrement.' : 'Micro actif · sauvegarde continue'}</p>
    </div>
    <div className="record-control">
      {state === 'idle' ? <button className="record-button" onClick={() => void start()} aria-label="Commencer l’enregistrement"><span><Icon name="record" size={34}/></span>Record</button>
        : <button className="record-button active" onClick={() => void stop()} disabled={state === 'stopping'} aria-label="Arrêter l’enregistrement"><span><Icon name="stop" size={30}/></span>{state === 'stopping' ? 'Patientez' : 'Stop'}</button>}
      <time>{formatDuration(elapsed)}</time>
    </div>
  </section>
}

function SettingsModal({ initial, assets, progress, onClose, onSaved, onDownload }: {
  initial: AppSettings; assets: AssetStatus | null; progress?: JobProgress; onClose(): void
  onSaved(settings: AppSettings): void; onDownload(): void
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
      <header><div><span className="eyebrow">Préférences</span><h2 id="settings-title">Réglages</h2></div><button className="icon-button" onClick={onClose}><Icon name="close"/><span className="sr-only">Fermer</span></button></header>
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
        <button className="secondary-button" onClick={onDownload} disabled={progress?.stage === 'download'}>{assets?.binaryReady && assets.modelReady ? 'Réinstaller' : 'Télécharger'}</button>
        {progress?.stage === 'download' && <ProgressBar progress={progress}/>}
      </div>
      <footer><button className="text-button" onClick={onClose}>Annuler</button><button className="primary-button" onClick={() => onSaved(settings)}>Enregistrer</button></footer>
    </section>
  </div>
}

type DocumentView = DocumentVariant | 'source'

function CourseDetail({ course, progress, onBack, onRename, onRetry, onCleanup, onStudy, onDelete, onError }: {
  course: Course; progress?: JobProgress; onBack(): void; onRename(title: string): Promise<void>; onRetry(): void; onCleanup(): void; onStudy(): void; onDelete(): void; onError(message: string): void
}): JSX.Element {
  const [view, setView] = useState<DocumentView>(course.studyMarkdown ? 'study' : 'course')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(course.title)
  const busy = ['converting', 'transcribing', 'cleaning', 'studying'].includes(course.status)
  const thinking = isThinkingStatus(course.status)
  const content = view === 'source' ? course.rawTranscript : view === 'study' ? course.studyMarkdown : course.cleanTranscript
  const variant: DocumentVariant = view === 'study' ? 'study' : 'course'

  useEffect(() => {
    setView(course.studyMarkdown ? 'study' : 'course')
    setEditingTitle(false)
    setTitleDraft(course.title)
  }, [course.id])

  useEffect(() => {
    if (!editingTitle) setTitleDraft(course.title)
  }, [course.title, editingTitle])

  const copy = async (): Promise<void> => {
    if (content) await navigator.clipboard.writeText(content)
  }
  const exportMd = async (): Promise<void> => {
    try { await window.api.courses.exportMarkdown(course.id, variant) }
    catch (e) { onError(e instanceof Error ? e.message : String(e)) }
  }
  const notion = async (): Promise<void> => {
    try {
      const result = await window.api.courses.sendToNotion(course.id, variant)
      window.open(result.url, '_blank')
    } catch (e) { onError(e instanceof Error ? e.message : String(e)) }
  }
  const generateStudy = (): void => {
    setView('study')
    onStudy()
  }
  const saveTitle = async (): Promise<void> => {
    const nextTitle = titleDraft.replace(/\s+/g, ' ').trim()
    if (!nextTitle) {
      setTitleDraft(course.title)
      setEditingTitle(false)
      onError('Le titre ne peut pas être vide.')
      return
    }
    if (nextTitle === course.title) {
      setEditingTitle(false)
      return
    }
    try {
      await onRename(nextTitle)
      setEditingTitle(false)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  const emptyTitle = course.status === 'studying' && view === 'study'
    ? 'Création de la fiche en cours'
    : busy
      ? 'Traitement du cours en cours'
      : view === 'study'
        ? 'Aucune fiche de révision'
        : 'Le cours complet n’est pas encore disponible'
  const emptyMessage = busy
    ? 'Vous pouvez quitter cet écran : le traitement continue en arrière-plan.'
    : view === 'study'
      ? 'Générez une fiche structurée pour réviser les notions, références et exceptions essentielles.'
      : course.rawTranscript
        ? 'Le son et la transcription source sont conservés. Vous pouvez relancer le nettoyage.'
        : 'Relancez le traitement depuis le fichier audio conservé.'

  return <main className="detail">
    <header className="detail-header">
      <div className="detail-heading">
        <button className="back-button" onClick={onBack}><Icon name="back"/>Tous les cours</button>
        <div className="detail-title">
          <span className="eyebrow">{formatDate(course.createdAt)} · {formatDuration(course.durationMs)}</span>
          {editingTitle
            ? <form className="title-editor" onSubmit={(event) => { event.preventDefault(); void saveTitle() }}>
                <input
                  autoFocus
                  aria-label="Titre du cours"
                  value={titleDraft}
                  maxLength={200}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={() => void saveTitle()}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setTitleDraft(course.title)
                      setEditingTitle(false)
                    }
                  }}
                />
              </form>
            : <div className="title-line"><h1>{course.title}</h1><button className="rename-button" onClick={() => setEditingTitle(true)} disabled={busy} title="Renommer le cours"><Icon name="edit" size={16}/><span className="sr-only">Renommer le cours</span></button></div>}
        </div>
      </div>
      <button className="icon-button danger" onClick={onDelete} disabled={busy}><Icon name="trash"/><span className="sr-only">Supprimer</span></button>
    </header>
    {progress && busy && <ProgressBar progress={progress} thinking={thinking}/>}
    {course.status === 'error' && <div className="error-card"><div><strong>Le traitement s’est arrêté pendant « {course.errorStage} ».</strong><p>{course.errorMessage}</p><small>L’audio source et les documents déjà produits sont conservés.</small></div><button className="secondary-button" onClick={onRetry}><Icon name="retry"/>Réessayer</button></div>}
    <div className="transcript-toolbar">
      <div className="tabs" role="tablist" aria-label="Documents du cours">
        {course.studyMarkdown && <button role="tab" aria-selected={view === 'study'} className={view === 'study' ? 'active' : ''} onClick={() => setView('study')}>Fiche de révision</button>}
        <button role="tab" aria-selected={view === 'course'} className={view === 'course' ? 'active' : ''} onClick={() => setView('course')}>Cours complet</button>
        {!course.studyMarkdown && (course.status === 'studying' || course.errorStage === 'study') && <button role="tab" aria-selected={view === 'study'} className={view === 'study' ? 'active' : ''} onClick={() => setView('study')}>Fiche de révision</button>}
        {view === 'source' && <button role="tab" aria-selected className="active technical-tab">Source technique</button>}
      </div>
      <div className="actions">
        {course.cleanTranscript && view !== 'source' && <button className="study-button" onClick={generateStudy} disabled={busy}><Icon name="sparkles"/>{course.studyMarkdown ? 'Regénérer la fiche' : 'Créer une fiche de révision'}</button>}
        <button onClick={() => void copy()} disabled={!content}><Icon name="copy"/>Copier</button>
        {view !== 'source' && <button onClick={() => void exportMd()} disabled={!content}><Icon name="export"/>Exporter .md</button>}
        {view !== 'source' && <button onClick={() => void notion()} disabled={!content}><Icon name="notion"/>Envoyer vers Notion</button>}
        <details className="source-menu">
          <summary aria-label="Options techniques"><Icon name="more"/><span className="sr-only">Options techniques</span></summary>
          <div>
            {course.rawTranscript && <button onClick={() => setView('source')}>Voir la source technique</button>}
            <button onClick={onRetry} disabled={busy}><Icon name="retry"/>Retranscrire depuis l’audio</button>
            <button onClick={onCleanup} disabled={busy || !course.rawTranscript}><Icon name="sparkles"/>Nettoyer à nouveau</button>
          </div>
        </details>
      </div>
    </div>
    <article className={`transcript ${view === 'source' ? 'raw' : 'markdown'} ${view === 'study' ? 'study' : ''}`}>
      {content
        ? view === 'source'
          ? <pre>{content}</pre>
          : <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        : <div className={`empty-transcript ${thinking ? 'is-thinking' : ''}`}>{thinking
          ? <ThinkingOrb state="connecting" size={64} theme="dark" aria-label={thinkingStatusLabel[course.status]}/>
          : <Icon name="sparkles" size={28}/>}<h3>{emptyTitle}</h3><p>{emptyMessage}</p>{view === 'study' && course.cleanTranscript && !busy && <button className="primary-button" onClick={generateStudy}>Créer la fiche de révision</button>}{view === 'course' && course.rawTranscript && !busy && <button className="secondary-button" onClick={onCleanup}>Nettoyer à nouveau</button>}</div>}
    </article>
  </main>
}

export function App(): JSX.Element {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, JobProgress>>({})
  const [globalProgress, setGlobalProgress] = useState<JobProgress | undefined>()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [assets, setAssets] = useState<AssetStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [courseValues, settingValues, assetValues] = await Promise.all([window.api.courses.list(), window.api.settings.get(), window.api.assets.status()])
    setCourses(courseValues); setSettings(settingValues); setAssets(assetValues)
  }, [])

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : String(e)))
    const offProgress = window.api.events.onProgress((value) => {
      if (value.courseId) setProgress((current) => ({ ...current, [value.courseId!]: value }))
      else setGlobalProgress(value)
    })
    const offCourse = window.api.events.onCourseUpdated((course) => setCourses((current) => {
      const exists = current.some((value) => value.id === course.id)
      return (exists ? current.map((value) => value.id === course.id ? course : value) : [course, ...current])
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }))
    return () => { offProgress(); offCourse() }
  }, [load])

  const selected = useMemo(() => courses.find((course) => course.id === selectedId) || null, [courses, selectedId])
  const importAudio = async (): Promise<void> => {
    try { const course = await window.api.courses.importAudio(); if (course) setSelectedId(course.id) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const remove = async (course: Course): Promise<void> => {
    if (!window.confirm(`Supprimer « ${course.title} » ? Les fichiers audio seront placés dans la corbeille.`)) return
    try { await window.api.courses.remove(course.id); setCourses((current) => current.filter((value) => value.id !== course.id)); setSelectedId(null) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const saveSettings = async (values: AppSettings): Promise<void> => {
    try { const saved = await window.api.settings.save(values); setSettings(saved); setSettingsOpen(false) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const download = async (): Promise<void> => {
    try { await window.api.assets.downloadWhisper(); setAssets(await window.api.assets.status()) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  if (selected) return <div className="app-shell">
    <div className="titlebar"><span className="brand-mark">F</span><span>FAC Transcript</span></div>
    <CourseDetail
      course={selected}
      progress={progress[selected.id]}
      onBack={() => setSelectedId(null)}
      onRename={(title) => window.api.courses.rename(selected.id, title).then(() => undefined)}
      onRetry={() => void window.api.courses.retry(selected.id).catch((e) => setError(e instanceof Error ? e.message : String(e)))}
      onCleanup={() => void window.api.courses.rerunCleanup(selected.id).catch((e) => setError(e instanceof Error ? e.message : String(e)))}
      onStudy={() => void window.api.courses.generateStudyGuide(selected.id).catch((e) => setError(e instanceof Error ? e.message : String(e)))}
      onDelete={() => void remove(selected)}
      onError={setError}
    />
    {error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError(null)}><Icon name="close"/></button></div>}
  </div>

  return <div className="app-shell">
    <div className="titlebar"><span className="brand-mark">F</span><span>FAC Transcript</span></div>
    <main className="home">
      <header className="home-header"><div><span className="eyebrow">Bibliothèque personnelle</span><h1>Vos cours, mot pour mot.</h1></div><div className="header-actions"><button className="secondary-button" onClick={() => void importAudio()}><Icon name="import"/>Importer un audio</button><button className="icon-button" onClick={() => setSettingsOpen(true)}><Icon name="settings"/><span className="sr-only">Réglages</span></button></div></header>
      <Recorder onFinished={(id) => setSelectedId(id)} onError={setError}/>
      <section className="library"><div className="section-heading"><h2>Enregistrements</h2><span>{courses.length} {courses.length > 1 ? 'cours' : 'cours'}</span></div>
        {courses.length ? <div className="course-list">{courses.map((course) => <CourseRow key={course.id} course={course} selected={false} progress={progress[course.id]} onClick={() => setSelectedId(course.id)}/>)}</div>
          : <div className="empty-list"><span className="empty-line"/><p>Votre prochain cours apparaîtra ici.<br/>Donnez-lui un titre, puis lancez l’enregistrement.</p></div>}
      </section>
    </main>
    {settingsOpen && settings && <SettingsModal initial={settings} assets={assets} progress={globalProgress} onClose={() => setSettingsOpen(false)} onSaved={(value) => void saveSettings(value)} onDownload={() => void download()}/>}
    {error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError(null)}><Icon name="close"/></button></div>}
  </div>
}
