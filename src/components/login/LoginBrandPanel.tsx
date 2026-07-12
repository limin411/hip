import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import gsap from 'gsap'
import { MascotActor } from '@/components/login/MascotActor'

const TAGLINE_KEYS = ['slogan', 'tagline2', 'tagline3'] as const
const STICKER_KEYS = ['sticker1', 'sticker2', 'sticker3'] as const

/** Bottom-right motion stage: three concurrent clips from public/motion. */
const MOTION_STAGE = [
  { action: 'wave' as const, delay: 0 },
  { action: 'code' as const, delay: 1600 },
  { action: 'dance' as const, delay: 3200 },
]

/** Soft, playful palette — pastel pops that stay readable on white. */
const PLAY_COLORS = {
  coral: '#ff6b6b',
  amber: '#f4a261',
  lemon: '#e9c46a',
  mint: '#2a9d8f',
  sky: '#4cc9f0',
  violet: '#9b5de5',
  pink: '#f72585',
  sage: '#6b7c5c',
} as const

const CONFETTI: Array<{
  top: string
  left: string
  size: number
  color: string
  shape: 'circle' | 'square' | 'triangle' | 'ring' | 'star'
  rot?: number
}> = [
  { top: '12%', left: '72%', size: 14, color: PLAY_COLORS.coral, shape: 'circle' },
  { top: '18%', left: '82%', size: 10, color: PLAY_COLORS.sky, shape: 'square', rot: 18 },
  { top: '28%', left: '76%', size: 16, color: PLAY_COLORS.violet, shape: 'triangle', rot: -12 },
  { top: '38%', left: '88%', size: 12, color: PLAY_COLORS.amber, shape: 'ring' },
  { top: '52%', left: '78%', size: 9, color: PLAY_COLORS.pink, shape: 'circle' },
  { top: '62%', left: '85%', size: 14, color: PLAY_COLORS.mint, shape: 'square', rot: 32 },
  { top: '22%', left: '8%', size: 11, color: PLAY_COLORS.lemon, shape: 'star' },
  { top: '48%', left: '6%', size: 13, color: PLAY_COLORS.sky, shape: 'triangle', rot: 20 },
  { top: '70%', left: '12%', size: 10, color: PLAY_COLORS.coral, shape: 'ring' },
  { top: '78%', left: '74%', size: 12, color: PLAY_COLORS.violet, shape: 'circle' },
  { top: '34%', left: '68%', size: 8, color: PLAY_COLORS.mint, shape: 'square', rot: -24 },
  { top: '58%', left: '70%', size: 15, color: PLAY_COLORS.amber, shape: 'star' },
]

function ConfettiShape({
  shape,
  color,
  size,
  rot = 0,
}: {
  shape: (typeof CONFETTI)[number]['shape']
  color: string
  size: number
  rot?: number
}) {
  if (shape === 'circle') {
    return (
      <span
        className="block rounded-full"
        style={{ width: size, height: size, backgroundColor: color }}
      />
    )
  }
  if (shape === 'square') {
    return (
      <span
        className="block rounded-[3px]"
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          transform: `rotate(${rot}deg)`,
        }}
      />
    )
  }
  if (shape === 'ring') {
    return (
      <span
        className="block rounded-full"
        style={{
          width: size,
          height: size,
          border: `2.5px solid ${color}`,
          backgroundColor: 'transparent',
        }}
      />
    )
  }
  if (shape === 'triangle') {
    return (
      <span
        className="block"
        style={{
          width: 0,
          height: 0,
          borderLeft: `${size / 2}px solid transparent`,
          borderRight: `${size / 2}px solid transparent`,
          borderBottom: `${size}px solid ${color}`,
          transform: `rotate(${rot}deg)`,
        }}
      />
    )
  }
  // star via css clip
  return (
    <span
      className="block"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        clipPath:
          'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
      }}
    />
  )
}

/** Split headline into per-char spans for kinetic reveal (preserves spaces). */
function splitHeadline(text: string) {
  return [...text].map((ch, i) => (
    <span
      key={`${ch}-${i}`}
      data-char
      className="inline-block will-change-transform"
      style={{ whiteSpace: ch === ' ' ? 'pre' : undefined }}
    >
      {ch === ' ' ? '\u00A0' : ch}
    </span>
  ))
}

/** Soft sine waveform for the ambient bottom band. */
function buildWavePath(phase: number, amp = 10, w = 800, mid = 24): string {
  const steps = 32
  let d = `M 0 ${mid}`
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * w
    const y = mid + Math.sin((i / steps) * Math.PI * 3 + phase) * amp
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

/**
 * Login left brand panel — light studio surface with layered art direction.
 * White base keeps macOS window-edge chrome invisible (light-on-light).
 */
export function LoginBrandPanel() {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const orbsRef = useRef<HTMLDivElement>(null)
  const cursorLightRef = useRef<HTMLDivElement>(null)
  const geoRef = useRef<SVGGElement>(null)
  const watermarkInnerRef = useRef<HTMLDivElement>(null)
  const wavePathRef = useRef<SVGPathElement>(null)
  const taglineRef = useRef<HTMLParagraphElement>(null)
  const taglineIndex = useRef(0)

  const line1 = t('login.brandLine1')
  const line2 = t('login.brandLine2')
  const line3 = t('login.brandLine3')
  const headline = t('login.brandHeadline')

  useLayoutEffect(() => {
    const root = rootRef.current
    const content = contentRef.current
    if (!root || !content) return

    let ctx: gsap.Context | null = null
    let teardownInteractive: (() => void) | null = null

    const killInteractiveTweens = () => {
      const light = cursorLightRef.current
      if (light) gsap.killTweensOf(light)
      root.querySelectorAll('[data-parallax]').forEach((n) => gsap.killTweensOf(n))
    }

    const applyReducedMotion = () => {
      const items = root.querySelectorAll<HTMLElement>('[data-brand-item]')
      const chars = content.querySelectorAll<HTMLElement>('[data-char]')
      const posterLines = content.querySelectorAll<HTMLElement>('[data-poster-line]')
      gsap.set(items, { opacity: 1, y: 0 })
      gsap.set(chars, { opacity: 1, y: 0 })
      gsap.set(posterLines, { opacity: 1, y: 0 })
      gsap.set(root.querySelectorAll('[data-geo-line]'), { strokeDashoffset: 0 })
      gsap.set(watermarkInnerRef.current, { opacity: 0.06 })
      // Scatter dust — without x/y every absolute node stacks at the origin.
      root.querySelectorAll<HTMLElement>('[data-dust]').forEach((el) => {
        gsap.set(el, {
          x: gsap.utils.random(8, 92) + '%',
          y: gsap.utils.random(8, 88) + '%',
          opacity: 0.45,
        })
      })
      gsap.set(root.querySelectorAll('[data-confetti]'), { opacity: 0.9 })
      root.querySelectorAll<HTMLElement>('[data-sticker]').forEach((el) => {
        const baseRot = Number(el.dataset.stickerRot) || 0
        gsap.set(el, { opacity: 1, scale: 1, rotation: baseRot })
      })
      if (wavePathRef.current) {
        wavePathRef.current.setAttribute('d', buildWavePath(0, 6))
      }
      if (taglineRef.current) {
        taglineRef.current.textContent = t(`login.${TAGLINE_KEYS[0]}`)
        gsap.set(taglineRef.current, { opacity: 1 })
      }
    }

    const applyMotion = () => {
      const items = root.querySelectorAll<HTMLElement>('[data-brand-item]')
      const chars = content.querySelectorAll<HTMLElement>('[data-char]')
      const posterLines = content.querySelectorAll<HTMLElement>('[data-poster-line]')

      ctx = gsap.context(() => {
        gsap.fromTo(
          items,
          { opacity: 0, y: 16 },
          {
            opacity: 1,
            y: 0,
            duration: 0.7,
            stagger: 0.08,
            ease: 'power3.out',
            delay: 0.1,
          },
        )

        // Poster lines: hard slide-up, staggered by line then char
        if (posterLines.length) {
          gsap.set(posterLines, { opacity: 0, y: 48 })
          gsap.to(posterLines, {
            opacity: 1,
            y: 0,
            duration: 0.85,
            stagger: 0.12,
            ease: 'power4.out',
            delay: 0.15,
          })
        }

        if (chars.length) {
          gsap.set(chars, { opacity: 0, y: 36 })
          gsap.to(chars, {
            opacity: 1,
            y: 0,
            duration: 0.55,
            stagger: 0.014,
            ease: 'power3.out',
            delay: 0.22,
          })
        }

        const lines = root.querySelectorAll<SVGGeometryElement>('[data-geo-line]')
        lines.forEach((line, i) => {
          const len = typeof line.getTotalLength === 'function' ? line.getTotalLength() : 400
          gsap.set(line, { strokeDasharray: len, strokeDashoffset: len })
          gsap.to(line, {
            strokeDashoffset: 0,
            duration: 1.6,
            delay: 0.2 + i * 0.12,
            ease: 'power2.inOut',
          })
        })

        if (watermarkInnerRef.current) {
          gsap.fromTo(
            watermarkInnerRef.current,
            { opacity: 0, x: -24 },
            { opacity: 0.07, x: 0, duration: 1.4, ease: 'power2.out', delay: 0.1 },
          )
          gsap.to(watermarkInnerRef.current, {
            x: 10,
            duration: 14,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          })
        }

        if (orbsRef.current) {
          orbsRef.current.querySelectorAll<HTMLElement>('[data-orb]').forEach((el, i) => {
            gsap.to(el, {
              x: i % 2 === 0 ? 28 : -22,
              y: i % 2 === 0 ? -18 : 24,
              scale: 1.08 + i * 0.04,
              duration: 7 + i * 1.5,
              ease: 'sine.inOut',
              yoyo: true,
              repeat: -1,
            })
          })
        }

        if (geoRef.current) {
          gsap.to(geoRef.current.querySelectorAll('[data-geo-spin]'), {
            rotation: 360,
            transformOrigin: '50% 50%',
            duration: 48,
            ease: 'none',
            repeat: -1,
          })
          gsap.to(geoRef.current.querySelectorAll('[data-geo-spin-rev]'), {
            rotation: -360,
            transformOrigin: '50% 50%',
            duration: 64,
            ease: 'none',
            repeat: -1,
          })
        }

        root.querySelectorAll<HTMLElement>('[data-dust]').forEach((el, i) => {
          gsap.set(el, {
            x: gsap.utils.random(8, 92) + '%',
            y: gsap.utils.random(8, 88) + '%',
            opacity: gsap.utils.random(0.25, 0.7),
            scale: gsap.utils.random(0.5, 1.4),
          })
          gsap.to(el, {
            y: `+=${gsap.utils.random(-48, 48)}`,
            x: `+=${gsap.utils.random(-28, 28)}`,
            duration: gsap.utils.random(8, 16),
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            delay: i * 0.15,
          })
          gsap.to(el, {
            opacity: gsap.utils.random(0.15, 0.75),
            duration: gsap.utils.random(2.5, 5),
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          })
        })

        // Colorful confetti bob + spin
        root.querySelectorAll<HTMLElement>('[data-confetti]').forEach((el, i) => {
          gsap.fromTo(
            el,
            { opacity: 0, scale: 0, rotation: gsap.utils.random(-40, 40) },
            {
              opacity: 1,
              scale: 1,
              duration: 0.6,
              delay: 0.4 + i * 0.05,
              ease: 'back.out(1.8)',
            },
          )
          gsap.to(el, {
            y: `+=${gsap.utils.random(-18, 18)}`,
            x: `+=${gsap.utils.random(-14, 14)}`,
            rotation: `+=${gsap.utils.random(-25, 25)}`,
            duration: gsap.utils.random(3.5, 6.5),
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            delay: i * 0.08,
          })
        })

        // Sticker pop-in; base tilt lives in data-sticker-rot so GSAP does not wipe it.
        root.querySelectorAll<HTMLElement>('[data-sticker]').forEach((el, i) => {
          const baseRot = Number(el.dataset.stickerRot) || 0
          gsap.fromTo(
            el,
            { opacity: 0, scale: 0.6, rotation: baseRot + (i % 2 === 0 ? -12 : 10) },
            {
              opacity: 1,
              scale: 1,
              rotation: baseRot,
              duration: 0.55,
              delay: 0.85 + i * 0.12,
              ease: 'back.out(2)',
            },
          )
          gsap.to(el, {
            y: `+=${i % 2 === 0 ? -6 : 6}`,
            rotation: baseRot + (i % 2 === 0 ? 3 : -3),
            duration: 3.2 + i * 0.4,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            delay: 1.2 + i * 0.1,
          })
        })

        if (wavePathRef.current) {
          const wave = { phase: 0, amp: 9 }
          gsap.to(wave, {
            phase: Math.PI * 2,
            amp: 14,
            duration: 4.5,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            onUpdate: () => {
              wavePathRef.current?.setAttribute('d', buildWavePath(wave.phase, wave.amp))
            },
          })
        }

        if (taglineRef.current) {
          taglineRef.current.textContent = t(`login.${TAGLINE_KEYS[0]}`)
          gsap.set(taglineRef.current, { opacity: 1 })
          const cycle = () => {
            const el = taglineRef.current
            if (!el) return
            gsap.to(el, {
              opacity: 0,
              y: -6,
              duration: 0.45,
              ease: 'power2.in',
              onComplete: () => {
                taglineIndex.current = (taglineIndex.current + 1) % TAGLINE_KEYS.length
                el.textContent = t(`login.${TAGLINE_KEYS[taglineIndex.current]}`)
                gsap.fromTo(
                  el,
                  { opacity: 0, y: 8 },
                  { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out' },
                )
              },
            })
          }
          gsap.delayedCall(4.2, function repeat() {
            cycle()
            gsap.delayedCall(4.2, repeat)
          })
        }

        const pulse = root.querySelector<HTMLElement>('[data-live-pulse]')
        if (pulse) {
          gsap.to(pulse, {
            scale: 1.6,
            opacity: 0,
            duration: 1.6,
            ease: 'power1.out',
            repeat: -1,
          })
        }
      }, root)

      const light = cursorLightRef.current
      const layers = root.querySelectorAll<HTMLElement>('[data-parallax]')

      const onMove = (e: PointerEvent) => {
        if (e.pointerType === 'touch') return
        const rect = root.getBoundingClientRect()
        const nx = (e.clientX - rect.left) / rect.width - 0.5

        if (light) {
          gsap.to(light, {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            duration: 0.55,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        }

        layers.forEach((layer) => {
          const depth = Number(layer.dataset.parallax) || 8
          gsap.to(layer, {
            x: nx * depth,
            y: 0,
            duration: 0.85,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        })
      }

      const onEnter = () => {
        if (light) gsap.to(light, { opacity: 1, duration: 0.4 })
      }
      const onLeave = () => {
        if (light) gsap.to(light, { opacity: 0, duration: 0.5 })
        layers.forEach((layer) => {
          gsap.to(layer, { x: 0, y: 0, duration: 1, ease: 'power2.out' })
        })
      }

      root.addEventListener('pointermove', onMove)
      root.addEventListener('pointerenter', onEnter)
      root.addEventListener('pointerleave', onLeave)

      teardownInteractive = () => {
        root.removeEventListener('pointermove', onMove)
        root.removeEventListener('pointerenter', onEnter)
        root.removeEventListener('pointerleave', onLeave)
        killInteractiveTweens()
      }
    }

    const setup = (reduced: boolean) => {
      teardownInteractive?.()
      teardownInteractive = null
      ctx?.revert()
      ctx = null
      killInteractiveTweens()
      if (reduced) {
        applyReducedMotion()
      } else {
        applyMotion()
      }
    }

    const mq =
      typeof window !== 'undefined'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null
    const onMqChange = () => setup(Boolean(mq?.matches))
    mq?.addEventListener?.('change', onMqChange)
    setup(Boolean(mq?.matches))

    return () => {
      mq?.removeEventListener?.('change', onMqChange)
      teardownInteractive?.()
      teardownInteractive = null
      ctx?.revert()
      ctx = null
      killInteractiveTweens()
    }
  }, [headline, line1, line2, line3, t])

  return (
    <div
      ref={rootRef}
      className="relative hidden h-full min-h-0 w-3/5 shrink-0 self-stretch overflow-hidden border-r border-border bg-surface md:flex"
    >
      {/* Multi-color washes + perspective grid */}
      <div
        data-parallax="10"
        ref={orbsRef}
        className="pointer-events-none absolute inset-0 will-change-transform"
        aria-hidden
      >
        <div
          data-orb
          className="absolute -left-16 top-[12%] h-[20rem] w-[20rem] rounded-full opacity-55 blur-3xl"
          style={{ background: `radial-gradient(circle, ${PLAY_COLORS.coral}33 0%, transparent 68%)` }}
        />
        <div
          data-orb
          className="absolute -right-20 top-[28%] h-[22rem] w-[22rem] rounded-full opacity-50 blur-3xl"
          style={{ background: `radial-gradient(circle, ${PLAY_COLORS.sky}36 0%, transparent 70%)` }}
        />
        <div
          data-orb
          className="absolute left-[20%] bottom-[8%] h-[18rem] w-[18rem] rounded-full opacity-45 blur-3xl"
          style={{ background: `radial-gradient(circle, ${PLAY_COLORS.violet}2e 0%, transparent 70%)` }}
        />
        <div
          data-orb
          className="absolute right-[18%] bottom-[22%] h-56 w-56 rounded-full opacity-40 blur-3xl"
          style={{ background: `radial-gradient(circle, ${PLAY_COLORS.amber}30 0%, transparent 70%)` }}
        />
        <div
          data-orb
          className="absolute left-[40%] top-[40%] h-48 w-48 rounded-full opacity-35 blur-3xl"
          style={{ background: `radial-gradient(circle, ${PLAY_COLORS.mint}28 0%, transparent 70%)` }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-[55%] opacity-[0.4]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(17,17,17,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,17,17,0.04) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'linear-gradient(to top, black 0%, transparent 88%)',
            WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 88%)',
            transform: 'perspective(600px) rotateX(58deg)',
            transformOrigin: 'center bottom',
          }}
        />
      </div>

      {/* Colorful dust */}
      <div className="pointer-events-none absolute inset-0 z-[1]" aria-hidden>
        {Array.from({ length: 18 }, (_, i) => {
          const colors = Object.values(PLAY_COLORS)
          const c = colors[i % colors.length]
          return (
            <span
              key={i}
              data-dust
              className="absolute h-1 w-1 rounded-full"
              style={{ backgroundColor: c, boxShadow: `0 0 6px ${c}66` }}
            />
          )
        })}
      </div>

      {/* Playful confetti shapes */}
      <div className="pointer-events-none absolute inset-0 z-[2]" aria-hidden>
        {CONFETTI.map((piece, i) => (
          <span
            key={i}
            data-confetti
            className="absolute"
            style={{ top: piece.top, left: piece.left, opacity: 0 }}
          >
            <ConfettiShape
              shape={piece.shape}
              color={piece.color}
              size={piece.size}
              rot={piece.rot}
            />
          </span>
        ))}
      </div>

      {/* Squiggle doodle */}
      <svg
        className="pointer-events-none absolute right-[10%] top-[14%] z-[2] h-16 w-28 opacity-80"
        viewBox="0 0 120 60"
        aria-hidden
      >
        <path
          data-geo-line
          d="M8 32 C 22 8, 38 52, 54 28 S 86 10, 112 30"
          fill="none"
          stroke={PLAY_COLORS.pink}
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>

      {/* Giant brand watermark */}
      <div
        data-parallax="18"
        className="pointer-events-none absolute -left-4 bottom-[-6%] will-change-transform"
        aria-hidden
      >
        <div
          ref={watermarkInnerRef}
          className="select-none font-semibold leading-none tracking-tighter text-ink"
          style={{
            fontSize: 'clamp(8rem, 22vw, 16rem)',
            opacity: 0,
            letterSpacing: '-0.06em',
          }}
        >
          hip
        </div>
      </div>

      {/* Geometric art */}
      <svg
        data-parallax="12"
        className="pointer-events-none absolute inset-0 h-full w-full will-change-transform"
        viewBox="0 0 800 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <g ref={geoRef} fill="none" stroke="rgba(107,124,92,0.28)" strokeWidth="1">
          <path data-geo-line d="M48 760 V828 H112" />
          <path data-geo-line d="M752 760 V828 H688" />

          {/* Outer translate is static; inner spins (keeps GSAP off SVG transform attrs). */}
          <g transform="translate(620 320)">
            <g data-geo-spin>
              <circle data-geo-line r="96" stroke="rgba(107,124,92,0.28)" />
              <circle data-geo-line r="128" stroke="rgba(17,17,17,0.08)" strokeDasharray="4 10" />
            </g>
          </g>
          <g transform="translate(620 320)">
            <g data-geo-spin-rev>
              <circle data-geo-line r="160" stroke="rgba(107,124,92,0.16)" strokeDasharray="2 14" />
            </g>
          </g>

          <path data-geo-line d="M0 640 L320 900" stroke="rgba(17,17,17,0.06)" />
          <path data-geo-line d="M140 160 L420 400" stroke="rgba(17,17,17,0.06)" />

          <circle cx="180" cy="200" r="3" fill={PLAY_COLORS.coral} stroke="none" opacity={0.85} />
          <circle cx="210" cy="248" r="2.5" fill={PLAY_COLORS.sky} stroke="none" opacity={0.8} />
          <circle cx="152" cy="260" r="2.5" fill={PLAY_COLORS.violet} stroke="none" opacity={0.8} />
          <path data-geo-line d="M180 200 L210 248 L152 260 Z" stroke={PLAY_COLORS.mint} strokeOpacity="0.45" />
        </g>
      </svg>

      {/* Breathing rainbow-ish waveform */}
      <div
        data-parallax="6"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-16 will-change-transform"
        aria-hidden
      >
        <svg className="h-full w-full opacity-70" viewBox="0 0 800 48" preserveAspectRatio="none">
          <defs>
            <linearGradient id="login-wave-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={PLAY_COLORS.coral} />
              <stop offset="35%" stopColor={PLAY_COLORS.amber} />
              <stop offset="65%" stopColor={PLAY_COLORS.mint} />
              <stop offset="100%" stopColor={PLAY_COLORS.violet} />
            </linearGradient>
          </defs>
          <path
            ref={wavePathRef}
            d={buildWavePath(0, 9)}
            fill="none"
            stroke="url(#login-wave-grad)"
            strokeWidth="1.75"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={buildWavePath(1.2, 6)}
            fill="none"
            stroke={PLAY_COLORS.sky}
            strokeOpacity="0.35"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      {/* Cursor spotlight — soft multi-hue */}
      <div
        ref={cursorLightRef}
        className="pointer-events-none absolute left-0 top-0 z-[1] h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0"
        style={{
          background:
            'radial-gradient(circle, rgba(76,201,240,0.14) 0%, rgba(155,93,229,0.08) 35%, transparent 68%)',
        }}
        aria-hidden
      />

      {/* Soft edge vignette (light) */}
      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{
          background:
            'radial-gradient(ellipse at 40% 45%, transparent 40%, rgba(245,245,245,0.65) 100%)',
        }}
        aria-hidden
      />

      {/* Vertical spine (poster index) */}
      <div
        className="pointer-events-none absolute bottom-16 left-5 z-10 hidden origin-bottom-left -rotate-90 select-none lg:block"
        aria-hidden
      >
        <span
          data-brand-item
          className="whitespace-nowrap text-caption font-medium uppercase tracking-[0.35em] text-ink-tertiary"
          style={{ opacity: 0 }}
        >
          {t('login.brandLabel')}
        </span>
      </div>

      {/*
        Motion row — three concurrent public/motion stages (crossfade each).
        Bottom-right so poster type stays free; staggered startDelay avoids lockstep swaps.
      */}
      <div
        data-brand-item
        className="pointer-events-none absolute bottom-8 right-4 z-[8] flex items-end gap-1 lg:bottom-10 lg:right-8 lg:gap-2"
        style={{ opacity: 0 }}
        aria-hidden
      >
        <div
          className="absolute left-1/2 top-1/2 h-[75%] w-[90%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-2xl"
          style={{
            background: `radial-gradient(circle, ${PLAY_COLORS.sky}38 0%, ${PLAY_COLORS.violet}22 50%, transparent 72%)`,
          }}
        />
        {MOTION_STAGE.map(({ action, delay }) => (
          <MascotActor
            key={action}
            size={148}
            crossfade
            collapseBottomPad={false}
            initialAction={action}
            startDelayMs={delay}
            className="relative drop-shadow-sm"
          />
        ))}
      </div>

      {/* Poster copy stack */}
      <div
        ref={contentRef}
        data-parallax="5"
        className="relative z-10 flex w-full flex-col justify-between px-10 py-12 will-change-transform lg:px-14 lg:py-14"
      >
        {/* Masthead */}
        <div
          data-brand-item
          className="flex items-center gap-3"
          style={{ opacity: 0 }}
        >
          <span className="flex gap-1" aria-hidden>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLAY_COLORS.coral }} />
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLAY_COLORS.sky }} />
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLAY_COLORS.violet }} />
          </span>
          <p className="text-meta font-semibold uppercase tracking-[0.32em] text-ink">
            {t('login.brandLabel')}
          </p>
        </div>

        {/* Hero poster type */}
        <div className="my-auto py-8">
          <h2 className="sr-only">{headline}</h2>
          <div aria-hidden className="relative flex flex-col" style={{ perspective: '800px' }}>
            {/* Floating stickers around type */}
            <div className="pointer-events-none absolute -right-2 top-0 z-[1] flex flex-col items-end gap-2 sm:-right-4 lg:right-0">
              {STICKER_KEYS.map((key, i) => {
                const styles = [
                  {
                    bg: PLAY_COLORS.coral,
                    rot: '-6deg',
                    color: '#fff',
                  },
                  {
                    bg: PLAY_COLORS.lemon,
                    rot: '5deg',
                    color: '#111',
                  },
                  {
                    bg: PLAY_COLORS.sky,
                    rot: '-4deg',
                    color: '#111',
                  },
                ][i]!
                return (
                  <span
                    key={key}
                    data-sticker
                    data-sticker-rot={parseFloat(styles.rot)}
                    className="rounded-full px-3 py-1 text-caption font-bold tracking-wide shadow-sm"
                    style={{
                      backgroundColor: styles.bg,
                      color: styles.color,
                      opacity: 0,
                    }}
                  >
                    {t(`login.${key}`)}
                  </span>
                )
              })}
            </div>

            <p
              data-poster-line
              className="text-[clamp(1.35rem,2.6vw,2rem)] font-medium leading-none tracking-tight text-ink-secondary"
              style={{ opacity: 0 }}
            >
              {splitHeadline(line1)}
            </p>
            <p
              data-poster-line
              className="mt-1 font-bold leading-[0.9] tracking-[-0.045em] text-ink"
              style={{
                opacity: 0,
                fontSize: 'clamp(3.25rem, 7.2vw, 5.75rem)',
              }}
            >
              {splitHeadline(line2)}
            </p>
            <div data-poster-line className="relative mt-1" style={{ opacity: 0 }}>
              <p
                className="font-bold leading-[0.9] tracking-[-0.045em] text-ink"
                style={{ fontSize: 'clamp(3.25rem, 7.2vw, 5.75rem)' }}
              >
                {splitHeadline(line3)}
              </p>
              {/* Rainbow underline bars */}
              <span className="mt-4 flex h-2 w-28 overflow-hidden rounded-full lg:h-2.5 lg:w-36" aria-hidden>
                <span className="h-full flex-1" style={{ backgroundColor: PLAY_COLORS.coral }} />
                <span className="h-full flex-1" style={{ backgroundColor: PLAY_COLORS.amber }} />
                <span className="h-full flex-1" style={{ backgroundColor: PLAY_COLORS.mint }} />
                <span className="h-full flex-1" style={{ backgroundColor: PLAY_COLORS.sky }} />
                <span className="h-full flex-1" style={{ backgroundColor: PLAY_COLORS.violet }} />
              </span>
            </div>
          </div>

          <p
            data-brand-item
            className="mt-8 max-w-md text-title font-medium leading-snug tracking-tight text-ink-secondary lg:mt-10"
            style={{ opacity: 0 }}
          >
            {t('login.brandDesc')}
          </p>

        </div>

        {/* Footer bar */}
        <div
          data-brand-item
          className="flex items-end justify-between gap-6 border-t border-ink/10 pt-5"
          style={{ opacity: 0 }}
        >
          <p
            ref={taglineRef}
            className="max-w-xs text-meta font-medium leading-relaxed tracking-wide text-ink-tertiary"
          >
            {t('login.slogan')}
          </p>
          <div className="flex items-center gap-2" aria-hidden>
            <span
              data-live-pulse
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: PLAY_COLORS.mint }}
            />
            <span
              className="rounded-full px-2 py-0.5 text-caption font-bold uppercase tracking-[0.18em] text-white"
              style={{ backgroundColor: PLAY_COLORS.mint }}
            >
              {t('login.liveBadge')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
