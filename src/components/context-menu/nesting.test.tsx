// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import '@/i18n'
import { MessageBubble } from '@/components/chat/MessageBubble'
import { CodeBlock } from '@/components/chat/CodeBlock'
import { DeclarativeContextMenu } from './DeclarativeContextMenu'
import { buildContextMenuItems } from './registry'
import type { ContextMenuBuildContext } from './types'

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))
vi.mock('@/ipc/clipboard', () => ({ copyText: vi.fn(async () => true) }))

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'chat',
    surface: 'chat',
    activeSessionId: 's1',
    sessionStatus: 'idle',
    sessionInterrupt: false,
    openSessionIds: ['s1'],
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

describe('nesting: message ⊃ codeBlock (innermost wins)', () => {
  beforeEach(() => {
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  it('buildContextMenuItems: code kind yields only code items (no message.regenerate/copy)', () => {
    const items = buildContextMenuItems(
      { kind: 'codeBlock', payload: { code: 'x = 1' } },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    const ids = items.map((i) => i.id)
    expect(ids).toContain('codeBlock.copy')
    expect(ids).not.toContain('message.copy')
    expect(ids).not.toContain('message.regenerate')
    expect(ids).not.toContain('message.quote')
  })

  it('buildContextMenuItems: message kind yields message items (no codeBlock.copy)', () => {
    const items = buildContextMenuItems(
      {
        kind: 'message',
        payload: {
          message: {
            id: 'm1',
            role: 'assistant',
            content: 'plain markdown',
            timestamp: Date.now(),
          } as never,
          isLastAssistant: true,
          sessionId: 's1',
        },
      },
      makeCtx(),
      { version: 1, disabledIds: [] },
    )
    const ids = items.map((i) => i.id)
    expect(ids).toContain('message.copy')
    expect(ids).toContain('message.regenerate')
    expect(ids).not.toContain('codeBlock.copy')
  })

  it('right-click code block host opens only code items', async () => {
    render(
      <DeclarativeContextMenu
        kind="message"
        payload={{
          message: {
            id: 'm1',
            role: 'assistant',
            content: 'outer',
            timestamp: Date.now(),
          } as never,
          isLastAssistant: true,
          sessionId: 's1',
        }}
        data-testid="msg-host"
      >
        <div>
          <span data-testid="plain-md">plain text</span>
          <CodeBlock>
            <code className="language-ts">const x = 1</code>
          </CodeBlock>
        </div>
      </DeclarativeContextMenu>,
    )

    const codeHost = screen.getByTestId('code-block-context-menu')
    fireEvent.contextMenu(codeHost)

    await waitFor(() => {
      expect(screen.getByTestId('context-menu-item-codeBlock.copy')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('context-menu-item-message.copy')).not.toBeInTheDocument()
    expect(screen.queryByTestId('context-menu-item-message.regenerate')).not.toBeInTheDocument()
  })

  it('right-click plain markdown host opens message items only', async () => {
    render(
      <MessageBubble
        message={{
          id: 'm2',
          role: 'assistant',
          content: 'hello plain world',
          timestamp: Date.now(),
        } as never}
        isLastAssistant
      />,
    )

    const msgHost = screen.getByTestId('message-context-menu')
    // Click on plain text area (not a code block — content has no fences)
    fireEvent.contextMenu(screen.getByText('hello plain world'))

    await waitFor(() => {
      expect(screen.getByTestId('context-menu-item-message.copy')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('context-menu-item-codeBlock.copy')).not.toBeInTheDocument()
    // host kind attribute for diagnostics
    expect(msgHost).toHaveAttribute('data-context-menu-kind', 'message')
  })

  it('nested hosts set distinct data-context-menu-kind attributes', () => {
    render(
      <MessageBubble
        message={{
          id: 'm3',
          role: 'assistant',
          content: 'before\n\n```js\nconsole.log(1)\n```\n\nafter',
          timestamp: Date.now(),
        } as never}
        isLastAssistant
      />,
    )

    expect(screen.getByTestId('message-context-menu')).toHaveAttribute(
      'data-context-menu-kind',
      'message',
    )
    expect(screen.getByTestId('code-block-context-menu')).toHaveAttribute(
      'data-context-menu-kind',
      'codeBlock',
    )
  })
})
