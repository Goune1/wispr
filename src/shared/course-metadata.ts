export const MAX_TITLE_LENGTH = 200
export const MAX_SUBJECT_LENGTH = 80

export interface CourseMetadataInput {
  title: string
  subject: string
}

export interface CourseMetadata extends CourseMetadataInput {
  createdAt: string
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeCourseMetadata(input: CourseMetadataInput): CourseMetadataInput {
  const title = collapse(input.title)
  const subject = collapse(input.subject)
  if (!title) throw new Error('Le nom du cours est obligatoire.')
  if (title.length > MAX_TITLE_LENGTH) throw new Error(`Le nom du cours ne peut pas dépasser ${MAX_TITLE_LENGTH} caractères.`)
  if (!subject) throw new Error('La matière est obligatoire.')
  if (subject.length > MAX_SUBJECT_LENGTH) throw new Error(`La matière ne peut pas dépasser ${MAX_SUBJECT_LENGTH} caractères.`)
  return { title, subject }
}

// La date n'est jamais saisie : elle est celle de l'enregistrement, posée ici pour que le
// formulaire du renderer et le main process attachent exactement la même information.
export function buildCourseMetadata(input: CourseMetadataInput, now: Date = new Date()): CourseMetadata {
  return { ...normalizeCourseMetadata(input), createdAt: now.toISOString() }
}

