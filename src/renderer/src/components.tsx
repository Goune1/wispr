import { useEffect, useId, useMemo, useState } from 'react'
import type { FormEvent, JSX, MouseEvent } from 'react'
import { ThinkingOrb } from 'thinking-orbs'
import type { Course, CourseFolder, CoursePlacement, JobProgress } from '../../shared/types'
import { MAX_SUBJECT_LENGTH, MAX_TITLE_LENGTH, normalizeCourseMetadata } from '../../shared/course-metadata'
import type { SubjectNode } from './course-filter'
import type { Route } from './navigation'
import type { RecordingMetadata } from './use-recorder'
import {
  collapseSpaces, COURSE_DRAG_TYPE, defaultCourseTitle, errorMessage, formatDuration, formatRelativeDate, Icon, isBusy,
  isThinkingStatus, Kbd, StatusBadge, thinkingStatusLabel
} from './ui'

export interface LibraryView {
  courses: Course[]
  folders: CourseFolder[]
  tree: SubjectNode[]
  subjects: string[]
  recentSubjects: string[]
  folderById: Map<string, CourseFolder>
  progress: Record<string, JobProgress>
  selectedIds: Set<string>
  // Cours coupés ou copiés, en attente d'être collés ailleurs.
  clipboard: { mode: 'cut' | 'copy'; courseIds: string[] } | null
}

export interface LibraryActions {
  navigate(route: Route): void
  openQuickStart(placement?: Partial<CoursePlacement>): void
  startRecording(metadata: RecordingMetadata): void
  moveCourse(id: string, placement: CoursePlacement): void
  moveCourses(ids: string[], placement: CoursePlacement): void
  clickCourse(course: Course, event: MouseEvent, list: Course[]): void
  courseMenu(course: Course, event: MouseEvent): void
  placeMenu(placement: CoursePlacement, event: MouseEvent): void
  paste(placement: CoursePlacement): void
  renameCourse(id: string, title: string): Promise<boolean>
  deleteCourse(course: Course): void
  processCourse(id: string): void
  retryCourse(id: string): void
  cleanupCourse(id: string): void
  studyCourse(id: string): void
  createSubject(name: string): Promise<boolean>
  renameSubject(from: string, to: string): Promise<boolean>
  createFolder(subject: string, name: string): Promise<boolean>
  renameFolder(folder: CourseFolder, name: string): Promise<boolean>
  deleteFolder(folder: CourseFolder): void
  reportError(message: string): void
}

export function placeLabel(course: Pick<Course, 'subject' | 'folderId'>, folderById: Map<string, CourseFolder>): string {
  const folder = course.folderId ? folderById.get(course.folderId) : undefined
  return [course.subject || 'Sans matière', folder?.name].filter(Boolean).join(' › ')
}

function RowIcon({ course }: { course: Course }): JSX.Element {
  if (course.status === 'recording') return <span className="row-icon"><span className="live-dot"/></span>
  if (isThinkingStatus(course.status)) return <span className="row-icon"><ThinkingOrb state="connecting" size={20} theme="dark" aria-label={thinkingStatusLabel[course.status]}/></span>
  return <span className="row-icon"><Icon name="page" size={16}/></span>
}

// Liste façon base Notion : une ligne par cours, la place (matière › dossier) seulement quand elle apporte quelque chose.
// Clic : ouvrir. ⌘/Ctrl-clic et Maj-clic : sélectionner, comme dans un explorateur de fichiers. Clic droit : actions.
export function CourseList({ courses, lib, actions, showPlace = false, renderAction }: {
  courses: Course[]; lib: LibraryView; actions: LibraryActions; showPlace?: boolean; renderAction?(course: Course): JSX.Element | null
}): JSX.Element {
  const cut = lib.clipboard?.mode === 'cut' ? new Set(lib.clipboard.courseIds) : null
  return <div className="course-list" role="list">
    {courses.map((course) => {
      const progress = lib.progress[course.id]
      const action = renderAction?.(course)
      const selected = lib.selectedIds.has(course.id)
      return <div key={course.id} className={`course-row-wrap ${selected ? 'selected' : ''} ${cut?.has(course.id) ? 'is-cut' : ''}`} role="listitem">
        <button className="course-row" data-course-id={course.id} aria-pressed={selected}
          onClick={(event) => actions.clickCourse(course, event, courses)}
          onContextMenu={(event) => actions.courseMenu(course, event)}
          draggable={course.status !== 'recording'}
          onDragStart={(event) => {
            const ids = selected ? [...lib.selectedIds] : [course.id]
            event.dataTransfer.setData(COURSE_DRAG_TYPE, ids.join('\n'))
            event.dataTransfer.effectAllowed = 'move'
          }}>
          <RowIcon course={course}/>
          <span className="row-title">{course.title}</span>
          {showPlace && <span className="row-place">{placeLabel(course, lib.folderById)}</span>}
          <span className="row-date">{formatRelativeDate(course.createdAt)}</span>
          <span className="row-duration">{course.durationMs ? formatDuration(course.durationMs) : ''}</span>
          <StatusBadge course={course}/>
        </button>
        {action && <span className="row-action">{action}</span>}
        {progress && isBusy(course) && <span className="row-progress"><i style={{ width: `${progress.progress}%` }}/></span>}
      </div>
    })}
  </div>
}

// Titre de page modifiable sur place, comme dans Notion : un clic, on tape, Entrée.
export function EditableTitle({ value, editable = true, maxLength, onSave }: {
  value: string; editable?: boolean; maxLength: number; onSave(next: string): Promise<boolean>
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  const commit = async (): Promise<void> => {
    const next = collapseSpaces(draft)
    if (!next || next === value) { setEditing(false); setDraft(value); return }
    if (await onSave(next)) setEditing(false)
  }
  if (!editing) {
    return <h1 className={`page-title ${editable ? 'editable' : ''}`} onClick={() => editable && setEditing(true)} title={editable ? 'Cliquer pour renommer' : undefined}>{value}</h1>
  }
  return <input className="page-title page-title-input" autoFocus aria-label="Titre" value={draft} maxLength={maxLength}
    onFocus={(event) => event.target.select()}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => void commit()}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); void commit() }
      if (event.key === 'Escape') { setDraft(value); setEditing(false) }
    }}/>
}

// Lancer un cours doit prendre deux secondes : le titre est facultatif (la date sert de titre),
// la matière se choisit d'un clic parmi les plus récentes, Entrée démarre.
export function QuickStart({ lib, placement = {}, starting, autoFocus = false, onStart }: {
  lib: LibraryView; placement?: Partial<CoursePlacement>; starting: boolean; autoFocus?: boolean; onStart(metadata: RecordingMetadata): void
}): JSX.Element {
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState(placement.subject ?? '')
  const [folderId, setFolderId] = useState(placement.folderId ?? '')
  const [invalid, setInvalid] = useState<string | null>(null)
  const defaultTitle = useMemo(() => defaultCourseTitle(), [])
  const subjectListId = useId()
  const chips = lib.recentSubjects.slice(0, 8)
  const typedSubject = chips.includes(subject) ? '' : subject
  const subjectFolders = useMemo(() => {
    const normalized = collapseSpaces(subject)
    return lib.folders.filter((folder) => folder.subject === normalized).sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }))
  }, [lib.folders, subject])

  useEffect(() => { if (folderId && !subjectFolders.some((folder) => folder.id === folderId)) setFolderId('') }, [folderId, subjectFolders])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    try {
      if (!collapseSpaces(subject)) throw new Error('Choisissez la matière du cours.')
      onStart({ ...normalizeCourseMetadata({ title: collapseSpaces(title) || defaultTitle, subject }), folderId: folderId || null })
    } catch (error) { setInvalid(errorMessage(error)) }
  }
  const pickSubject = (value: string): void => { setSubject(value); setInvalid(null) }

  return <form className="quick-start" onSubmit={submit}>
    <input className="qs-title" autoFocus={autoFocus} value={title} maxLength={MAX_TITLE_LENGTH} placeholder={defaultTitle} aria-label="Nom du cours (facultatif)"
      onChange={(event) => setTitle(event.target.value)}/>
    <div className="qs-field">
      <span className="qs-label">Matière</span>
      <div className="chips">
        {chips.map((value) => <button type="button" key={value} className={`chip ${subject === value ? 'selected' : ''}`} onClick={() => pickSubject(value)}>{value}</button>)}
        <input className={`chip-input ${typedSubject ? 'filled' : ''}`} list={subjectListId} value={typedSubject} maxLength={MAX_SUBJECT_LENGTH}
          placeholder={chips.length ? 'Autre matière…' : 'Ex. Droit des obligations'} aria-label="Matière" onChange={(event) => pickSubject(event.target.value)}/>
        <datalist id={subjectListId}>{lib.subjects.map((value) => <option key={value} value={value}/>)}</datalist>
      </div>
    </div>
    {subjectFolders.length > 0 && <div className="qs-field">
      <span className="qs-label">Dossier</span>
      <div className="chips">
        <button type="button" className={`chip ${folderId ? '' : 'selected'}`} onClick={() => setFolderId('')}>Aucun</button>
        {subjectFolders.map((folder) => <button type="button" key={folder.id} className={`chip ${folderId === folder.id ? 'selected' : ''}`} onClick={() => setFolderId(folder.id)}><Icon name="folder" size={13}/>{folder.name}</button>)}
      </div>
    </div>}
    {invalid && <p className="form-error" role="alert">{invalid}</p>}
    <footer className="qs-footer">
      <span className="qs-hint">La date et l’heure sont ajoutées automatiquement.</span>
      <button type="submit" className="record-cta" disabled={starting}><span className="rec-dot"/>{starting ? 'Accès au micro…' : 'Démarrer l’enregistrement'}<Kbd>↵</Kbd></button>
    </footer>
  </form>
}

export function EmptyState({ icon, title, children }: { icon: Parameters<typeof Icon>[0]['name']; title: string; children?: JSX.Element | string }): JSX.Element {
  return <div className="empty-state"><Icon name={icon} size={22}/><strong>{title}</strong>{children && <p>{children}</p>}</div>
}
