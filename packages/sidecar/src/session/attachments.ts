import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Attachment } from '@hip/protocol'
import { scratchDirFor } from './scratch.js'

export interface AttachmentPayload extends Attachment {
  path: string
}

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_SIZE = 50 * 1024 * 1024

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.csv', '.xml', '.toml',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs', '.java', '.c',
  '.cpp', '.h', '.cs', '.rb', '.php', '.swift', '.kt', '.html', '.css',
  '.scss', '.sql', '.sh', '.ps1',
])

const TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'application/json', 'text/yaml', 'text/csv',
  'application/xml', 'text/xml', 'text/toml', 'text/javascript', 'text/typescript',
  'text/html', 'text/css',
])

export function isAllowedAttachment(name: string, mimeType: string): boolean {
  if (IMAGE_MIME_TYPES.includes(mimeType)) return true
  if (mimeType === 'application/pdf') return true
  if (TEXT_MIME_TYPES.has(mimeType)) return true
  const ext = path.extname(name).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

export async function validateAttachments(attachments: AttachmentPayload[]): Promise<void> {
  let total = 0
  for (const a of attachments) {
    if (!isAllowedAttachment(a.name, a.mimeType)) {
      throw new Error(`Unsupported attachment type: ${a.name}`)
    }
    const stat = await fs.stat(a.path)
    if (stat.size > MAX_ATTACHMENT_SIZE) {
      throw new Error(`Attachment exceeds 10 MB limit: ${a.name}`)
    }
    total += stat.size
    if (total > MAX_TOTAL_ATTACHMENT_SIZE) {
      throw new Error('Total attachment size exceeds 50 MB limit')
    }
  }
}

export async function stageAttachments(
  sessionId: string,
  attachments: AttachmentPayload[],
  scratchRoot: string,
): Promise<Attachment[]> {
  const baseDir = path.join(scratchDirFor(sessionId, scratchRoot), 'attachments')
  await fs.mkdir(baseDir, { recursive: true })
  const staged: Attachment[] = []
  for (const a of attachments) {
    const targetDir = path.join(baseDir, a.id)
    await fs.mkdir(targetDir, { recursive: true })
    const targetPath = path.join(targetDir, a.name)
    await fs.copyFile(a.path, targetPath)
    const stat = await fs.stat(targetPath)
    staged.push({ id: a.id, name: a.name, mimeType: a.mimeType, size: stat.size })
  }
  return staged
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export async function buildAttachmentContentParts(attachments: AttachmentPayload[]): Promise<ContentPart[]> {
  const parts: ContentPart[] = []
  for (const a of attachments) {
    if (IMAGE_MIME_TYPES.includes(a.mimeType)) {
      const data = await fs.readFile(a.path)
      const base64 = data.toString('base64')
      parts.push({ type: 'image_url', image_url: { url: `data:${a.mimeType};base64,${base64}` } })
    } else if (a.mimeType === 'application/pdf') {
      try {
        const pdfParse = (await import('pdf-parse')).default
        const data = await fs.readFile(a.path)
        const parsed = await pdfParse(data)
        parts.push({ type: 'text', text: `[Attached PDF: ${a.name}]\n${parsed.text}` })
      } catch {
        parts.push({ type: 'text', text: `[Attached PDF: ${a.name}]` })
      }
    } else {
      const text = await fs.readFile(a.path, 'utf-8')
      parts.push({ type: 'text', text: `[Attached: ${a.name}]\n${text}` })
    }
  }
  return parts
}
