import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { Attachment } from '@hip/protocol'
import { scratchDirFor } from './scratch.js'

export interface AttachmentPayload extends Attachment {
  path: string
}

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_SIZE = 50 * 1024 * 1024

export type AttachmentErrorCode =
  | 'ATTACHMENT_UNSUPPORTED'
  | 'ATTACHMENT_TOO_LARGE'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_INVALID_PATH'

export class AttachmentError extends Error {
  constructor(
    public readonly code: AttachmentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AttachmentError'
  }
}

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
  if (mimeType.startsWith('image/')) return true
  if (mimeType === 'application/pdf') return true
  if (TEXT_MIME_TYPES.has(mimeType)) return true
  const ext = path.extname(name).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

async function resolveAndValidateAttachmentPath(filePath: string): Promise<{ realPath: string; size: number }> {
  if (!path.isAbsolute(filePath)) {
    throw new AttachmentError('ATTACHMENT_INVALID_PATH', `Attachment path must be absolute: ${filePath}`)
  }
  if (filePath.split(path.sep).some((segment) => segment === '..')) {
    throw new AttachmentError('ATTACHMENT_INVALID_PATH', `Attachment path cannot contain '..' segments: ${filePath}`)
  }
  let realPath: string
  try {
    realPath = await fs.realpath(filePath)
  } catch (err) {
    const errno = err as NodeJS.ErrnoException
    if (errno.code === 'ENOENT' || errno.code === 'ENOTDIR') {
      throw new AttachmentError('ATTACHMENT_NOT_FOUND', `Attachment not found or inaccessible: ${filePath}`)
    }
    throw new AttachmentError('ATTACHMENT_INVALID_PATH', `Cannot resolve attachment path ${filePath}: ${errno.message}`)
  }
  const normalizedReal = path.normalize(realPath)
  const allowedRoots = await Promise.all([os.homedir(), os.tmpdir()].map(async (r) => path.normalize(await fs.realpath(r))))
  const underAllowed = allowedRoots.some((root) => {
    const rel = path.relative(root, normalizedReal)
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
  if (!underAllowed) {
    throw new AttachmentError('ATTACHMENT_INVALID_PATH', `Attachment path is outside allowed directories (${os.homedir()} or ${os.tmpdir()}): ${filePath}`)
  }
  let stat: fs.Stats
  try {
    stat = await fs.stat(realPath)
  } catch (err) {
    const errno = err as NodeJS.ErrnoException
    if (errno.code === 'ENOENT' || errno.code === 'ENOTDIR') {
      throw new AttachmentError('ATTACHMENT_NOT_FOUND', `Attachment not found or inaccessible: ${filePath}`)
    }
    throw new AttachmentError('ATTACHMENT_INVALID_PATH', `Cannot stat attachment ${filePath}: ${errno.message}`)
  }
  if (!stat.isFile()) {
    throw new AttachmentError('ATTACHMENT_INVALID_PATH', `Attachment path is not a regular file: ${filePath}`)
  }
  return { realPath, size: stat.size }
}

export async function validateAttachments(attachments: AttachmentPayload[]): Promise<void> {
  let total = 0
  for (const a of attachments) {
    if (!isAllowedAttachment(a.name, a.mimeType)) {
      throw new AttachmentError('ATTACHMENT_UNSUPPORTED', `Unsupported attachment type: ${a.name} (${a.mimeType})`)
    }
    const { size } = await resolveAndValidateAttachmentPath(a.path)
    if (size > MAX_ATTACHMENT_SIZE) {
      throw new AttachmentError('ATTACHMENT_TOO_LARGE', `Attachment exceeds 10 MB limit: ${a.name}`)
    }
    total += size
    if (total > MAX_TOTAL_ATTACHMENT_SIZE) {
      throw new AttachmentError('ATTACHMENT_TOO_LARGE', 'Total attachment size exceeds 50 MB limit')
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
    const { realPath } = await resolveAndValidateAttachmentPath(a.path)
    const targetDir = path.join(baseDir, a.id)
    await fs.mkdir(targetDir, { recursive: true })
    const targetPath = path.join(targetDir, a.name)
    await fs.copyFile(realPath, targetPath)
    const stat = await fs.stat(targetPath)
    staged.push({ id: a.id, name: a.name, mimeType: a.mimeType, size: stat.size })
  }
  return staged
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export async function buildAttachmentContentParts(attachments: AttachmentPayload[]): Promise<ContentPart[]> {
  const parts: ContentPart[] = []
  for (const a of attachments) {
    const { realPath } = await resolveAndValidateAttachmentPath(a.path)
    if (a.mimeType.startsWith('image/')) {
      const data = await fs.readFile(realPath)
      const base64 = data.toString('base64')
      parts.push({ type: 'image_url', image_url: { url: `data:${a.mimeType};base64,${base64}` } })
    } else if (a.mimeType === 'application/pdf') {
      try {
        const pdfParse = (await import('pdf-parse')).default
        const data = await fs.readFile(realPath)
        const parsed = await pdfParse(data)
        parts.push({ type: 'text', text: `[Attached PDF: ${a.name}]\n${parsed.text}` })
      } catch {
        parts.push({ type: 'text', text: `[Attached PDF: ${a.name}]` })
      }
    } else {
      const text = await fs.readFile(realPath, 'utf-8')
      parts.push({ type: 'text', text: `[Attached: ${a.name}]\n${text}` })
    }
  }
  return parts
}
