import { useEffect, useState } from 'react'
import { ACTION_PATH, type MascotAction } from '@/components/login/MascotActor'
import { HipLogo } from '@/components/login/HipLogo'

function motionUrl(action: MascotAction): string {
  const base = import.meta.env.BASE_URL ?? '/'
  const root = base.endsWith('/') ? base : `${base}/`
  return `${root}motion/${ACTION_PATH[action]}`
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Farm plot mascot — pinned motion clip, respects reduced-motion. */
export function IsoMascot({
  action,
  size = 96,
  forceStatic = false,
}: {
  action: MascotAction
  size?: number
  forceStatic?: boolean
}) {
  const [systemReduced, setSystemReduced] = useState(prefersReducedMotion)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onChange = () => setSystemReduced(Boolean(mq?.matches))
    mq?.addEventListener?.('change', onChange)
    onChange()
    return () => mq?.removeEventListener?.('change', onChange)
  }, [])

  if (forceStatic || systemReduced) {
    return <HipLogo size={size} decorative />
  }

  return (
    <div
      className="iso-mascot"
      style={{ width: size, height: size }}
      aria-hidden
      data-mascot-action={action}
      data-testid="workbench-mascot"
    >
      <img
        src={motionUrl(action)}
        alt=""
        width={size}
        height={size}
        className="h-full w-full select-none object-contain"
        draggable={false}
      />
    </div>
  )
}
