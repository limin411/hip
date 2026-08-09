import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { modalMotion, overlayMotion } from './motionClasses'

export interface ImageLightboxProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolved image URL (data: / https: / blob:). */
  src: string | null | undefined
  alt?: string
}

/**
 * Full-viewport floating image preview.
 * Click backdrop / Esc / close button dismisses.
 */
export function ImageLightbox({
  open,
  onOpenChange,
  src,
  alt = '',
}: ImageLightboxProps) {
  const { t } = useTranslation()
  const title = alt.trim() || t('knowledge.asset.preview')

  return (
    <Dialog.Root open={open && Boolean(src)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-[240] bg-black/80',
            overlayMotion,
          )}
          data-testid="image-lightbox-overlay"
        />
        <Dialog.Content
          className={cn(
            // Full-viewport stage; inset centering (no translate — see Modal).
            'fixed inset-0 z-[250] m-auto flex h-[min(92dvh,100%)] w-[min(96vw,100%)]',
            'flex-col items-center justify-center gap-3 border-0 bg-transparent p-4 shadow-none outline-none',
            modalMotion,
          )}
          aria-describedby={undefined}
          data-testid="image-lightbox"
          onClick={(e) => {
            // Click empty stage (not the image) closes.
            if (e.target === e.currentTarget) onOpenChange(false)
          }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Close
            type="button"
            className={cn(
              'absolute right-3 top-3 z-[1] inline-flex h-9 w-9 items-center justify-center',
              'rounded-full bg-black/50 text-white/90 transition-colors',
              'hover:bg-black/70 hover:text-white focus-visible:outline-none',
              'focus-visible:ring-2 focus-visible:ring-white/60',
            )}
            aria-label={t('common.close')}
            data-testid="image-lightbox-close"
          >
            <X size={18} aria-hidden />
          </Dialog.Close>
          {src ? (
            <img
              src={src}
              alt={alt}
              data-testid="image-lightbox-img"
              className="max-h-full max-w-full select-none object-contain drop-shadow-lg"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
          {alt.trim() ? (
            <p
              className="max-w-full truncate px-4 text-center text-meta text-white/80"
              data-testid="image-lightbox-caption"
            >
              {alt}
            </p>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * True when a click target should open the doc image lightbox.
 * Skips non-content images (icons, UI chrome) via opt-out attribute.
 */
export function imageLightboxTargetFromEvent(
  target: EventTarget | null,
): HTMLImageElement | null {
  if (!(target instanceof Element)) return null
  if (target.closest('[data-no-image-lightbox]')) return null
  const img =
    target instanceof HTMLImageElement
      ? target
      : target.closest('img')
  if (!(img instanceof HTMLImageElement)) return null
  if (img.closest('[data-testid="image-lightbox"]')) return null
  const src = (img.currentSrc || img.src || '').trim()
  if (!src) return null
  return img
}
