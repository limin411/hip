import { useEffect, useRef } from 'react'
import type { ZoneId, ZoneModel, ZoneState } from '../workbenchTypes'
import type { CosmosHandle } from './createCosmos'

/**
 * Lazy Three cosmos (starfield + sun + zone planets).
 * pointer-events none; fails silent without WebGL.
 */
export function CosmosHost({
  heroState,
  zones,
  hoveredId,
  enabled,
  reduceMotion,
}: {
  heroState: ZoneState
  zones: ZoneModel[]
  hoveredId: ZoneId | null
  enabled: boolean
  reduceMotion: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<CosmosHandle | null>(null)

  useEffect(() => {
    if (!enabled || reduceMotion) return
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    let cancelled = false
    let ro: ResizeObserver | null = null

    void (async () => {
      try {
        const { createCosmos } = await import('./createCosmos')
        if (cancelled || !canvasRef.current) return
        const dark =
          typeof document !== 'undefined' &&
          document.documentElement.classList.contains('dark')
        const handle = await createCosmos(canvasRef.current, { animate: true, dark })
        if (cancelled) {
          handle.dispose()
          return
        }
        handleRef.current = handle
        handle.setHeroState(heroState)
        handle.setPlanets(
          zones.map((z) => ({ id: z.id, state: z.state, progress: z.progress })),
        )
        handle.setHovered(hoveredId)

        const applySize = () => {
          const r = wrap.getBoundingClientRect()
          handle.resize(r.width, r.height)
        }
        applySize()
        ro = new ResizeObserver(applySize)
        ro.observe(wrap)
      } catch {
        handleRef.current = null
      }
    })()

    return () => {
      cancelled = true
      ro?.disconnect()
      handleRef.current?.dispose()
      handleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount on gate
  }, [enabled, reduceMotion])

  useEffect(() => {
    handleRef.current?.setHeroState(heroState)
  }, [heroState])

  useEffect(() => {
    handleRef.current?.setPlanets(
      zones.map((z) => ({ id: z.id, state: z.state, progress: z.progress })),
    )
  }, [zones])

  useEffect(() => {
    handleRef.current?.setHovered(hoveredId)
  }, [hoveredId])

  useEffect(() => {
    if (!enabled || reduceMotion) return
    const onMove = (e: PointerEvent) => {
      const wrap = wrapRef.current
      if (!wrap) return
      const r = wrap.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const inside =
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      if (!inside) {
        handleRef.current?.setPointer(0, 0, false)
        return
      }
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1
      const ny = -(((e.clientY - r.top) / r.height) * 2 - 1)
      handleRef.current?.setPointer(nx, ny, true)
    }
    const onLeave = () => handleRef.current?.setPointer(0, 0, false)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('blur', onLeave)
    }
  }, [enabled, reduceMotion])

  if (!enabled || reduceMotion) return null

  return (
    <div ref={wrapRef} className="wb-cosmos" data-testid="workbench-scene" aria-hidden>
      <canvas ref={canvasRef} />
    </div>
  )
}
