/**
 * GSAP micro-interactions for pixel farm plots.
 * No-ops when reduced-motion is requested.
 * Spec: docs/design/2026-07-29-workbench-pixel-farm.md
 */
import gsap from 'gsap'

function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  return true
}

/** Soft lift on hover — call on pointerenter. */
export function playPlotHover(el: HTMLElement | null): void {
  if (!el || !motionAllowed()) return
  gsap.killTweensOf(el)
  gsap.to(el, {
    y: -12,
    scale: 1.06,
    duration: 0.22,
    ease: 'back.out(1.6)',
    overwrite: 'auto',
  })
}

/** Return to rest on pointerleave. */
export function resetPlotHover(el: HTMLElement | null): void {
  if (!el) return
  gsap.killTweensOf(el)
  if (!motionAllowed()) {
    gsap.set(el, { y: 0, scale: 1 })
    return
  }
  gsap.to(el, {
    y: 0,
    scale: 1,
    duration: 0.28,
    ease: 'power2.out',
    overwrite: 'auto',
  })
}

/**
 * Click punch + optional harvest sparkles under the plot.
 * Resolves after the punch so navigation can follow immediately.
 */
export function playPlotClick(el: HTMLElement | null): void {
  if (!el || !motionAllowed()) return
  gsap.killTweensOf(el)
  gsap
    .timeline({ defaults: { overwrite: 'auto' } })
    .to(el, { scale: 0.92, y: -4, duration: 0.08, ease: 'power2.in' })
    .to(el, { scale: 1.08, y: -16, duration: 0.18, ease: 'back.out(2.2)' })
    .to(el, { scale: 1, y: 0, duration: 0.22, ease: 'power2.out' })

  spawnSparks(el)
}

function spawnSparks(host: HTMLElement): void {
  const layer = document.createElement('span')
  layer.className = 'px-farm-sparks'
  layer.setAttribute('aria-hidden', 'true')
  host.appendChild(layer)

  const colors = ['#ffc94a', '#7dcea0', '#f4a261', '#fff6d0', '#5dade2']
  const n = 8
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i')
    s.className = 'px-farm-spark'
    s.style.background = colors[i % colors.length]!
    layer.appendChild(s)
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.4
    const dist = 28 + Math.random() * 36
    gsap.fromTo(
      s,
      { x: 0, y: 0, scale: 0.4, opacity: 1 },
      {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist - 12,
        scale: 0,
        opacity: 0,
        duration: 0.45 + Math.random() * 0.15,
        ease: 'power2.out',
      },
    )
  }

  window.setTimeout(() => {
    layer.remove()
  }, 700)
}

export function killFarmJuice(el: HTMLElement | null): void {
  if (!el) return
  gsap.killTweensOf(el)
  gsap.set(el, { clearProps: 'transform' })
}
