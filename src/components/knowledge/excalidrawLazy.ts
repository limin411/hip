/**
 * Lazy Excalidraw entry for whiteboard only.
 * Sets EXCALIDRAW_ASSET_PATH to self-hosted fonts under public/excalidraw-assets/
 * before the package loads (avoids esm.sh CDN fallback).
 */
import { lazy, type ComponentType } from 'react'

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

/** Ensure offline font base URL is set (idempotent). */
export function ensureExcalidrawAssetPath(): void {
  if (typeof window === 'undefined') return
  const base = import.meta.env.BASE_URL || '/'
  const path = `${base.endsWith('/') ? base : `${base}/`}excalidraw-assets/`
  window.EXCALIDRAW_ASSET_PATH = path
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExcalidrawComponent = ComponentType<any>

/**
 * React.lazy factory — only pulled when a board is open.
 * CSS is imported with the chunk so Source/Live sessions pay nothing.
 */
export const LazyExcalidraw = lazy(async () => {
  ensureExcalidrawAssetPath()
  const mod = await import('@excalidraw/excalidraw')
  await import('@excalidraw/excalidraw/index.css')
  return { default: mod.Excalidraw as ExcalidrawComponent }
})

/** Dynamic import of export helpers (PNG) without mounting the canvas. */
export async function loadExcalidrawUtils() {
  ensureExcalidrawAssetPath()
  return import('@excalidraw/excalidraw')
}
