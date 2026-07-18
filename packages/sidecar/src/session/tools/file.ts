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
  applyPatch: StructuredToolInterface
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
        'Create or overwrite a file. `path` is absolute relative to the project root (e.g. "/index.html"). ' +
        'Prefer edit_file for localized fixes (text overflow, box sizes, small sections). ' +
        'Avoid a single write_file with multi-thousand-line content — large one-shot rewrites can stall; ' +
        'for big changes, edit in sections with edit_file or write smaller chunks.',
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
        'instead of re-reading the whole file when you only need a section. ' +
        'If output is truncated, re-read the missing ranges with offset/limit; do not rewrite the whole ' +
        'file from a partial read — prefer edit_file for localized changes (e.g. SVG box/font tweaks).',
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
    async (raw) => {
      try {
        const p = raw.path
        const abs = await resolvePath(p)
        let cur = await fs.readFile(abs, 'utf8')
        const edits =
          Array.isArray(raw.edits) && raw.edits.length > 0
            ? raw.edits
            : raw.oldString !== undefined
              ? [{ oldString: raw.oldString, newString: raw.newString ?? '', replaceAll: raw.replaceAll }]
              : []
        if (edits.length === 0) return `Error: no edits provided for ${p}`

        const diffs: string[] = []
        for (const ed of edits) {
          const oldS = ed.oldString ?? ''
          const newS = ed.newString ?? ''
          const replaceAll = !!ed.replaceAll
          let idx = cur.indexOf(oldS)
          if (idx < 0) {
            // Limited fuzzy: normalize trailing whitespace / smart quotes for match only.
            const norm = (s: string) =>
              s
                .replace(/[\u2018\u2019]/g, "'")
                .replace(/[\u201C\u201D]/g, '"')
                .replace(/[\u2013\u2014]/g, '-')
                .split('\n')
                .map((l) => l.trimEnd())
                .join('\n')
            const nCur = norm(cur)
            const nOld = norm(oldS)
            const nIdx = nCur.indexOf(nOld)
            if (nIdx < 0) {
              const snippet = cur.slice(0, 200).replace(/\n/g, '\\n')
              const count = cur.split(oldS).length - 1
              return (
                `Error: oldString not found in ${p}` +
                (count > 1 ? ` (note: raw count would be ${count})` : '') +
                `. File starts with: ${snippet}`
              )
            }
            // Fall back to exact-only when fuzzy index differs in length mapping — require unique normalized match.
            if (nCur.indexOf(nOld, nIdx + 1) >= 0 && !replaceAll) {
              return `Error: oldString matches multiple locations in ${p}; expand context or set replaceAll`
            }
            // Apply using original oldS failure path message if we cannot map offsets safely:
            return `Error: oldString not found exactly in ${p} (fuzzy-normalized match exists — use exact bytes from read_file)`
          }
          if (!replaceAll) {
            const second = cur.indexOf(oldS, idx + 1)
            if (second >= 0) {
              return `Error: oldString matches multiple locations in ${p}; expand context or set replaceAll`
            }
          }
          const before = cur
          cur = replaceAll ? cur.split(oldS).join(newS) : cur.replace(oldS, newS)
          diffs.push(`@@ ${p}\n-${oldS.slice(0, 80)}\n+${newS.slice(0, 80)}`)
          if (before === cur) return `Error: edit produced no change in ${p}`
        }
        await fs.writeFile(abs, cur, 'utf8')
        return `edited ${p}\n${diffs.join('\n')}`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'edit_file',
      description:
        'Replace substring(s) in a file. Prefer this over write_file for localized fixes. ' +
        'Provide oldString/newString, or edits[] for multiple non-overlapping replacements against the original file. ' +
        'oldString must be unique unless replaceAll is true.',
      schema: z.object({
        path: z.string(),
        oldString: z.string().optional(),
        newString: z.string().optional(),
        replaceAll: z.boolean().optional(),
        edits: z
          .array(
            z.object({
              oldString: z.string(),
              newString: z.string(),
              replaceAll: z.boolean().optional(),
            }),
          )
          .optional(),
      }),
    },
  )

  const applyPatch = tool(
    async ({ patch }) => {
      try {
        const text = patch.trim()
        if (!text.includes('*** Begin Patch') || !text.includes('*** End Patch')) {
          return 'Error: patch must include *** Begin Patch and *** End Patch'
        }
        const body = text
          .replace(/^\*\*\* Begin Patch\s*/m, '')
          .replace(/\*\*\* End Patch\s*$/m, '')
          .trim()
        const hunks = body.split(/(?=\*\*\* (?:Add|Update|Delete) File: )/).filter(Boolean)
        if (hunks.length === 0) return 'Error: no file hunks in patch'
        const results: string[] = []
        for (const hunk of hunks) {
          const add = hunk.match(/^\*\*\* Add File: (.+)\n([\s\S]*)$/)
          const del = hunk.match(/^\*\*\* Delete File: (.+)\s*$/)
          const upd = hunk.match(/^\*\*\* Update File: (.+)\n([\s\S]*)$/)
          if (add) {
            const rel = add[1].trim()
            const abs = await resolvePath(rel)
            const lines = add[2]
              .split('\n')
              .filter((l) => l.startsWith('+'))
              .map((l) => l.slice(1))
              .join('\n')
            await fs.mkdir(path.dirname(abs), { recursive: true })
            await fs.writeFile(abs, lines.endsWith('\n') ? lines : `${lines}\n`, 'utf8')
            results.push(`added ${rel}`)
            continue
          }
          if (del) {
            const rel = del[1].trim()
            const abs = await resolvePath(rel)
            await fs.unlink(abs)
            results.push(`deleted ${rel}`)
            continue
          }
          if (upd) {
            const rel = upd[1].trim()
            const abs = await resolvePath(rel)
            let cur = await fs.readFile(abs, 'utf8')
            const changeLines = upd[2].split('\n').filter((l) => l.startsWith('-') || l.startsWith('+') || l.startsWith(' '))
            // Simple apply: collect contiguous -/+ groups as replace pairs (Codex subset).
            let i = 0
            while (i < changeLines.length) {
              if (changeLines[i].startsWith('@@') || changeLines[i].startsWith('***')) {
                i++
                continue
              }
              const oldParts: string[] = []
              const newParts: string[] = []
              while (i < changeLines.length && (changeLines[i].startsWith(' ') || changeLines[i].startsWith('-') || changeLines[i].startsWith('+'))) {
                const line = changeLines[i]
                if (line.startsWith(' ')) {
                  oldParts.push(line.slice(1))
                  newParts.push(line.slice(1))
                } else if (line.startsWith('-')) {
                  oldParts.push(line.slice(1))
                } else if (line.startsWith('+')) {
                  newParts.push(line.slice(1))
                }
                i++
              }
              const oldBlock = oldParts.join('\n')
              const newBlock = newParts.join('\n')
              if (oldBlock.length === 0 && newBlock.length > 0) {
                // pure insert at EOF fallback
                cur = cur.endsWith('\n') ? cur + newBlock + '\n' : cur + '\n' + newBlock + '\n'
              } else if (!cur.includes(oldBlock)) {
                return `Error: patch context not found in ${rel}: ${oldBlock.slice(0, 80)}`
              } else {
                cur = cur.replace(oldBlock, newBlock)
              }
            }
            await fs.writeFile(abs, cur, 'utf8')
            results.push(`updated ${rel}`)
            continue
          }
          return `Error: unrecognized patch hunk: ${hunk.slice(0, 60)}`
        }
        return results.join('\n')
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'apply_patch',
      description:
        'Apply a structured multi-file patch (Codex-style). Prefer this for multi-hunk edits. ' +
        'Format: *** Begin Patch / *** Add|Update|Delete File: path / +/-/ space lines / *** End Patch.',
      schema: z.object({ patch: z.string() }),
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

  return { writeFile, readFile, editFile, applyPatch, ls, glob, grep }
}
