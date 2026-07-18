/**
 * Pure projection for tool results shared by transcript and Agents panel (U12/U23).
 */

import { parseToolInput, toolTitleHint } from './toolPresentation'

export type ToolResultKind =
  | 'diff'
  | 'lines'
  | 'code'
  | 'shell'
  | 'delegate'
  | 'raw'

export interface ToolResultModel {
  kind: ToolResultKind
  title: string
  /** Primary display body */
  body: string
  /** Optional structured lines (grep/ls) */
  lines?: string[]
  /** Exit code for shell */
  exitCode?: number | null
  /** Unified diff when available */
  diff?: string
  path?: string | null
  truncated?: boolean
  isError?: boolean
  errorText?: string
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function buildToolResultModel(tool: {
  name: string
  input: string
  output?: string
  error?: string
  status: string
  truncated?: boolean
  meta?: { diff?: string; paths?: string[]; firstChangedLine?: number }
}): ToolResultModel {
  const title = toolTitleHint(tool)
  const isError = tool.status === 'error' || !!tool.error
  const args = parseToolInput(tool.input)
  const path =
    asString(args.path ?? args.file_path ?? args.filename ?? args.file) ||
    tool.meta?.paths?.[0] ||
    null
  const out = tool.output ?? ''
  const err = tool.error ?? ''

  if (tool.name === 'write_file' || tool.name === 'edit_file' || tool.name === 'apply_patch') {
    const diff = tool.meta?.diff ?? (out.includes('@@') || out.includes('*** ') ? out : undefined)
    return {
      kind: 'diff',
      title,
      body: diff || out || err,
      diff: diff || undefined,
      path,
      truncated: tool.truncated,
      isError,
      errorText: err || undefined,
    }
  }

  if (tool.name === 'grep' || tool.name === 'glob' || tool.name === 'ls') {
    const lines = out.split('\n')
    return {
      kind: 'lines',
      title,
      body: out,
      lines,
      path: asString(args.path) || path,
      truncated: tool.truncated,
      isError,
      errorText: err || undefined,
    }
  }

  if (tool.name === 'read_file' || tool.name === 'read_media') {
    return {
      kind: 'code',
      title,
      body: out || err,
      path,
      truncated: tool.truncated,
      isError,
      errorText: err || undefined,
    }
  }

  if (tool.name === 'run_script') {
    const exitMatch = out.match(/exit(?:_code| code)?[=:\s]+(-?\d+)/i)
    const exitCode = exitMatch ? Number(exitMatch[1]) : null
    return {
      kind: 'shell',
      title,
      body: out || err,
      exitCode: Number.isFinite(exitCode as number) ? exitCode : null,
      truncated: tool.truncated,
      isError: isError || (exitCode != null && exitCode !== 0),
      errorText: err || undefined,
    }
  }

  if (
    tool.name === 'task' ||
    tool.name === 'dispatch_agent' ||
    tool.name === 'task_batch'
  ) {
    return {
      kind: 'delegate',
      title,
      body: out || err,
      truncated: tool.truncated,
      isError,
      errorText: err || undefined,
    }
  }

  return {
    kind: 'raw',
    title,
    body: out || err,
    path,
    truncated: tool.truncated,
    isError,
    errorText: err || undefined,
  }
}
