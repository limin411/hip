// @vitest-environment happy-dom
/**
 * Structural + behavioral check: App shell early-hydrates knowledge spaces
 * so the sidebar knowledge count is not empty until first Knowledge enter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const loadSpaces = vi.fn(async () => {})
const providersLoad = vi.fn(async () => {})
const skillsLoad = vi.fn(async () => {})
const pluginsLoad = vi.fn(async () => {})

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: Object.assign(
    (sel: (s: { loaded: boolean }) => unknown) => sel({ loaded: false }),
    {
      getState: () => ({
        loadSpaces,
        loaded: false,
      }),
      setState: vi.fn(),
    },
  ),
}))

vi.mock('@/store/providersStore', () => ({
  useProvidersStore: Object.assign(
    (sel: (s: { loaded: boolean }) => unknown) => sel({ loaded: true }),
    {
      getState: () => ({
        load: providersLoad,
        loaded: true,
      }),
      setState: vi.fn(),
    },
  ),
}))

vi.mock('@/store/skillsStore', () => ({
  useSkillsStore: {
    getState: () => ({
      load: skillsLoad,
    }),
    setState: vi.fn(),
  },
}))

vi.mock('@/store/pluginsStore', () => ({
  usePluginsStore: {
    getState: () => ({
      load: pluginsLoad,
    }),
    setState: vi.fn(),
  },
}))

vi.mock('@/components/layout/LoadingScreen', () => ({
  LoadingScreen: () => null,
}))

vi.mock('./routes/AppLayout', () => ({
  AppLayout: () => null,
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    createHashRouter: () => ({}),
    RouterProvider: () => null,
  }
})

describe('App knowledge cold-start hydrate wire', () => {
  beforeEach(() => {
    loadSpaces.mockClear()
    providersLoad.mockClear()
    skillsLoad.mockClear()
    pluginsLoad.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('App.tsx source wires useKnowledgeStore.loadSpaces on bootstrap', () => {
    const src = readFileSync(resolve(__dirname, 'App.tsx'), 'utf8')
    expect(src).toMatch(/useKnowledgeStore/)
    expect(src).toMatch(/loadSpaces\s*\(\s*\)/)
    // Same store path the sidebar reads for spaces.length count.
    expect(src).toContain("import { useKnowledgeStore } from '@/store/knowledgeStore'")
  })

  it('mounting App invokes loadSpaces (early hydrate)', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const App = (await import('./App')).default

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(React.createElement(App))

    await vi.waitFor(() => {
      expect(loadSpaces).toHaveBeenCalled()
    })

    root.unmount()
    host.remove()
  })
})
