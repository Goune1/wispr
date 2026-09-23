import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ThinkingOrb } from 'thinking-orbs'
import type { Course, CoursePlacement, JobProgress } from '../../shared/types'
import { capturedMsAt, type CaptureClock } from './recording-clock'

export type IconName =
  | 'record' | 'import' | 'settings' | 'copy' | 'export' | 'notion' | 'retry' | 'trash' | 'back' | 'forward' | 'close' | 'stop'
  | 'sparkles' | 'more' | 'edit' | 'pause' | 'play' | 'search' | 'folder' | 'chevron' | 'plus' | 'home' | 'page' | 'book'
  | 'notes' | 'check' | 'mic' | 'clock' | 'enter' | 'cut' | 'paste' | 'move'

export function Icon({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element {
  const paths: Record<IconName, JSX.Element> = {
    record: <circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none"/>,
    import: <><path d="M12 3.5v11m0 0 4-4m-4 4-4-4"/><path d="M5 16.5v3h14v-3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2"/></>,
    export: <><path d="M12 14.5v-11m0 0 4 4m-4-4-4 4"/><path d="M5 13.5v6h14v-6"/></>,
    notion: <><rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M9 16V8l6 8V8"/></>,
    retry: <><path d="M20 6v5h-5"/><path d="M19.2 11A7.5 7.5 0 1 0 17 16.8"/></>,
    trash: <><path d="M4.5 7h15M10 3.5h4M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/></>,
    back: <path d="m14.5 18-6-6 6-6"/>,
    forward: <path d="m9.5 18 6-6-6-6"/>,
    close: <path d="m6.5 6.5 11 11m0-11-11 11"/>,
    stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>,
    sparkles: <><path d="m12 3.5 1.3 4 4 1.3-4 1.3-1.3 4-1.3-4-4-1.3 4-1.3 1.3-4Z"/><path d="m18 14 .7 2.2 2.3.8-2.3.7L18 20l-.7-2.3-2.3-.7 2.3-.8L18 14Z"/></>,
    more: <><circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none"/></>,
    edit: <><path d="M4.5 19.5h4l10.5-10.5-4-4L4.5 15.5v4Z"/><path d="m13.5 6.5 4 4"/></>,
    pause: <><rect x="7.5" y="6" width="3" height="12" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="6" width="3" height="12" rx="1" fill="currentColor" stroke="none"/></>,
    play: <path d="M8.5 6.2v11.6l9.5-5.8-9.5-5.8Z" fill="currentColor" stroke="none"/>,
    search: <><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></>,
    folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9Z"/>,
    chevron: <path d="m9.5 6.5 5.5 5.5-5.5 5.5"/>,
    plus: <path d="M12 5.5v13M5.5 12h13"/>,
    home: <><path d="M4.5 10.5 12 4.5l7.5 6"/><path d="M6.5 9v10.5h11V9"/></>,
    page: <><path d="M6.5 3.5h7l4 4v13h-11v-17Z"/><path d="M13.5 3.5v4h4M9 12.5h6M9 16h6"/></>,
    book: <><path d="M4.5 5.5a2 2 0 0 1 2-2h12v15h-12a2 2 0 0 0-2 2v-15Z"/><path d="M4.5 20.5a2 2 0 0 1 2-2h12v2"/></>,
    notes: <><path d="M5.5 4.5h13v15h-13z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/></>,
    check: <path d="m5.5 12.5 4 4 9-9"/>,
    mic: <><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5v3"/></>,
    clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></>,
    enter: <path d="M19 5.5v6a2 2 0 0 1-2 2H6m0 0 4-4m-4 4 4 4"/>,
    cut: <><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7 18 4.5M15.7 15.7 6 4.5"/></>,
    paste: <><rect x="5.5" y="4.5" width="13" height="16" rx="2"/><path d="M9 4.5V3.5h6v1M9 11h6M9 14.5h4"/></>,
    move: <><path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9Z"/><path d="M10 13h5m0 0-2-2m2 2-2 2"/></>
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export const statusLabel: Record<Course['status'], string> = {
  recording: 'En direct', converting: 'Préparation', recorded: 'Audio prêt', transcribing: 'Transcription',
  cleaning: 'Nettoyage', studying: 'Fiche en cours', complete: 'Prêt', error: 'À reprendre'
}

export const thinkingStatusLabel: Partial<Record<Course['status'], string>> = {
  transcribing: 'Transcription du cours en cours',
  cleaning: 'Nettoyage de la transcription en cours',
  studying: 'Création de la fiche de révision en cours'
}

export const COURSE_DRAG_TYPE = 'application/x-fac-course'

// Suggestions pour nommer un sous-dossier ; n'importe quel autre nom reste possible.
export const FOLDER_SUGGESTIONS = ['Cours magistral', 'Travaux dirigés', 'Travaux pratiques', 'Examens', 'Annales']

export function isThinkingStatus(status: Course['status']): boolean {
  return status === 'transcribing' || status === 'cleaning' || status === 'studying'
}

export function isBusy(course: Course): boolean {
  return ['converting', 'transcribing', 'cleaning', 'studying'].includes(course.status)
}

export function isAwaitingProcessing(course: Course): boolean {
  return course.status === 'recorded' && !course.rawTranscript
}

export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error)
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return hours ? `${hours}:${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}` : `${minutes}:${rest.toString().padStart(2, '0')}`
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

// « Aujourd'hui 14:05 », « Hier », « lun. 22 sept. » : ce qu'on lit d'un coup d'œil dans une liste.
export function formatRelativeDate(value: string, now = new Date()): string {
  const date = new Date(value)
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(now) - day(date)) / 86_400_000)
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date)
  if (days === 0) return `Aujourd’hui ${time}`
  if (days === 1) return `Hier ${time}`
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }).format(date)
}

export function defaultCourseTitle(now = new Date()): string {
  return `Cours du ${new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)}`
}

export function StatusBadge({ course }: { course: Course }): JSX.Element {
  const awaiting = isAwaitingProcessing(course)
  const tone = awaiting ? 'pending' : course.status
  return <span className={`status-badge tone-${tone}`}>{awaiting ? 'À transcrire' : statusLabel[course.status]}</span>
}

export function ProgressBar({ progress, thinking = false }: { progress: JobProgress; thinking?: boolean }): JSX.Element {
  return <div className="job-progress">
    <div className="progress-meta">
      <span className="progress-message">{thinking && <ThinkingOrb state="connecting" size={20} theme="dark" aria-label={progress.message}/>}<span>{progress.message}</span></span>
      <strong>{progress.progress}%</strong>
    </div>
    <div className="progress-track"><span style={{ width: `${progress.progress}%` }}/></div>
  </div>
}

// Le chrono se rafraîchit seul : le reste de l'app ne se redessine pas quatre fois par seconde.
export function RecordingTimer({ clock }: { clock: CaptureClock }): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (clock.runningSince === null) return
    const interval = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [clock.runningSince])
  return <time className="recording-timer">{formatDuration(capturedMsAt(clock, clock.runningSince === null ? 0 : now))}</time>
}

export function NameInput({ initial, label, placeholder, maxLength, suggestions, className = '', onCommit, onCancel }: {
  initial: string; label: string; placeholder: string; maxLength: number; suggestions?: string; className?: string
  onCommit(name: string): Promise<boolean>; onCancel(): void
}): JSX.Element {
  const [draft, setDraft] = useState(initial)
  const committing = useRef(false)
  const commit = async (): Promise<void> => {
    if (committing.current) return
    const name = collapseSpaces(draft)
    if (!name || name === initial) return onCancel()
    committing.current = true
    const saved = await onCommit(name)
    committing.current = false
    if (!saved) setDraft(name)
  }
  return <form className={`name-input ${className}`} onSubmit={(event) => { event.preventDefault(); void commit() }}>
    <input autoFocus aria-label={label} value={draft} maxLength={maxLength} list={suggestions} placeholder={placeholder}
      onFocus={(event) => event.target.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => { if (event.key === 'Escape') onCancel() }}/>
  </form>
}

// Les cours glissés (un seul ou toute la sélection) se déposent sur une matière ou un dossier :
// barre latérale, tuiles ou fil d'Ariane.
export function useCourseDrop(onDropCourses: (courseIds: string[], placement: CoursePlacement) => void): {
  dropTarget: string | null; dropZone(key: string, placement: CoursePlacement): Partial<JSX.IntrinsicElements['div']>
} {
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dropZone = (key: string, placement: CoursePlacement): Partial<JSX.IntrinsicElements['div']> => ({
    onDragOver: (event) => {
      if (!event.dataTransfer.types.includes(COURSE_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dropTarget !== key) setDropTarget(key)
    },
    onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null) },
    onDrop: (event) => {
      event.preventDefault()
      setDropTarget(null)
      const courseIds = event.dataTransfer.getData(COURSE_DRAG_TYPE).split('\n').filter(Boolean)
      if (courseIds.length) onDropCourses(courseIds, placement)
    }
  })
  return { dropTarget, dropZone }
}

export type ContextMenuItem = 'separator' | { label: string; icon?: IconName; shortcut?: string; danger?: boolean; disabled?: boolean; run(): void }

// Menu du clic droit, positionné sous le pointeur et gardé dans la fenêtre.
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextMenuItem[]; onClose(): void }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  useEffect(() => {
    const box = root.current?.getBoundingClientRect()
    if (box) setPosition({ left: Math.min(x, window.innerWidth - box.width - 8), top: Math.min(y, window.innerHeight - box.height - 8) })
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])
  useEffect(() => {
    const onPointer = (event: MouseEvent): void => { if (!root.current?.contains(event.target as Node)) onClose() }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => { window.removeEventListener('mousedown', onPointer); window.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', onClose) }
  }, [onClose])
  return <div className="menu-popover context-menu" role="menu" ref={root} style={position} onContextMenu={(event) => event.preventDefault()}>
    {items.map((item, index) => item === 'separator'
      ? <div key={index} className="menu-separator"/>
      : <button key={index} role="menuitem" className={item.danger ? 'danger' : ''} disabled={item.disabled} onClick={() => { onClose(); item.run() }}>
          {item.icon && <Icon name={item.icon}/>}<span className="menu-label">{item.label}</span>{item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
        </button>)}
  </div>
}

// Un menu déroulant sobre ; il se referme au clic extérieur ou sur Échap.
export function Menu({ label, icon = 'more', children }: { label: string; icon?: IconName; children: (close: () => void) => JSX.Element }): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onPointer); window.removeEventListener('keydown', onKey) }
  }, [open])
  return <div className="menu" ref={root}>
    <button className={`icon-button ${open ? 'pressed' : ''}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} title={label}><Icon name={icon}/><span className="sr-only">{label}</span></button>
    {open && <div className="menu-popover" role="menu">{children(() => setOpen(false))}</div>}
  </div>
}

export function Kbd({ children }: { children: string }): JSX.Element {
  return <kbd className="kbd">{children}</kbd>
}

export const MOD_KEY = navigator.userAgent.includes('Mac OS X') ? '⌘' : 'Ctrl'
