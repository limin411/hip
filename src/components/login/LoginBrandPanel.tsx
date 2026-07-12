import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import gsap from 'gsap'

const FEATURE_KEYS = ['feature1', 'feature2', 'feature3'] as const

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

/**
 * Login left brand panel — dark charcoal promo with layered art direction:
 * watermark type, geometric frame, film grain, cursor light, kinetic headline.
 */
export function LoginBrandPanel() {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const orbsRef = useRef<HTMLDivElement>(null)
  const cursorLightRef = useRef<HTMLDivElement>(null)
  const geoRef = useRef<SVGGElement>(null)
  const watermarkRef = useRef<HTMLDivElement>(null)

  const headline = t('login.brandHeadline')

  useLayoutEffect(() => {
    const root = rootRef.current
    const content = contentRef.current
    if (!root || !content) return

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const items = content.querySelectorAll<HTMLElement>('[data-brand-item]')
    const chars = content.querySelectorAll<HTMLElement>('[data-char]')

    if (reduced) {
      gsap.set(items, { opacity: 1, y: 0 })
      gsap.set(chars, { opacity: 1, y: 0 })
      gsap.set(root.querySelectorAll('[data-geo-line]'), { strokeDashoffset: 0 })
      gsap.set(watermarkRef.current, { opacity: 0.06 })
      return
    }

    const ctx = gsap.context(() => {
      // — Entrance: copy stack
      gsap.fromTo(
        items,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.75,
          stagger: 0.09,
          ease: 'power3.out',
          delay: 0.15,
        },
      )

      // — Kinetic headline (per character)
      if (chars.length) {
        gsap.set(chars, { opacity: 0, y: 28, rotateX: -40 })
        gsap.to(chars, {
          opacity: 1,
          y: 0,
          rotateX: 0,
          duration: 0.65,
          stagger: 0.018,
          ease: 'power3.out',
          delay: 0.28,
        })
      }

      // — Geometric stroke draw-in
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

      // — Watermark drift
      if (watermarkRef.current) {
        gsap.fromTo(
          watermarkRef.current,
          { opacity: 0, x: -24 },
          { opacity: 0.07, x: 0, duration: 1.4, ease: 'power2.out', delay: 0.1 },
        )
        gsap.to(watermarkRef.current, {
          x: 12,
          duration: 14,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
        })
      }

      // — Ambient orbs
      if (orbsRef.current) {
        orbsRef.current.querySelectorAll<HTMLElement>('[data-orb]').forEach((el, i) => {
          gsap.to(el, {
            x: i % 2 === 0 ? 32 : -26,
            y: i % 2 === 0 ? -24 : 30,
            scale: 1.1 + i * 0.05,
            duration: 7 + i * 1.5,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          })
        })
      }

      // — Slow rotate on decorative rings
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

      // — Soft light sweep across panel
      const sweep = root.querySelector<HTMLElement>('[data-light-sweep]')
      if (sweep) {
        const sweepTl = gsap.timeline({
          delay: 0.8,
          repeat: -1,
          repeatDelay: 6,
        })
        sweepTl
          .set(sweep, { xPercent: -120, opacity: 0 })
          .to(sweep, { opacity: 0.7, duration: 0.35, ease: 'power1.out' })
          .to(sweep, { xPercent: 120, duration: 2.2, ease: 'power1.inOut' }, 0)
          .to(sweep, { opacity: 0, duration: 0.35, ease: 'power1.in' }, '-=0.35')
      }
    }, root)

    // — Cursor-follow spotlight (pointer only; skips touch / reduced motion)
    const light = cursorLightRef.current
    const onMove = (e: PointerEvent) => {
      if (!light || e.pointerType === 'touch') return
      const rect = root.getBoundingClientRect()
      gsap.to(light, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        duration: 0.6,
        ease: 'power2.out',
        overwrite: 'auto',
      })
    }
    const onEnter = () => {
      if (light) gsap.to(light, { opacity: 1, duration: 0.4 })
    }
    const onLeave = () => {
      if (light) gsap.to(light, { opacity: 0, duration: 0.5 })
    }
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerenter', onEnter)
    root.addEventListener('pointerleave', onLeave)

    return () => {
      ctx.revert()
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerenter', onEnter)
      root.removeEventListener('pointerleave', onLeave)
    }
  }, [headline])

  return (
    <div
      ref={rootRef}
      className="relative hidden w-3/5 overflow-hidden md:flex"
      style={{
        background:
          'linear-gradient(155deg, #0a0a0a 0%, #141414 42%, #1a1a1a 100%)',
      }}
    >
      {/* Ambient color washes */}
      <div ref={orbsRef} className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          data-orb
          className="absolute -left-20 top-[18%] h-[22rem] w-[22rem] rounded-full opacity-45 blur-3xl"
          style={{ background: 'radial-gradient(circle, #6b7c5c50 0%, transparent 68%)' }}
        />
        <div
          data-orb
          className="absolute -right-24 bottom-[12%] h-[26rem] w-[26rem] rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, #a8b89a30 0%, transparent 70%)' }}
        />
        <div
          data-orb
          className="absolute left-[28%] top-[62%] h-56 w-56 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #ffffff12 0%, transparent 70%)' }}
        />

        {/* Perspective grid floor */}
        <div
          className="absolute inset-x-0 bottom-0 h-[55%] opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,0.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.4) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'linear-gradient(to top, black 0%, transparent 88%)',
            WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 88%)',
            transform: 'perspective(600px) rotateX(58deg)',
            transformOrigin: 'center bottom',
          }}
        />
      </div>

      {/* Giant brand watermark */}
      <div
        ref={watermarkRef}
        className="pointer-events-none absolute -left-4 bottom-[-6%] select-none font-semibold leading-none tracking-tighter text-white"
        style={{
          fontSize: 'clamp(8rem, 22vw, 16rem)',
          opacity: 0,
          letterSpacing: '-0.06em',
        }}
        aria-hidden
      >
        hip
      </div>

      {/* Geometric art frame (SVG) */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 800 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <g ref={geoRef} fill="none" stroke="rgba(168,184,154,0.28)" strokeWidth="1">
          {/* Corner brackets */}
          <path data-geo-line d="M48 120 V48 H120" />
          <path data-geo-line d="M752 120 V48 H680" />
          <path data-geo-line d="M48 780 V852 H120" />
          <path data-geo-line d="M752 780 V852 H680" />

          {/* Accent arcs / rings — right side composition */}
          <g data-geo-spin transform="translate(620 280)">
            <circle data-geo-line r="96" stroke="rgba(168,184,154,0.22)" />
            <circle data-geo-line r="128" stroke="rgba(255,255,255,0.08)" strokeDasharray="4 10" />
          </g>
          <g data-geo-spin-rev transform="translate(620 280)">
            <circle data-geo-line r="160" stroke="rgba(107,124,92,0.18)" strokeDasharray="2 14" />
          </g>

          {/* Diagonal guide lines */}
          <path data-geo-line d="M0 640 L320 900" stroke="rgba(255,255,255,0.06)" />
          <path data-geo-line d="M80 0 L420 380" stroke="rgba(255,255,255,0.05)" />

          {/* Small constellation dots */}
          <circle cx="180" cy="200" r="1.5" fill="rgba(168,184,154,0.5)" stroke="none" />
          <circle cx="210" cy="248" r="1.2" fill="rgba(255,255,255,0.35)" stroke="none" />
          <circle cx="152" cy="260" r="1" fill="rgba(168,184,154,0.4)" stroke="none" />
          <path data-geo-line d="M180 200 L210 248 L152 260 Z" stroke="rgba(168,184,154,0.2)" />
        </g>
      </svg>

      {/* Cursor spotlight */}
      <div
        ref={cursorLightRef}
        className="pointer-events-none absolute left-0 top-0 z-[1] h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0"
        style={{
          background:
            'radial-gradient(circle, rgba(168,184,154,0.14) 0%, rgba(168,184,154,0.04) 35%, transparent 68%)',
        }}
        aria-hidden
      />

      {/* Occasional light sweep */}
      <div
        data-light-sweep
        className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-1/3 opacity-0"
        style={{
          background:
            'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.04) 45%, rgba(168,184,154,0.06) 50%, rgba(255,255,255,0.03) 55%, transparent 100%)',
        }}
        aria-hidden
      />

      {/* Film grain */}
      <div
        className="pointer-events-none absolute inset-0 z-[2] opacity-[0.055] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
            `<svg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'>
              <filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/></filter>
              <rect width='100%' height='100%' filter='url(%23n)'/>
            </svg>`,
          )}")`,
          backgroundSize: '180px 180px',
        }}
        aria-hidden
      />

      {/* Vignette */}
      <div
        className="pointer-events-none absolute inset-0 z-[2]"
        style={{
          background:
            'radial-gradient(ellipse at 40% 45%, transparent 30%, rgba(0,0,0,0.45) 100%)',
        }}
        aria-hidden
      />

      {/* Promo copy */}
      <div
        ref={contentRef}
        className="relative z-10 flex w-full flex-col justify-between px-12 py-14 lg:px-16 lg:py-16"
      >
        <div>
          {/* Vertical side index */}
          <div
            data-brand-item
            className="mb-8 flex items-center gap-3"
            style={{ opacity: 0 }}
          >
            <span className="h-px w-8 bg-[#a8b89a]/60" aria-hidden />
            <p className="text-meta font-medium uppercase tracking-[0.28em] text-white/45">
              {t('login.brandLabel')}
            </p>
          </div>

          <h2
            className="max-w-lg text-[2rem] font-semibold leading-[1.18] tracking-tight text-white lg:text-[2.45rem]"
            style={{ perspective: '600px' }}
          >
            <span className="sr-only">{headline}</span>
            <span aria-hidden className="inline">
              {splitHeadline(headline)}
            </span>
          </h2>

          <p
            data-brand-item
            className="mt-5 max-w-sm text-prose leading-relaxed text-white/55"
            style={{ opacity: 0 }}
          >
            {t('login.brandDesc')}
          </p>

          <ul
            className="mt-11 flex flex-col gap-4"
            aria-label={t('login.brandFeaturesLabel')}
          >
            {FEATURE_KEYS.map((key, i) => (
              <li
                key={key}
                data-brand-item
                className="group flex items-start gap-3.5 text-body text-white/70"
                style={{ opacity: 0 }}
              >
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#a8b89a]/35 text-[10px] tabular-nums text-[#a8b89a]/90"
                  aria-hidden
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="pt-0.5">{t(`login.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div
          data-brand-item
          className="flex items-end justify-between gap-6"
          style={{ opacity: 0 }}
        >
          <p className="max-w-xs text-meta leading-relaxed text-white/35">
            {t('login.slogan')}
          </p>
          <span
            className="hidden text-caption uppercase tracking-[0.2em] text-white/20 sm:block"
            aria-hidden
          >
            01 — studio
          </span>
        </div>
      </div>
    </div>
  )
}
