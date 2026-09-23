import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { filterCourses, foldForSearch } from './course-filter'
import { placeLabel, type LibraryView } from './components'
import type { Route } from './navigation'
import { formatRelativeDate, Icon, Kbd, type IconName } from './ui'

interface PaletteItem {
  id: string
  group: string
  icon: IconName
  label: string
  hint?: string
  run(): void
}

// ⌘K : retrouver un cours, une matière ou lancer une action sans quitter le clavier.
export function CommandPalette({ lib, canRecord, onNavigate, onNewCourse, onImport, onSettings, onClose }: {
  lib: LibraryView; canRecord: boolean; onNavigate(route: Route): void; onNewCourse(): void; onImport(): void; onSettings(): void; onClose(): void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const items = useMemo<PaletteItem[]>(() => {
    const needle = foldForSearch(query.trim())
    const matches = (value: string): boolean => !needle || needle.split(' ').every((part) => foldForSearch(value).includes(part))
    const courses = (needle ? filterCourses(lib.courses, { query, scope: { kind: 'root' } }).slice(0, 12) : lib.courses.slice(0, 6))
      .map<PaletteItem>((course) => ({
        id: `c:${course.id}`, group: needle ? 'Cours' : 'Récents', icon: 'page', label: course.title,
        hint: `${placeLabel(course, lib.folderById)} · ${formatRelativeDate(course.createdAt)}`,
        run: () => onNavigate({ kind: 'course', courseId: course.id })
      }))
    const subjects = lib.tree.filter((node) => matches(node.subject || 'Sans matière')).slice(0, needle ? 6 : 0)
      .map<PaletteItem>((node) => ({ id: `s:${node.subject}`, group: 'Matières', icon: 'book', label: node.subject || 'Sans matière', run: () => onNavigate({ kind: 'subject', subject: node.subject }) }))
    const folders = lib.folders.filter((folder) => needle && matches(`${folder.name} ${folder.subject}`)).slice(0, 6)
      .map<PaletteItem>((folder) => ({ id: `f:${folder.id}`, group: 'Dossiers', icon: 'folder', label: folder.name, hint: folder.subject, run: () => onNavigate({ kind: 'folder', folderId: folder.id }) }))
    const newCourse: PaletteItem[] = canRecord ? [{ id: 'a:new', group: 'Actions', icon: 'mic', label: 'Nouveau cours', run: onNewCourse }] : []
    const actions: PaletteItem[] = [
      ...newCourse,
      { id: 'a:home', group: 'Actions', icon: 'home', label: 'Accueil', run: () => onNavigate({ kind: 'home' }) },
      { id: 'a:import', group: 'Actions', icon: 'import', label: 'Importer un audio', run: onImport },
      { id: 'a:settings', group: 'Actions', icon: 'settings', label: 'Réglages', run: onSettings }
    ]
    const matchingActions = actions.filter((item) => matches(item.label))
    return needle ? [...courses, ...subjects, ...folders, ...matchingActions] : [...matchingActions, ...courses]
  }, [query, lib, canRecord, onNavigate, onNewCourse, onImport, onSettings])

  useEffect(() => setCursor(0), [query])
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [cursor])

  const choose = (item: PaletteItem | undefined): void => {
    if (!item) return
    onClose()
    item.run()
  }

  let lastGroup = ''
  return <div className="modal-backdrop palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Recherche">
      <div className="palette-input"><Icon name="search" size={18}/>
        <input autoFocus value={query} placeholder="Rechercher un cours, une matière, une action…" aria-label="Rechercher"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((value) => Math.min(items.length - 1, value + 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((value) => Math.max(0, value - 1)) }
            else if (event.key === 'Enter') { event.preventDefault(); choose(items[cursor]) }
            else if (event.key === 'Escape') { event.preventDefault(); onClose() }
          }}/>
        <Kbd>Échap</Kbd>
      </div>
      <div className="palette-list" ref={list} role="listbox">
        {items.length === 0 && <p className="palette-empty">Aucun résultat pour « {query.trim()} ».</p>}
        {items.map((item, index) => {
          const heading = item.group !== lastGroup ? item.group : null
          lastGroup = item.group
          return <div key={item.id}>
            {heading && <div className="palette-group">{heading}</div>}
            <button role="option" aria-selected={index === cursor} data-active={index === cursor} className="palette-item"
              onMouseMove={() => setCursor(index)} onClick={() => choose(item)}>
              <Icon name={item.icon}/><span className="palette-label">{item.label}</span>{item.hint && <span className="palette-hint">{item.hint}</span>}
              {index === cursor && <Icon name="enter" size={14}/>}
            </button>
          </div>
        })}
      </div>
    </div>
  </div>
}
