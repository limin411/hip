import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Pencil,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { listChildren } from '@/domain/knowledge/tree'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { Button } from '@/components/ui/Button'

interface SpaceTreeProps {
  onRename: (node: KnowledgeNode) => void
  onDelete: (node: KnowledgeNode) => void
  /** When set, only render nodes in this set (matches ∪ ancestors). */
  visibleIds?: Set<string> | null
}

export function SpaceTree({ onRename, onDelete, visibleIds }: SpaceTreeProps) {
  const { t } = useTranslation()
  const nodes = useKnowledgeStore((s) => s.nodes)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const expanded = useKnowledgeStore((s) => s.expandedFolderIds)
  const busy = useKnowledgeStore((s) => s.busy)
  const openDoc = useKnowledgeStore((s) => s.openDoc)
  const toggleFolder = useKnowledgeStore((s) => s.toggleFolder)

  const roots = listChildren(nodes, null)

  if (roots.length === 0) {
    return (
      <p className="px-2 py-3 text-meta text-ink-tertiary" data-testid="knowledge-tree-empty">
        {t('knowledge.tree.empty')}
      </p>
    )
  }

  const renderNode = (node: KnowledgeNode, depth: number) => {
    if (visibleIds && !visibleIds.has(node.id)) return null

    if (node.kind === 'folder') {
      const isOpen = expanded[node.id] === true
      const kids = listChildren(nodes, node.id)
      return (
        <div key={node.id}>
          <div
            className={cn(
              'group flex w-full items-center gap-0.5 rounded-md py-1 pr-1 text-body transition-colors',
              'text-ink hover:bg-surface-muted',
            )}
            style={{ paddingLeft: depth * 14 + 6 }}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              onClick={() => toggleFolder(node.id)}
              disabled={busy}
            >
              {isOpen ? (
                <ChevronDown size={14} className="shrink-0 text-ink-tertiary" />
              ) : (
                <ChevronRight size={14} className="shrink-0 text-ink-tertiary" />
              )}
              {isOpen ? (
                <FolderOpen size={15} className="shrink-0 text-accent-strong" />
              ) : (
                <Folder size={15} className="shrink-0 text-accent-strong" />
              )}
              <span className="truncate">{node.title}</span>
            </button>
            <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                disabled={busy}
                aria-label={t('knowledge.tree.rename')}
                onClick={() => onRename(node)}
              >
                <Pencil size={12} />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-danger hover:text-danger"
                disabled={busy}
                aria-label={t('knowledge.tree.delete')}
                onClick={() => onDelete(node)}
              >
                <Trash2 size={12} />
              </Button>
            </div>
          </div>
          {isOpen && kids.map((c) => renderNode(c, depth + 1))}
        </div>
      )
    }

    const active = activeDocId === node.id
    return (
      <div
        key={node.id}
        className={cn(
          'group flex w-full items-center gap-0.5 rounded-md py-1 pr-1 text-body transition-colors',
          active
            ? 'bg-accent-active font-medium text-accent-strong'
            : 'text-ink hover:bg-surface-muted',
        )}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          data-testid={`knowledge-tree-doc-${node.id}`}
          onClick={() => void openDoc(node.id)}
          disabled={busy}
        >
          <span className="w-3.5 shrink-0" />
          <FileText size={15} className="shrink-0 text-ink-tertiary" />
          <span className="truncate">{node.title}</span>
        </button>
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={busy}
            aria-label={t('knowledge.tree.rename')}
            onClick={() => onRename(node)}
          >
            <Pencil size={12} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-danger hover:text-danger"
            disabled={busy}
            aria-label={t('knowledge.tree.delete')}
            onClick={() => onDelete(node)}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>
    )
  }

  return <div data-testid="knowledge-tree">{roots.map((n) => renderNode(n, 0))}</div>
}
