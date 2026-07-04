// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ConnectionStatus } from './ConnectionStatus'

afterEach(cleanup)

const translations: Record<string, string> = {
  'chat.connectionConnected': '已连接',
  'chat.connectionConnecting': '连接中…',
  'chat.connectionDisconnected': '已断开',
  'chat.connectionError': '连接错误',
  'chat.connectionRetry': '重试',
  'chat.noApiKey': '未配置密钥',
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => translations[key] ?? key }),
}))

vi.mock('@/domain', () => ({
  useConnectionStatus: () => 'connected',
  useHasApiKey: () => true,
  sessionService: { reconnect: vi.fn() },
}))

describe('ConnectionStatus', () => {
  it('renders connected status', () => {
    render(<ConnectionStatus />)
    expect(screen.getByText('已连接')).toBeInTheDocument()
  })
})
