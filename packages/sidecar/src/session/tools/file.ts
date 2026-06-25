import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { EXCLUDE_DIRS, MAX_SCAN_FILE_BYTES, real, realInSkill, resolveFull, toGlobRegex } from './helpers.js'

export interface FileTools {
  writeFile: StructuredToolInterface
  readFile: StructuredToolInterface
  editFile: StructuredToolInterface
  ls: StructuredToolInterface
  glob: StructuredToolInterface
  grep: StructuredToolInterface
}

export function buildFileTools(
  resolvePath: (p: string) => Promise<string>,
  root: string,
  skillDirs: string[],
  isFull: boolean,
  pathRoot: string,
): FileTools {
  const writeFile = tool(
    async ({ path: p, content }) => {
      try {
        const abs = await resolvePath(p)
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
      // First, allow an absolute path that canonicalizes to within an enabled skill dir (read-only
      // bundled reference files live outside the project root). Anything else stays jailed to `root`.
      if (skillDirs.length > 0) {
        const inSkill = await realInSkill(skillDirs, p)
        if (inSkill) {
          try {
            return await fs.readFile(inSkill, 'utf8')
          } catch {
            return `Error: file not found: ${p}`
          }
        }
      }
      try {
        const abs = await resolvePath(p)
        return await fs.readFile(abs, 'utf8')
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('escapes')) return `Error: ${msg}`
        return `Error: file not found: ${p}`
      }
    },
    {
      name: 'read_file',
      description:
        'Read a text file. `path` is absolute relative to the project root, OR an absolute path to a ' +
        'bundled file inside a loaded skill dir (as disclosed by use_skill).',
      schema: z.object({ path: z.string() }),
    },
  )

  const editFile = tool(
    async ({ path: p, oldString, newString, replaceAll }) => {
      try {
        const abs = await resolvePath(p)
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
        const abs = await resolvePath(p ?? '/')
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
      let rx: RegExp
      try {
        rx = toGlobRegex(pattern)
      } catch (err) {
        return `Error: invalid pattern: ${(err as Error).message}`
      }
      const out: string[] = []
      // In 'full' (un-jailed) mode glob scans the un-jailed root (cwd) and reports paths relative to it,
      // matching ls/read_file/grep via resolvePath. Otherwise it stays jailed to `root`.
      const globBase = isFull ? pathRoot : root
      async function walk(dir: string): Promise<void> {
        if (out.length >= 200) return
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue
          if (EXCLUDE_DIRS.has(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else {
            const rel = '/' + path.relative(globBase, full)
            if (rx.test(rel)) out.push(rel)
          }
        }
      }
      await walk(globBase)
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
      let re: RegExp
      try {
        re = new RegExp(pattern)
      } catch (err) {
        return `Error: invalid regex: ${(err as Error).message}`
      }
      const hits: string[] = []
      async function walk(dir: string): Promise<void> {
        if (hits.length >= 200) return
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (hits.length >= 200) return
          if (e.name.startsWith('.')) continue
          if (EXCLUDE_DIRS.has(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            await walk(full)
          } else {
            const st = await fs.stat(full)
            if (st.size > MAX_SCAN_FILE_BYTES) continue
            const text = await fs.readFile(full, 'utf8').catch(() => '')
            if (text.slice(0, 8000).includes('\0')) continue
            text.split('\n').forEach((line, i) => {
              if (hits.length < 200 && re.test(line)) hits.push(`/${path.relative(root, full)}:${i + 1}: ${line.trim().slice(0, 200)}`)
            })
          }
        }
      }
      await walk(await resolvePath(p ?? '/'))
      return hits.slice(0, 200).join('\n') || `No matches for ${pattern}`
    },
    {
      name: 'grep',
      description: 'Search file contents by regex. Optional `path` scopes the search. Returns up to 200 `file:line` hits.',
      schema: z.object({ pattern: z.string(), path: z.string().optional() }),
    },
  )

  return { writeFile, readFile, editFile, ls, glob, grep }
}
