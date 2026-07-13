import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import {
  MAX_SCAN_FILE_BYTES,
  compileGrepPattern,
  isExcludedDirName,
  realInSkill,
  sliceFileLines,
  toGlobRegex,
} from './helpers.js'

export interface FileTools {
  writeFile: StructuredToolInterface
  readFile: StructuredToolInterface
  editFile: StructuredToolInterface
  ls: StructuredToolInterface
  glob: StructuredToolInterface
  grep: StructuredToolInterface
}

/** Default scope for recursive tools: project-relative `.` (never bare `/`, which is drive root in full mode on Windows). */
const DEFAULT_SCAN_PATH = '.'

export function buildFileTools(
  resolvePath: (p: string) => Promise<string>,
  root: string,
  skillDirs: string[],
  isFull: boolean,
  pathRoot: string,
): FileTools {
  const scanBase = isFull ? pathRoot : root

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
    async ({ path: p, offset, limit }) => {
      const applySlice = (raw: string): string => {
        if (offset === undefined && limit === undefined) return raw
        return sliceFileLines(raw, offset, limit).text
      }
      // First, allow an absolute path that canonicalizes to within an enabled skill dir (read-only
      // bundled reference files live outside the project root). Anything else stays jailed to `root`.
      if (skillDirs.length > 0) {
        const inSkill = await realInSkill(skillDirs, p)
        if (inSkill) {
          try {
            return applySlice(await fs.readFile(inSkill, 'utf8'))
          } catch {
            return `Error: file not found: ${p}`
          }
        }
      }
      try {
        const abs = await resolvePath(p)
        return applySlice(await fs.readFile(abs, 'utf8'))
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
        'bundled file inside a loaded skill dir (as disclosed by use_skill). ' +
        'Optional `offset` (1-based start line) and `limit` (max lines) for large files — use these ' +
        'instead of re-reading the whole file when you only need a section.',
      schema: z.object({
        path: z.string(),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based start line. Omit to start at line 1.'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum number of lines to return from offset.'),
      }),
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
        // Default `.` so full mode never treats bare `/` as the OS drive root.
        const abs = await resolvePath(p ?? DEFAULT_SCAN_PATH)
        const ents = await fs.readdir(abs, { withFileTypes: true })
        return ents.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n') || '(empty)'
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'ls',
      description:
        'List the immediate children of a directory. `path` defaults to the project root (`.`). ' +
        'Prefer project-relative paths (e.g. `/src` or `src`) over OS absolute roots.',
      schema: z.object({ path: z.string().optional() }),
    },
  )

  const defaultGlobCaseInsensitive = process.platform === 'win32'

  const glob = tool(
    async ({ pattern, caseInsensitive }) => {
      const ci = caseInsensitive ?? defaultGlobCaseInsensitive
      let rx: RegExp
      try {
        rx = toGlobRegex(pattern, ci)
      } catch (err) {
        return `Error: invalid pattern: ${(err as Error).message}`
      }
      const out: string[] = []
      // In 'full' (un-jailed) mode glob scans the un-jailed root (cwd) and reports paths relative to it,
      // matching ls/read_file/grep via resolvePath. Otherwise it stays jailed to `root`.
      const globBase = scanBase
      async function walk(dir: string): Promise<void> {
        if (out.length >= 200) return
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue
          if (isExcludedDirName(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full)
          else {
            const rel = '/' + path.relative(globBase, full).split(path.sep).join('/')
            if (rx.test(rel)) out.push(rel)
          }
        }
      }
      await walk(globBase)
      return out.sort().slice(0, 200).join('\n') || `No files match ${pattern}`
    },
    {
      name: 'glob',
      description:
        'Find files by a glob-ish pattern (supports * and **). Returns up to 200 paths. ' +
        'Matching is case-insensitive on Windows by default; set caseInsensitive explicitly to override.',
      schema: z.object({
        pattern: z.string(),
        caseInsensitive: z
          .boolean()
          .optional()
          .describe('Case-insensitive path match. Default true on Windows, false elsewhere.'),
      }),
    },
  )

  const grep = tool(
    async ({ pattern, path: p, caseInsensitive }) => {
      const compiled = compileGrepPattern(pattern, caseInsensitive)
      if (!compiled.ok) return compiled.error
      const { re, notes } = compiled
      const hits: string[] = []
      const relOf = (full: string): string =>
        '/' + path.relative(scanBase, full).split(path.sep).join('/')

      async function scanFile(full: string): Promise<void> {
        if (hits.length >= 200) return
        const st = await fs.stat(full).catch(() => null)
        if (!st || !st.isFile() || st.size > MAX_SCAN_FILE_BYTES) return
        const text = await fs.readFile(full, 'utf8').catch(() => '')
        if (text.slice(0, 8000).includes('\0')) return
        text.split('\n').forEach((line, i) => {
          if (hits.length < 200 && re.test(line)) {
            hits.push(`${relOf(full)}:${i + 1}: ${line.trim().slice(0, 200)}`)
          }
        })
      }

      async function walk(dir: string): Promise<void> {
        if (hits.length >= 200) return
        for (const e of await fs.readdir(dir, { withFileTypes: true })) {
          if (hits.length >= 200) return
          if (e.name.startsWith('.')) continue
          if (isExcludedDirName(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            await walk(full)
          } else {
            await scanFile(full)
          }
        }
      }

      try {
        // Default `.` (project/cwd), never bare `/` — on Windows full mode `/` is the drive root
        // and previously walked into $RECYCLE.BIN.
        const abs = await resolvePath(p ?? DEFAULT_SCAN_PATH)
        const st = await fs.stat(abs)
        if (st.isFile()) {
          await scanFile(abs)
        } else if (st.isDirectory()) {
          await walk(abs)
        } else {
          return `Error: path is neither a file nor a directory: ${p ?? DEFAULT_SCAN_PATH}`
        }
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }

      const body = hits.slice(0, 200).join('\n') || `No matches for ${pattern}`
      if (notes.length === 0) return body
      return `${notes.map((n) => `Note: ${n}`).join('\n')}\n${body}`
    },
    {
      name: 'grep',
      description:
        'Search file contents by JavaScript RegExp. Optional `path` scopes the search to a file or directory ' +
        '(defaults to the project root). Set caseInsensitive=true for case-insensitive match ' +
        '(prefer this over PCRE (?i) flags). Returns up to 200 `file:line` hits.',
      schema: z.object({
        pattern: z.string(),
        path: z.string().optional(),
        caseInsensitive: z
          .boolean()
          .optional()
          .describe('Case-insensitive match. Prefer this over (?i) inline flags. Default false.'),
      }),
    },
  )

  return { writeFile, readFile, editFile, ls, glob, grep }
}
