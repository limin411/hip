import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import gsap from 'gsap'

const FEATURE_KEYS = ['feature1', 'feature2', 'feature3'] as const

/**
 * Login left brand panel — dark charcoal promo surface with GSAP entrance.
 * Mascot intentionally omitted; pure typography + ambient light.
 */
export function LoginBrandPanel() {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const orbsRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    const content = contentRef.current
    const orbs = orbsRef.current
    if (!root || !content) return

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const items = content.querySelectorAll<HTMLElement>('[data-brand-item]')

    if (reduced) {
      gsap.set(items, { opacity: 1, y: 0 })
      return
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        items,
        { opacity: 0, y: 18 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          stagger: 0.1,
          ease: 'power3.out',
          delay: 0.12,
        },
      )

      if (orbs) {
        const blobEls = orbs.querySelectorAll<HTMLElement>('[data-orb]')
        blobEls.forEach((el, i) => {
          gsap.to(el, {
            x: i % 2 === 0 ? 28 : -22,
            y: i % 2 === 0 ? -20 : 26,
            scale: 1.08 + i * 0.04,
            duration: 6 + i * 1.4,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          })
        })
      }
    }, root)

    return () => ctx.revert()
  }, [])

  return (
    <div
      ref={rootRef}
      className="relative hidden w-3/5 overflow-hidden md:flex"
      style={{
        background:
          'linear-gradient(155deg, #0c0c0c 0%, #161616 48%, #1c1c1c 100%)',
      }}
    >
      {/* Ambient orbs */}
      <div ref={orbsRef} className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          data-orb
          className="absolute -left-16 top-1/4 h-72 w-72 rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(circle, #6b7c5c55 0%, transparent 70%)' }}
        />
        <div
          data-orb
          className="absolute -right-20 bottom-1/4 h-80 w-80 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, #a8b89a33 0%, transparent 70%)' }}
        />
        <div
          data-orb
          className="absolute left-1/3 top-2/3 h-48 w-48 rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, #ffffff14 0%, transparent 70%)' }}
        />
        {/* Soft grid */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
      </div>

      {/* Promo copy */}
      <div
        ref={contentRef}
        className="relative z-10 flex w-full flex-col justify-between px-12 py-14 lg:px-16 lg:py-16"
      >
        <div>
          <p
            data-brand-item
            className="text-meta font-medium uppercase tracking-[0.22em] text-white/45"
            style={{ opacity: 0 }}
          >
            {t('login.brandLabel')}
          </p>
          <h2
            data-brand-item
            className="mt-5 max-w-md text-[2rem] font-semibold leading-[1.2] tracking-tight text-white lg:text-[2.35rem]"
            style={{ opacity: 0 }}
          >
            {t('login.brandHeadline')}
          </h2>
          <p
            data-brand-item
            className="mt-4 max-w-sm text-prose leading-relaxed text-white/55"
            style={{ opacity: 0 }}
          >
            {t('login.brandDesc')}
          </p>

          <ul className="mt-10 flex flex-col gap-3.5" aria-label={t('login.brandFeaturesLabel')}>
            {FEATURE_KEYS.map((key) => (
              <li
                key={key}
                data-brand-item
                className="flex items-start gap-3 text-body text-white/70"
                style={{ opacity: 0 }}
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#a8b89a]"
                  aria-hidden
                />
                {t(`login.${key}`)}
              </li>
            ))}
          </ul>
        </div>

        <p
          data-brand-item
          className="text-meta text-white/35"
          style={{ opacity: 0 }}
        >
          {t('login.slogan')}
        </p>
      </div>
    </div>
  )
}
