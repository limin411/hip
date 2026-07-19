/**
 * Product create spine (D20/D26): all product isolation / parallel worktrees go
 * through WorktreeService.create — no ad-hoc `git worktree add` for product paths.
 *
 * Call sites:
 * - handlers/workspace.ts `git:worktree:create` (protocol; reveal pass-through)
 * - tools/parallel-worktree.ts (agent HITL; reveal: false)
 */
import type { CreateWorktreeServiceOpts, WorktreeService } from './worktree-service.js'

export function createManagedProductWorktree(
  svc: WorktreeService,
  opts: CreateWorktreeServiceOpts,
): ReturnType<WorktreeService['create']> {
  return svc.create(opts)
}
