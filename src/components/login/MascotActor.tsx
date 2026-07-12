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

interface MascotActorProps {
  size?: number
  className?: string
  /** First clip before the idle loop (default: wave). */
  initialAction?: MascotAction
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
}: MascotActorProps) {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  const [action, setAction] = useState<MascotAction>(initialAction)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actionRef = useRef<MascotAction>(initialAction)
  const initialRef = useRef(initialAction)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const play = useCallback((name: MascotAction) => {
    actionRef.current = name
    setAction(name)
  }, [])

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
    play(start)
    scheduleNext(FIRST_HOLD_MS)

    return () => {
      clearTimer()
      mq?.removeEventListener?.('change', onChange)
    }
  }, [clearTimer, play, scheduleNext])

  if (reduced) {
    return <HipLogo size={size} className={className} decorative />
  }

  return (
    <div
      className={['flex items-center justify-center', className].filter(Boolean).join(' ')}
      style={{
        width: size,
        height: size,
        // Collapse transparent bottom canvas into the gap before greeting text.
        marginBottom: Math.round(size * -BOTTOM_PAD_RATIO),
      }}
      aria-hidden
      data-mascot-action={action}
    >
      <img
        src={motionUrl(action)}
        alt=""
        width={size}
        height={size}
        className="h-full w-full object-contain select-none"
        draggable={false}
      />
    </div>
  )
}
