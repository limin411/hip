import { useCallback, useEffect, useRef, useState } from 'react'
import { HipLogo } from '@/components/login/HipLogo'

export type MascotAction =
  | 'blink'
  | 'bounce'
  | 'happy'
  | 'look-around'
  | 'sleep'
  | 'think'
  | 'tilt'
  | 'wave'

/** Approximate clip lengths from public/gif (ms). */
const ACTION_MS: Record<MascotAction, number> = {
  blink: 2400,
  bounce: 1000,
  happy: 1300,
  'look-around': 3400,
  sleep: 2900,
  think: 1900,
  tilt: 1000,
  wave: 1200,
}

const IDLE_POOL: MascotAction[] = [
  'blink',
  'blink',
  'look-around',
  'tilt',
  'think',
  'blink',
]

const GAP_MS = [1800, 2800, 3500] as const

function gifUrl(action: MascotAction, bust = false): string {
  const base = import.meta.env.BASE_URL ?? '/'
  const root = base.endsWith('/') ? base : `${base}/`
  const path = `${root}gif/${action}.gif`
  return bust ? `${path}?t=${Date.now()}` : path
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function pickIdle(): MascotAction {
  return IDLE_POOL[Math.floor(Math.random() * IDLE_POOL.length)]!
}

function pickGap(): number {
  return GAP_MS[Math.floor(Math.random() * GAP_MS.length)]!
}

interface MascotActorProps {
  size?: number
  className?: string
  /** When true, play `happy` once then return to idle. */
  cheer?: boolean
}

/**
 * Cycles mascot action GIFs from `public/gif`. Falls back to static HipLogo
 * when the user prefers reduced motion.
 */
export function MascotActor({ size = 280, className, cheer }: MascotActorProps) {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  const [src, setSrc] = useState(() => gifUrl('wave'))
  const [action, setAction] = useState<MascotAction>('wave')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modeRef = useRef<'auto' | 'oneshot'>('auto')

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const play = useCallback((name: MascotAction) => {
    setAction(name)
    // Cache-bust so the GIF restarts from frame 0
    setSrc(gifUrl(name, true))
  }, [])

  const scheduleIdle = useCallback(
    (delayMs: number) => {
      clearTimer()
      if (modeRef.current !== 'auto' || prefersReducedMotion()) return
      timerRef.current = setTimeout(() => {
        const next = pickIdle()
        play(next)
        scheduleIdle(ACTION_MS[next] + pickGap())
      }, delayMs)
    },
    [clearTimer, play],
  )

  // Initial wave → idle loop
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(Boolean(mq?.matches))
    mq?.addEventListener?.('change', onChange)
    onChange()

    if (prefersReducedMotion()) {
      return () => mq?.removeEventListener?.('change', onChange)
    }

    modeRef.current = 'auto'
    play('wave')
    scheduleIdle(ACTION_MS.wave + 600)

    return () => {
      clearTimer()
      mq?.removeEventListener?.('change', onChange)
    }
  }, [clearTimer, play, scheduleIdle])

  // Cheer pulse (e.g. hover primary button)
  useEffect(() => {
    if (reduced || !cheer) return
    modeRef.current = 'oneshot'
    clearTimer()
    play('happy')
    timerRef.current = setTimeout(() => {
      modeRef.current = 'auto'
      play('blink')
      scheduleIdle(ACTION_MS.blink + pickGap())
    }, ACTION_MS.happy + 200)
  }, [cheer, reduced, clearTimer, play, scheduleIdle])

  if (reduced) {
    return <HipLogo size={size} className={className} decorative />
  }

  return (
    <div
      className={['flex items-center justify-center', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      aria-hidden
      data-mascot-action={action}
    >
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="h-full w-full object-contain select-none"
        draggable={false}
      />
    </div>
  )
}
