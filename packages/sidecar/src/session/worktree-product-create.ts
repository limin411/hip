/**
 * Product create spine (D20/D26): all product isolation / parallel worktrees go
 * through WorktreeService.create — no ad-hoc `git worktree add` for product paths.
 *
 * Call sites / source tags (PR7):
 * - handlers/workspace.ts `git:worktree:create` — pass-through source/label/reveal;
 *   client single → `protocol`, host fan-out → `host_fanout` (handler default `protocol`)
 * - tools/parallel-worktree.ts — agent HITL; source: `parallel`, reveal: false
 */
import type { CreateWorktreeServiceOpts, WorktreeService } from './worktree-service.js'

export function createManagedProductWorktree(
  svc: WorktreeService,
  opts: CreateWorktreeServiceOpts,
): ReturnType<WorktreeService['create']> {
  return svc.create(opts)
}
