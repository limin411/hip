/**
 * Hip whiteboard tool chrome (PR-2).
 * role="toolbar"; each tool button uses aria-pressed.
 */
import {
  ArrowUpRight,
  Circle,
  Minus,
  MousePointer2,
  Square,
  Type,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { BoardTool } from '@/domain/knowledge/boardOps'

export type BoardToolbarProps = {
  tool: BoardTool
  onToolChange: (tool: BoardTool) => void
  /** When true (e.g. text editing), tools stay visible but non-interactive. */
  disabled?: boolean
  className?: string
}

const TOOLS: Array<{
  id: BoardTool
  shortcut: string
  label: string
  testId: string
  Icon: typeof Square
}> = [
  { id: 'select', shortcut: 'V', label: 'Select', testId: 'hip-board-tool-select', Icon: MousePointer2 },
  { id: 'rect', shortcut: 'R', label: 'Rectangle', testId: 'hip-board-tool-rect', Icon: Square },
  { id: 'ellipse', shortcut: 'O', label: 'Ellipse', testId: 'hip-board-tool-ellipse', Icon: Circle },
  { id: 'line', shortcut: 'L', label: 'Line', testId: 'hip-board-tool-line', Icon: Minus },
  { id: 'arrow', shortcut: 'A', label: 'Arrow', testId: 'hip-board-tool-arrow', Icon: ArrowUpRight },
  { id: 'text', shortcut: 'T', label: 'Text', testId: 'hip-board-tool-text', Icon: Type },
]

export function BoardToolbar({ tool, onToolChange, disabled, className }: BoardToolbarProps) {
  return (
    <div
      className={cn(
        'pointer-events-auto absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-surface/95 px-1 py-0.5 shadow-sm backdrop-blur-sm',
        className,
      )}
      role="toolbar"
      aria-label="Whiteboard tools"
      data-testid="hip-board-toolbar"
    >
      {TOOLS.map(({ id, shortcut, label, testId, Icon }) => {
        const pressed = tool === id
        return (
          <Button
            key={id}
            type="button"
            size="icon"
            variant="ghost"
            className={cn(
              'h-8 w-8',
              pressed && 'bg-state-hover text-ink',
            )}
            title={`${label} (${shortcut})`}
            aria-label={`${label} (${shortcut})`}
            aria-pressed={pressed}
            disabled={disabled}
            data-testid={testId}
            data-tool={id}
            onMouseDown={(e) => {
              // Keep canvas focus for keyboard shortcuts after tool click.
              e.preventDefault()
            }}
            onClick={() => onToolChange(id)}
          >
            <Icon size={15} strokeWidth={2} />
          </Button>
        )
      })}
    </div>
  )
}

export { TOOLS as BOARD_TOOLBAR_ITEMS }
