// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ConnectionStatus } from './ConnectionStatus'
import { sessionService } from '@/domain'

afterEach(cleanup)

const translations: Record<string, string> = {
  'chat.connectionConnected': '已连接',
  'chat.connectionConnecting': '连接中…',
  'chat.connectionDisconnected': '已断开',
  'chat.connectionError': '连接错误',
  'chat.connectionRetry': '重试',
  'chat.noApiKey': '未配置密钥',
}

const mocks = vi.hoisted(() => ({
  status: 'connected' as 'connected' | 'connecting' | 'disconnected' | 'error',
  hasApiKey: true,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => translations[key] ?? key }),
}))

vi.mock('@/domain', () => ({
  useConnectionStatus: () => mocks.status,
  useHasApiKey: () => mocks.hasApiKey,
  sessionService: { reconnect: vi.fn() },
}))

describe('ConnectionStatus', () => {
  beforeEach(() => {
    mocks.status = 'connected'
    mocks.hasApiKey = true
    vi.mocked(sessionService.reconnect).mockClear()
  })

  it('renders connected status', () => {
    render(<ConnectionStatus />)
    expect(screen.getByText('已连接')).toBeInTheDocument()
  })

  it('renders connecting status', () => {
    mocks.status = 'connecting'
    render(<ConnectionStatus />)
    expect(screen.getByText('连接中…')).toBeInTheDocument()
  })

  it('renders disconnected status with retry button', () => {
    mocks.status = 'disconnected'
    render(<ConnectionStatus />)
    expect(screen.getByText('已断开')).toBeInTheDocument()
    fireEvent.click(screen.getByText('重试'))
    expect(sessionService.reconnect).toHaveBeenCalledTimes(1)
  })

  it('renders error status with retry button', () => {
    mocks.status = 'error'
    render(<ConnectionStatus />)
    expect(screen.getByText('连接错误')).toBeInTheDocument()
    fireEvent.click(screen.getByText('重试'))
    expect(sessionService.reconnect).toHaveBeenCalledTimes(1)
  })

  it('warns when connected but no API key is configured', () => {
    mocks.hasApiKey = false
    render(<ConnectionStatus />)
    expect(screen.getByText('未配置密钥')).toBeInTheDocument()
    expect(screen.queryByText('已连接')).not.toBeInTheDocument()
  })
})
