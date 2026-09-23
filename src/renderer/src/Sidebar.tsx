import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { MAX_SUBJECT_LENGTH } from '../../shared/course-metadata'
import type { LibraryActions, LibraryView } from './components'
import type { Route } from './navigation'
import type { Recorder } from './use-recorder'
import { Icon, Kbd, MOD_KEY, NameInput, RecordingTimer, useCourseDrop } from './ui'
import logoUrl from './logo.png'

export function Sidebar({ lib, route, recorder, actions, onSearch, onImport, onSettings }: {
  lib: LibraryView; route: Route; recorder: Recorder; actions: LibraryActions
  onSearch(): void; onImport(): void; onSettings(): void
}): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [adding, setAdding] = useState(false)
  const { dropTarget, dropZone } = useCourseDrop(actions.moveCourses)
  const currentFolder = route.kind === 'folder' ? lib.folderById.get(route.folderId) : undefined
  const currentCourse = route.kind === 'course' ? lib.courses.find((course) => course.id === route.courseId) : undefined
  const currentSubject = route.kind === 'subject' ? route.subject : currentFolder?.subject ?? currentCourse?.subject
  const currentFolderId = currentFolder?.id ?? currentCourse?.folderId ?? null

  // La matière de la page ouverte se déplie d'elle-même pour montrer où l'on se trouve.
  useEffect(() => {
    if (currentSubject) setExpanded((current) => current.has(currentSubject) ? current : new Set(current).add(currentSubject))
  }, [currentSubject])

  const toggle = (subject: string): void => setExpanded((current) => {
    const next = new Set(current)
    if (!next.delete(subject)) next.add(subject)
    return next
  })
  const live = recorder.course

  return <aside className="sidebar">
    <div className="sidebar-drag"/>
    <div className="sidebar-brand"><img src={logoUrl} alt="" width={20} height={20}/><span>FAC Transcript</span></div>

    <div className="sidebar-block">
      {live
        ? <div className={`live-card ${recorder.state === 'paused' ? 'paused' : ''}`}>
            <button className="live-card-open" onClick={() => actions.navigate({ kind: 'course', courseId: live.id })} title="Revenir à mes notes">
              <span className="live-dot"/>
              <span className="live-card-copy"><strong>{live.title}</strong><small>{recorder.state === 'paused' ? 'En pause' : live.subject}</small></span>
              <RecordingTimer clock={recorder.clock}/>
            </button>
            <div className="live-card-controls">
              <button onClick={recorder.togglePause} disabled={recorder.state === 'stopping'}><Icon name={recorder.state === 'paused' ? 'play' : 'pause'} size={14}/>{recorder.state === 'paused' ? 'Reprendre' : 'Pause'}</button>
              <button className="stop" onClick={() => void recorder.stop()} disabled={recorder.state === 'stopping'}><Icon name="stop" size={14}/>{recorder.state === 'stopping' ? '…' : 'Terminer'}</button>
            </div>
          </div>
        : <button className="new-course" onClick={() => actions.openQuickStart()} disabled={recorder.state === 'starting'}><span className="rec-dot"/>Nouveau cours<Kbd>{`${MOD_KEY} N`}</Kbd></button>}
      <button className={`side-item ${route.kind === 'home' ? 'active' : ''}`} onClick={() => actions.navigate({ kind: 'home' })}><Icon name="home"/><span>Accueil</span></button>
      <button className="side-item" onClick={onSearch}><Icon name="search"/><span>Rechercher</span><Kbd>{`${MOD_KEY} K`}</Kbd></button>
    </div>

    <nav className="sidebar-section" aria-label="Matières">
      <div className="side-heading"><span>Matières</span><button onClick={() => setAdding(true)} title="Nouvelle matière"><Icon name="plus" size={14}/><span className="sr-only">Nouvelle matière</span></button></div>
      {lib.tree.map((node) => {
        const open = expanded.has(node.subject)
        const key = `s:${node.subject}`
        const active = route.kind === 'subject' && route.subject === node.subject
        return <div key={key || 'none'}>
          <div className={`side-item tree ${active ? 'active' : ''} ${dropTarget === key ? 'drop-target' : ''}`} {...(node.subject ? dropZone(key, { subject: node.subject, folderId: null }) : {})}>
            <button className={`side-toggle ${open ? 'open' : ''} ${node.folders.length ? '' : 'empty'}`} onClick={() => toggle(node.subject)} aria-label={open ? 'Replier' : 'Déplier'} tabIndex={node.folders.length ? 0 : -1}><Icon name="chevron" size={12}/></button>
            <button className="side-label" onClick={() => actions.navigate({ kind: 'subject', subject: node.subject })}
              onContextMenu={(event) => node.subject && actions.placeMenu({ subject: node.subject, folderId: null }, event)}>
              <span className={currentSubject === node.subject && !active ? 'side-text in-path' : 'side-text'}>{node.subject || 'Sans matière'}</span>
            </button>
            <em>{node.count || ''}</em>
          </div>
          {open && node.folders.map(({ folder, count }) => {
            const folderKey = `f:${folder.id}`
            const folderActive = route.kind === 'folder' && route.folderId === folder.id
            return <div key={folder.id} className={`side-item tree nested ${folderActive ? 'active' : ''} ${dropTarget === folderKey ? 'drop-target' : ''}`} {...dropZone(folderKey, { subject: node.subject, folderId: folder.id })}>
              <button className="side-label" onClick={() => actions.navigate({ kind: 'folder', folderId: folder.id })}
                onContextMenu={(event) => actions.placeMenu({ subject: node.subject, folderId: folder.id }, event)}>
                <Icon name="folder" size={14}/><span className={currentFolderId === folder.id && !folderActive ? 'side-text in-path' : 'side-text'}>{folder.name}</span>
              </button>
              <em>{count || ''}</em>
            </div>
          })}
        </div>
      })}
      {adding && <NameInput className="side-input" initial="" label="Nom de la nouvelle matière" placeholder="Nom de la matière" maxLength={MAX_SUBJECT_LENGTH} onCancel={() => setAdding(false)}
        onCommit={async (name) => { const saved = await actions.createSubject(name); if (saved) setAdding(false); return saved }}/>}
      {!lib.tree.length && !adding && <button className="side-hint" onClick={() => setAdding(true)}>Ajoutez vos matières pour ranger vos cours.</button>}
    </nav>

    <div className="sidebar-footer">
      <button className="side-item" onClick={onImport}><Icon name="import"/><span>Importer un audio</span></button>
      <button className="side-item" onClick={onSettings}><Icon name="settings"/><span>Réglages</span></button>
    </div>
  </aside>
}
