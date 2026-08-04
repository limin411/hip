import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { DocOutline } from './DocOutline'
import { cn } from '@/lib/utils'
import { extractDocOutline, slugifyHeading } from '@/domain/knowledge/mdPreview'

/** Idle debounce so outline does not re-parse on every Live draft tick. */
const OUTLINE_BODY_DEBOUNCE_MS = 200

/**
 * Knowledge right-rail: Outline + Backlinks + Outbound (docs only).
 */
export function KnowledgeOutlinePanel() {
  const { t } = useTranslation()
  const draftBody = useKnowledgeStore((s) => s.draftBody)
  const docBody = useKnowledgeStore((s) => s.docBody)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const nodes = useKnowledgeStore((s) => s.nodes)
  const backlinks = useKnowledgeStore((s) => s.backlinks)
  const outboundLinks = useKnowledgeStore((s) => s.outboundLinks)
  const linkPanelStatus = useKnowledgeStore((s) => s.linkPanelStatus)
  const requestOutlineJump = useKnowledgeStore((s) => s.requestOutlineJump)
  const openDoc = useKnowledgeStore((s) => s.openDoc)

  const activeNode = activeDocId ? nodes.find((n) => n.id === activeDocId) : undefined
  // Docs only; boards hidden. Unknown node id still treated as doc (open path).
  const isDoc =
    activeDocId != null &&
    activeNode?.kind !== 'board' &&
    !(activeDocId.startsWith('brd_') && activeNode == null)

  const liveContent = draftBody || docBody
  const [content, setContent] = useState(liveContent)
  const prevDocIdRef = useRef(activeDocId)
  useEffect(() => {
    if (!activeDocId || !isDoc) {
      setContent('')
      prevDocIdRef.current = null
      return
    }
    if (prevDocIdRef.current !== activeDocId) {
      prevDocIdRef.current = activeDocId
      setContent(liveContent)
      return
    }
    const id = window.setTimeout(() => setContent(liveContent), OUTLINE_BODY_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [liveContent, activeDocId, isDoc])

  const openBacklink = async (fromDocId: string, fragment: string | null) => {
    await openDoc(fromDocId)
    if (fragment) {
      const body =
        useKnowledgeStore.getState().draftBody || useKnowledgeStore.getState().docBody
      const outline = extractDocOutline(body)
      const hit =
        outline.find((o) => o.text === fragment) ||
        outline.find((o) => o.text.toLowerCase() === fragment.toLowerCase()) ||
        outline.find((o) => slugifyHeading(o.text) === slugifyHeading(fragment)) ||
        outline.find((o) => o.id === slugifyHeading(fragment))
      if (hit) {
        useKnowledgeStore.getState().requestOutlineJump(hit)
      }
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col border-l border-border bg-surface"
      data-testid="knowledge-outline-panel"
    >
      <div
        data-tauri-drag-region
        className="flex h-[var(--titlebar-height)] shrink-0 items-center justify-between border-b border-border px-2"
      >
        <span
          className="truncate px-1.5 text-body font-medium tracking-tight text-ink"
          data-tauri-drag-region="false"
          data-testid="panel-title"
        >
          {t('knowledge.outline.title')}
        </span>
        <div className="flex items-center gap-2" data-tauri-drag-region="false">
          <PanelToggle slot="panel" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!activeDocId || !isDoc ? (
          <div
            className="flex h-full items-center justify-center px-4 py-8 text-center"
            data-testid="knowledge-doc-outline-no-doc"
            role="status"
          >
            <p className="text-meta text-ink-tertiary">{t('knowledge.outline.noDoc')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-2 pb-6">
            <section data-testid="knowledge-outline-section">
              <h3 className="px-1 pb-1 text-caption font-medium text-ink-tertiary">
                {t('knowledge.outline.sectionOutline')}
              </h3>
              <DocOutline content={content} onSelect={(item) => requestOutlineJump(item)} />
            </section>

            <section data-testid="knowledge-backlinks-section">
              <h3 className="px-1 pb-1 text-caption font-medium text-ink-tertiary">
                {t('knowledge.outline.sectionBacklinks')}
                {backlinks.length > 0 ? (
                  <span className="ml-1 font-normal normal-case text-ink-tertiary">
                    ({backlinks.length})
                  </span>
                ) : null}
              </h3>
              {linkPanelStatus === 'loading' ? (
                <p className="px-1 text-meta text-ink-tertiary">{t('knowledge.outline.loading')}</p>
              ) : backlinks.length === 0 ? (
                <p
                  className="px-1 text-meta text-ink-tertiary"
                  data-testid="knowledge-backlinks-empty"
                >
                  {t('knowledge.outline.backlinksEmpty')}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5" data-testid="knowledge-backlinks-list">
                  {backlinks.map((b, i) => (
                    <li key={`${b.fromDocId}-${i}-${b.raw}`}>
                      <button
                        type="button"
                        className={cn(
                          'w-full rounded-md px-2 py-1.5 text-left text-meta',
                          'text-ink hover:bg-surface-hover',
                        )}
                        data-testid="knowledge-backlink-item"
                        onClick={() => void openBacklink(b.fromDocId, b.fragment)}
                      >
                        <span className="font-medium">{b.fromTitle}</span>
                        <span className="mt-0.5 block truncate text-ink-tertiary">{b.raw}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section data-testid="knowledge-outbound-section">
              <h3 className="px-1 pb-1 text-caption font-medium text-ink-tertiary">
                {t('knowledge.outline.sectionOutbound')}
              </h3>
              {outboundLinks.filter((l) => l.kind === 'wiki' || l.kind === 'embed').length ===
              0 ? (
                <p className="px-1 text-meta text-ink-tertiary" data-testid="knowledge-outbound-empty">
                  {t('knowledge.outline.outboundEmpty')}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5" data-testid="knowledge-outbound-list">
                  {outboundLinks
                    .filter((l) => l.kind === 'wiki' || l.kind === 'embed')
                    .map((l, i) => {
                      const broken = !l.targetDocId
                      const sameDoc =
                        l.targetDocId != null &&
                        l.targetDocId === activeDocId &&
                        activeSpaceId != null
                      return (
                        <li key={`${l.raw}-${i}`}>
                          <button
                            type="button"
                            disabled={broken && !l.fragment}
                            className={cn(
                              'w-full rounded-md px-2 py-1.5 text-left text-meta',
                              broken
                                ? 'text-danger hover:bg-danger/10'
                                : 'text-ink hover:bg-surface-hover',
                              broken && !l.targetDocId ? 'opacity-90' : '',
                            )}
                            data-testid={
                              broken ? 'knowledge-outbound-broken' : 'knowledge-outbound-item'
                            }
                            onClick={() => {
                              if (l.targetDocId) {
                                void openBacklink(l.targetDocId, l.fragment)
                              } else if (sameDoc || (l.targetTitle === '' && l.fragment)) {
                                void openBacklink(activeDocId!, l.fragment)
                              }
                            }}
                          >
                            <span className="truncate">{l.raw}</span>
                            {broken ? (
                              <span className="mt-0.5 block text-ink-tertiary">
                                {t('knowledge.outline.broken')}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      )
                    })}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
