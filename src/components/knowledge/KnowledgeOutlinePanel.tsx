import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { DocOutline } from './DocOutline'
import { cn } from '@/lib/utils'
import { extractDocOutline, slugifyHeading } from '@/domain/knowledge/mdPreview'

/** Idle debounce so outline does not re-parse on every Live draft tick. */
const OUTLINE_BODY_DEBOUNCE_MS = 200
/** Scrollspy: treat headings within this offset from the scroller top as active. */
const SCROLLSPY_TOP_OFFSET_PX = 72

function findDocScroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const live = document.querySelector(
    '[data-testid="knowledge-doc-live-editor"]',
  ) as HTMLElement | null
  if (live) return live
  const cm = document.querySelector(
    '[data-testid="knowledge-doc-editor"] .cm-scroller',
  ) as HTMLElement | null
  if (cm) return cm
  const reader = document.querySelector(
    '[data-testid="knowledge-doc-reader"]',
  ) as HTMLElement | null
  return reader
}

function headingText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

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
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
  const prevDocIdRef = useRef(activeDocId)
  useEffect(() => {
    if (!activeDocId || !isDoc) {
      setContent('')
      setActiveOutlineId(null)
      prevDocIdRef.current = null
      return
    }
    if (prevDocIdRef.current !== activeDocId) {
      prevDocIdRef.current = activeDocId
      setContent(liveContent)
      setActiveOutlineId(null)
      return
    }
    const id = window.setTimeout(() => setContent(liveContent), OUTLINE_BODY_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [liveContent, activeDocId, isDoc])

  const outlineItems = useMemo(() => extractDocOutline(content), [content])

  // TOC scrollspy — highlight the last heading that crossed the top band.
  useEffect(() => {
    if (!activeDocId || !isDoc || outlineItems.length === 0) {
      setActiveOutlineId(null)
      return
    }

    let raf = 0
    const sync = () => {
      raf = 0
      const scroller = findDocScroller()
      if (!scroller) return
      const scrollerRect = scroller.getBoundingClientRect()
      const band = scrollerRect.top + SCROLLSPY_TOP_OFFSET_PX
      const nodes = scroller.querySelectorAll(
        'h1, h2, h3, h4, h5, h6, [data-content-type="heading"]',
      )
      if (nodes.length === 0) return

      let bestIdx = 0
      for (let i = 0; i < nodes.length; i++) {
        const top = nodes[i].getBoundingClientRect().top
        if (top <= band) bestIdx = i
        else break
      }

      const text = headingText(nodes[bestIdx])
      if (!text) return
      // Match outline by text (handles duplicate titles via first unused match order).
      const seen = new Map<string, number>()
      let hitId: string | null = null
      for (const item of outlineItems) {
        const key = item.text.trim()
        const n = seen.get(key) ?? 0
        seen.set(key, n + 1)
        if (key !== text) continue
        // Count how many DOM headings with this text appear before bestIdx
        let domOcc = 0
        for (let j = 0; j < bestIdx; j++) {
          if (headingText(nodes[j]) === text) domOcc += 1
        }
        if (domOcc === n) {
          hitId = item.id
          break
        }
      }
      if (!hitId) {
        const loose = outlineItems.find((o) => o.text.trim() === text)
        hitId = loose?.id ?? null
      }
      setActiveOutlineId((prev) => (prev === hitId ? prev : hitId))
    }

    const onScroll = () => {
      if (raf) return
      raf = window.requestAnimationFrame(sync)
    }

    const attach = () => {
      const scroller = findDocScroller()
      if (!scroller) return null
      scroller.addEventListener('scroll', onScroll, { passive: true })
      sync()
      return scroller
    }

    let scroller = attach()
    // Editor mounts async (Suspense Live) — retry briefly.
    const retry = window.setInterval(() => {
      if (scroller) {
        window.clearInterval(retry)
        return
      }
      scroller = attach()
      if (scroller) window.clearInterval(retry)
    }, 200)

    window.addEventListener('resize', onScroll)
    return () => {
      window.clearInterval(retry)
      if (raf) window.cancelAnimationFrame(raf)
      scroller?.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [activeDocId, isDoc, outlineItems])

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
                {outlineItems.length > 0 ? (
                  <span className="ml-1 font-normal normal-case text-ink-tertiary">
                    ({outlineItems.length})
                  </span>
                ) : null}
              </h3>
              <DocOutline
                content={content}
                activeId={activeOutlineId}
                onSelect={(item) => requestOutlineJump(item)}
              />
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
