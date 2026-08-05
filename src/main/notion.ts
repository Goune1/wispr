import type { Course, DocumentVariant, JobProgress } from '../shared/types'
import type { AppDatabase } from './database'

type RichText = { type: 'text'; text: { content: string }; annotations?: { bold?: boolean; italic?: boolean; code?: boolean } }
type NotionBlock = { object: 'block'; type: string; [key: string]: unknown }

function richText(content: string): RichText[] {
  const values: RichText[] = []
  for (let index = 0; index < content.length; index += 1900) {
    values.push({ type: 'text', text: { content: content.slice(index, index + 1900) } })
  }
  return values.length ? values : [{ type: 'text', text: { content: '' } }]
}

function markdownToBlocks(markdown: string): NotionBlock[] {
  const lines = markdown.replace(/\r/g, '').split('\n')
  const blocks: NotionBlock[] = []
  let paragraph: string[] = []
  let code: string[] | null = null
  let codeLanguage = 'plain text'

  const flushParagraph = (): void => {
    const content = paragraph.join(' ').trim()
    if (content) blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(content) } })
    paragraph = []
  }

  for (const line of lines) {
    const fence = line.match(/^```(.*)$/)
    if (fence) {
      if (code) {
        blocks.push({ object: 'block', type: 'code', code: { language: codeLanguage, rich_text: richText(code.join('\n')) } })
        code = null
      } else {
        flushParagraph()
        code = []
        codeLanguage = fence[1].trim() || 'plain text'
      }
      continue
    }
    if (code) { code.push(line); continue }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    const quote = line.match(/^>\s?(.+)$/)
    if (heading) {
      flushParagraph()
      const type = `heading_${heading[1].length}`
      blocks.push({ object: 'block', type, [type]: { rich_text: richText(heading[2]) } })
    } else if (bullet) {
      flushParagraph()
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(bullet[1]) } })
    } else if (numbered) {
      flushParagraph()
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(numbered[1]) } })
    } else if (quote) {
      flushParagraph()
      blocks.push({ object: 'block', type: 'quote', quote: { rich_text: richText(quote[1]) } })
    } else if (!line.trim()) flushParagraph()
    else paragraph.push(line.trim())
  }
  flushParagraph()
  return blocks
}

export class NotionService {
  constructor(private readonly database: AppDatabase, private readonly emit: (progress: JobProgress) => void) {}

  async send(course: Course, variant: DocumentVariant): Promise<{ url: string }> {
    const settings = this.database.getSettings()
    if (!settings.notionToken || !settings.notionParentId) {
      throw new Error('Le token Notion et l’identifiant parent doivent être renseignés dans les réglages.')
    }
    const markdown = variant === 'study' ? course.studyMarkdown : course.cleanTranscript
    if (!markdown) throw new Error('Aucune transcription à envoyer.')
    const title = `${course.title}${variant === 'study' ? ' — Fiche de révision' : ''} — ${new Date(course.createdAt).toLocaleDateString('fr-FR')}`
    let databaseTitleProperty = 'Name'
    if (settings.notionParentType === 'database_id') {
      const info = await this.request<{ properties: Record<string, { type: string }> }>(
        `https://api.notion.com/v1/databases/${settings.notionParentId.replace(/-/g, '')}`,
        { method: 'GET' },
        settings.notionToken
      )
      databaseTitleProperty = Object.entries(info.properties).find(([, property]) => property.type === 'title')?.[0] || 'Name'
    }
    const page = await this.request<{ id: string; url: string }>('https://api.notion.com/v1/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { [settings.notionParentType]: settings.notionParentId.replace(/-/g, '') },
        properties: settings.notionParentType === 'database_id'
          ? { [databaseTitleProperty]: { title: richText(title) } }
          : { title: { title: richText(title) } }
      })
    }, settings.notionToken)

    const blocks = markdownToBlocks(markdown)
    const batches: NotionBlock[][] = []
    for (let index = 0; index < blocks.length; index += 100) batches.push(blocks.slice(index, index + 100))
    for (let index = 0; index < batches.length; index += 1) {
      this.emit({
        courseId: course.id,
        stage: 'notion',
        progress: Math.round(index / batches.length * 100),
        message: `Envoi vers Notion — lot ${index + 1}/${batches.length}`
      })
      await this.request(`https://api.notion.com/v1/blocks/${page.id}/children`, {
        method: 'PATCH',
        body: JSON.stringify({ children: batches[index] })
      }, settings.notionToken)
    }
    this.emit({ courseId: course.id, stage: 'notion', progress: 100, message: 'Page Notion créée.' })
    return { url: page.url }
  }

  private async request<T>(url: string, init: RequestInit, token: string): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    })
    if (!response.ok) throw new Error(`Notion (${response.status}) : ${await response.text()}`)
    return response.json() as Promise<T>
  }
}
