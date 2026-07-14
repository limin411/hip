import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, AlertTriangle } from 'lucide-react'
import {
  getKnowledgeBacklinks,
  getKnowledgeBrokenOutboundCount,
  useKnowledgeStore,
} from '@/store/knowledgeStore'
import { cn } from '@/lib/utils'

/**
 * Side panel: documents linking to the active doc + broken outbound count (P1.4).
 * Index is rebuilt with search; no separate rebuild control.
 */
export function BacklinksPanel({
  spaceId,
  docId,
  onOpenDoc,
}: {
  spaceId: string
  docId: string
  onOpenDoc: (id: string) => void
}) {
  const { t } = useTranslation()
  const nodes = useKnowledgeStore((s) => s.nodes)
  // Re-subscribe when save/index status changes so backlinks refresh after flush.
  const saveState = useKnowledgeStore((s) => s.saveState)
  const indexStatus = useKnowledgeStore((s) => s.indexStatus)
  const draftBody = useKnowledgeStore((s) => s.draftBody)
  const docBody = useKnowledgeStore((s) => s.docBody)

  const titleById = useMemo(() => {
    const m = new Map<string, string>()
    for (const n of nodes) {
      if (n.kind === 'doc') m.set(n.id, n.title)
    }
    return m
  }, [nodes])

  const backlinks = useMemo(() => {
    void saveState
    void indexStatus
    void draftBody
    void docBody
    return getKnowledgeBacklinks(spaceId, docId)
  }, [spaceId, docId, saveState, indexStatus, draftBody, docBody, nodes])

  const brokenCount = useMemo(() => {
    void saveState
    void indexStatus
    void draftBody
    void docBody
    return getKnowledgeBrokenOutboundCount(spaceId, docId)
  }, [spaceId, docId, saveState, indexStatus, draftBody, docBody, nodes])

  return (
    <aside
      className="flex w-[220px] shrink-0 flex-col border-l border-border bg-surface-subtle"
      data-testid="knowledge-backlinks-panel"
    >
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5">
        <Link2 size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-meta font-semibold text-ink">
          {t('knowledge.backlinks.title')}
        </h2>
        {backlinks.length > 0 && (
          <span
            className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] tabular-nums text-ink-secondary"
            data-testid="knowledge-backlinks-count"
          >
            {backlinks.length}
          </span>
        )}
      </div>

      {brokenCount > 0 && (
        <div
          className="flex items-start gap-1.5 border-b border-border px-3 py-2 text-meta text-danger"
          data-testid="knowledge-backlinks-broken"
          title={t('knowledge.backlinks.brokenHint')}
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {t('knowledge.backlinks.brokenCount', { count: brokenCount })}
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {backlinks.length === 0 ? (
          <p
            className="px-2 py-3 text-meta text-ink-tertiary"
            data-testid="knowledge-backlinks-empty"
          >
            {t('knowledge.backlinks.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5" data-testid="knowledge-backlinks-list">
            {backlinks.map((edge) => {
              const title =
                titleById.get(edge.fromDocId) ??
                edge.fromDocId
              return (
                <li key={`${edge.fromSpaceId}:${edge.fromDocId}:${edge.title}`}>
                  <button
                    type="button"
                    data-testid="knowledge-backlink-item"
                    data-doc-id={edge.fromDocId}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-meta',
                      'text-ink-secondary hover:bg-state-hover hover:text-ink',
                    )}
                    onClick={() => onOpenDoc(edge.fromDocId)}
                    title={t('knowledge.backlinks.openHint', { title })}
                  >
                    <span className="truncate font-medium">{title}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
