export const MAX_TITLE_LENGTH = 200
export const MAX_SUBJECT_LENGTH = 80
export const MAX_FOLDER_NAME_LENGTH = 60

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

export function normalizeSubject(value: string): string {
  const subject = collapse(value)
  if (!subject) throw new Error('La matière est obligatoire.')
  if (subject.length > MAX_SUBJECT_LENGTH) throw new Error(`La matière ne peut pas dépasser ${MAX_SUBJECT_LENGTH} caractères.`)
  return subject
}

export function normalizeFolderName(value: string): string {
  const name = collapse(value)
  if (!name) throw new Error('Le nom du dossier est obligatoire.')
  if (name.length > MAX_FOLDER_NAME_LENGTH) throw new Error(`Le nom du dossier ne peut pas dépasser ${MAX_FOLDER_NAME_LENGTH} caractères.`)
  return name
}

export function normalizeCourseMetadata(input: CourseMetadataInput): CourseMetadataInput {
  const title = collapse(input.title)
  if (!title) throw new Error('Le nom du cours est obligatoire.')
  if (title.length > MAX_TITLE_LENGTH) throw new Error(`Le nom du cours ne peut pas dépasser ${MAX_TITLE_LENGTH} caractères.`)
  return { title, subject: normalizeSubject(input.subject) }
}

// La date n'est jamais saisie : elle est celle de l'enregistrement, posée ici pour que le
// formulaire du renderer et le main process attachent exactement la même information.
export function buildCourseMetadata(input: CourseMetadataInput, now: Date = new Date()): CourseMetadata {
  return { ...normalizeCourseMetadata(input), createdAt: now.toISOString() }
}

