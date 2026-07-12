import { useCallback, useEffect, useRef, useState } from 'react'
import { HipLogo } from '@/components/login/HipLogo'

/**
 * Animated mascot clips under `public/motion/<category>/logo-<id>.svg`.
 * ids are unique across categories.
 */
export type MascotAction =
  // arts
  | 'dance'
  | 'guitar'
  | 'paint'
  | 'photo'
  | 'piano'
  // celebration
  | 'birthday'
  | 'gift'
  // fitness
  | 'bike'
  | 'jump-rope'
  | 'jumping-jack'
  | 'lift'
  | 'plank'
  | 'run'
  | 'stretch'
  | 'yoga'
  // lifestyle
  | 'brush-teeth'
  | 'clap'
  | 'coffee'
  | 'cook'
  | 'phone'
  | 'read'
  | 'shower'
  | 'sleep'
  | 'wave'
  // outdoor
  | 'camp'
  | 'fish'
  | 'hike'
  | 'skate'
  | 'ski'
  | 'surf'
  // pets
  | 'cat'
  | 'dog'
  // sports
  | 'archery'
  | 'badminton'
  | 'baseball'
  | 'basketball'
  | 'bowling'
  | 'box'
  | 'golf'
  | 'pingpong'
  | 'soccer'
  | 'swim'
  | 'tennis'
  | 'volleyball'
  // travel
  | 'drive'
  | 'plane'
  // work
  | 'code'
  | 'meeting'
  | 'write'

const ACTION_PATH: Record<MascotAction, string> = {
  dance: 'arts/logo-dance.svg',
  guitar: 'arts/logo-guitar.svg',
  paint: 'arts/logo-paint.svg',
  photo: 'arts/logo-photo.svg',
  piano: 'arts/logo-piano.svg',
  birthday: 'celebration/logo-birthday.svg',
  gift: 'celebration/logo-gift.svg',
  bike: 'fitness/logo-bike.svg',
  'jump-rope': 'fitness/logo-jump-rope.svg',
  'jumping-jack': 'fitness/logo-jumping-jack.svg',
  lift: 'fitness/logo-lift.svg',
  plank: 'fitness/logo-plank.svg',
  run: 'fitness/logo-run.svg',
  stretch: 'fitness/logo-stretch.svg',
  yoga: 'fitness/logo-yoga.svg',
  'brush-teeth': 'lifestyle/logo-brush-teeth.svg',
  clap: 'lifestyle/logo-clap.svg',
  coffee: 'lifestyle/logo-coffee.svg',
  cook: 'lifestyle/logo-cook.svg',
  phone: 'lifestyle/logo-phone.svg',
  read: 'lifestyle/logo-read.svg',
  shower: 'lifestyle/logo-shower.svg',
  sleep: 'lifestyle/logo-sleep.svg',
  wave: 'lifestyle/logo-wave.svg',
  camp: 'outdoor/logo-camp.svg',
  fish: 'outdoor/logo-fish.svg',
  hike: 'outdoor/logo-hike.svg',
  skate: 'outdoor/logo-skate.svg',
  ski: 'outdoor/logo-ski.svg',
  surf: 'outdoor/logo-surf.svg',
  cat: 'pets/logo-cat.svg',
  dog: 'pets/logo-dog.svg',
  archery: 'sports/logo-archery.svg',
  badminton: 'sports/logo-badminton.svg',
  baseball: 'sports/logo-baseball.svg',
  basketball: 'sports/logo-basketball.svg',
  bowling: 'sports/logo-bowling.svg',
  box: 'sports/logo-box.svg',
  golf: 'sports/logo-golf.svg',
  pingpong: 'sports/logo-pingpong.svg',
  soccer: 'sports/logo-soccer.svg',
  swim: 'sports/logo-swim.svg',
  tennis: 'sports/logo-tennis.svg',
  volleyball: 'sports/logo-volleyball.svg',
  drive: 'travel/logo-drive.svg',
  plane: 'travel/logo-plane.svg',
  code: 'work/logo-code.svg',
  meeting: 'work/logo-meeting.svg',
  write: 'work/logo-write.svg',
}

/** Calm / common clips appear more often in the idle pool. */
const IDLE_POOL: MascotAction[] = [
  'wave',
  'wave',
  'coffee',
  'read',
  'clap',
  'phone',
  'sleep',
  'stretch',
  'yoga',
  'code',
  'write',
  'meeting',
  'paint',
  'guitar',
  'dance',
  'piano',
  'photo',
  'cook',
  'fish',
  'hike',
  'camp',
  'bike',
  'run',
  'lift',
  'plank',
  'jump-rope',
  'jumping-jack',
  'soccer',
  'basketball',
  'tennis',
  'pingpong',
  'badminton',
  'swim',
  'surf',
  'skate',
  'ski',
  'cat',
  'dog',
  'plane',
  'drive',
  'birthday',
  'gift',
  'archery',
  'baseball',
  'bowling',
  'box',
  'golf',
  'volleyball',
  'brush-teeth',
  'shower',
]

/** How long each infinite SVG clip stays on screen before rotating (ms). */
const HOLD_MS = [4200, 5200, 6000, 7000] as const
const FIRST_HOLD_MS = 4800
const CROSSFADE_MS = 900
const SLIDE_MS = 720
/** Horizontal travel for 左进右退 (fraction of box width). */
const SLIDE_X = '32%'
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

/** How clips swap on screen. */
export type MascotTransition = 'none' | 'crossfade' | 'slide'

function motionUrl(action: MascotAction): string {
  const base = import.meta.env.BASE_URL ?? '/'
  const root = base.endsWith('/') ? base : `${base}/`
  return `${root}motion/${ACTION_PATH[action]}`
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function pickIdle(exclude?: MascotAction): MascotAction {
  let next = IDLE_POOL[Math.floor(Math.random() * IDLE_POOL.length)]!
  // Avoid immediate repeats when the pool is large enough.
  if (exclude && IDLE_POOL.length > 1) {
    let guard = 0
    while (next === exclude && guard < 8) {
      next = IDLE_POOL[Math.floor(Math.random() * IDLE_POOL.length)]!
      guard += 1
    }
  }
  return next
}

function pickHold(): number {
  return HOLD_MS[Math.floor(Math.random() * HOLD_MS.length)]!
}

/** Decode next motion clip before flipping the dual-buffer front layer. */
function preloadMotion(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    const done = () => resolve()
    img.onload = done
    img.onerror = done
    img.src = url
    if (img.complete) done()
  })
}

function resolveTransition(
  transition: MascotTransition | undefined,
  crossfade: boolean | undefined,
): MascotTransition {
  if (transition) return transition
  return crossfade ? 'crossfade' : 'none'
}

interface MascotActorProps {
  size?: number
  className?: string
  /** First clip before the idle loop (default: wave). */
  initialAction?: MascotAction
  /**
   * Clip swap style. Default `none` (hard cut).
   * - `crossfade` — opacity blend (login brand stages)
   * - `slide` — enter from left, exit to right (new conversation)
   */
  transition?: MascotTransition
  /**
   * @deprecated Prefer `transition="crossfade"`. Kept for login call sites.
   */
  crossfade?: boolean
  /**
   * Collapse transparent bottom canvas into following content (chat).
   * Default true; set false when the actor sits free on a brand panel.
   */
  collapseBottomPad?: boolean
  /** Extra delay before the first clip rotation (ms). Useful when staging several actors. */
  startDelayMs?: number
}

/**
 * Motion SVGs keep transparent canvas margin for animation swing (~12–15% bottom).
 * Pull the next sibling into that empty band via negative margin — never clip the SVG.
 */
const BOTTOM_PAD_RATIO = 0.12

/**
 * Cycles animated mascot SVGs from `public/motion`.
 * Falls back to static HipLogo when the user prefers reduced motion.
 */
export function MascotActor({
  size = 420,
  className,
  initialAction = 'wave',
  transition: transitionProp,
  crossfade = false,
  collapseBottomPad = true,
  startDelayMs = 0,
}: MascotActorProps) {
  const mode = resolveTransition(transitionProp, crossfade)
  const dual = mode === 'crossfade' || mode === 'slide'

  const [reduced, setReduced] = useState(prefersReducedMotion)
  const [action, setAction] = useState<MascotAction>(initialAction)
  // Dual buffers: only one is fully on-screen at rest.
  const [layerA, setLayerA] = useState<MascotAction>(initialAction)
  const [layerB, setLayerB] = useState<MascotAction>(initialAction)
  const [frontIsA, setFrontIsA] = useState(true)
  /** Slide only: layer parked at left (no transition) before entering. */
  const [slidePrep, setSlidePrep] = useState<'a' | 'b' | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actionRef = useRef<MascotAction>(initialAction)
  const layerARef = useRef<MascotAction>(initialAction)
  const layerBRef = useRef<MascotAction>(initialAction)
  const initialRef = useRef(initialAction)
  const startDelayRef = useRef(startDelayMs)
  const frontIsARef = useRef(true)
  const playGenRef = useRef(0)
  const modeRef = useRef(mode)
  modeRef.current = mode
  startDelayRef.current = startDelayMs

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const play = useCallback(
    (name: MascotAction) => {
      const m = modeRef.current
      if (m === 'none') {
        actionRef.current = name
        setAction(name)
        setLayerA(name)
        layerARef.current = name
        setFrontIsA(true)
        frontIsARef.current = true
        setSlidePrep(null)
        return
      }

      const frontAction = frontIsARef.current ? layerARef.current : layerBRef.current
      // Already showing this clip — skip (avoids mount same-src transition).
      if (name === frontAction) {
        actionRef.current = name
        setAction(name)
        return
      }

      actionRef.current = name
      setAction(name)
      const gen = ++playGenRef.current
      const wasFrontA = frontIsARef.current
      const nextFrontIsA = !wasFrontA
      const prepLayer: 'a' | 'b' = nextFrontIsA ? 'a' : 'b'

      // Paint next clip on the hidden buffer first.
      if (wasFrontA) {
        setLayerB(name)
        layerBRef.current = name
      } else {
        setLayerA(name)
        layerARef.current = name
      }

      void preloadMotion(motionUrl(name)).then(() => {
        if (gen !== playGenRef.current) return

        if (m === 'slide') {
          // 1) Park incoming on the left with transition disabled.
          setSlidePrep(prepLayer)
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (gen !== playGenRef.current) return
              // 2) Flip: incoming → center (左进), outgoing → right (右退).
              setSlidePrep(null)
              frontIsARef.current = nextFrontIsA
              setFrontIsA(nextFrontIsA)
            })
          })
          return
        }

        frontIsARef.current = nextFrontIsA
        setFrontIsA(nextFrontIsA)
      })
    },
    [],
  )

  const scheduleNext = useCallback(
    (delayMs: number) => {
      clearTimer()
      if (prefersReducedMotion()) return
      timerRef.current = setTimeout(() => {
        const next = pickIdle(actionRef.current)
        play(next)
        scheduleNext(pickHold())
      }, delayMs)
    },
    [clearTimer, play],
  )

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(Boolean(mq?.matches))
    mq?.addEventListener?.('change', onChange)
    onChange()

    if (prefersReducedMotion()) {
      return () => mq?.removeEventListener?.('change', onChange)
    }

    const start = initialRef.current
    // Establish action without a no-op transition when buffers already hold start.
    play(start)
    scheduleNext(FIRST_HOLD_MS + Math.max(0, startDelayRef.current))

    return () => {
      playGenRef.current += 1
      clearTimer()
      mq?.removeEventListener?.('change', onChange)
    }
  }, [clearTimer, play, scheduleNext])

  if (reduced) {
    return <HipLogo size={size} className={className} decorative />
  }

  const layerStyle = (isFront: boolean, layer: 'a' | 'b'): React.CSSProperties => {
    if (mode === 'crossfade') {
      return {
        opacity: isFront ? 1 : 0,
        transition: `opacity ${CROSSFADE_MS}ms ${EASE}`,
      }
    }
    if (mode === 'slide') {
      // Parked left so the next flip can enter from the left.
      if (slidePrep === layer) {
        return {
          opacity: 0,
          transform: `translateX(-${SLIDE_X})`,
          transition: 'none',
          zIndex: 1,
        }
      }
      if (isFront) {
        return {
          opacity: 1,
          transform: 'translateX(0)',
          transition: `transform ${SLIDE_MS}ms ${EASE}, opacity ${SLIDE_MS}ms ${EASE}`,
          zIndex: 2,
        }
      }
      // Resting / exiting off to the right.
      return {
        opacity: 0,
        transform: `translateX(${SLIDE_X})`,
        transition: `transform ${SLIDE_MS}ms ${EASE}, opacity ${SLIDE_MS}ms ${EASE}`,
        zIndex: 1,
      }
    }
    return { opacity: isFront ? 1 : 0 }
  }

  return (
    <div
      className={[
        'relative flex items-center justify-center',
        dual ? 'overflow-hidden' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        width: size,
        height: size,
        // Collapse transparent bottom canvas into the gap before greeting text.
        marginBottom: collapseBottomPad ? Math.round(size * -BOTTOM_PAD_RATIO) : 0,
      }}
      aria-hidden
      data-mascot-action={action}
      data-mascot-crossfade={mode === 'crossfade' ? 'true' : undefined}
      data-mascot-transition={mode}
    >
      {dual ? (
        <>
          <img
            src={motionUrl(layerA)}
            alt=""
            width={size}
            height={size}
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
            style={layerStyle(frontIsA, 'a')}
            draggable={false}
          />
          <img
            src={motionUrl(layerB)}
            alt=""
            width={size}
            height={size}
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
            style={layerStyle(!frontIsA, 'b')}
            draggable={false}
          />
        </>
      ) : (
        <img
          src={motionUrl(action)}
          alt=""
          width={size}
          height={size}
          className="h-full w-full select-none object-contain"
          draggable={false}
        />
      )}
    </div>
  )
}
