import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { isAllowedAttachment, validateAttachments, stageAttachments, buildAttachmentContentParts, AttachmentError } from './attachments.js'

async function tempFile(name: string, content: Buffer | string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-attach-'))
  const p = path.join(dir, name)
  await fs.writeFile(p, content)
  return p
}

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'hip-attach-'))
}

async function expectAttachmentError(promise: Promise<unknown>, code: string, messagePattern?: RegExp): Promise<void> {
  let err: unknown
  try {
    await promise
  } catch (e) {
    err = e
  }
  expect(err).toBeInstanceOf(AttachmentError)
  expect((err as AttachmentError).code).toBe(code)
  if (messagePattern) {
    expect((err as AttachmentError).message).toMatch(messagePattern)
  }
}

describe('attachments', () => {
  it('allows any image mime type', () => {
    expect(isAllowedAttachment('x.png', 'image/png')).toBe(true)
    expect(isAllowedAttachment('x.jpg', 'image/jpeg')).toBe(true)
    expect(isAllowedAttachment('x.avif', 'image/avif')).toBe(true)
    expect(isAllowedAttachment('x.unknown', 'image/x-custom')).toBe(true)
  })

  it('allows PDFs and text files', () => {
    expect(isAllowedAttachment('x.pdf', 'application/pdf')).toBe(true)
    expect(isAllowedAttachment('x.txt', 'text/plain')).toBe(true)
    expect(isAllowedAttachment('x.ts', 'text/typescript')).toBe(true)
  })

  it('rejects unknown binaries', () => {
    expect(isAllowedAttachment('x.exe', 'application/octet-stream')).toBe(false)
  })

  it('rejects unsupported attachment type with ATTACHMENT_UNSUPPORTED', async () => {
    const src = await tempFile('bad.exe', Buffer.from('MZ'))
    await expectAttachmentError(
      validateAttachments([{ id: '1', name: 'bad.exe', mimeType: 'application/octet-stream', path: src }]),
      'ATTACHMENT_UNSUPPORTED',
      /Unsupported attachment type/,
    )
    await fs.rm(path.dirname(src), { recursive: true, force: true })
  })

  it('rejects oversized attachments with ATTACHMENT_TOO_LARGE', async () => {
    const big = await tempFile('big.txt', Buffer.alloc(11 * 1024 * 1024))
    await expectAttachmentError(
      validateAttachments([{ id: '1', name: 'big.txt', mimeType: 'text/plain', path: big }]),
      'ATTACHMENT_TOO_LARGE',
      /10 MB/,
    )
    await fs.rm(path.dirname(big), { recursive: true, force: true })
  })

  it('rejects relative paths with ATTACHMENT_INVALID_PATH', async () => {
    await expectAttachmentError(
      validateAttachments([{ id: '1', name: 'x.txt', mimeType: 'text/plain', path: 'relative/path.txt' }]),
      'ATTACHMENT_INVALID_PATH',
      /must be absolute/,
    )
  })

  it('rejects paths containing .. with ATTACHMENT_INVALID_PATH', async () => {
    const tmpFile = await tempFile('x.txt', 'hi')
    const dir = path.dirname(tmpFile)
    // Construct a raw path that contains a '..' segment but resolves to the file.
    const traversal = `${dir}/sub/../${path.basename(tmpFile)}`
    await expectAttachmentError(
      validateAttachments([{ id: '1', name: 'x.txt', mimeType: 'text/plain', path: traversal }]),
      'ATTACHMENT_INVALID_PATH',
      /cannot contain '\.\.'/,
    )
    await fs.rm(path.dirname(tmpFile), { recursive: true, force: true })
  })

  it('rejects paths outside allowed directories with ATTACHMENT_INVALID_PATH', async () => {
    await expectAttachmentError(
      validateAttachments([{ id: '1', name: 'x.txt', mimeType: 'text/plain', path: '/etc/passwd' }]),
      'ATTACHMENT_INVALID_PATH',
      /outside allowed directories/,
    )
  })

  it('rejects directories with ATTACHMENT_INVALID_PATH', async () => {
    const dir = await tempDir()
    await expectAttachmentError(
      validateAttachments([{ id: '1', name: 'x.txt', mimeType: 'text/plain', path: dir }]),
      'ATTACHMENT_INVALID_PATH',
      /not a regular file/,
    )
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('rejects missing files with ATTACHMENT_NOT_FOUND', async () => {
    await expectAttachmentError(
      validateAttachments([{ id: '1', name: 'x.txt', mimeType: 'text/plain', path: path.join(os.tmpdir(), 'does-not-exist-12345.txt') }]),
      'ATTACHMENT_NOT_FOUND',
      /not found/,
    )
  })

  it('allows valid absolute paths under tmp', async () => {
    const src = await tempFile('x.txt', 'hi')
    await expect(validateAttachments([{ id: '1', name: 'x.txt', mimeType: 'text/plain', path: src }])).resolves.toBeUndefined()
    await fs.rm(path.dirname(src), { recursive: true, force: true })
  })

  it('allows symlinks that resolve inside allowed directories', async () => {
    const dir = await tempDir()
    const realFile = path.join(dir, 'real.txt')
    const linkFile = path.join(dir, 'link.txt')
    await fs.writeFile(realFile, 'hello')
    await fs.symlink(realFile, linkFile)
    await expect(validateAttachments([{ id: '1', name: 'link.txt', mimeType: 'text/plain', path: linkFile }])).resolves.toBeUndefined()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('rejects symlinks that resolve outside allowed directories', async () => {
    const dir = await tempDir()
    const linkFile = path.join(dir, 'link.txt')
    await fs.symlink('/etc/passwd', linkFile)
    await expectAttachmentError(
      validateAttachments([{ id: '1', name: 'link.txt', mimeType: 'text/plain', path: linkFile }]),
      'ATTACHMENT_INVALID_PATH',
      /outside allowed directories/,
    )
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('validates total size limit', async () => {
    const big = await tempFile('big.txt', Buffer.alloc(11 * 1024 * 1024))
    await expect(validateAttachments([{ id: '1', name: 'big.txt', mimeType: 'text/plain', path: big }]))
      .rejects.toThrow('10 MB')
    await fs.rm(path.dirname(big), { recursive: true, force: true })
  })

  it('stages attachments into scratch', async () => {
    const src = await tempFile('note.txt', 'hello')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-scratch-'))
    const staged = await stageAttachments('s1', [{ id: 'a1', name: 'note.txt', mimeType: 'text/plain', path: src }], root)
    expect(staged[0].size).toBe(5)
    const copied = await fs.readFile(path.join(root, 's1', 'attachments', 'a1', 'note.txt'), 'utf-8')
    expect(copied).toBe('hello')
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(path.dirname(src), { recursive: true, force: true })
  })

  it('builds text part for text files', async () => {
    const src = await tempFile('note.txt', 'hello')
    const parts = await buildAttachmentContentParts([{ id: 'a1', name: 'note.txt', mimeType: 'text/plain', path: src }])
    expect(parts).toEqual([{ type: 'text', text: '[Attached: note.txt]\nhello' }])
    await fs.rm(path.dirname(src), { recursive: true, force: true })
  })

  it('stageAttachments rejects unsafe paths', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-scratch-'))
    await expectAttachmentError(
      stageAttachments('s1', [{ id: 'a1', name: 'x.txt', mimeType: 'text/plain', path: '/etc/passwd' }], root),
      'ATTACHMENT_INVALID_PATH',
    )
    await fs.rm(root, { recursive: true, force: true })
  })

  it('buildAttachmentContentParts rejects unsafe paths', async () => {
    await expectAttachmentError(
      buildAttachmentContentParts([{ id: 'a1', name: 'x.txt', mimeType: 'text/plain', path: '/etc/passwd' }]),
      'ATTACHMENT_INVALID_PATH',
    )
  })
})
