import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useHipConfigStore } from '@/store/hipConfigStore'
import {
  DOC_WIDTH_MEASURE,
  normalizeDocWidthId,
} from '@/domain/knowledge/docWidth'
import {
  ImageLightbox,
  imageLightboxTargetFromEvent,
} from '@/components/ui/ImageLightbox'
import './knowledge-doc-typography.css'

/**
 * Full-page document body chrome (no elevated card).
 * Mode overflow is parent-owned via paperClassName — not part of this constant.
 */
export const DOC_PAGE_SHELL =
  'w-full min-h-0 flex-1 flex flex-col bg-surface-content knowledge-doc-paper-host'

/** @deprecated Use DOC_PAGE_SHELL — kept as alias for any residual imports. */
export const DOC_PAPER_SHELL = DOC_PAGE_SHELL

/**
 * Document page column: fills the workspace main area (no rounded card).
 * Scroll ownership stays in KnowledgeWorkspace (Live/Source scroller).
 *
 * Mode overflow is applied by the parent via paperClassName — default classes omit
 * overflow so Workspace can pass mode-specific overflow without fighting the primitive.
 *
 * Click any content image (BlockNote / Typora live widgets) → floating enlarge preview.
 */
export function KnowledgeDocCanvas({
  children,
  className,
  paperClassName,
}: {
  children: ReactNode
  className?: string
  /** Classes on the page body (overflow, flex grow). */
  paperClassName?: string
}) {
  const docWidth = useHipConfigStore((s) =>
    normalizeDocWidthId(s.config.knowledge?.docWidth),
  )
  const paperStyle = {
    ['--kb-measure' as string]: DOC_WIDTH_MEASURE[docWidth],
  } as CSSProperties

  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(
    null,
  )

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    // Nested React images own their own lightbox (KnowledgeAssetImage).
    if ((e.target as Element | null)?.closest?.('[data-knowledge-lightbox-host]')) {
      return
    }
    const img = imageLightboxTargetFromEvent(e.target)
    if (!img) return
    // Don't steal clicks from UI chrome buttons that embed icons as <img>.
    if (img.closest('button')) return
    const src = (img.currentSrc || img.src || '').trim()
    if (!src) return
    setPreview({ src, alt: img.alt ?? '' })
  }, [])

  return (
    <div
      data-testid="knowledge-doc-canvas"
      className={cn(
        // Full-bleed in main: stretch width/height (gutter lives on scrollports).
        'flex min-h-0 w-full flex-1 flex-col',
        className,
      )}
      onClickCapture={onClickCapture}
    >
      <div
        data-testid="knowledge-doc-paper"
        data-doc-width={docWidth}
        style={paperStyle}
        className={cn(
          DOC_PAGE_SHELL,
          // No horizontal pad on the paper host — scrollports own
          // `.knowledge-doc-inline-pad` so the scrollbar can sit on the
          // main panel's far right edge (content stays guttered).
          paperClassName,
        )}
      >
        {children}
      </div>
      <ImageLightbox
        open={preview != null}
        onOpenChange={(o) => {
          if (!o) setPreview(null)
        }}
        src={preview?.src}
        alt={preview?.alt}
      />
    </div>
  )
}
