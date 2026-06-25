import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm'])

function mime(ext: string): string {
  switch (ext) {
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    default: return 'application/octet-stream'
  }
}

function maxBytes(): number {
  return parseInt(process.env.HIP_MEDIA_MAX_SIZE_MB ?? '50', 10) * 1024 * 1024
}

interface Frame {
  timestamp: number
  base64: string
}

async function extractFrames(videoPath: string): Promise<Frame[]> {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'hip-media-'))
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', [
        '-i', videoPath,
        '-vf', 'fps=0.5',
        '-f', 'image2',
        path.join(tmpDir, 'frame_%04d.png'),
      ], { stdio: 'ignore' })

      child.on('error', (err) => {
        const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'ffmpeg not found. Install ffmpeg to enable video frame extraction.'
          : `ffmpeg spawn failed: ${err.message}`
        reject(new Error(msg))
      })
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg exited with code ${code}`))
      })
    })

    const allFiles = await fs.readdir(tmpDir)
    const frameFiles = allFiles
      .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
      .sort()

    const frames: Frame[] = []
    for (let i = 0; i < frameFiles.length; i++) {
      const buf = await fs.readFile(path.join(tmpDir, frameFiles[i]))
      frames.push({ timestamp: i * 2, base64: buf.toString('base64') })
    }

    if (frames.length === 0) {
      throw new Error('ffmpeg produced no frames. The file may be corrupted or not a valid video.')
    }
    return frames
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

export function buildMediaTools(opts?: { enabled?: boolean }): StructuredToolInterface[] {
  if (!opts?.enabled) return []

  const readMedia = tool(
    async ({ path: p }) => {
      try {
        const st = await fs.stat(p)
        const limit = maxBytes()
        if (st.size > limit) {
          const limitMB = process.env.HIP_MEDIA_MAX_SIZE_MB ?? '50'
          return `Error: file size (${(st.size / 1024 / 1024).toFixed(1)}MB) exceeds limit (${limitMB}MB). Set HIP_MEDIA_MAX_SIZE_MB to increase.`
        }

        const ext = path.extname(p).toLowerCase()

        if (IMAGE_EXTS.has(ext)) {
          const buf = await fs.readFile(p)
          const b64 = buf.toString('base64')
          return `[image] data:${mime(ext)};base64,${b64} [/image]`
        }

        if (VIDEO_EXTS.has(ext)) {
          const frames = await extractFrames(p)
          const lines: string[] = [`[video] ${p} — ${frames.length} frames extracted:`]
          for (const f of frames) {
            lines.push(`[frame ${f.timestamp}s] data:image/png;base64,${f.base64} [/frame]`)
          }
          return lines.join('\n')
        }

        const supported = [...IMAGE_EXTS, ...VIDEO_EXTS].join(', ')
        return `Error: unsupported media type "${ext}". Supported: ${supported}`
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT') return `Error: file not found: ${p}`
        if (code === 'EACCES') return `Error: permission denied: ${p}`
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'read_media',
      description:
        'Read an image or video file. Images are returned as base64-encoded data URIs. ' +
        'Videos have keyframes extracted (1 frame per 2 seconds) and returned as an image sequence with timestamps. ' +
        'Supported image formats: PNG, JPG, GIF, WEBP. Supported video formats: MP4, MOV, WEBM. ' +
        `Max file size is controlled by HIP_MEDIA_MAX_SIZE_MB (default 50MB).`,
      schema: z.object({ path: z.string() }),
    },
  )

  return [readMedia]
}
