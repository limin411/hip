import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// 品牌专属色常量：小鱼吉祥物的 coral/navy/cream 色系是品牌识别色，
// 没有对应全局设计 token，保留原色并加注说明。
const CREAM = '#f4ecd8' // 眼白
const NAVY = '#003b68' // 四肢 / 瞳孔
const CORAL = '#f0997b' // 鱼身
const CORAL_DEEP = '#d85a30' // 鱼尾 / 嘴
const CORAL_PALE = '#f5c4b3' // 鱼肚

interface FishMascotProps {
  animClass: string
  className?: string
}

export type AnimName =
  | 'idle' | 'idle2' | 'idle3' | 'idle4' | 'idle5'
  | 'swim' | 'swim2' | 'swim3' | 'swim4' | 'swim5'
  | 'jump' | 'jump2' | 'jump3' | 'jump4' | 'jump5'
  | 'puff' | 'puff2' | 'puff3' | 'puff4' | 'puff5'
  | 'dance' | 'dance2' | 'dance3' | 'dance4' | 'dance5'
  | 'wave' | 'wave2' | 'wave3' | 'wave4' | 'point'
  | 'happy' | 'surprise' | 'think' | 'sleepy' | 'angry'
  | 'stretch' | 'scratch' | 'sneeze' | 'yawn' | 'clap'
  | 'splash' | 'peekaboo' | 'spin' | 'spin2' | 'tumble'
  | 'float' | 'sink' | 'rush' | 'freeze' | 'wiggle'

const ANIM_DURATION: Record<AnimName, number> = {
  idle: Infinity, idle2: 3600, idle3: 4000, idle4: 4000, idle5: 3000,
  swim: 5000, swim2: 5500, swim3: 6000, swim4: 4000, swim5: 3500,
  jump: 5000, jump2: 4500, jump3: 3500, jump4: 5500, jump5: 4000,
  puff: 4000, puff2: 3500, puff3: 3000, puff4: 4500, puff5: 4000,
  dance: 1800, dance2: 1800, dance3: 1800, dance4: 2000, dance5: 2000,
  wave: 4500, wave2: 4500, wave3: 3800, wave4: 3500, point: 3500,
  happy: 2000, surprise: 2500, think: 4000, sleepy: 5000, angry: 1800,
  stretch: 5000, scratch: 3500, sneeze: 2000, yawn: 4500, clap: 2000,
  splash: 4500, peekaboo: 3000, spin: 3500, spin2: 4000, tumble: 4000,
  float: 4000, sink: 3000, rush: 2500, freeze: 2000, wiggle: 1800,
}

/** Maps each animation name to an i18n greeting group key. */
export const GREETING_GROUP: Record<AnimName, string> = {
  idle: 'default', idle2: 'default', idle3: 'default', idle4: 'default', idle5: 'default',
  swim: 'swim', swim2: 'swim', swim3: 'swim', swim4: 'swim', swim5: 'swim',
  jump: 'jump', jump2: 'jump', jump3: 'jump', jump4: 'jump', jump5: 'jump',
  puff: 'puff', puff2: 'puff', puff3: 'puff', puff4: 'puff', puff5: 'puff',
  dance: 'dance', dance2: 'dance', dance3: 'dance', dance4: 'dance', dance5: 'dance',
  wave: 'wave', wave2: 'wave', wave3: 'wave', wave4: 'wave',
  happy: 'happy', clap: 'clap',
  think: 'think', scratch: 'think',
  stretch: 'stretch', yawn: 'stretch',
  splash: 'splash', sneeze: 'splash',
  point: 'point',
  surprise: 'surprise',
  sleepy: 'sleepy',
  angry: 'angry',
  peekaboo: 'peekaboo',
  spin: 'spin', spin2: 'spin',
  tumble: 'tumble',
  float: 'default', sink: 'default', freeze: 'default',
  rush: 'swim',
  wiggle: 'dance',
}

const CHAT_POOL: AnimName[] = [
  'stretch', 'happy', 'swim', 'swim2', 'think', 'scratch', 'float', 'spin', 'point', 'clap',
]
const CODE_POOL: AnimName[] = [
  'stretch', 'happy', 'swim', 'swim2', 'think', 'scratch', 'float', 'spin',
  'puff', 'puff2', 'puff3', 'puff', 'jump3', 'point',
]

function pickRandom(pool: AnimName[]): AnimName {
  const r = Math.random()
  if (r < 0.04) return 'dance'
  if (r < 0.08) return 'wiggle'
  if (r < 0.12) return 'angry'
  if (r < 0.16) return 'surprise'
  return pool[Math.floor(Math.random() * pool.length)]!
}

export function useFishAnimation(surface: 'chat' | 'code'): { animClass: string; animName: AnimName } {
  const [anim, setAnim] = useState<AnimName>('idle')
  const returnTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const pool = surface === 'code' ? CODE_POOL : CHAT_POOL

    const greetTimer = setTimeout(() => setAnim('wave'), 2000)
    const backTimer = setTimeout(() => setAnim('idle'), 2000 + ANIM_DURATION.wave)

    const interval = setInterval(() => {
      const chosen = pickRandom(pool)
      setAnim(chosen)
      if (returnTimer.current) clearTimeout(returnTimer.current)
      returnTimer.current = setTimeout(() => setAnim('idle'), ANIM_DURATION[chosen])
    }, 40000)

    return () => {
      clearTimeout(greetTimer)
      clearTimeout(backTimer)
      clearInterval(interval)
      if (returnTimer.current) clearTimeout(returnTimer.current)
    }
  }, [surface])

  return { animClass: `act-${anim}`, animName: anim }
}

export function FishMascot({ animClass, className }: FishMascotProps) {
  return (
    <div className={cn('flex items-center justify-center', className)} aria-hidden>
      <svg
        className={cn('h-[180px] w-[180px] overflow-visible', animClass)}
        viewBox="0 0 160 200"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g className="fish-y">
          <g className="body-sq">
            <g className="fish-r">

              {/* tail: pivot (108,118) */}
              <g transform="translate(108,118)">
                <g className="tail-rot">
                  <path d="M0 -8 L28 -22 L18 0 L28 22 Z" fill={CORAL_DEEP} />
                </g>
              </g>

              {/* left leg: pivot (58,140) */}
              <g transform="translate(58,140)">
                <g className="leg-l-rot">
                  <line x1={0} y1={0} x2={-7} y2={36} stroke={NAVY} strokeWidth="3.5" strokeLinecap="round" />
                  <ellipse cx={-7} cy={38} rx={8} ry={5} fill={NAVY} />
                </g>
              </g>

              {/* right leg: pivot (102,140) */}
              <g transform="translate(102,140)">
                <g className="leg-r-rot">
                  <line x1={0} y1={0} x2={7} y2={36} stroke={NAVY} strokeWidth="3.5" strokeLinecap="round" />
                  <ellipse cx={7} cy={38} rx={8} ry={5} fill={NAVY} />
                </g>
              </g>

              {/* left arm: pivot (48,110) */}
              <g transform="translate(48,110)">
                <g className="arm-l-rot">
                  <path d="M0 0 Q-26 22 -22 38" stroke={NAVY} strokeWidth="3.5" strokeLinecap="round" fill="none" />
                  <circle cx={-22} cy={40} r={6} fill={NAVY} />
                </g>
              </g>

              {/* right arm: pivot (112,110) */}
              <g transform="translate(112,110)">
                <g className="arm-r-rot">
                  <path d="M0 0 Q26 22 22 38" stroke={NAVY} strokeWidth="3.5" strokeLinecap="round" fill="none" />
                  <circle cx={22} cy={40} r={6} fill={NAVY} />
                </g>
              </g>

              {/* body */}
              <ellipse cx={80} cy={118} rx={34} ry={30} fill={CORAL} />
              <path d="M48 124 Q80 150 112 124 Q80 140 48 124 Z" fill={CORAL_PALE} opacity=".85" />
              <path d="M50 118 L40 112 L46 124 Z" fill={CORAL_DEEP} />

              {/* eyes */}
              <circle cx={70} cy={115} r={7.5} fill={CREAM} />
              <circle cx={90} cy={115} r={7.5} fill={CREAM} />
              <circle cx={71} cy={117} r={3.4} fill={NAVY} />
              <circle cx={91} cy={117} r={3.4} fill={NAVY} />

              {/* mouth */}
              <path d="M72 131 q8 6 16 0" stroke={CORAL_DEEP} strokeWidth="2.4" strokeLinecap="round" fill="none" />

            </g>
          </g>
        </g>
      </svg>
    </div>
  )
}
