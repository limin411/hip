import type { EditorView } from '@codemirror/view'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import {
  headingAndDispatch,
  insertFence,
  insertLink,
  prefixAndDispatch,
  wrapAndDispatch,
} from '@/domain/knowledge/mdEdit'
import { cn } from '@/lib/utils'

export interface MarkdownToolbarProps {
  getView: () => EditorView | null
  /** Called after a successful edit so parent can sync draftBody from the view. */
  onAfterEdit?: (text: string) => void
  disabled?: boolean
  /** Merge/override root classes (e.g. strip plate when nested in a shared chrome bar). */
  className?: string
}

function ToolBtn({
  label,
  onClick,
  disabled,
  children,
  testId,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  testId?: string
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      title={label}
      aria-label={label}
      disabled={disabled}
      data-testid={testId}
      onMouseDown={(e) => {
        e.preventDefault()
      }}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

export function MarkdownToolbar({
  getView,
  onAfterEdit,
  disabled,
  className,
}: MarkdownToolbarProps) {
  const { t } = useTranslation()

  const run = (fn: (view: EditorView) => boolean) => {
    const view = getView()
    if (!view || view.composing || disabled) return
    if (fn(view)) {
      onAfterEdit?.(view.state.doc.toString())
    }
  }

  return (
    <div
      className={cn(
        '-mx-1 mb-1 flex shrink-0 flex-wrap items-center gap-0.5 rounded-md px-1 py-0.5 text-ink-secondary',
        className,
      )}
      data-testid="knowledge-md-toolbar"
      role="toolbar"
      aria-label={t('knowledge.toolbar.label')}
    >
      <ToolBtn
        label={t('knowledge.toolbar.h1')}
        testId="knowledge-md-h1"
        disabled={disabled}
        onClick={() => run((v) => headingAndDispatch(v, 1))}
      >
        <Heading1 size={14} />
      </ToolBtn>
      <ToolBtn
        label={t('knowledge.toolbar.h2')}
        disabled={disabled}
        onClick={() => run((v) => headingAndDispatch(v, 2))}
      >
        <Heading2 size={14} />
      </ToolBtn>
      <ToolBtn
        label={t('knowledge.toolbar.h3')}
        disabled={disabled}
        onClick={() => run((v) => headingAndDispatch(v, 3))}
      >
        <Heading3 size={14} />
      </ToolBtn>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <ToolBtn
        label={t('knowledge.toolbar.bold')}
        testId="knowledge-md-bold"
        disabled={disabled}
        onClick={() => run((v) => wrapAndDispatch(v, '**'))}
      >
        <Bold size={14} />
      </ToolBtn>
      <ToolBtn
        label={t('knowledge.toolbar.italic')}
        disabled={disabled}
        onClick={() => run((v) => wrapAndDispatch(v, '*'))}
      >
        <Italic size={14} />
      </ToolBtn>
      <ToolBtn
        label={t('knowledge.toolbar.strike')}
        disabled={disabled}
        onClick={() => run((v) => wrapAndDispatch(v, '~~'))}
      >
        <Strikethrough size={14} />
      </ToolBtn>
      <ToolBtn
        label={t('knowledge.toolbar.code')}
        disabled={disabled}
        onClick={() => run((v) => wrapAndDispatch(v, '`'))}
      >
        <Code size={14} />
      </ToolBtn>
      <ToolBtn
        label={t('knowledge.toolbar.link')}
        testId="knowledge-md-link"
        disabled={disabled}
        onClick={() => run((v) => insertLink(v))}
      >
        <Link size={14} />
      </ToolBtn>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <ToolBtn
        label={t('knowledge.toolbar.bullet')}
        disabled={disabled}
        onClick={() => run((v) => prefixAndDispatch(v, '- '))}
      >
        <List size={14} />
      </ToolBtn>
      <ToolBtn
        label={t('knowledge.toolbar.ordered')}
        disabled={disabled}
        onClick={() => run((v) => prefixAndDispatch(v, '1. '))}
      >
        <ListOrdered size={14} />
      </ToolBtn>
      <ToolBtn
        label={t('knowledge.toolbar.quote')}
        disabled={disabled}
        onClick={() => run((v) => prefixAndDispatch(v, '> '))}
      >
        <Quote size={14} />
      </ToolBtn>
      <ToolBtn
        label={t('knowledge.toolbar.fence')}
        disabled={disabled}
        onClick={() => run((v) => insertFence(v))}
      >
        <SquareCode size={14} />
      </ToolBtn>
    </div>
  )
}
