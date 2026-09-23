import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ThinkingOrb } from 'thinking-orbs'
import type { Course, CourseFolder, CoursePlacement, DocumentVariant } from '../../shared/types'
import { MAX_FOLDER_NAME_LENGTH, MAX_SUBJECT_LENGTH, MAX_TITLE_LENGTH } from '../../shared/course-metadata'
import { filterCourses, type LibraryScope } from './course-filter'
import { CourseList, EditableTitle, EmptyState, placeLabel, QuickStart, type LibraryActions, type LibraryView } from './components'
import type { Recorder } from './use-recorder'
import {
  errorMessage, FOLDER_SUGGESTIONS, formatDate, formatDuration, Icon, isAwaitingProcessing, isBusy, isThinkingStatus, Menu,
  NameInput, plural, ProgressBar, RecordingTimer, StatusBadge, thinkingStatusLabel, useCourseDrop
} from './ui'

// L'éditeur (BlockNote + Mantine) pèse lourd : il n'est chargé qu'à la première prise de notes.
const LazyNotesEditor = lazy(() => import('./NotesEditor').then((module) => ({ default: module.NotesEditor })))

function NotesEditor(props: { courseId: string; className?: string; onError(message: string): void }): JSX.Element {
  return <Suspense fallback={<div className={`notes-editor ${props.className ?? ''}`}><div className="notes-loading">Chargement de l’éditeur…</div></div>}>
    <LazyNotesEditor {...props}/>
  </Suspense>
}

function greeting(now = new Date()): string {
  const hour = now.getHours()
  return hour < 5 || hour >= 18 ? 'Bonsoir' : 'Bonjour'
}

export function LiveBanner({ recorder, onOpen }: { recorder: Recorder; onOpen?(): void }): JSX.Element | null {
  const course = recorder.course
  if (!course) return null
  const paused = recorder.state === 'paused'
  return <div className={`live-banner ${paused ? 'paused' : ''}`}>
    <span className="live-dot"/>
    <div className="live-banner-copy">
      <strong>{paused ? 'Enregistrement en pause' : 'Enregistrement en cours'}</strong>
      <span>{onOpen ? course.title : paused ? 'Rien n’est capté pendant la pause.' : 'Le micro capte le cours, l’audio est sauvegardé en continu.'}</span>
    </div>
    <RecordingTimer clock={recorder.clock}/>
    {onOpen && <button className="button" onClick={onOpen}><Icon name="notes"/>Mes notes</button>}
    <button className="button" onClick={recorder.togglePause} disabled={recorder.state === 'stopping'}><Icon name={paused ? 'play' : 'pause'}/>{paused ? 'Reprendre' : 'Pause'}</button>
    <button className="button danger-solid" onClick={() => void recorder.stop()} disabled={recorder.state === 'stopping'}><Icon name="stop"/>{recorder.state === 'stopping' ? 'Finalisation…' : 'Terminer'}</button>
  </div>
}

export function HomePage({ lib, recorder, actions }: { lib: LibraryView; recorder: Recorder; actions: LibraryActions }): JSX.Element {
  const recent = useMemo(() => lib.courses.filter((course) => course.status !== 'recording').slice(0, 6), [lib.courses])
  const queue = useMemo(() => lib.courses.filter((course) => isAwaitingProcessing(course) || course.status === 'error' || isBusy(course)), [lib.courses])
  const today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  return <div className="page">
    <p className="page-eyebrow">{today}</p>
    <h1 className="page-title">{greeting()}</h1>

    <section className="home-block">
      {recorder.course
        ? <LiveBanner recorder={recorder} onOpen={() => actions.navigate({ kind: 'course', courseId: recorder.course!.id })}/>
        : <div className="start-card">
            <div className="start-card-head"><Icon name="mic" size={18}/><div><strong>Nouveau cours</strong><span>Prenez vos notes pendant que l’audio est capté.</span></div></div>
            <QuickStart lib={lib} starting={recorder.state === 'starting'} onStart={actions.startRecording}/>
          </div>}
    </section>

    {queue.length > 0 && <section className="home-block">
      <h2 className="section-title">À traiter <span>{queue.length}</span></h2>
      <CourseList courses={queue} lib={lib} showPlace actions={actions} renderAction={(course) =>
        isAwaitingProcessing(course)
          ? <button className="button small" onClick={() => actions.processCourse(course.id)}><Icon name="sparkles" size={14}/>Transcrire</button>
          : course.status === 'error' ? <button className="button small" onClick={() => actions.retryCourse(course.id)}><Icon name="retry" size={14}/>Relancer</button> : null}/>
    </section>}

    <section className="home-block">
      <h2 className="section-title">Matières</h2>
      <SubjectGallery lib={lib} actions={actions}/>
    </section>

    <section className="home-block">
      <h2 className="section-title">Récents</h2>
      {recent.length
        ? <CourseList courses={recent} lib={lib} showPlace actions={actions}/>
        : <EmptyState icon="page" title="Aucun cours pour l’instant">Votre premier enregistrement apparaîtra ici.</EmptyState>}
    </section>
  </div>
}

function SubjectGallery({ lib, actions }: { lib: LibraryView; actions: LibraryActions }): JSX.Element {
  const [adding, setAdding] = useState(false)
  const { dropTarget, dropZone } = useCourseDrop(actions.moveCourses)
  return <div className="gallery">
    {lib.tree.map((node) => {
      const key = `s:${node.subject}`
      return <div key={key} className={`tile ${dropTarget === key ? 'drop-target' : ''}`} {...(node.subject ? dropZone(key, { subject: node.subject, folderId: null }) : {})}>
        <button className="tile-open" onClick={() => actions.navigate({ kind: 'subject', subject: node.subject })}
          onContextMenu={(event) => node.subject && actions.placeMenu({ subject: node.subject, folderId: null }, event)}>
          <span className="tile-icon"><Icon name={node.subject ? 'book' : 'folder'} size={18}/></span>
          <strong>{node.subject || 'Sans matière'}</strong>
          <span>{[plural(node.count, 'cours', 'cours'), node.folders.length ? plural(node.folders.length, 'dossier') : ''].filter(Boolean).join(' · ')}</span>
        </button>
      </div>
    })}
    {adding
      ? <div className="tile editing"><span className="tile-icon"><Icon name="book" size={18}/></span>
          <NameInput initial="" label="Nom de la nouvelle matière" placeholder="Nom de la matière" maxLength={MAX_SUBJECT_LENGTH} onCancel={() => setAdding(false)}
            onCommit={async (name) => { const saved = await actions.createSubject(name); if (saved) setAdding(false); return saved }}/></div>
      : <button className="tile new" onClick={() => setAdding(true)}><span className="tile-icon"><Icon name="plus" size={18}/></span><strong>Nouvelle matière</strong></button>}
  </div>
}

export function LocationPage({ scope, lib, actions }: { scope: Extract<LibraryScope, { kind: 'subject' | 'folder' }>; lib: LibraryView; actions: LibraryActions }): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [addingFolder, setAddingFolder] = useState(false)
  const [editingFolder, setEditingFolder] = useState<string | null>(null)
  const { dropTarget, dropZone } = useCourseDrop(actions.moveCourses)
  const folder = scope.kind === 'folder' ? lib.folderById.get(scope.folderId) : undefined
  const subject = scope.kind === 'subject' ? scope.subject : folder?.subject ?? ''
  const node = lib.tree.find((value) => value.subject === subject)
  const courses = useMemo(() => filterCourses(lib.courses, { query, scope }), [lib.courses, query, scope])
  const scopeKey = scope.kind === 'subject' ? `s:${scope.subject}` : `f:${scope.folderId}`

  useEffect(() => { setQuery(''); setAddingFolder(false); setEditingFolder(null) }, [scopeKey])
  if (!node || (scope.kind === 'folder' && !folder)) return null

  const placement: CoursePlacement = { subject, folderId: folder?.id ?? null }
  const canFile = Boolean(subject)
  const folderCount = folder ? node.folders.find((value) => value.folder.id === folder.id)?.count ?? 0 : 0
  const meta = folder
    ? plural(folderCount, 'cours', 'cours')
    : [plural(node.count, 'cours', 'cours'), node.folders.length ? plural(node.folders.length, 'dossier') : ''].filter(Boolean).join(' · ')
  const pasteCount = lib.clipboard?.courseIds.length ?? 0

  return <div className="page" onContextMenu={(event) => {
    // Un clic droit dans le vide de la page propose de coller ici.
    if (canFile && !(event.target as HTMLElement).closest('button, input, a, .tile, [data-course-id]')) actions.placeMenu(placement, event)
  }}>
    <div className="page-icon"><Icon name={folder ? 'folder' : 'book'} size={30}/></div>
    {folder
      ? <EditableTitle value={folder.name} maxLength={MAX_FOLDER_NAME_LENGTH} onSave={(name) => actions.renameFolder(folder, name)}/>
      : <EditableTitle value={subject || 'Sans matière'} editable={canFile} maxLength={MAX_SUBJECT_LENGTH} onSave={(name) => actions.renameSubject(subject, name)}/>}
    <div className="page-toolbar">
      <span className="page-meta">{meta}</span>
      <div className="page-toolbar-actions">
        {canFile && pasteCount > 0 && <button className="button" onClick={() => actions.paste(placement)} title="⌘V"><Icon name="paste"/>{lib.clipboard?.mode === 'cut' ? 'Déplacer ici' : 'Coller ici'} ({pasteCount})</button>}
        {canFile && <button className="button primary" onClick={() => actions.openQuickStart(placement)}><span className="rec-dot"/>Nouveau cours ici</button>}
        {!folder && canFile && <button className="button" onClick={() => setAddingFolder(true)}><Icon name="plus"/>Dossier</button>}
        {folder && <Menu label="Options du dossier">{(close) => <>
          <button role="menuitem" onClick={() => { close(); actions.navigate({ kind: 'subject', subject }) }}><Icon name="book"/>Ouvrir {subject}</button>
          <button role="menuitem" className="danger" onClick={() => { close(); actions.deleteFolder(folder) }}><Icon name="trash"/>Supprimer le dossier</button>
        </>}</Menu>}
      </div>
    </div>

    {scope.kind === 'subject' && canFile && (node.folders.length > 0 || addingFolder) && <section className="page-section">
      <h2 className="section-title">Dossiers</h2>
      <div className="gallery compact">
        {node.folders.map(({ folder: child, count }) => {
          const key = `f:${child.id}`
          return editingFolder === child.id
            ? <div key={key} className="tile editing"><span className="tile-icon"><Icon name="folder" size={18}/></span>
                <NameInput initial={child.name} label="Nom du dossier" placeholder="Nom du dossier" maxLength={MAX_FOLDER_NAME_LENGTH} suggestions="folder-suggestions" onCancel={() => setEditingFolder(null)}
                  onCommit={async (name) => { const saved = await actions.renameFolder(child, name); if (saved) setEditingFolder(null); return saved }}/></div>
            : <div key={key} className={`tile ${dropTarget === key ? 'drop-target' : ''}`} {...dropZone(key, { subject, folderId: child.id })}>
                <button className="tile-open" onClick={() => actions.navigate({ kind: 'folder', folderId: child.id })}
                  onContextMenu={(event) => actions.placeMenu({ subject, folderId: child.id }, event)}>
                  <span className="tile-icon"><Icon name="folder" size={18}/></span>
                  <strong>{child.name}</strong>
                  <span>{plural(count, 'cours', 'cours')}</span>
                </button>
                <span className="tile-actions">
                  <button onClick={() => setEditingFolder(child.id)} title="Renommer"><Icon name="edit" size={14}/><span className="sr-only">Renommer {child.name}</span></button>
                  <button className="danger" onClick={() => actions.deleteFolder(child)} title="Supprimer"><Icon name="trash" size={14}/><span className="sr-only">Supprimer {child.name}</span></button>
                </span>
              </div>
        })}
        {addingFolder && <div className="tile editing"><span className="tile-icon"><Icon name="folder" size={18}/></span>
          <NameInput initial="" label="Nom du nouveau dossier" placeholder="Travaux dirigés" maxLength={MAX_FOLDER_NAME_LENGTH} suggestions="folder-suggestions" onCancel={() => setAddingFolder(false)}
            onCommit={async (name) => { const saved = await actions.createFolder(subject, name); if (saved) setAddingFolder(false); return saved }}/></div>}
      </div>
      <datalist id="folder-suggestions">{FOLDER_SUGGESTIONS.map((value) => <option key={value} value={value}/>)}</datalist>
    </section>}

    <section className="page-section">
      <div className="section-head">
        <h2 className="section-title">{folder ? 'Cours' : node.folders.length ? 'Cours hors dossier' : 'Cours'}</h2>
        <label className="filter-field"><Icon name="search" size={14}/><input type="search" value={query} placeholder="Filtrer" aria-label="Filtrer les cours" onChange={(event) => setQuery(event.target.value)}/></label>
      </div>
      {courses.length
        ? <CourseList courses={courses} lib={lib} showPlace={Boolean(query.trim()) && !folder} actions={actions}/>
        : query.trim()
          ? <EmptyState icon="search" title="Aucun cours ne correspond"/>
          : <EmptyState icon="page" title={folder ? 'Ce dossier est vide' : 'Aucun cours ici'}>
              {canFile ? (folder ? 'Lancez un cours d’ici, ou glissez-y un cours depuis une liste.' : node.folders.length ? 'Tous les cours de cette matière sont rangés dans ses dossiers.' : 'Lancez un cours d’ici : il y sera rangé automatiquement.') : ''}
            </EmptyState>}
    </section>
  </div>
}

type DocumentView = DocumentVariant | 'source'

function PlacementSelect({ course, lib, onMove }: { course: Course; lib: LibraryView; onMove(placement: CoursePlacement): void }): JSX.Element {
  const encode = (placement: CoursePlacement): string => JSON.stringify([placement.subject, placement.folderId])
  return <select className="property-select" value={encode({ subject: course.subject, folderId: course.folderId })} aria-label="Ranger ce cours dans" onChange={(event) => {
    const [subject, folderId] = JSON.parse(event.target.value) as [string, string | null]
    onMove({ subject, folderId })
  }}>
    {!course.subject && <option value={encode({ subject: '', folderId: null })} disabled>Sans matière</option>}
    {lib.subjects.map((subject) => <optgroup key={subject} label={subject}>
      <option value={encode({ subject, folderId: null })}>{subject}</option>
      {lib.folders.filter((folder: CourseFolder) => folder.subject === subject).sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }))
        .map((folder) => <option key={folder.id} value={encode({ subject, folderId: folder.id })}>{subject} › {folder.name}</option>)}
    </optgroup>)}
  </select>
}

function defaultView(course: Course): DocumentView {
  if (course.status === 'recording') return 'notes'
  return course.studyMarkdown ? 'study' : course.cleanTranscript ? 'course' : 'notes'
}

export function CoursePage({ course, lib, recorder, actions }: { course: Course; lib: LibraryView; recorder: Recorder; actions: LibraryActions }): JSX.Element {
  const [view, setView] = useState<DocumentView>(() => defaultView(course))
  const live = course.status === 'recording'
  const busy = isBusy(course)
  const thinking = isThinkingStatus(course.status)
  const awaiting = isAwaitingProcessing(course) && !busy
  const progress = lib.progress[course.id]
  const content = view === 'source' ? course.rawTranscript : view === 'study' ? course.studyMarkdown : view === 'notes' ? null : course.cleanTranscript
  const variant: DocumentVariant = view === 'source' ? 'course' : view
  const hasDocument = view === 'notes' || Boolean(content)

  useEffect(() => { setView(defaultView(course)) }, [course.id])
  useEffect(() => { if (live) setView('notes') }, [live])

  const run = (task: () => Promise<unknown>): void => { void task().catch((error) => actions.reportError(errorMessage(error))) }
  const copy = (): void => run(async () => {
    const text = view === 'notes' ? (await window.api.notes.get(course.id)).markdown : content
    if (text) await navigator.clipboard.writeText(text)
  })
  const exportMd = (): void => run(() => window.api.courses.exportMarkdown(course.id, variant))
  const notion = (): void => run(async () => { const result = await window.api.courses.sendToNotion(course.id, variant); window.open(result.url, '_blank') })
  const generateStudy = (): void => { setView('study'); actions.studyCourse(course.id) }

  const emptyTitle = course.status === 'studying' && view === 'study' ? 'Création de la fiche en cours'
    : busy ? 'Traitement du cours en cours'
      : view === 'study' ? 'Pas encore de fiche de révision'
        : awaiting ? 'Transcription pas encore lancée'
          : 'Le cours complet n’est pas encore disponible'
  const emptyMessage = busy ? 'Vous pouvez continuer ailleurs : le traitement se poursuit en arrière-plan.'
    : view === 'study' ? 'Une fiche structurée à partir du cours et de vos notes : notions, définitions, exceptions et questions d’auto-évaluation.'
      : awaiting ? 'L’audio est sauvegardé. Lancez la transcription quand vous voulez.'
        : course.rawTranscript ? 'La transcription source est conservée : vous pouvez relancer le nettoyage.'
          : 'Relancez le traitement depuis l’audio conservé.'

  return <div className="page course-page">
    {live && recorder.course?.id === course.id && <LiveBanner recorder={recorder}/>}
    <EditableTitle value={course.title} editable={!busy} maxLength={MAX_TITLE_LENGTH} onSave={(title) => actions.renameCourse(course.id, title)}/>

    <div className="properties">
      <div className="property"><span className="property-name"><Icon name="book" size={15}/>Matière</span>
        <span className="property-value">{live || !lib.subjects.length ? placeLabel(course, lib.folderById) : <PlacementSelect course={course} lib={lib} onMove={(placement) => actions.moveCourse(course.id, placement)}/>}</span></div>
      <div className="property"><span className="property-name"><Icon name="clock" size={15}/>Date</span>
        <span className="property-value">{formatDate(course.createdAt)}{course.durationMs ? ` · ${formatDuration(course.durationMs)}` : ''}</span></div>
      <div className="property"><span className="property-name"><Icon name="check" size={15}/>Statut</span>
        <span className="property-value"><StatusBadge course={course}/></span></div>
    </div>

    {progress && busy && <ProgressBar progress={progress} thinking={thinking}/>}
    {awaiting && <div className="callout"><Icon name="sparkles"/><div><strong>Ce cours attend d’être transcrit.</strong><p>L’audio est conservé tel quel. La transcription puis le nettoyage prennent quelques minutes.</p></div><button className="button primary" onClick={() => actions.processCourse(course.id)}>Transcrire maintenant</button></div>}
    {course.status === 'error' && <div className="callout danger"><Icon name="retry"/><div><strong>Le traitement s’est arrêté pendant « {course.errorStage} ».</strong><p>{course.errorMessage}</p><small>L’audio source et les documents déjà produits sont conservés.</small></div><button className="button" onClick={() => actions.retryCourse(course.id)}>Réessayer</button></div>}

    <div className="doc-toolbar">
      <div className="tabs" role="tablist" aria-label="Documents du cours">
        {!live && <button role="tab" aria-selected={view === 'study'} className={view === 'study' ? 'active' : ''} onClick={() => setView('study')}><Icon name="sparkles" size={15}/>Fiche</button>}
        {!live && <button role="tab" aria-selected={view === 'course'} className={view === 'course' ? 'active' : ''} onClick={() => setView('course')}><Icon name="page" size={15}/>Cours complet</button>}
        <button role="tab" aria-selected={view === 'notes'} className={view === 'notes' ? 'active' : ''} onClick={() => setView('notes')}><Icon name="notes" size={15}/>Mes notes</button>
        {view === 'source' && <button role="tab" aria-selected className="active">Source technique</button>}
      </div>
      {!live && <div className="doc-actions">
        {course.cleanTranscript && view !== 'source' && <button className="button small accent" onClick={generateStudy} disabled={busy}><Icon name="sparkles" size={14}/>{course.studyMarkdown ? 'Regénérer la fiche' : 'Créer la fiche'}</button>}
        <button className="icon-button" onClick={copy} disabled={!hasDocument} title="Copier"><Icon name="copy"/><span className="sr-only">Copier</span></button>
        <Menu label="Plus d’actions">{(close) => <>
          <button role="menuitem" disabled={!hasDocument || view === 'source'} onClick={() => { close(); exportMd() }}><Icon name="export"/>Exporter en Markdown</button>
          <button role="menuitem" disabled={!hasDocument || view === 'source'} onClick={() => { close(); notion() }}><Icon name="notion"/>Envoyer vers Notion</button>
          <div className="menu-separator"/>
          {course.rawTranscript && <button role="menuitem" onClick={() => { close(); setView('source') }}><Icon name="page"/>Voir la source technique</button>}
          <button role="menuitem" disabled={busy} onClick={() => { close(); actions.retryCourse(course.id) }}><Icon name="retry"/>Retranscrire depuis l’audio</button>
          <button role="menuitem" disabled={busy || !course.rawTranscript} onClick={() => { close(); actions.cleanupCourse(course.id) }}><Icon name="sparkles"/>Nettoyer à nouveau</button>
          <div className="menu-separator"/>
          <button role="menuitem" className="danger" disabled={busy} onClick={() => { close(); actions.deleteCourse(course) }}><Icon name="trash"/>Supprimer le cours</button>
        </>}</Menu>
      </div>}
    </div>

    {view === 'notes'
      ? <NotesEditor courseId={course.id} className={live ? 'live' : ''} onError={actions.reportError}/>
      : <article className={`document ${view === 'source' ? 'raw' : 'markdown'}`}>
          {content
            ? view === 'source' ? <pre>{content}</pre> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            : <div className="document-empty">
                {thinking ? <ThinkingOrb state="connecting" size={64} theme="dark" aria-label={thinkingStatusLabel[course.status]}/> : <Icon name={view === 'study' ? 'sparkles' : 'page'} size={24}/>}
                <strong>{emptyTitle}</strong><p>{emptyMessage}</p>
                {view === 'study' && course.cleanTranscript && !busy && <button className="button primary" onClick={generateStudy}>Créer la fiche de révision</button>}
                {view === 'course' && course.rawTranscript && !busy && !course.cleanTranscript && <button className="button" onClick={() => actions.cleanupCourse(course.id)}>Nettoyer à nouveau</button>}
                {(view === 'course' || view === 'study') && awaiting && <button className="button primary" onClick={() => actions.processCourse(course.id)}>Transcrire maintenant</button>}
                {!busy && <button className="button subtle" onClick={() => setView('notes')}><Icon name="notes"/>Ouvrir mes notes</button>}
              </div>}
        </article>}
  </div>
}
