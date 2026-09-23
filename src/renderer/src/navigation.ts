import { useCallback, useState } from 'react'

export type Route =
  | { kind: 'home' }
  | { kind: 'subject'; subject: string }
  | { kind: 'folder'; folderId: string }
  | { kind: 'course'; courseId: string }

export function sameRoute(a: Route, b: Route): boolean {
  if (a.kind === 'subject' && b.kind === 'subject') return a.subject === b.subject
  if (a.kind === 'folder' && b.kind === 'folder') return a.folderId === b.folderId
  if (a.kind === 'course' && b.kind === 'course') return a.courseId === b.courseId
  return a.kind === b.kind
}

export interface Navigation {
  route: Route
  canGoBack: boolean
  canGoForward: boolean
  navigate(route: Route): void
  replace(route: Route): void
  back(): void
  forward(): void
}

interface HistoryState { entries: Route[]; index: number }

// Un historique façon navigateur : Retour et Suivant rejouent les pages visitées.
export function useNavigation(): Navigation {
  const [history, setHistory] = useState<HistoryState>({ entries: [{ kind: 'home' }], index: 0 })
  const navigate = useCallback((route: Route) => setHistory(({ entries, index }) =>
    sameRoute(entries[index], route) ? { entries, index } : { entries: [...entries.slice(0, index + 1), route], index: index + 1 }), [])
  const replace = useCallback((route: Route) => setHistory(({ entries, index }) =>
    ({ entries: entries.map((entry, position) => position === index ? route : entry), index })), [])
  const back = useCallback(() => setHistory((current) => ({ ...current, index: Math.max(0, current.index - 1) })), [])
  const forward = useCallback(() => setHistory((current) => ({ ...current, index: Math.min(current.entries.length - 1, current.index + 1) })), [])
  return {
    route: history.entries[history.index],
    canGoBack: history.index > 0,
    canGoForward: history.index < history.entries.length - 1,
    navigate, replace, back, forward
  }
}
