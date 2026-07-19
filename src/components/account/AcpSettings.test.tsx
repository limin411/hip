// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { AcpHostPolicySection } from './AcpSettings'

const updateSection = vi.fn().mockResolvedValue(undefined)
const load = vi.fn().mockResolvedValue(undefined)

let mockAcp: { forwardMcp?: boolean; fsBridge?: boolean } | undefined = undefined
let mockLoaded = true
let mockError: string | null = null

vi.mock('@/store/hipConfigStore', () => ({
  useHipConfigStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      config: { version: 1, acp: mockAcp },
      loaded: mockLoaded,
      error: mockError,
      load,
      updateSection,
    }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('AcpHostPolicySection', () => {
  beforeEach(() => {
    updateSection.mockClear()
    load.mockClear()
    mockAcp = undefined
    mockLoaded = true
    mockError = null
  })
  afterEach(() => {
    cleanup()
  })

  it('renders section title and both host-policy switches', () => {
    render(<AcpHostPolicySection />)
    expect(screen.getByTestId('acp-settings')).toBeInTheDocument()
    expect(screen.getByText('settings.acp.sectionTitle')).toBeInTheDocument()
    expect(screen.getByTestId('acp-switch-forward-mcp')).toHaveAttribute('aria-checked', 'false')
    // fsBridge defaults on when unset
    expect(screen.getByTestId('acp-switch-fs-bridge')).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByTestId('acp-forward-mcp-warning')).not.toBeInTheDocument()
  })

  it('shows warning when forwardMcp is already on', () => {
    mockAcp = { forwardMcp: true, fsBridge: true }
    render(<AcpHostPolicySection />)
    expect(screen.getByTestId('acp-switch-forward-mcp')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('acp-forward-mcp-warning')).toBeInTheDocument()
  })

  it('persists forwardMcp via updateSection merge', async () => {
    render(<AcpHostPolicySection />)
    fireEvent.click(screen.getByTestId('acp-switch-forward-mcp'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('acp', expect.any(Function))
    })
    const fn = updateSection.mock.calls[0][1] as (
      prev: { fsBridge?: boolean } | undefined,
    ) => Record<string, unknown>
    expect(fn(undefined)).toEqual({ forwardMcp: true })
    expect(fn({ fsBridge: false })).toEqual({ fsBridge: false, forwardMcp: true })
  })

  it('persists fsBridge off while keeping other fields', async () => {
    mockAcp = { forwardMcp: true, fsBridge: true }
    render(<AcpHostPolicySection />)
    fireEvent.click(screen.getByTestId('acp-switch-fs-bridge'))
    await waitFor(() => {
      expect(updateSection).toHaveBeenCalledWith('acp', expect.any(Function))
    })
    const fn = updateSection.mock.calls[0][1] as (
      prev: { forwardMcp?: boolean; fsBridge?: boolean } | undefined,
    ) => Record<string, unknown>
    expect(fn({ forwardMcp: true, fsBridge: true })).toEqual({
      forwardMcp: true,
      fsBridge: false,
    })
  })

  it('loads config when not yet loaded', () => {
    mockLoaded = false
    render(<AcpHostPolicySection />)
    expect(load).toHaveBeenCalled()
  })
})
