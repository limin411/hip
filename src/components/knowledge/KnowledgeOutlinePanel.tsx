import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { DocOutline } from './DocOutline'
import { BoardStructureList } from './BoardStructureList'
import { BoardSelectionPanel } from './BoardSelectionPanel'
import { cn } from '@/lib/utils'
import { extractDocOutline, slugifyHeading } from '@/domain/knowledge/mdPreview'

/** Idle debounce so outline does not re-parse on every Live draft tick. */
const OUTLINE_BODY_DEBOUNCE_MS = 200

/**
 * Knowledge right-rail: Outline + Backlinks + Outbound (docs),
 * or Canvas companion: metadata + selection + elements (boards, LKD-20…32).
 * Boards have no document outline — panel title is "Canvas", not "Outline".
 * Same chrome as ArtifactPanel / PreviewPanel — hosted in AppLayout's resizable drawer.
 */
export function KnowledgeOutlinePanel() {
  const { t, i18n } = useTranslation()
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
  const boardOutline = useKnowledgeStore((s) => s.boardOutline)
  const boardSelection = useKnowledgeStore((s) => s.boardSelection)

  const activeNode = activeDocId ? nodes.find((n) => n.id === activeDocId) : undefined
  // Prefer kind; brd_* fallback so rail does not flash doc-outline chrome.
  const isBoard =
    activeNode?.kind === 'board' ||
    (activeDocId != null && activeDocId.startsWith('brd_'))

  const liveContent = draftBody || docBody
  const [content, setContent] = useState(liveContent)
  const prevDocIdRef = useRef(activeDocId)
  useEffect(() => {
    if (!activeDocId || isBoard) {
      setContent('')
      prevDocIdRef.current = isBoard ? activeDocId : null
      return
    }
    // Doc switch: paint outline immediately.
    if (prevDocIdRef.current !== activeDocId) {
      prevDocIdRef.current = activeDocId
      setContent(liveContent)
      return
    }
    const id = window.setTimeout(() => setContent(liveContent), OUTLINE_BODY_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [liveContent, activeDocId, isBoard])

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

  // LKD-27: only show outline/selection stamped for the active board.
  const outlineForBoard =
    isBoard && boardOutline?.boardId === activeDocId ? boardOutline : null
  const selectionForBoard =
    isBoard && boardSelection?.boardId === activeDocId ? boardSelection : null
  const selectedIdSet = new Set(selectionForBoard?.ids ?? [])
  const hasBoardSelection = (selectionForBoard?.ids.length ?? 0) > 0
  const boardTitle =
    activeNode?.title?.trim() || t('knowledge.board.untitled')
  const boardUpdatedLabel = (() => {
    const at = activeNode?.updatedAt
    if (at == null || !Number.isFinite(at)) return null
    try {
      return new Intl.DateTimeFormat(i18n.language || undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(at))
    } catch {
      return null
    }
  })()

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
          {isBoard ? t('knowledge.board.panelTitle') : t('knowledge.outline.title')}
        </span>
        <div className="flex items-center gap-2" data-tauri-drag-region="false">
          {/* Relocated from main toolbar when open — same toggle collapses the rail. */}
          <PanelToggle slot="panel" />
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
        ) : isBoard ? (
          <div
            className="flex flex-col gap-4 p-2 pb-6"
            data-testid="knowledge-board-companion"
          >
            {/* Canvas metadata — primary when nothing selected (no doc outline). */}
            <section data-testid="knowledge-board-canvas-section">
              <h3 className="px-1 pb-1 text-caption font-medium text-ink-tertiary">
                {t('knowledge.board.sectionCanvas')}
              </h3>
              <dl
                className="flex flex-col gap-1.5 px-1"
                data-testid="knowledge-board-canvas-meta"
              >
                <div className="flex items-start justify-between gap-2">
                  <dt className="shrink-0 text-meta text-ink-tertiary">
                    {t('knowledge.board.metaTitle')}
                  </dt>
                  <dd
                    className="min-w-0 truncate text-right text-meta text-ink"
                    data-testid="knowledge-board-meta-title"
                  >
                    {boardTitle}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <dt className="shrink-0 text-meta text-ink-tertiary">
                    {t('knowledge.board.metaElements')}
                  </dt>
                  <dd
                    className="text-meta text-ink"
                    data-testid="knowledge-board-meta-elements"
                  >
                    {outlineForBoard?.totalElements ?? 0}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <dt className="shrink-0 text-meta text-ink-tertiary">
                    {t('knowledge.board.metaImages')}
                  </dt>
                  <dd
                    className="text-meta text-ink"
                    data-testid="knowledge-board-meta-images"
                  >
                    {outlineForBoard?.imageCount ?? 0}
                  </dd>
                </div>
                {boardUpdatedLabel ? (
                  <div className="flex items-start justify-between gap-2">
                    <dt className="shrink-0 text-meta text-ink-tertiary">
                      {t('knowledge.board.metaUpdated')}
                    </dt>
                    <dd
                      className="min-w-0 text-right text-meta text-ink"
                      data-testid="knowledge-board-meta-updated"
                    >
                      {boardUpdatedLabel}
                    </dd>
                  </div>
                ) : null}
                <p
                  className="pt-0.5 text-caption text-ink-tertiary"
                  data-testid="knowledge-board-stats"
                >
                  {t('knowledge.board.stats', {
                    elements: outlineForBoard?.totalElements ?? 0,
                    images: outlineForBoard?.imageCount ?? 0,
                  })}
                </p>
              </dl>
            </section>

            {/* Selection inspector — only when something is selected. */}
            <section data-testid="knowledge-board-selection-section">
              <h3 className="px-1 pb-1 text-caption font-medium text-ink-tertiary">
                {hasBoardSelection
                  ? t('knowledge.board.sectionSelection')
                  : t('knowledge.board.sectionSelectionIdle')}
              </h3>
              <BoardSelectionPanel selection={selectionForBoard} />
            </section>

            <section data-testid="knowledge-board-structure-section">
              <h3 className="px-1 pb-1 text-caption font-medium text-ink-tertiary">
                {t('knowledge.board.sectionStructure')}
              </h3>
              <BoardStructureList
                items={outlineForBoard?.items ?? []}
                selectedIds={selectedIdSet}
                truncated={outlineForBoard?.truncated ?? false}
                totalElements={outlineForBoard?.totalElements ?? 0}
              />
            </section>
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
