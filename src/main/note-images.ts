import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Les images collées dans les notes sont copiées dans le dossier de l'application et servies
// par un protocole interne : les notes ne contiennent que l'adresse fac-media://notes/<cours>/<fichier>.
export const NOTE_IMAGE_SCHEME = 'fac-media'
export const MAX_NOTE_IMAGE_BYTES = 25 * 1024 * 1024
export const NOTE_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.avif', '.bmp']

const ID = /^[a-zA-Z0-9-]{1,64}$/
const FILE_NAME = /^[a-zA-Z0-9-]{1,64}\.[a-z0-9]{2,5}$/
const LOCAL_IMAGE = new RegExp(`!\\[([^\\]]*)\\]\\((${NOTE_IMAGE_SCHEME}://notes/([a-zA-Z0-9-]+)/([a-zA-Z0-9.-]+))\\)`, 'g')

export function noteImageUrl(courseId: string, fileName: string): string {
  return `${NOTE_IMAGE_SCHEME}://notes/${courseId}/${fileName}`
}

// Refuse tout ce qui ne désigne pas exactement un fichier d'images de notes : pas de « .. », pas de sous-dossier.
export function resolveNoteImagePath(root: string, url: string): string | null {
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  if (parsed.protocol !== `${NOTE_IMAGE_SCHEME}:` || parsed.hostname !== 'notes') return null
  const [courseId, fileName, ...rest] = parsed.pathname.split('/').filter(Boolean)
  if (rest.length || !courseId || !fileName || !ID.test(courseId) || !FILE_NAME.test(fileName)) return null
  return join(root, courseId, fileName)
}

// Une image locale n'a pas de sens pour l'IA ni pour Notion : on garde seulement sa légende.
export function stripLocalImages(markdown: string): string {
  return markdown.replace(LOCAL_IMAGE, (_match, caption: string) => caption.trim() ? `*[Image : ${caption.trim()}]*` : '').replace(/\n{3,}/g, '\n\n').trim()
}

// À l'export, les images pointent vers leur fichier sur le disque pour s'afficher dans un éditeur Markdown.
export function localImagesToFileUrls(markdown: string, root: string): string {
  return markdown.replace(LOCAL_IMAGE, (match, caption: string, url: string) => {
    const path = resolveNoteImagePath(root, url)
    return path ? `![${caption}](${pathToFileURL(path).href})` : match
  })
}

export function retargetNoteImages(text: string, fromCourseId: string, toCourseId: string): string {
  return text.split(noteImageUrl(fromCourseId, '')).join(noteImageUrl(toCourseId, ''))
}
