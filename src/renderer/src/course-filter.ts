import type { Course } from '../../shared/types'

export interface CourseFilter {
  query: string
  subject: string
}

// Une recherche tapée à la volée ignore accents et casse : « droit penal » doit trouver « Droit pénal ».
export function foldForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export function filterCourses(courses: Course[], filter: CourseFilter): Course[] {
  const needles = foldForSearch(filter.query).split(' ').filter(Boolean)
  return courses.filter((course) => {
    if (filter.subject && course.subject !== filter.subject) return false
    const haystack = foldForSearch(`${course.title} ${course.subject}`)
    return needles.every((needle) => haystack.includes(needle))
  })
}

// Le tri par matière ne propose que les matières réellement portées par un enregistrement.
export function listSubjects(courses: Array<Pick<Course, 'subject'>>): string[] {
  return [...new Set(courses.map((course) => course.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'))
}
