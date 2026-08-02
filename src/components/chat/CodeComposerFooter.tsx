import { BranchSwitcher } from '@/components/artifact/BranchSwitcher'

/**
 * Code-surface composer footer row (GitHub Copilot / Cursor style status strip):
 * current git branch in a quiet row below the input, separated from the toolbar
 * by a hairline (see Composer `footer` slot).
 *
 * Rendered only for session-bound code InputBars; the picker self-hides when the
 * session has no cwd / no session id.
 */
export function CodeComposerFooter() {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-0.5"
      data-testid="composer-footer-row"
    >
      <BranchSwitcher />
    </div>
  )
}
