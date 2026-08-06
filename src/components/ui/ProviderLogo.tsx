import { useEffect, useState } from 'react'
import {
  providerLogoUrl,
  shouldLoadProviderLogo,
} from '@/lib/providerLogo'
import { cn } from '@/lib/utils'

export type ProviderLogoProps = {
  providerId: string
  name: string
  custom?: boolean
  /** Pixel box; list=24 (h-6), detail=32 (h-8). */
  size?: number
  /**
   * Surface + text tokens for the letter fallback (and box chrome).
   * Call site must pass active/inactive styles — component does not know selection.
   */
  className?: string
  /** Override logo CDN base (tests / mirrors). */
  logoBase?: string
}

/**
 * Provider brand mark from models.dev logos CDN, with letter underlay until load
 * and permanent letter fallback on error / custom / offline.
 */
export function ProviderLogo({
  providerId,
  name,
  custom,
  size = 24,
  className,
  logoBase,
}: ProviderLogoProps) {
  const src = shouldLoadProviderLogo({ id: providerId, custom }, logoBase)
    ? providerLogoUrl(providerId, logoBase)
    : ''
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Clear error/load state when URL identity changes (shared-component contract).
  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [src])

  const letter = (name || providerId || '?').charAt(0).toUpperCase()
  const showImg = Boolean(src) && !failed

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md text-caption font-medium',
        className,
      )}
      style={{ width: size, height: size }}
      data-testid={showImg && loaded ? 'provider-logo' : 'provider-logo-fallback'}
      aria-hidden
    >
      {/* Letter always present until successful load — avoids empty-box flash / CLS */}
      <span
        className={cn(
          'flex h-full w-full items-center justify-center',
          showImg && loaded && 'opacity-0',
        )}
      >
        {letter}
      </span>
      {showImg && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          data-provider-id={providerId}
          data-testid="provider-logo-img"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'absolute inset-0 h-full w-full object-contain p-0.5',
            !loaded && 'opacity-0',
            'dark:brightness-0 dark:invert',
          )}
        />
      )}
    </span>
  )
}
