/**
 * Terminal rendering enhancements (WebGL, Ligatures, Unicode11).
 *
 * Spec: docs/design/terminal-capability-upgrade/terminal-capability-upgrade-spec.md
 *
 * Provides lazy-loading and graceful degradation for optional xterm.js addons
 * that improve rendering performance and visual quality.
 */

import type { Terminal as XTerm } from '@xterm/xterm'
import { useHipConfigStore } from '@/store/hipConfigStore'

/** Feature flags for terminal enhancements (compile-time defaults) */
export const TERMINAL_WEBGL_DEFAULT = true
export const TERMINAL_LIGATURES_DEFAULT = true
export const TERMINAL_UNICODE11_DEFAULT = true

/** Debug: force disable all enhancements for troubleshooting */
const DEBUG_DISABLE_ALL = false

/** Get rendering config from hip.toml with defaults */
function getRenderingConfig() {
  const config = useHipConfigStore.getState().config
  const terminal = config.terminal

  return {
    webgl: terminal?.webgl ?? TERMINAL_WEBGL_DEFAULT,
    ligatures: terminal?.ligatures ?? TERMINAL_LIGATURES_DEFAULT,
    unicodeVersion: terminal?.unicodeVersion ?? '11',
  }
}

/** Loaded addon instances (for disposal) */
interface LoadedAddons {
  webgl?: { dispose: () => void }
  ligatures?: { dispose: () => void }
  unicode11?: { dispose: () => void }
}

/**
 * Load WebGL addon for GPU-accelerated rendering.
 *
 * Benefits:
 * - 3-10x rendering performance improvement
 * - GPU offloading for CPU-bound rendering
 * - 60fps target for high-frequency output
 *
 * Fallback:
 * - Automatically degrades to Canvas rendering if WebGL is not supported
 * - Handles context loss gracefully
 */
export async function loadWebGLAddon(term: XTerm): Promise<LoadedAddons['webgl']> {
  if (DEBUG_DISABLE_ALL) return undefined
  const config = getRenderingConfig()
  if (!config.webgl) return undefined

  try {
    const { WebglAddon } = await import('@xterm/addon-webgl')
    const addon = new WebglAddon()

    // Handle WebGL context loss (e.g., GPU driver crash, system sleep)
    addon.onContextLoss(() => {
      console.warn('[terminal] WebGL context lost, falling back to canvas rendering')
      addon.dispose()
    })

    term.loadAddon(addon)
    console.debug('[terminal] WebGL addon loaded successfully')
    return addon
  } catch (e) {
    // WebGL not supported or initialization failed
    // This is expected in some environments (e.g., certain WKWebView configurations)
    console.debug('[terminal] WebGL addon not available, using canvas rendering:', e)
    return undefined
  }
}

/**
 * Load font ligatures addon for programming ligatures.
 *
 * Benefits:
 * - Correct display of programming ligatures (=>, ->, !=, ===, etc.)
 * - Improved code readability
 *
 * Requirements:
 * - Font must support ligatures (JetBrains Mono ✅)
 * - Performance may vary with high-frequency output
 *
 * Note: @xterm/addon-ligatures@0.10.0 has a packaging issue where the main entry
 * points to a non-existent .js file. This function is temporarily disabled
 * until the upstream package is fixed. See: https://github.com/xtermjs/xterm.js/issues
 */
export async function loadLigaturesAddon(_term: XTerm): Promise<LoadedAddons['ligatures']> {
  if (DEBUG_DISABLE_ALL) return undefined
  const config = getRenderingConfig()
  if (!config.ligatures) return undefined

  // TODO: Re-enable when @xterm/addon-ligatures packaging is fixed
  // The package has a bug where package.json main field points to .js
  // but only .mjs file exists in lib/.
  console.debug('[terminal] Ligatures addon disabled (upstream packaging issue)')
  return undefined
}

/**
 * Load Unicode 11 addon for correct emoji and CJK width calculation.
 *
 * Benefits:
 * - Correct emoji width (2 columns)
 * - Accurate CJK character alignment
 * - Consistent behavior with modern terminals
 */
export async function loadUnicode11Addon(term: XTerm): Promise<LoadedAddons['unicode11']> {
  if (DEBUG_DISABLE_ALL) return undefined
  const config = getRenderingConfig()
  if (config.unicodeVersion !== '11') return undefined

  try {
    const { Unicode11Addon } = await import('@xterm/addon-unicode11')
    const addon = new Unicode11Addon()
    term.loadAddon(addon)
    term.unicode.activeVersion = '11'
    console.debug('[terminal] Unicode 11 addon loaded successfully')
    return addon
  } catch (e) {
    // Unicode 11 addon not available
    // Terminal will use default Unicode version
    console.debug('[terminal] Unicode 11 addon not available:', e)
    return undefined
  }
}

/**
 * Load all terminal enhancement addons.
 *
 * Loads addons in parallel for optimal startup performance.
 * Each addon is optional; failure of one does not prevent others from loading.
 *
 * @param term - The xterm.js Terminal instance
 * @returns Object containing loaded addon references for disposal
 */
export async function loadTerminalEnhancements(
  term: XTerm,
): Promise<LoadedAddons> {
  const [webgl, ligatures, unicode11] = await Promise.all([
    loadWebGLAddon(term),
    loadLigaturesAddon(term),
    loadUnicode11Addon(term),
  ])

  return { webgl, ligatures, unicode11 }
}

/**
 * Dispose all loaded terminal enhancement addons.
 *
 * NOTE: This function should NOT be called if term.dispose() is called afterward.
 * xterm.js AddonManager automatically disposes all loaded addons when the terminal
 * is disposed. Calling this function AND term.dispose() will cause double-dispose errors.
 *
 * Use this function ONLY if you need to dispose addons without disposing the terminal.
 */
export function disposeTerminalEnhancements(addons: LoadedAddons): void {
  addons.webgl?.dispose()
  addons.ligatures?.dispose()
  addons.unicode11?.dispose()
}

/**
 * Check if WebGL rendering is available in the current environment.
 *
 * This is a quick check that does not load the addon.
 * Useful for UI indicators or logging.
 */
export function isWebGLSupported(): boolean {
  if (typeof document === 'undefined') return false

  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    return gl !== null
  } catch {
    return false
  }
}
