import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { PartialBlock } from '@blocknote/core'
import { fr } from '@blocknote/core/locales'
import { BlockNoteView, type Theme } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/mantine/style.css'

// Les notes sont sauvegardées peu après chaque frappe : un plantage ne coûte que la dernière demi-seconde.
const SAVE_DELAY_MS = 500

const theme: Theme = {
  colors: {
    editor: { text: '#dadada', background: '#0f0f0f' },
    menu: { text: '#ececec', background: '#1f1f1f' },
    tooltip: { text: '#ececec', background: '#2a2a2a' },
    hovered: { text: '#ececec', background: '#2a2a2a' },
    selected: { text: '#111111', background: '#ececec' },
    disabled: { text: '#6b6b6b', background: '#181818' },
    shadow: '#00000099',
    border: '#2e2e2e',
    sideMenu: '#6b6b6b',
    highlights: {
      gray: { text: '#a8a29c', background: '#2a2927' },
      brown: { text: '#c9a58a', background: '#33271f' },
      red: { text: '#e0968e', background: '#3b2221' },
      orange: { text: '#e0a778', background: '#3a2818' },
      yellow: { text: '#dcc27a', background: '#383016' },
      green: { text: '#9fc196', background: '#1f3020' },
      blue: { text: '#8fb1d8', background: '#1b2838' },
      purple: { text: '#b9a0d8', background: '#2b2238' },
      pink: { text: '#d99cbc', background: '#372130' }
    }
  },
  borderRadius: 7,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Inter, 'Helvetica Neue', Arial, sans-serif"
}

const dictionary = {
  ...fr,
  placeholders: { ...fr.placeholders, default: 'Écrivez, ou tapez « / » pour un titre, une liste, un tableau…', emptyDocument: 'Vos notes de cours. Tapez « / » pour insérer un titre, une liste, une citation…' }
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

function parseBlocks(value: string | null): PartialBlock[] | undefined {
  if (!value) return undefined
  try {
    const blocks = JSON.parse(value) as PartialBlock[]
    return Array.isArray(blocks) && blocks.length ? blocks : undefined
  } catch { return undefined }
}

export function NotesEditor({ courseId, className = '', onError }: { courseId: string; className?: string; onError(message: string): void }): JSX.Element {
  const [initial, setInitial] = useState<{ courseId: string; blocks: PartialBlock[] | undefined } | null>(null)

  useEffect(() => {
    let current = true
    setInitial(null)
    window.api.notes.get(courseId)
      .then((notes) => { if (current) setInitial({ courseId, blocks: parseBlocks(notes.blocks) }) })
      .catch((error) => onError(error instanceof Error ? error.message : String(error)))
    return () => { current = false }
  }, [courseId])

  return <div className={`notes-editor ${className}`}>
    {initial?.courseId === courseId
      ? <LoadedEditor key={courseId} courseId={courseId} initialContent={initial.blocks} onError={onError}/>
      : <div className="notes-loading">Chargement des notes…</div>}
  </div>
}

function LoadedEditor({ courseId, initialContent, onError }: { courseId: string; initialContent: PartialBlock[] | undefined; onError(message: string): void }): JSX.Element {
  const editor = useCreateBlockNote({ initialContent, dictionary })
  const [state, setState] = useState<SaveState>('saved')
  const timer = useRef<number | null>(null)
  const dirty = useRef(false)

  const save = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    if (!dirty.current) return
    dirty.current = false
    setState('saving')
    const blocks = editor.document
    window.api.notes.save(courseId, { blocks: JSON.stringify(blocks), markdown: editor.blocksToMarkdownLossy(blocks) })
      .then(() => setState(dirty.current ? 'dirty' : 'saved'))
      .catch((error) => { dirty.current = true; setState('error'); onError(error instanceof Error ? error.message : String(error)) })
  }
  const saveRef = useRef(save)
  saveRef.current = save

  // Sauvegarde finale quand l'éditeur disparaît (fin de session, retour à la bibliothèque) ou quand la fenêtre se ferme.
  useEffect(() => {
    const flush = (): void => saveRef.current()
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); flush() }
  }, [])

  return <>
    <span className={`notes-status ${state}`} aria-live="polite">{state === 'saved' ? 'Enregistré' : state === 'error' ? 'Échec de la sauvegarde' : 'Enregistrement…'}</span>
    <BlockNoteView editor={editor} theme={theme} onChange={() => {
      dirty.current = true
      setState('dirty')
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => saveRef.current(), SAVE_DELAY_MS)
    }}/>
  </>
}
