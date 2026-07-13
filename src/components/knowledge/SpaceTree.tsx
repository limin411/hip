import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { listChildren } from '@/domain/knowledge/tree'
import { useKnowledgeStore } from '@/store/knowledgeStore'

interface SpaceTreeProps {
  onRename: (node: KnowledgeNode) => void
  onDelete: (node: KnowledgeNode) => void
}

export function SpaceTree({ onRename, onDelete }: SpaceTreeProps) {
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
    if (node.kind === 'folder') {
      const isOpen = expanded[node.id] === true
      const kids = listChildren(nodes, node.id)
      return (
        <div key={node.id}>
          <div
            className={cn(
              'group flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-body text-ink hover:bg-state-hover',
            )}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
              onClick={() => toggleFolder(node.id)}
              disabled={busy}
            >
              {isOpen ? <ChevronDown size={12} className="shrink-0 text-ink-tertiary" /> : <ChevronRight size={12} className="shrink-0 text-ink-tertiary" />}
              <Folder size={14} className="shrink-0 text-ink-tertiary" />
              <span className="truncate">{node.title}</span>
            </button>
            <button
              type="button"
              className="hidden text-meta text-ink-tertiary group-hover:inline"
              onClick={() => onRename(node)}
              disabled={busy}
            >
              {t('knowledge.tree.rename')}
            </button>
            <button
              type="button"
              className="hidden text-meta text-danger group-hover:inline"
              onClick={() => onDelete(node)}
              disabled={busy}
            >
              {t('knowledge.tree.delete')}
            </button>
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
          'group flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-body',
          active ? 'bg-state-active font-medium text-ink' : 'text-ink hover:bg-state-hover',
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          data-testid={`knowledge-tree-doc-${node.id}`}
          onClick={() => void openDoc(node.id)}
          disabled={busy}
        >
          <span className="w-3" />
          <FileText size={14} className="shrink-0 text-ink-tertiary" />
          <span className="truncate">{node.title}</span>
        </button>
        <button
          type="button"
          className="hidden text-meta text-ink-tertiary group-hover:inline"
          onClick={() => onRename(node)}
          disabled={busy}
        >
          {t('knowledge.tree.rename')}
        </button>
        <button
          type="button"
          className="hidden text-meta text-danger group-hover:inline"
          onClick={() => onDelete(node)}
          disabled={busy}
        >
          {t('knowledge.tree.delete')}
        </button>
      </div>
    )
  }

  return <div data-testid="knowledge-tree">{roots.map((n) => renderNode(n, 0))}</div>
}
