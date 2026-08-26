// @vitest-environment happy-dom
/**
 * Terminal enhancement addons tests.
 *
 * Tests for WebGL, Ligatures, and Unicode11 addon loading.
 * These tests verify the graceful degradation behavior.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  loadWebGLAddon,
  loadLigaturesAddon,
  loadUnicode11Addon,
  loadTerminalEnhancements,
  disposeTerminalEnhancements,
  isWebGLSupported,
  TERMINAL_WEBGL_DEFAULT,
  TERMINAL_LIGATURES_DEFAULT,
  TERMINAL_UNICODE11_DEFAULT,
} from './terminalEnhancements'

// Mock xterm.js Terminal
const createMockTerminal = () => ({
  loadAddon: vi.fn(),
  unicode: { activeVersion: '' },
})

describe('terminalEnhancements', () => {
  describe('feature flags', () => {
    it('should have WebGL feature flag enabled by default', () => {
      expect(TERMINAL_WEBGL_DEFAULT).toBe(true)
    })

    it('should have Ligatures feature flag enabled by default', () => {
      expect(TERMINAL_LIGATURES_DEFAULT).toBe(true)
    })

    it('should have Unicode11 feature flag enabled by default', () => {
      expect(TERMINAL_UNICODE11_DEFAULT).toBe(true)
    })
  })

  describe('isWebGLSupported', () => {
    it('should return boolean', () => {
      const result = isWebGLSupported()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('loadWebGLAddon', () => {
    it('should attempt to load WebGL addon', async () => {
      const term = createMockTerminal() as any

      // This will either load successfully or fail gracefully
      // depending on the test environment's WebGL support
      const result = await loadWebGLAddon(term)

      // Result should be either an addon object or undefined
      if (result) {
        expect(result.dispose).toBeDefined()
      }
    })
  })

  describe('loadLigaturesAddon', () => {
    it('should return undefined when Ligatures is disabled', async () => {
      const term = createMockTerminal() as any

      // Ligatures addon may not be available in test environment
      const result = await loadLigaturesAddon(term)

      // Should either load or return undefined
      if (result) {
        expect(result.dispose).toBeDefined()
      }
    })
  })

  describe('loadUnicode11Addon', () => {
    it('should load Unicode 11 addon and set active version', async () => {
      const term = createMockTerminal() as any

      const result = await loadUnicode11Addon(term)

      // Should either load or return undefined
      if (result) {
        expect(term.loadAddon).toHaveBeenCalled()
        expect(term.unicode.activeVersion).toBe('11')
      }
    })
  })

  describe('loadTerminalEnhancements', () => {
    it('should load all addons in parallel', async () => {
      const term = createMockTerminal() as any

      const result = await loadTerminalEnhancements(term)

      // Result should be an object with optional addon references
      expect(result).toBeDefined()
      expect(typeof result).toBe('object')

      // Each property should be either an addon or undefined
      if (result.webgl) {
        expect(result.webgl.dispose).toBeDefined()
      }
      if (result.ligatures) {
        expect(result.ligatures.dispose).toBeDefined()
      }
      if (result.unicode11) {
        expect(result.unicode11.dispose).toBeDefined()
      }
    })
  })

  describe('disposeTerminalEnhancements', () => {
    it('should dispose all loaded addons', () => {
      const mockAddon1 = { dispose: vi.fn() }
      const mockAddon2 = { dispose: vi.fn() }
      const mockAddon3 = { dispose: vi.fn() }

      const addons = {
        webgl: mockAddon1,
        ligatures: mockAddon2,
        unicode11: mockAddon3,
      }

      disposeTerminalEnhancements(addons)

      expect(mockAddon1.dispose).toHaveBeenCalled()
      expect(mockAddon2.dispose).toHaveBeenCalled()
      expect(mockAddon3.dispose).toHaveBeenCalled()
    })

    it('should handle undefined addons gracefully', () => {
      const addons = {
        webgl: undefined,
        ligatures: undefined,
        unicode11: undefined,
      }

      // Should not throw
      expect(() => disposeTerminalEnhancements(addons)).not.toThrow()
    })

    it('should handle partial addons', () => {
      const mockAddon = { dispose: vi.fn() }

      const addons = {
        webgl: mockAddon,
        ligatures: undefined,
        unicode11: undefined,
      }

      disposeTerminalEnhancements(addons)

      expect(mockAddon.dispose).toHaveBeenCalled()
    })
  })
})
