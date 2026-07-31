import { WorktreeControl } from './WorktreeControl/WorktreeControl'
import { BranchSwitcher } from '@/components/artifact/BranchSwitcher'

/**
 * Code-surface composer footer row (GitHub Copilot / Cursor style status strip):
 * workspace context — worktree + current git branch — in a quiet row below the
 * input, separated from the toolbar by a hairline (see Composer `footer` slot).
 *
 * Rendered only for session-bound code InputBars; the pickers self-hide when the
 * session has no cwd / no session id.
 */
export function CodeComposerFooter() {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-0.5"
      data-testid="composer-footer-row"
    >
      <WorktreeControl />
      <BranchSwitcher />
    </div>
  )
}
