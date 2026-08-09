import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageOff } from 'lucide-react'
import {
  isImageMime,
  normalizeAssetRelPath,
  resolveAssetDataUrl,
} from '@/domain/knowledge/assetUrl'
import { knowledgeErrorMessage, knowledgeRevealPath } from '@/ipc/knowledge'
import { toast } from 'sonner'
import { ImageLightbox } from '@/components/ui/ImageLightbox'
import { cn } from '@/lib/utils'

export interface KnowledgeAssetImageProps {
  spaceId: string
  /** Markdown `src` — may be `assets/…` or remote URL. */
  src?: string | null
  alt?: string
  className?: string
}

/**
 * Preview local knowledge assets via `data:` URLs (K16).
 * Oversize / missing / non-image → placeholder + reveal.
 * Remote / data: / absolute http(s) pass through to plain <img>.
 * Click opens a floating enlarged preview.
 */
export function KnowledgeAssetImage({
  spaceId,
  src,
  alt = '',
  className,
}: KnowledgeAssetImageProps) {
  const { t } = useTranslation()
  const rel = src ? normalizeAssetRelPath(src) : null
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(Boolean(rel))
  const [lightboxOpen, setLightboxOpen] = useState(false)

  useEffect(() => {
    if (!rel) {
      setDataUrl(null)
      setFailed(false)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    setDataUrl(null)
    void resolveAssetDataUrl(spaceId, rel).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res && isImageMime(res.mime)) {
        setDataUrl(res.dataUrl)
      } else {
        setFailed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [spaceId, rel])

  const previewSrc = rel ? dataUrl : src && typeof src === 'string' ? src : null
  const imgClass = cn(className, 'cursor-zoom-in')

  // Non-local: leave browser / CSP path (https may still be blocked by CSP — intentional).
  if (!rel) {
    if (!src) return null
    return (
      <>
        <img
          src={src}
          alt={alt}
          className={imgClass}
          data-testid="knowledge-asset-img-remote"
          data-knowledge-lightbox-host=""
          role="button"
          tabIndex={0}
          aria-label={alt ? `${t('knowledge.asset.previewOpen')}: ${alt}` : t('knowledge.asset.previewOpen')}
          onClick={() => setLightboxOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setLightboxOpen(true)
            }
          }}
        />
        <ImageLightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          src={previewSrc}
          alt={alt}
        />
      </>
    )
  }

  if (loading) {
    return (
      <span
        data-testid="knowledge-asset-img-loading"
        className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-surface-muted px-2 py-1 text-meta text-ink-tertiary"
      >
        {t('knowledge.asset.loading')}
      </span>
    )
  }

  if (failed || !dataUrl) {
    return (
      <span
        data-testid="knowledge-asset-img-placeholder"
        className="inline-flex max-w-full flex-wrap items-center gap-2 rounded border border-dashed border-border bg-surface-muted px-2 py-1.5 text-meta text-ink-secondary"
      >
        <ImageOff size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
        <span className="truncate">{alt || rel}</span>
        <button
          type="button"
          data-testid="knowledge-asset-reveal"
          className="shrink-0 underline hover:text-ink"
          onClick={() => {
            void knowledgeRevealPath(spaceId, rel).catch((e) => {
              toast.error(knowledgeErrorMessage(e))
            })
          }}
        >
          {t('knowledge.asset.reveal')}
        </button>
      </span>
    )
  }

  return (
    <>
      <img
        src={dataUrl}
        alt={alt}
        className={imgClass}
        data-testid="knowledge-asset-img"
        data-asset-rel={rel}
        data-knowledge-lightbox-host=""
        role="button"
        tabIndex={0}
        aria-label={alt ? `${t('knowledge.asset.previewOpen')}: ${alt}` : t('knowledge.asset.previewOpen')}
        onClick={() => setLightboxOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setLightboxOpen(true)
          }
        }}
      />
      <ImageLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        src={dataUrl}
        alt={alt}
      />
    </>
  )
}
