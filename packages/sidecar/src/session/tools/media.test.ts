import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { SpawnOptions } from 'node:child_process'

const { mockSpawn } = vi.hoisted(() => {
  const fn = vi.fn()
  return { mockSpawn: fn }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: mockSpawn }
})

import { buildMediaTools } from './media.js'

function minimalPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    'base64',
  )
}

function createChildProc(): EventEmitter & { pid?: number; kill?: ReturnType<typeof vi.fn>; stdout?: EventEmitter; stderr?: EventEmitter } {
  const ee = new EventEmitter() as EventEmitter & { pid?: number; kill?: ReturnType<typeof vi.fn>; stdout?: EventEmitter; stderr?: EventEmitter }
  ee.pid = 12345
  ee.kill = vi.fn()
  return ee
}

let tmpDir: string
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hip-media-test-'))
  mockSpawn.mockReset()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('buildMediaTools', () => {
  it('returns an empty array when enabled is false', () => {
    expect(buildMediaTools({ enabled: false })).toEqual([])
    expect(buildMediaTools()).toEqual([])
    expect(buildMediaTools({})).toEqual([])
  })

  it('returns a read_media tool when enabled is true', () => {
    const tools = buildMediaTools({ enabled: true })
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('read_media')
  })
})

describe('read_media', () => {
  function tool() {
    return buildMediaTools({ enabled: true })[0]
  }

  it('reads a PNG file and returns base64 image content', async () => {
    const png = minimalPng()
    const filePath = join(tmpDir, 'sample.png')
    writeFileSync(filePath, png)

    const result = String(await tool().invoke({ path: filePath }))
    expect(result).toContain('[image]')
    expect(result).toContain('data:image/png;base64,')
    expect(result).toContain('[/image]')
    const b64Part = result.slice(
      result.indexOf('base64,') + 7,
      result.indexOf(' [/image]'),
    )
    expect(b64Part).toBe(png.toString('base64'))
  })

  it('reads a JPG file and uses the correct MIME type', async () => {
    const png = minimalPng()
    const filePath = join(tmpDir, 'sample.jpg')
    writeFileSync(filePath, png)

    const result = String(await tool().invoke({ path: filePath }))
    expect(result).toContain('data:image/jpeg;base64,')
  })

  it('returns an error for a non-existent file', async () => {
    const result = String(
      await tool().invoke({ path: join(tmpDir, 'nonexistent.png') }),
    )
    expect(result).toMatch(/Error: file not found/)
  })

  it('returns an error when file exceeds size limit', async () => {
    const prev = process.env.HIP_MEDIA_MAX_SIZE_MB
    process.env.HIP_MEDIA_MAX_SIZE_MB = '0'
    try {
      const png = minimalPng()
      const filePath = join(tmpDir, 'large.png')
      writeFileSync(filePath, png)

      const result = String(await tool().invoke({ path: filePath }))
      expect(result).toContain('Error: file size')
      expect(result).toContain('exceeds limit')
    } finally {
      if (prev === undefined) delete process.env.HIP_MEDIA_MAX_SIZE_MB
      else process.env.HIP_MEDIA_MAX_SIZE_MB = prev
    }
  })

  it('returns an error for an unsupported file extension', async () => {
    const filePath = join(tmpDir, 'doc.txt')
    writeFileSync(filePath, 'hello')

    const result = String(await tool().invoke({ path: filePath }))
    expect(result).toContain('Error: unsupported media type')
  })

  describe('video frame extraction', () => {
    function mockFfmpegSuccess(frames: Buffer[]) {
      const proc = createChildProc()
      mockSpawn.mockImplementation(
        (_cmd: string, args: string[], _opts: SpawnOptions) => {
          // args[args.length - 1] is the output pattern like /tmp/.../frame_%04d.png
          const pattern = args[args.length - 1]
          const dir = pattern.substring(0, pattern.lastIndexOf('/'))

          process.nextTick(() => {
            for (let i = 0; i < frames.length; i++) {
              const num = String(i + 1).padStart(4, '0')
              writeFileSync(join(dir, `frame_${num}.png`), frames[i])
            }
            proc.emit('close', 0)
          })
          return proc
        },
      )
    }

    it('extracts frames from video via ffmpeg', async () => {
      const png = minimalPng()
      mockFfmpegSuccess([png, png])

      const videoPath = join(tmpDir, 'test.mp4')
      writeFileSync(videoPath, Buffer.alloc(100))

      const result = String(await tool().invoke({ path: videoPath }))
      expect(result).toContain('[video]')
      expect(result).toContain('2 frames extracted')
      expect(result).toContain('[frame 0s]')
      expect(result).toContain('[frame 2s]')
      expect(result).toContain('data:image/png;base64,')
      expect(result).toContain('[/frame]')

      expect(mockSpawn).toHaveBeenCalledTimes(1)
      const spawnArgs = mockSpawn.mock.calls[0]
      expect(spawnArgs[0]).toBe('ffmpeg')
      expect(spawnArgs[1]).toContain('-vf')
      expect(spawnArgs[1]).toContain('fps=0.5')
    })

    it('returns an error when ffmpeg exits with non-zero code', async () => {
      const proc = createChildProc()
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => proc.emit('close', 1))
        return proc
      })

      const videoPath = join(tmpDir, 'test.mp4')
      writeFileSync(videoPath, Buffer.alloc(100))

      const result = String(await tool().invoke({ path: videoPath }))
      expect(result).toContain('Error: ffmpeg exited with code 1')
    })

    it('returns an error when ffmpeg produces no frames', async () => {
      const proc = createChildProc()
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => proc.emit('close', 0))
        return proc
      })

      const videoPath = join(tmpDir, 'test.mp4')
      writeFileSync(videoPath, Buffer.alloc(100))

      const result = String(await tool().invoke({ path: videoPath }))
      expect(result).toContain('Error: ffmpeg produced no frames')
    })

    it('returns an error when ffmpeg is not installed (ENOENT)', async () => {
      const proc = createChildProc()
      mockSpawn.mockImplementation(() => {
        process.nextTick(() => {
          const err = new Error('spawn ffmpeg ENOENT') as NodeJS.ErrnoException
          err.code = 'ENOENT'
          proc.emit('error', err)
        })
        return proc
      })

      const videoPath = join(tmpDir, 'test.mp4')
      writeFileSync(videoPath, Buffer.alloc(100))

      const result = String(await tool().invoke({ path: videoPath }))
      expect(result).toContain('ffmpeg not found')
    })
  })
})
