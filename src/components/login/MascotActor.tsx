import { useCallback, useEffect, useRef, useState } from 'react'
import { HipLogo } from '@/components/login/HipLogo'

/**
 * Animated mascot clips under `public/motion/<category>/NNN_name.svg`.
 * Action ids are sticker semantic names (snake_case), unique across categories.
 */
export type MascotAction =
  | 'happy' | 'love' | 'cry' | 'angry' | 'shock' | 'wink'
  | 'sleepy' | 'cheer' | 'laugh' | 'shy' | 'cool' | 'sad'
  | 'confused' | 'excited' | 'proud' | 'nervous' | 'dizzy' | 'dead'
  | 'drool' | 'tongue' | 'blank' | 'rage' | 'melt' | 'sparkle'
  | 'smug' | 'pout' | 'awe' | 'relief' | 'wave' | 'thumbs_up'
  | 'thumbs_down' | 'clap' | 'point' | 'shrug' | 'peace' | 'hug'
  | 'highfive' | 'come' | 'stop' | 'ok_hand' | 'pray' | 'flex'
  | 'coding' | 'bug' | 'fixed' | 'deploy' | 'review' | 'thinking'
  | 'idea' | 'loading' | 'success' | 'fail' | 'deadline' | 'meeting'
  | 'merge' | 'coffee_work' | 'online' | 'offline' | 'busy' | 'away'
  | 'brb' | 'done' | 'wait' | 'yes' | 'no' | 'maybe'
  | 'thanks' | 'sorry' | 'hungry' | 'eat' | 'coffee' | 'full'
  | 'yummy' | 'thirsty' | 'snack' | 'chef' | 'diet' | 'cheers_drink'
  | 'sunny' | 'rainy' | 'snowy' | 'hot' | 'cold' | 'windy'
  | 'night' | 'morning' | 'rainbow' | 'storm' | 'party' | 'birthday'
  | 'new_year' | 'valentine' | 'halloween' | 'champion' | 'rich' | 'music'
  | 'dance' | 'game' | 'travel' | 'fire' | 'run' | 'sprint'
  | 'jog' | 'jump_rope' | 'gym' | 'yoga' | 'stretch' | 'basketball'
  | 'soccer' | 'tennis' | 'swim' | 'boxing' | 'victory_lap' | 'tired_run'
  | 'finish' | 'coach'

/** Paths under public/motion. Exported for completeness tests. */
export const ACTION_PATH: Record<MascotAction, string> = {
  happy: '01_emotion/001_happy.svg',
  love: '01_emotion/002_love.svg',
  cry: '01_emotion/003_cry.svg',
  angry: '01_emotion/004_angry.svg',
  shock: '01_emotion/005_shock.svg',
  wink: '01_emotion/006_wink.svg',
  sleepy: '01_emotion/007_sleepy.svg',
  cheer: '01_emotion/008_cheer.svg',
  laugh: '01_emotion/009_laugh.svg',
  shy: '01_emotion/010_shy.svg',
  cool: '01_emotion/011_cool.svg',
  sad: '01_emotion/012_sad.svg',
  confused: '01_emotion/013_confused.svg',
  excited: '01_emotion/014_excited.svg',
  proud: '01_emotion/015_proud.svg',
  nervous: '01_emotion/016_nervous.svg',
  dizzy: '02_emotion_more/017_dizzy.svg',
  dead: '02_emotion_more/018_dead.svg',
  drool: '02_emotion_more/019_drool.svg',
  tongue: '02_emotion_more/020_tongue.svg',
  blank: '02_emotion_more/021_blank.svg',
  rage: '02_emotion_more/022_rage.svg',
  melt: '02_emotion_more/023_melt.svg',
  sparkle: '02_emotion_more/024_sparkle.svg',
  smug: '02_emotion_more/025_smug.svg',
  pout: '02_emotion_more/026_pout.svg',
  awe: '02_emotion_more/027_awe.svg',
  relief: '02_emotion_more/028_relief.svg',
  wave: '03_gesture/029_wave.svg',
  thumbs_up: '03_gesture/030_thumbs_up.svg',
  thumbs_down: '03_gesture/031_thumbs_down.svg',
  clap: '03_gesture/032_clap.svg',
  point: '03_gesture/033_point.svg',
  shrug: '03_gesture/034_shrug.svg',
  peace: '03_gesture/035_peace.svg',
  hug: '03_gesture/036_hug.svg',
  highfive: '03_gesture/037_highfive.svg',
  come: '03_gesture/038_come.svg',
  stop: '03_gesture/039_stop.svg',
  ok_hand: '03_gesture/040_ok_hand.svg',
  pray: '03_gesture/041_pray.svg',
  flex: '03_gesture/042_flex.svg',
  coding: '04_work/043_coding.svg',
  bug: '04_work/044_bug.svg',
  fixed: '04_work/045_fixed.svg',
  deploy: '04_work/046_deploy.svg',
  review: '04_work/047_review.svg',
  thinking: '04_work/048_thinking.svg',
  idea: '04_work/049_idea.svg',
  loading: '04_work/050_loading.svg',
  success: '04_work/051_success.svg',
  fail: '04_work/052_fail.svg',
  deadline: '04_work/053_deadline.svg',
  meeting: '04_work/054_meeting.svg',
  merge: '04_work/055_merge.svg',
  coffee_work: '04_work/056_coffee_work.svg',
  online: '05_status/057_online.svg',
  offline: '05_status/058_offline.svg',
  busy: '05_status/059_busy.svg',
  away: '05_status/060_away.svg',
  brb: '05_status/061_brb.svg',
  done: '05_status/062_done.svg',
  wait: '05_status/063_wait.svg',
  yes: '05_status/064_yes.svg',
  no: '05_status/065_no.svg',
  maybe: '05_status/066_maybe.svg',
  thanks: '05_status/067_thanks.svg',
  sorry: '05_status/068_sorry.svg',
  hungry: '06_food/069_hungry.svg',
  eat: '06_food/070_eat.svg',
  coffee: '06_food/071_coffee.svg',
  full: '06_food/072_full.svg',
  yummy: '06_food/073_yummy.svg',
  thirsty: '06_food/074_thirsty.svg',
  snack: '06_food/075_snack.svg',
  chef: '06_food/076_chef.svg',
  diet: '06_food/077_diet.svg',
  cheers_drink: '06_food/078_cheers_drink.svg',
  sunny: '07_weather/079_sunny.svg',
  rainy: '07_weather/080_rainy.svg',
  snowy: '07_weather/081_snowy.svg',
  hot: '07_weather/082_hot.svg',
  cold: '07_weather/083_cold.svg',
  windy: '07_weather/084_windy.svg',
  night: '07_weather/085_night.svg',
  morning: '07_weather/086_morning.svg',
  rainbow: '07_weather/087_rainbow.svg',
  storm: '07_weather/088_storm.svg',
  party: '08_fun/089_party.svg',
  birthday: '08_fun/090_birthday.svg',
  new_year: '08_fun/091_new_year.svg',
  valentine: '08_fun/092_valentine.svg',
  halloween: '08_fun/093_halloween.svg',
  champion: '08_fun/094_champion.svg',
  rich: '08_fun/095_rich.svg',
  music: '08_fun/096_music.svg',
  dance: '08_fun/097_dance.svg',
  game: '08_fun/098_game.svg',
  travel: '08_fun/099_travel.svg',
  fire: '08_fun/100_fire.svg',
  run: '09_sports/101_run.svg',
  sprint: '09_sports/102_sprint.svg',
  jog: '09_sports/103_jog.svg',
  jump_rope: '09_sports/104_jump_rope.svg',
  gym: '09_sports/105_gym.svg',
  yoga: '09_sports/106_yoga.svg',
  stretch: '09_sports/107_stretch.svg',
  basketball: '09_sports/108_basketball.svg',
  soccer: '09_sports/109_soccer.svg',
  tennis: '09_sports/110_tennis.svg',
  swim: '09_sports/111_swim.svg',
  boxing: '09_sports/112_boxing.svg',
  victory_lap: '09_sports/113_victory_lap.svg',
  tired_run: '09_sports/114_tired_run.svg',
  finish: '09_sports/115_finish.svg',
  coach: '09_sports/116_coach.svg',
}

/** Calm / common clips appear more often in the idle pool (~23 unique / ~24 weighted). */
const IDLE_POOL: MascotAction[] = [
  'wave',
  'wave',
  'happy',
  'thumbs_up',
  'clap',
  'ok_hand',
  'coding',
  'thinking',
  'coffee_work',
  'idea',
  'review',
  'wink',
  'cool',
  'proud',
  'relief',
  'sparkle',
  'online',
  'done',
  'coffee',
  'stretch',
  'yoga',
  'music',
  'dance',
  'run',
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
 * Cycles animated Flat Butt mascot SVGs from `public/motion`.
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
