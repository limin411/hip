/**
 * Persist approved plans under ~/.hip/plans/ (global), not project cwd.
 * Writing into <cwd>/.hip/plans polluted eval worktrees and git status.
 */
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PlanItem } from '@hip/protocol'

export function approvedPlanJsonPath(sessionId: string, home = homedir()): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(home, '.hip', 'plans', `${safeId}.json`)
}

export async function persistApprovedPlan(
  sessionId: string,
  plan: PlanItem[],
  opts?: { home?: string; approvedAt?: number },
): Promise<string> {
  const filePath = approvedPlanJsonPath(sessionId, opts?.home)
  const dir = join(opts?.home ?? homedir(), '.hip', 'plans')
  await mkdir(dir, { recursive: true })
  const tmpFile = `${filePath}.tmp-${Date.now()}`
  const planPayload = {
    sessionId,
    plan,
    approvedAt: opts?.approvedAt ?? Date.now(),
  }
  await writeFile(tmpFile, JSON.stringify(planPayload, null, 2), 'utf8')
  await rename(tmpFile, filePath)
  return filePath
}
