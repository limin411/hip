/**
 * Best-effort removal of on-disk session artifacts on hard delete.
 * Soft-delete must NOT call this (restore needs plans / task-output).
 */
import { rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { approvedPlanJsonPath } from './plan-persistence.js'

export type SessionArtifactRoots = {
  home?: string
  taskOutputRoot?: string
  toolOutputRoot?: string
}

/** plan-mode.md sanitizer: non-alnum → `_` (hyphens become underscores). */
export function sanitizePlanMarkdownId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9]/g, '_')
}

function assertSafeSessionId(sessionId: string): void {
  if (!sessionId || sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
    throw new Error(`invalid session artifact id: ${sessionId}`)
  }
}

export function defaultTaskOutputRoot(home = os.homedir()): string {
  return path.join(home, '.hip', 'task-output')
}

export function defaultToolOutputRoot(home = os.homedir()): string {
  return path.join(home, '.hip', 'data', 'tool-output')
}

export function planMarkdownPath(sessionId: string, home = os.homedir()): string {
  return path.join(home, '.hip', 'plans', `${sanitizePlanMarkdownId(sessionId)}.md`)
}

export function taskOutputDirFor(sessionId: string, root?: string): string {
  assertSafeSessionId(sessionId)
  return path.join(root ?? defaultTaskOutputRoot(), sessionId)
}

export function toolOutputDirFor(sessionId: string, root?: string): string {
  assertSafeSessionId(sessionId)
  return path.join(root ?? defaultToolOutputRoot(), sessionId)
}

function rmBestEffort(target: string): void {
  try {
    rmSync(target, { recursive: true, force: true })
  } catch {
    /* best-effort — must never block session:deleted */
  }
}

/**
 * Remove plans (md + json), task-output/<id>, tool-output/<id>.
 * No-throw for missing paths; invalid ids are ignored (no throw to callers).
 */
export function removeSessionArtifacts(sessionId: string, roots: SessionArtifactRoots = {}): void {
  if (!sessionId || sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
    return
  }
  const home = roots.home ?? os.homedir()
  const taskRoot = roots.taskOutputRoot ?? defaultTaskOutputRoot(home)
  const toolRoot = roots.toolOutputRoot ?? defaultToolOutputRoot(home)

  rmBestEffort(planMarkdownPath(sessionId, home))
  rmBestEffort(approvedPlanJsonPath(sessionId, home))
  rmBestEffort(taskOutputDirFor(sessionId, taskRoot))
  rmBestEffort(toolOutputDirFor(sessionId, toolRoot))
}
