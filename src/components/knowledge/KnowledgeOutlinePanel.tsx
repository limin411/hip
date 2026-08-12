import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { DocOutline } from './DocOutline'
import { extractDocOutline } from '@/domain/knowledge/mdPreview'
import { parseFrontmatter } from '@/domain/knowledge/frontmatter'
import { BacklinkPanel } from './BacklinkPanel'

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
  const nodes = useKnowledgeStore((s) => s.nodes)
  const requestOutlineJump = useKnowledgeStore((s) => s.requestOutlineJump)

  const activeNode = activeDocId ? nodes.find((n) => n.id === activeDocId) : undefined
  // Table leaf: same-shape predicate as KnowledgeWorkspace.tsx（对齐 L287）。
  const isTable =
    activeDocId != null && activeNode?.kind === 'table' && activeDocId.startsWith('tbl_')
  // Docs only; boards/tables hidden. Unknown node id still treated as doc (open path).
  const isDoc =
    activeDocId != null &&
    !isTable &&
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
    if (isTable) return
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

  // 文档统计（字词），随内容防抖刷新。
  const wordCount = useMemo(() => {
    const body = parseFrontmatter(liveContent).bodyWithoutFm
    const words = body.trim().match(/\S+/g)
    return words?.length ?? 0
  }, [liveContent])

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
          {isTable ? t('knowledge.tableInfo.title') : t('knowledge.outline.title')}
        </span>
        <div className="flex items-center gap-2" data-tauri-drag-region="false">
          {activeDocId && (isDoc || isTable) ? (
            <button
              type="button"
              className="rounded-md p-1 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
              aria-label={t('knowledge.backlinks.refresh')}
              data-testid="knowledge-backlink-refresh"
              onClick={() => void useKnowledgeStore.getState().refreshLinkPanel()}
            >
              <RefreshCw size={12} aria-hidden />
            </button>
          ) : null}
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
        ) : isTable ? (
          <div
            className="flex h-full items-center justify-center px-4 py-8 text-center"
            data-testid="knowledge-table-info-placeholder"
            role="status"
          >
            <p className="text-meta text-ink-tertiary">{t('knowledge.tableInfo.empty')}</p>
          </div>
        ) : (
          activeNode?.kind === 'board' ? (
            <div
              className="flex h-full items-center justify-center px-4 py-8 text-center"
              data-testid="knowledge-doc-outline-no-doc"
              role="status"
            >
              <p className="text-meta text-ink-tertiary">{t('knowledge.outline.noBoard')}</p>
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

            <BacklinkPanel />

            <div
              className="flex flex-col gap-1 px-1 pt-1 text-meta text-ink-tertiary"
              data-testid="knowledge-panel-doc-stats"
            >
              <span data-testid="knowledge-doc-word-count">
                {t('knowledge.doc.wordCount', { count: wordCount })}
              </span>
            </div>
          </div>
          )
        )}
      </div>
    </div>
  )
}
