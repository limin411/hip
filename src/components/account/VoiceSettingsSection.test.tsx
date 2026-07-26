// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { VoiceSettingsSection } from './VoiceSettingsSection'
import { useVoiceDownloadStore } from '@/domain/voice/voiceDownloadStore'

const updateSection = vi.fn().mockResolvedValue(undefined)
const hipConfigState = {
  config: {
    version: 1 as const,
    voice: { enabled: false as boolean | undefined, model: 'base' as const },
  },
  updateSection,
}

vi.mock('@/store/hipConfigStore', () => ({
  useHipConfigStore: (sel: (s: typeof hipConfigState) => unknown) => sel(hipConfigState),
}))

const voiceModelStatus = vi.fn()
const voiceRuntimeStatus = vi.fn()
const voiceDownloadModel = vi.fn()
const voiceCancelDownload = vi.fn()
const voiceOpenModelsDir = vi.fn()
const listenVoiceDownloadProgress = vi.fn().mockResolvedValue(() => {})

vi.mock('@/ipc/voice', () => ({
  voiceRuntimeStatus: (...a: unknown[]) => voiceRuntimeStatus(...a),
  voiceModelStatus: (...a: unknown[]) => voiceModelStatus(...a),
  voiceDownloadModel: (...a: unknown[]) => voiceDownloadModel(...a),
  voiceCancelDownload: (...a: unknown[]) => voiceCancelDownload(...a),
  voiceOpenModelsDir: (...a: unknown[]) => voiceOpenModelsDir(...a),
  listenVoiceDownloadProgress: (...a: unknown[]) => listenVoiceDownloadProgress(...a),
}))

vi.mock('@/components/ui/DropdownMenu', async () => {
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    DropdownMenuItem: ({
      children,
      onSelect,
      ...rest
    }: {
      children: React.ReactNode
      onSelect?: () => void
      'data-testid'?: string
    }) =>
      React.createElement(
        'button',
        { type: 'button', onClick: () => onSelect?.(), ...rest },
        children,
      ),
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && 'sizeMb' in opts) return `${k}:${opts.sizeMb}`
      if (opts && 'model' in opts && 'status' in opts) return `${k}:${opts.model}:${opts.status}`
      if (opts && 'model' in opts) return `${k}:${opts.model}`
      return k
    },
  }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }))

describe('VoiceSettingsSection', () => {
  beforeEach(() => {
    cleanup()
    useVoiceDownloadStore.getState()._resetForTests()
    updateSection.mockClear()
    hipConfigState.config.voice = { enabled: false, model: 'base' }
    voiceRuntimeStatus.mockResolvedValue({
      mock: false,
      binaryAvailable: true,
      voiceEnvDisabled: false,
    })
    voiceModelStatus.mockImplementation(async (id?: string) => ({
      model: id ?? 'base',
      ready: id === 'tiny',
      approxBytes: 100_000_000,
      bytesOnDisk: id === 'tiny' ? 77_000_000 : undefined,
    }))
    voiceDownloadModel.mockResolvedValue({ path: '/tmp/m' })
    // Avoid hanging getUserMedia in happy-dom.
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('denied')),
        enumerateDevices: vi.fn().mockResolvedValue([]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
  })

  afterEach(() => {
    cleanup()
    useVoiceDownloadStore.getState()._resetForTests()
  })

  it('shows only master switch when voice is disabled (opt-in)', () => {
    render(<VoiceSettingsSection />)
    expect(screen.getByTestId('settings-voice-enabled')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-voice-model-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-voice-check-status')).not.toBeInTheDocument()
  })

  it('reveals model download and status panel when enabled', async () => {
    hipConfigState.config.voice = { enabled: true, model: 'base' }
    render(<VoiceSettingsSection />)
    expect(screen.getByTestId('settings-voice-model-panel')).toBeInTheDocument()
    expect(screen.getByTestId('settings-voice-check-status')).toBeInTheDocument()
    expect(screen.getByTestId('settings-voice-download')).toBeInTheDocument()
    await waitFor(() => {
      expect(voiceModelStatus).toHaveBeenCalled()
    })
    expect(screen.getByTestId('settings-voice-model-row-tiny')).toHaveAttribute(
      'data-ready',
      'true',
    )
    expect(screen.getByTestId('settings-voice-model-row-base')).toHaveAttribute(
      'data-ready',
      'false',
    )
  })

  it('check status re-queries all models', async () => {
    hipConfigState.config.voice = { enabled: true, model: 'base' }
    render(<VoiceSettingsSection />)
    await waitFor(() => expect(voiceModelStatus).toHaveBeenCalled())
    voiceModelStatus.mockClear()
    fireEvent.click(screen.getByTestId('settings-voice-check-status'))
    await waitFor(() => {
      expect(voiceModelStatus).toHaveBeenCalled()
    })
  })

  it('download button triggers voiceDownloadModel for active model', async () => {
    hipConfigState.config.voice = { enabled: true, model: 'base' }
    render(<VoiceSettingsSection />)
    await waitFor(() => expect(screen.getByTestId('settings-voice-download')).toBeEnabled())
    fireEvent.click(screen.getByTestId('settings-voice-download'))
    await waitFor(() => {
      expect(voiceDownloadModel).toHaveBeenCalledWith('base')
    })
  })

  it('does not open microphone or enumerate devices on page load', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error('should not be called'))
    const enumerateDevices = vi.fn().mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic1', label: '', groupId: 'g1' },
    ])
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    hipConfigState.config.voice = { enabled: true, model: 'base' }
    render(<VoiceSettingsSection />)
    // Give effects a tick — must stay hands-off for mic.
    await waitFor(() => expect(screen.getByTestId('settings-voice-mic-test')).toBeInTheDocument())
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(enumerateDevices).not.toHaveBeenCalled()
  })

  it('allows model download even when whisper binary is missing', async () => {
    voiceRuntimeStatus.mockResolvedValue({
      mock: false,
      binaryAvailable: false,
      voiceEnvDisabled: false,
    })
    hipConfigState.config.voice = { enabled: true, model: 'base' }
    render(<VoiceSettingsSection />)
    await waitFor(() => expect(screen.getByTestId('settings-voice-download')).toBeEnabled())
    fireEvent.click(screen.getByTestId('settings-voice-download'))
    await waitFor(() => {
      expect(voiceDownloadModel).toHaveBeenCalledWith('base')
    })
  })

  it('refresh devices requests mic permission only on user action', async () => {
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    })
    const enumerateDevices = vi.fn().mockResolvedValue([])
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia,
        enumerateDevices,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    hipConfigState.config.voice = { enabled: true, model: 'base' }
    render(<VoiceSettingsSection />)
    await waitFor(() => expect(screen.getByTestId('settings-voice-refresh-devices')).toBeInTheDocument())
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(enumerateDevices).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('settings-voice-refresh-devices'))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    expect(enumerateDevices).toHaveBeenCalled()
  })

  it('shows mic test controls when voice is enabled', async () => {
    hipConfigState.config.voice = { enabled: true, model: 'base' }
    render(<VoiceSettingsSection />)
    expect(screen.getByTestId('settings-voice-mic-test')).toBeInTheDocument()
    expect(screen.getByTestId('settings-voice-mic-test-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('settings-voice-mic-test-transcribe')).toBeDisabled()
  })

  it('keeps download progress when remounting (page switch)', async () => {
    let resolveDl!: (v: { path: string }) => void
    voiceDownloadModel.mockImplementation(
      () =>
        new Promise<{ path: string }>((res) => {
          resolveDl = res
        }),
    )
    hipConfigState.config.voice = { enabled: true, model: 'base' }
    const { unmount } = render(<VoiceSettingsSection />)
    await waitFor(() => expect(screen.getByTestId('settings-voice-download')).toBeEnabled())
    fireEvent.click(screen.getByTestId('settings-voice-download'))
    await waitFor(() => expect(voiceDownloadModel).toHaveBeenCalledWith('base'))

    useVoiceDownloadStore.getState().applyProgress({
      model: 'base',
      downloaded: 70_000_000,
      total: 147_951_465,
      phase: 'downloading',
    })

    unmount()
    // Simulate navigating away then back — store must still hold progress.
    render(<VoiceSettingsSection />)
    await waitFor(() => {
      expect(screen.getByTestId('settings-voice-download-progress')).toBeInTheDocument()
    })
    expect(screen.getByTestId('settings-voice-download')).toBeDisabled()
    // In-flight download is shared; re-click (even if not disabled in DOM) must not re-invoke IPC.
    const callsBefore = voiceDownloadModel.mock.calls.length
    fireEvent.click(screen.getByTestId('settings-voice-download'))
    expect(voiceDownloadModel).toHaveBeenCalledTimes(callsBefore)

    resolveDl({ path: '/tmp/m' })
    await waitFor(() => {
      expect(screen.queryByTestId('settings-voice-download-progress')).not.toBeInTheDocument()
    })
  })
})
