import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'
import { DocOutline } from './DocOutline'
import { cn } from '@/lib/utils'
import { extractDocOutline, slugifyHeading } from '@/domain/knowledge/mdPreview'

/**
 * Knowledge right-rail: Outline + Backlinks + Outbound.
 * Same chrome as ArtifactPanel / PreviewPanel — hosted in AppLayout's resizable drawer.
 */
export function KnowledgeOutlinePanel() {
  const { t } = useTranslation()
  const draftBody = useKnowledgeStore((s) => s.draftBody)
  const docBody = useKnowledgeStore((s) => s.docBody)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const backlinks = useKnowledgeStore((s) => s.backlinks)
  const outboundLinks = useKnowledgeStore((s) => s.outboundLinks)
  const linkPanelStatus = useKnowledgeStore((s) => s.linkPanelStatus)
  const requestOutlineJump = useKnowledgeStore((s) => s.requestOutlineJump)
  const openDoc = useKnowledgeStore((s) => s.openDoc)
  const setKnowledgePanelOpen = useUiStore((s) => s.setKnowledgePanelOpen)

  const content = draftBody || docBody

  const openBacklink = async (fromDocId: string, fragment: string | null) => {
    await openDoc(fromDocId)
    if (fragment) {
      // Jump after open — best-effort match heading text or slug
      const body = useKnowledgeStore.getState().draftBody || useKnowledgeStore.getState().docBody
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
        className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2"
      >
        <span
          className="truncate px-1 text-body font-medium text-ink"
          data-tauri-drag-region="false"
          data-testid="panel-title"
        >
          {t('knowledge.outline.title')}
        </span>
        <div className="flex items-center gap-2" data-tauri-drag-region="false">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setKnowledgePanelOpen(false)}
            title={t('artifact.closePanel')}
            data-testid="knowledge-outline-panel-close"
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!activeDocId ? (
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
              <h3 className="px-1 pb-1 text-meta font-medium uppercase tracking-wide text-ink-tertiary">
                {t('knowledge.outline.sectionOutline')}
              </h3>
              <DocOutline content={content} onSelect={(item) => requestOutlineJump(item)} />
            </section>

            <section data-testid="knowledge-backlinks-section">
              <h3 className="px-1 pb-1 text-meta font-medium uppercase tracking-wide text-ink-tertiary">
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
              <h3 className="px-1 pb-1 text-meta font-medium uppercase tracking-wide text-ink-tertiary">
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
