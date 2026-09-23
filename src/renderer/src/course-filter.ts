import type { Course, CourseFolder } from '../../shared/types'

// L'emplacement ouvert dans l'explorateur : la racine liste les matières, une matière ses
// sous-dossiers et ses cours non rangés. La matière vide ('') regroupe les audios importés sans matière.
export type LibraryScope =
  | { kind: 'root' }
  | { kind: 'subject'; subject: string }
  | { kind: 'folder'; folderId: string }

export interface CourseFilter {
  query: string
  scope: LibraryScope
}

export interface FolderNode {
  folder: CourseFolder
  count: number
}

export interface SubjectNode {
  subject: string
  count: number
  folders: FolderNode[]
}

// Une recherche tapée à la volée ignore accents et casse : « droit penal » doit trouver « Droit pénal ».
export function foldForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

// Sans recherche, seuls les cours posés directement à cet emplacement s'affichent ; une recherche
// parcourt aussi ses sous-dossiers, et toute la bibliothèque depuis la racine.
export function isInScope(course: Pick<Course, 'subject' | 'folderId'>, scope: LibraryScope, deep = false): boolean {
  if (scope.kind === 'subject') return course.subject === scope.subject && (deep || !course.folderId)
  if (scope.kind === 'folder') return course.folderId === scope.folderId
  return deep
}

export function filterCourses(courses: Course[], filter: CourseFilter): Course[] {
  const needles = foldForSearch(filter.query).split(' ').filter(Boolean)
  return courses.filter((course) => {
    if (!isInScope(course, filter.scope, needles.length > 0)) return false
    const haystack = foldForSearch(`${course.title} ${course.subject}`)
    return needles.every((needle) => haystack.includes(needle))
  })
}

// Les matières proposées sont celles portées par un enregistrement ou par un dossier créé à la main.
export function listSubjects(courses: Array<Pick<Course, 'subject'>>, folders: Array<Pick<CourseFolder, 'subject'>> = []): string[] {
  return [...new Set([...courses, ...folders].map((value) => value.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'))
}

// Un dossier par matière, ses sous-dossiers triés par nom ; « Sans matière » ferme la liste s'il sert.
// `extraSubjects` garde visibles les matières créées à la main qui n'ont encore ni cours ni dossier.
export function buildLibraryTree(courses: Array<Pick<Course, 'subject' | 'folderId'>>, folders: CourseFolder[], extraSubjects: string[] = []): SubjectNode[] {
  const subjects = listSubjects([...courses, ...extraSubjects.map((subject) => ({ subject }))], folders)
  if (courses.some((course) => !course.subject)) subjects.push('')
  return subjects.map((subject) => {
    const inSubject = courses.filter((course) => course.subject === subject)
    const subjectFolders = folders
      .filter((folder) => folder.subject === subject)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }))
      .map((folder) => ({ folder, count: inSubject.filter((course) => course.folderId === folder.id).length }))
    return { subject, count: inSubject.length, folders: subjectFolders }
  })
}

// Les matières du dernier cours enregistré d'abord : c'est généralement celle du prochain amphi.
export function subjectsByRecentUse(courses: Array<Pick<Course, 'subject' | 'createdAt'>>, subjects: string[]): string[] {
  const lastUse = new Map<string, string>()
  for (const course of courses) {
    if (course.subject && (lastUse.get(course.subject) ?? '') < course.createdAt) lastUse.set(course.subject, course.createdAt)
  }
  return [...subjects].sort((a, b) => (lastUse.get(b) ?? '').localeCompare(lastUse.get(a) ?? '') || a.localeCompare(b, 'fr'))
}
