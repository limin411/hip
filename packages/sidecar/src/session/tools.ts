import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { resolveWithin } from './workspace-fs.js'

/** Map a model-supplied "/abs-relative-to-root" path to a real fs path inside `root` (throws on escape). */
function real(root: string, p: string): string {
  const rel = p.replace(/^\/+/, '')
  return resolveWithin(root, path.join(root, rel))
}

/** Build the file-tool set sandboxed to `root`. Each returns a short string result for the model. */
export function buildTools(root: string): StructuredToolInterface[] {
  const writeFile = tool(
    async ({ path: p, content }) => {
      try {
        const abs = real(root, p)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, content, 'utf8')
        return `wrote ${p} (${content.length} bytes)`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'write_file',
      description:
        'Create or overwrite a file. `path` is absolute relative to the project root (e.g. "/index.html"). Returns a confirmation.',
      schema: z.object({ path: z.string(), content: z.string() }),
    },
  )

  const readFile = tool(
    async ({ path: p }) => {
      try {
        const abs = real(root, p)
        return await fs.readFile(abs, 'utf8')
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('escapes')) return `Error: ${msg}`
        return `Error: file not found: ${p}`
      }
    },
    {
      name: 'read_file',
      description: 'Read a text file. `path` is absolute relative to the project root.',
      schema: z.object({ path: z.string() }),
    },
  )

  const editFile = tool(
    async ({ path: p, oldString, newString, replaceAll }) => {
      try {
        const abs = real(root, p)
        const cur = await fs.readFile(abs, 'utf8')
        if (!cur.includes(oldString)) return `Error: oldString not found in ${p}`
        const next = replaceAll ? cur.split(oldString).join(newString) : cur.replace(oldString, newString)
        await fs.writeFile(abs, next, 'utf8')
        return `edited ${p}`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'edit_file',
      description: 'Replace an exact substring in a file. Set replaceAll to replace every occurrence.',
      schema: z.object({
        path: z.string(),
        oldString: z.string(),
        newString: z.string(),
        replaceAll: z.boolean().optional(),
      }),
    },
  )

  const ls = tool(
    async ({ path: p }) => {
      try {
        const abs = real(root, p ?? '/')
        const ents = await fs.readdir(abs, { withFileTypes: true })
        return ents.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n') || '(empty)'
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'ls',
      description: 'List the immediate children of a directory. `path` defaults to "/".',
      schema: z.object({ path: z.string().optional() }),
    },
  )

  const glob = tool(
    async ({ pattern }) => {
      const out: string[] = []
      async function walk(dir: string): Promise<void> {
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else {
            const rel = '/' + path.relative(root, full)
            if (simpleMatch(pattern, rel)) out.push(rel)
          }
        }
      }
      await walk(root)
      return out.sort().slice(0, 200).join('\n') || `No files match ${pattern}`
    },
    {
      name: 'glob',
      description: 'Find files by a glob-ish pattern (supports * and **). Returns up to 200 paths.',
      schema: z.object({ pattern: z.string() }),
    },
  )

  const grep = tool(
    async ({ pattern, path: p }) => {
      const re = new RegExp(pattern)
      const hits: string[] = []
      async function walk(dir: string): Promise<void> {
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else {
            const rel = '/' + path.relative(root, full)
            const text = await fs.readFile(full, 'utf8').catch(() => '')
            text.split('\n').forEach((line, i) => {
              if (re.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`)
            })
          }
        }
      }
      await walk(real(root, p ?? '/'))
      return hits.slice(0, 200).join('\n') || `No matches for ${pattern}`
    },
    {
      name: 'grep',
      description: 'Search file contents by regex. Optional `path` scopes the search. Returns up to 200 `file:line` hits.',
      schema: z.object({ pattern: z.string(), path: z.string().optional() }),
    },
  )

  return [writeFile, readFile, editFile, ls, glob, grep]
}

/** Minimal glob: `**` matches any chars incl. `/`; `*` matches any chars except `/`. Anchored full-match. */
function simpleMatch(pattern: string, p: string): boolean {
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ' ')
    .replace(/\*/g, '[^/]*')
    .replace(/ /g, '.*')
  return new RegExp(`^${rx.startsWith('/') ? '' : '.*'}${rx}$`).test(p)
}
