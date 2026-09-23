import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import type { AppSettings, AssetStatus, Course, CourseFolder, CoursePlacement, JobProgress, UpdateStatus } from '../../shared/types'
import { normalizeSubject } from '../../shared/course-metadata'
import { buildLibraryTree, subjectsByRecentUse } from './course-filter'
import { CommandPalette } from './CommandPalette'
import type { LibraryActions, LibraryView } from './components'
import { MoveDialog, QuickStartModal, SettingsModal } from './modals'
import { sameRoute, useNavigation, type Route } from './navigation'
import { CoursePage, HomePage, LocationPage } from './pages'
import { Sidebar } from './Sidebar'
import { ContextMenu, errorMessage, Icon, MOD_KEY, plural, type ContextMenuItem } from './ui'
import { useRecorder, type Recorder, type RecordingMetadata } from './use-recorder'

interface Notice {
  tone: 'error' | 'info'
  message: string
  actions?: Array<{ label: string; run(): void }>
}

function routeKey(route: Route): string {
  return route.kind === 'subject' ? `s:${route.subject}` : route.kind === 'folder' ? `f:${route.folderId}` : route.kind === 'course' ? `c:${route.courseId}` : 'home'
}

export function App(): JSX.Element {
  const [courses, setCourses] = useState<Course[]>([])
  const [folders, setFolders] = useState<CourseFolder[]>([])
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState<Record<string, JobProgress>>({})
  const [globalProgress, setGlobalProgress] = useState<JobProgress | undefined>()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [assets, setAssets] = useState<AssetStatus | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [quickStart, setQuickStart] = useState<Partial<CoursePlacement> | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const selectionAnchor = useRef<string | null>(null)
  const [clipboard, setClipboard] = useState<LibraryView['clipboard']>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const [moveTargets, setMoveTargets] = useState<string[] | null>(null)
  // Matières créées à la main qui n'ont encore ni cours ni dossier (non persistées).
  const [draftSubjects, setDraftSubjects] = useState<string[]>([])
  const nav = useNavigation()
  const { route, navigate, replace } = nav
  const routeRef = useRef(route)
  routeRef.current = route

  const reportError = useCallback((message: string) => setNotice({ tone: 'error', message }), [])
  const failed = (error: unknown): false => { reportError(errorMessage(error)); return false }
  const baseRecorder = useRecorder(reportError)
  const recordingRef = useRef(false)
  recordingRef.current = Boolean(baseRecorder.course)

  const loadLibrary = useCallback(async () => {
    const [courseValues, folderValues] = await Promise.all([window.api.courses.list(), window.api.folders.list()])
    setCourses(courseValues); setFolders(folderValues)
  }, [])

  useEffect(() => {
    void Promise.all([loadLibrary(), window.api.settings.get().then(setSettings), window.api.assets.status().then(setAssets), window.api.updates.status().then(setUpdateStatus)])
      .catch((error) => reportError(errorMessage(error)))
      .finally(() => setLoaded(true))
    const offProgress = window.api.events.onProgress((value) => {
      if (value.courseId) setProgress((current) => ({ ...current, [value.courseId!]: value }))
      else setGlobalProgress(value)
    })
    const offCourse = window.api.events.onCourseUpdated((course) => setCourses((current) => {
      const exists = current.some((value) => value.id === course.id)
      return (exists ? current.map((value) => value.id === course.id ? course : value) : [course, ...current])
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }))
    const offUpdate = window.api.events.onUpdateStatus(setUpdateStatus)
    return () => { offProgress(); offCourse(); offUpdate() }
  }, [loadLibrary, reportError])

  useEffect(() => {
    if (updateStatus?.phase === 'available') setNotice({ tone: 'info', message: `La version ${updateStatus.version} est disponible.`, actions: [{ label: 'Télécharger', run: () => { void window.api.updates.download().then((status) => { if (status.phase === 'error') reportError(status.message ?? 'Le téléchargement a échoué.') }).catch(failed) } }] })
    if (updateStatus?.phase === 'downloaded') setNotice({ tone: 'info', message: `La version ${updateStatus.version} est prête à installer.`, actions: [{ label: 'Redémarrer', run: () => { if (recordingRef.current) reportError('Terminez l’enregistrement avant de redémarrer.'); else void window.api.updates.install().catch(failed) } }] })
  }, [updateStatus?.phase, updateStatus?.version])

  const tree = useMemo(() => buildLibraryTree(courses, folders, draftSubjects), [courses, folders, draftSubjects])
  const lib = useMemo<LibraryView>(() => {
    const subjects = tree.map((node) => node.subject).filter(Boolean)
    return {
      courses, folders, tree, subjects, progress, selectedIds, clipboard,
      recentSubjects: subjectsByRecentUse(courses, subjects),
      folderById: new Map(folders.map((folder) => [folder.id, folder]))
    }
  }, [courses, folders, tree, progress, selectedIds, clipboard])

  // La sélection appartient à la page affichée : changer de page la vide.
  useEffect(() => { setSelectedIds(new Set()); selectionAnchor.current = null }, [route])
  // Un cours supprimé ne reste ni sélectionné ni dans le presse-papiers.
  useEffect(() => {
    const known = new Set(courses.map((course) => course.id))
    setSelectedIds((current) => [...current].every((id) => known.has(id)) ? current : new Set([...current].filter((id) => known.has(id))))
    setClipboard((current) => {
      if (!current || current.courseIds.every((id) => known.has(id))) return current
      const courseIds = current.courseIds.filter((id) => known.has(id))
      return courseIds.length ? { ...current, courseIds } : null
    })
  }, [courses])

  const currentCourse = route.kind === 'course' ? courses.find((course) => course.id === route.courseId) : undefined
  const currentFolder = route.kind === 'folder' ? lib.folderById.get(route.folderId) : undefined

  // Une page dont l'objet a disparu (cours supprimé, dossier retiré, matière renommée) renvoie à l'accueil.
  useEffect(() => {
    if (!loaded) return
    const stale = (route.kind === 'course' && !currentCourse)
      || (route.kind === 'folder' && !currentFolder)
      || (route.kind === 'subject' && !tree.some((node) => node.subject === route.subject))
    if (stale) replace({ kind: 'home' })
  }, [loaded, route, currentCourse, currentFolder, tree, replace])

  const contextPlacement = (): Partial<CoursePlacement> => {
    if (route.kind === 'subject' && route.subject) return { subject: route.subject, folderId: null }
    if (currentFolder) return { subject: currentFolder.subject, folderId: currentFolder.id }
    if (currentCourse?.subject) return { subject: currentCourse.subject, folderId: currentCourse.folderId }
    return {}
  }

  // Un cours terminé depuis une autre page propose tout de suite la suite, sans y retourner.
  const recorder: Recorder = {
    ...baseRecorder,
    stop: async () => {
      const course = await baseRecorder.stop()
      const current = routeRef.current
      if (course && !(current.kind === 'course' && current.courseId === course.id)) {
        setNotice({
          tone: 'info', message: `« ${course.title} » est enregistré.`,
          actions: [
            { label: 'Transcrire maintenant', run: () => void window.api.courses.startProcessing(course.id).catch(failed) },
            { label: 'Ouvrir', run: () => navigate({ kind: 'course', courseId: course.id }) }
          ]
        })
      }
      return course
    }
  }

  const openQuickStart = (placement: Partial<CoursePlacement> = contextPlacement()): void => {
    if (baseRecorder.course) navigate({ kind: 'course', courseId: baseRecorder.course.id })
    else setQuickStart(placement)
  }
  const importAudio = async (): Promise<void> => {
    try { const course = await window.api.courses.importAudio(); if (course) navigate({ kind: 'course', courseId: course.id }) }
    catch (error) { failed(error) }
  }

  const placementLabel = (placement: CoursePlacement): string => {
    const folder = placement.folderId ? lib.folderById.get(placement.folderId) : undefined
    return folder ? `${placement.subject} › ${folder.name}` : placement.subject
  }
  const movable = (ids: string[]): Course[] => ids.map((id) => courses.find((course) => course.id === id)).filter((course): course is Course => Boolean(course && course.status !== 'recording'))

  // Déplacer range les cours ailleurs ; « Annuler » les remet exactement où ils étaient.
  const moveCourses = (ids: string[], placement: CoursePlacement): void => {
    const toMove = movable(ids).filter((course) => course.subject !== placement.subject || course.folderId !== placement.folderId)
    if (!toMove.length) return
    const previous = toMove.map((course) => ({ id: course.id, placement: { subject: course.subject, folderId: course.folderId } }))
    void Promise.all(toMove.map((course) => window.api.courses.move(course.id, placement))).then(() => {
      setSelectedIds(new Set())
      setNotice({
        tone: 'info', message: `${plural(toMove.length, 'cours', 'cours')} déplacé${toMove.length > 1 ? 's' : ''} vers ${placementLabel(placement)}.`,
        actions: [{ label: 'Annuler', run: () => void Promise.all(previous.map((entry) => window.api.courses.move(entry.id, entry.placement))).catch(failed) }]
      })
    }).catch(failed)
  }
  const copyCourses = async (ids: string[], placement: CoursePlacement): Promise<void> => {
    const toCopy = movable(ids)
    let copied = 0
    try {
      for (const course of toCopy) { await window.api.courses.duplicate(course.id, placement); copied++ }
      setNotice({ tone: 'info', message: `${plural(copied, 'cours copié', 'cours copiés')} dans ${placementLabel(placement)}.` })
    } catch (error) {
      failed(error)
    }
  }
  const toClipboard = (mode: 'cut' | 'copy', ids: string[]): void => {
    const courseIds = movable(ids).map((course) => course.id)
    if (!courseIds.length) return
    setClipboard({ mode, courseIds })
    setNotice({ tone: 'info', message: `${plural(courseIds.length, 'cours', 'cours')} ${mode === 'cut' ? 'coupé' : 'copié'}${courseIds.length > 1 ? 's' : ''}. Ouvrez une matière ou un dossier puis ${MOD_KEY} V pour ${mode === 'cut' ? 'les déplacer' : 'coller'}.` })
  }
  const paste = (placement: CoursePlacement): void => {
    if (!clipboard) return
    if (clipboard.mode === 'cut') { moveCourses(clipboard.courseIds, placement); setClipboard(null) }
    else void copyCourses(clipboard.courseIds, placement)
  }
  const deleteCourses = (targets: Course[]): void => {
    const deletable = targets.filter((course) => course.status !== 'recording')
    if (!deletable.length) return
    const label = deletable.length === 1 ? `« ${deletable[0].title} »` : `ces ${deletable.length} cours`
    if (!window.confirm(`Supprimer ${label} ? L’audio sera placé dans la corbeille.`)) return
    void (async () => {
      for (const course of deletable) {
        try { await window.api.courses.remove(course.id); setCourses((current) => current.filter((value) => value.id !== course.id)) }
        catch (error) { failed(error) }
      }
    })()
  }
  // Ce sur quoi agissent ⌘X / ⌘C : la sélection, sinon la ligne qui a le focus, sinon le cours ouvert.
  const shortcutTargets = (): string[] => {
    if (selectedIds.size) return [...selectedIds]
    const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-course-id]')?.dataset.courseId
    if (focused) return [focused]
    return currentCourse ? [currentCourse.id] : []
  }
  const pastePlacement = (): CoursePlacement | null => {
    if (route.kind === 'subject' && route.subject) return { subject: route.subject, folderId: null }
    if (currentFolder) return { subject: currentFolder.subject, folderId: currentFolder.id }
    if (currentCourse?.subject) return { subject: currentCourse.subject, folderId: currentCourse.folderId }
    return null
  }
  const openMenu = (event: ReactMouseEvent, items: ContextMenuItem[]): void => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, items })
  }
  const pasteItem = (placement: CoursePlacement): ContextMenuItem => ({
    label: clipboard ? `${clipboard.mode === 'cut' ? 'Déplacer' : 'Coller'} ${plural(clipboard.courseIds.length, 'cours', 'cours')} ici` : 'Coller ici',
    icon: 'paste', shortcut: `${MOD_KEY} V`, disabled: !clipboard, run: () => paste(placement)
  })

  const actions: LibraryActions = {
    navigate,
    moveCourses,
    paste,
    clickCourse: (course, event, list) => {
      if (event.metaKey || event.ctrlKey) {
        setSelectedIds((current) => { const next = new Set(current); if (!next.delete(course.id)) next.add(course.id); return next })
        selectionAnchor.current = course.id
        return
      }
      if (event.shiftKey) {
        const anchor = list.findIndex((value) => value.id === (selectionAnchor.current ?? course.id))
        const index = list.findIndex((value) => value.id === course.id)
        const [from, to] = anchor < 0 ? [index, index] : [Math.min(anchor, index), Math.max(anchor, index)]
        setSelectedIds(new Set(list.slice(from, to + 1).map((value) => value.id)))
        return
      }
      navigate({ kind: 'course', courseId: course.id })
    },
    courseMenu: (course, event) => {
      const targets = selectedIds.has(course.id) ? [...selectedIds] : [course.id]
      const single = targets.length === 1
      const targetCourses = targets.map((id) => courses.find((value) => value.id === id)).filter((value): value is Course => Boolean(value))
      openMenu(event, [
        ...(single ? [{ label: 'Ouvrir', icon: 'page' as const, run: () => navigate({ kind: 'course', courseId: course.id }) }, 'separator' as const] : []),
        { label: single ? 'Couper' : `Couper ${targets.length} cours`, icon: 'cut', shortcut: `${MOD_KEY} X`, run: () => toClipboard('cut', targets) },
        { label: single ? 'Copier' : `Copier ${targets.length} cours`, icon: 'copy', shortcut: `${MOD_KEY} C`, run: () => toClipboard('copy', targets) },
        { label: 'Déplacer vers…', icon: 'move', run: () => setMoveTargets(targets) },
        'separator',
        { label: single ? 'Supprimer' : `Supprimer ${targets.length} cours`, icon: 'trash', danger: true, run: () => deleteCourses(targetCourses) }
      ])
    },
    placeMenu: (placement, event) => openMenu(event, [
      pasteItem(placement),
      { label: 'Nouveau cours ici', icon: 'mic', disabled: Boolean(baseRecorder.course), run: () => openQuickStart(placement) }
    ]),
    openQuickStart,
    reportError,
    startRecording: (metadata: RecordingMetadata) => {
      void baseRecorder.start(metadata).then((course) => {
        if (!course) return
        setQuickStart(null)
        navigate({ kind: 'course', courseId: course.id })
      })
    },
    moveCourse: (id, placement) => moveCourses([id], placement),
    renameCourse: async (id, title) => {
      try { await window.api.courses.rename(id, title); return true } catch (error) { return failed(error) }
    },
    deleteCourse: (course) => deleteCourses([course]),
    processCourse: (id) => { void window.api.courses.startProcessing(id).catch(failed) },
    retryCourse: (id) => { void window.api.courses.retry(id).catch(failed) },
    cleanupCourse: (id) => { void window.api.courses.rerunCleanup(id).catch(failed) },
    studyCourse: (id) => { void window.api.courses.generateStudyGuide(id).catch(failed) },
    createSubject: async (name) => {
      try {
        const subject = normalizeSubject(name)
        const existing = lib.subjects.find((value) => value.localeCompare(subject, 'fr', { sensitivity: 'accent' }) === 0)
        if (!existing) setDraftSubjects((current) => [...current, subject])
        navigate({ kind: 'subject', subject: existing ?? subject })
        return true
      } catch (error) { return failed(error) }
    },
    renameSubject: async (from, to) => {
      try {
        const subject = normalizeSubject(to)
        const persisted = courses.some((course) => course.subject === from) || folders.some((folder) => folder.subject === from)
        if (persisted) await window.api.subjects.rename(from, subject)
        setDraftSubjects((current) => current.map((value) => value === from ? subject : value))
        if (persisted) await loadLibrary()
        if (routeRef.current.kind === 'subject') replace({ kind: 'subject', subject })
        return true
      } catch (error) { return failed(error) }
    },
    createFolder: async (subject, name) => {
      try { const folder = await window.api.folders.create(subject, name); setFolders((current) => [...current, folder]); return true }
      catch (error) { return failed(error) }
    },
    renameFolder: async (folder, name) => {
      try { const renamed = await window.api.folders.rename(folder.id, name); setFolders((current) => current.map((value) => value.id === renamed.id ? renamed : value)); return true }
      catch (error) { return failed(error) }
    },
    deleteFolder: (folder) => {
      const count = courses.filter((course) => course.folderId === folder.id).length
      const contents = count ? ` Ses ${count} cours reviendront directement dans « ${folder.subject} ».` : ''
      if (!window.confirm(`Supprimer le dossier « ${folder.name} » ?${contents}`)) return
      void window.api.folders.remove(folder.id).then(() => {
        setFolders((current) => current.filter((value) => value.id !== folder.id))
        setCourses((current) => current.map((course) => course.folderId === folder.id ? { ...course, folderId: null } : course))
        if (routeRef.current.kind === 'folder' && routeRef.current.folderId === folder.id) replace({ kind: 'subject', subject: folder.subject })
      }).catch(failed)
    }
  }

  // Raccourcis : ⌘K rechercher, ⌘N nouveau cours, ⌘[ / ⌘] naviguer. L'éditeur de notes garde les siens.
  const editing = (target: EventTarget | null): boolean => {
    return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  }
  const hasTextSelection = (): boolean => Boolean(window.getSelection()?.toString())
  const clipboardShortcut = (key: 'x' | 'c' | 'v', event: KeyboardEvent): boolean => {
    if (editing(event.target) || (key !== 'v' && hasTextSelection())) return false
    if (key === 'v') {
      if (!clipboard) return false
      const placement = pastePlacement()
      if (placement) paste(placement)
      else setNotice({ tone: 'info', message: 'Ouvrez une matière ou un dossier pour y coller les cours.' })
      return true
    }
    const targets = shortcutTargets()
    if (!targets.length) return false
    toClipboard(key === 'x' ? 'cut' : 'copy', targets)
    return true
  }
  const shortcuts = useRef({ openQuickStart, back: nav.back, forward: nav.forward, clipboardShortcut, clearSelection: () => setSelectedIds(new Set()), hasSelection: selectedIds.size > 0 })
  shortcuts.current = { openQuickStart, back: nav.back, forward: nav.forward, clipboardShortcut, clearSelection: () => setSelectedIds(new Set()), hasSelection: selectedIds.size > 0 }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && key === 'k') { event.preventDefault(); setPaletteOpen((open) => !open) }
      else if (mod && key === 'n') { event.preventDefault(); shortcuts.current.openQuickStart() }
      else if ((mod && key === '[') || (event.altKey && key === 'arrowleft')) { event.preventDefault(); shortcuts.current.back() }
      else if ((mod && key === ']') || (event.altKey && key === 'arrowright')) { event.preventDefault(); shortcuts.current.forward() }
      else if (mod && !event.shiftKey && !event.altKey && (key === 'x' || key === 'c' || key === 'v')) { if (shortcuts.current.clipboardShortcut(key, event)) event.preventDefault() }
      else if (key === 'escape' && shortcuts.current.hasSelection) shortcuts.current.clearSelection()
    }
    const onMouse = (event: MouseEvent): void => {
      if (event.button === 3) shortcuts.current.back()
      if (event.button === 4) shortcuts.current.forward()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onMouse) }
  }, [])

  useEffect(() => {
    if (notice?.tone !== 'info') return
    const timer = window.setTimeout(() => setNotice((current) => current === notice ? null : current), 12_000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const crumbs: Array<{ label: string; route?: Route; icon?: 'book' | 'folder' | 'page' }> = []
  const crumbSubject = route.kind === 'subject' ? route.subject : currentFolder?.subject ?? currentCourse?.subject
  const crumbFolder = currentFolder ?? (currentCourse?.folderId ? lib.folderById.get(currentCourse.folderId) : undefined)
  if (route.kind !== 'home' && crumbSubject !== undefined) crumbs.push({ label: crumbSubject || 'Sans matière', route: { kind: 'subject', subject: crumbSubject }, icon: 'book' })
  if (crumbFolder) crumbs.push({ label: crumbFolder.name, route: { kind: 'folder', folderId: crumbFolder.id }, icon: 'folder' })
  if (currentCourse) crumbs.push({ label: currentCourse.title, icon: 'page' })

  const page = route.kind === 'home'
    ? <HomePage lib={lib} recorder={recorder} actions={actions}/>
    : route.kind === 'course'
      ? currentCourse ? <CoursePage course={currentCourse} lib={lib} recorder={recorder} actions={actions}/> : null
      : <LocationPage scope={route} lib={lib} actions={actions}/>

  const saveSettings = async (values: AppSettings): Promise<void> => {
    try { setSettings(await window.api.settings.save(values)); setSettingsOpen(false) } catch (error) { failed(error) }
  }
  const download = async (): Promise<void> => {
    try { await window.api.assets.downloadWhisper(); setAssets(await window.api.assets.status()) } catch (error) { failed(error) }
  }
  const checkUpdate = async (): Promise<void> => { try { const status = await window.api.updates.check(); if (status.phase === 'error') reportError(status.message ?? 'La vérification a échoué.') } catch (error) { failed(error) } }
  const downloadUpdate = async (): Promise<void> => { try { const status = await window.api.updates.download(); if (status.phase === 'error') reportError(status.message ?? 'Le téléchargement a échoué.') } catch (error) { failed(error) } }
  const installUpdate = async (): Promise<void> => { try { await window.api.updates.install() } catch (error) { failed(error) } }

  return <div className="app">
    <Sidebar lib={lib} route={route} recorder={recorder} actions={actions} onSearch={() => setPaletteOpen(true)} onImport={() => void importAudio()} onSettings={() => setSettingsOpen(true)}/>
    <div className="main">
      <header className="topbar">
        <div className="topbar-nav">
          <button className="icon-button" onClick={nav.back} disabled={!nav.canGoBack} title="Retour"><Icon name="back"/><span className="sr-only">Retour</span></button>
          <button className="icon-button" onClick={nav.forward} disabled={!nav.canGoForward} title="Suivant"><Icon name="forward"/><span className="sr-only">Suivant</span></button>
        </div>
        <nav className="breadcrumb" aria-label="Emplacement">
          <button className={`crumb ${route.kind === 'home' ? 'current' : ''}`} onClick={() => navigate({ kind: 'home' })}><Icon name="home" size={14}/>{route.kind === 'home' && <span>Accueil</span>}</button>
          {crumbs.map((crumb, index) => <span key={index} className="crumb-part">
            <span className="crumb-sep">/</span>
            {crumb.route && !sameRoute(crumb.route, route)
              ? <button className="crumb" onClick={() => navigate(crumb.route!)}>{crumb.icon && <Icon name={crumb.icon} size={14}/>}<span>{crumb.label}</span></button>
              : <span className="crumb current">{crumb.icon && <Icon name={crumb.icon} size={14}/>}<span>{crumb.label}</span></span>}
          </span>)}
        </nav>
      </header>
      <div className="content" key={routeKey(route)}>{page}</div>
    </div>

    {selectedIds.size > 0 && <div className="selection-bar" role="toolbar" aria-label="Cours sélectionnés">
      <span>{plural(selectedIds.size, 'cours sélectionné', 'cours sélectionnés')}</span>
      <button onClick={() => toClipboard('cut', [...selectedIds])} title={`${MOD_KEY} X`}><Icon name="cut" size={14}/>Couper</button>
      <button onClick={() => toClipboard('copy', [...selectedIds])} title={`${MOD_KEY} C`}><Icon name="copy" size={14}/>Copier</button>
      <button onClick={() => setMoveTargets([...selectedIds])}><Icon name="move" size={14}/>Déplacer vers…</button>
      <button className="danger" onClick={() => deleteCourses([...selectedIds].map((id) => courses.find((course) => course.id === id)).filter((course): course is Course => Boolean(course)))}><Icon name="trash" size={14}/></button>
      <button className="close" onClick={() => setSelectedIds(new Set())} title="Échap"><Icon name="close" size={14}/><span className="sr-only">Désélectionner</span></button>
    </div>}
    {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)}/>}
    {moveTargets && <MoveDialog lib={lib} count={moveTargets.length} onClose={() => setMoveTargets(null)} onChoose={(placement) => { const ids = moveTargets; setMoveTargets(null); moveCourses(ids, placement) }}/>}
    {quickStart && <QuickStartModal lib={lib} placement={quickStart} starting={baseRecorder.state === 'starting'} onStart={actions.startRecording} onClose={() => setQuickStart(null)}/>}
    {paletteOpen && <CommandPalette lib={lib} canRecord={!baseRecorder.course} onNavigate={navigate} onNewCourse={() => openQuickStart()} onImport={() => void importAudio()} onSettings={() => setSettingsOpen(true)} onClose={() => setPaletteOpen(false)}/>}
    {settingsOpen && settings && <SettingsModal initial={settings} assets={assets} progress={globalProgress} updateStatus={updateStatus} recording={Boolean(baseRecorder.course)} onClose={() => setSettingsOpen(false)} onSaved={(value) => void saveSettings(value)} onDownload={() => void download()} onCheckUpdate={() => void checkUpdate()} onDownloadUpdate={() => void downloadUpdate()} onInstallUpdate={() => void installUpdate()}/>}
    {notice && <div className={`toast ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <span>{notice.message}</span>
      {notice.actions?.map((action) => <button key={action.label} className="toast-action" onClick={() => { setNotice(null); action.run() }}>{action.label}</button>)}
      <button className="toast-close" onClick={() => setNotice(null)}><Icon name="close" size={14}/><span className="sr-only">Fermer</span></button>
    </div>}
  </div>
}
