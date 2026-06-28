import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { isAllowedAttachment, validateAttachments, stageAttachments, buildAttachmentContentParts } from './attachments.js'

async function tempFile(name: string, content: Buffer | string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-attach-'))
  const p = path.join(dir, name)
  await fs.writeFile(p, content)
  return p
}

describe('attachments', () => {
  it('allows images and PDFs', () => {
    expect(isAllowedAttachment('x.png', 'image/png')).toBe(true)
    expect(isAllowedAttachment('x.pdf', 'application/pdf')).toBe(true)
  })

  it('rejects unknown binaries', () => {
    expect(isAllowedAttachment('x.exe', 'application/octet-stream')).toBe(false)
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
})
