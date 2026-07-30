import { useEffect, useState } from 'react'
import { classifyTier, type ViewportTier } from '@/lib/shellViewport'

/**
 * Live viewport tier (A–D) for shell chrome decisions (e.g. Settings nav).
 * Subscribes to window resize; pure classifyTier under the hood.
 */
export function useShellViewportTier(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(() => {
    if (typeof window === 'undefined') return 'A'
    return classifyTier(window.innerWidth, window.innerHeight)
  })

  useEffect(() => {
    const update = () => {
      setTier(classifyTier(window.innerWidth, window.innerHeight))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return tier
}
