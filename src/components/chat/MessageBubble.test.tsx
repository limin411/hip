// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import i18n from '@/i18n'
import { MessageBubble } from './MessageBubble'

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))
vi.mock('@/ipc/clipboard', () => ({ copyText: vi.fn() }))

describe('MessageBubble', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  beforeEach(() => {
    cleanup()
  })
  it('renders a user message with content', () => {
    render(
      <MessageBubble
        message={{
          id: 'm1',
          role: 'user',
          content: 'hello',
          timestamp: Date.now(),
        } as any}
      />,
    )
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('你')).toBeInTheDocument()
  })

  it('renders an assistant message', () => {
    render(
      <MessageBubble
        message={{
          id: 'm2',
          role: 'assistant',
          content: 'hi there',
          timestamp: Date.now(),
        } as any}
      />,
    )
    expect(screen.getByText('hi there')).toBeInTheDocument()
    expect(screen.getByText('hip')).toBeInTheDocument()
  })

  it('renders user attachments', () => {
    render(
      <MessageBubble
        message={{
          id: 'm3',
          role: 'user',
          content: '',
          timestamp: Date.now(),
          attachments: [{ id: 'a1', name: 'pic.png', mimeType: 'image/png', size: 1024 }],
        } as any}
      />,
    )
    const chip = screen.getByTestId('message-attachment')
    expect(chip).toHaveTextContent('pic.png')
    expect(chip).toHaveTextContent('1.0 KB')
  })

  it('shows message usage for assistant messages', () => {
    render(
      <MessageBubble
        message={{
          id: 'm4',
          role: 'assistant',
          content: 'ok',
          timestamp: Date.now(),
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        } as any}
        isLastAssistant
      />,
    )
    expect(screen.getByTestId('message-usage')).toHaveTextContent('15')
  })

  it('shows message timestamp when available', () => {
    const now = Date.now()
    render(
      <MessageBubble
        message={{
          id: 'm5',
          role: 'user',
          content: 'time',
          timestamp: now,
        } as any}
      />,
    )
    expect(screen.getByTestId('message-time')).toBeInTheDocument()
  })

  it('shows memory citations chip when memoryCitations is non-empty', () => {
    render(
      <MessageBubble
        message={{
          id: 'm6',
          role: 'assistant',
          content: 'ok',
          timestamp: Date.now(),
          memoryCitations: [
            { memoryId: 'a', title: 'A' },
            { memoryId: 'b', title: 'B' },
          ],
        } as any}
      />,
    )
    const chip = screen.getByTestId('memory-citations-chip')
    expect(chip).toBeInTheDocument()
    fireEvent.pointerDown(chip)
    fireEvent.click(chip)
    const list = screen.getByTestId('memory-citations-list')
    expect(list).toHaveTextContent('A')
    expect(list).toHaveTextContent('B')
  })

  it('hides memory citations chip when empty or missing', () => {
    render(
      <MessageBubble
        message={{
          id: 'm7',
          role: 'assistant',
          content: 'ok',
          timestamp: Date.now(),
          memoryCitations: [],
        } as any}
      />,
    )
    expect(screen.queryByTestId('memory-citations-chip')).not.toBeInTheDocument()
  })
})
