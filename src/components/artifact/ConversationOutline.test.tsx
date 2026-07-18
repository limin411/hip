// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useUiStore } from '@/store/uiStore'
import { ConversationOutline } from './ConversationOutline'

describe('ConversationOutline', () => {
  beforeEach(() => {
    useUiStore.setState({ scrollTargetMessageId: null })
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 'T',
          preview: '',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [
            { id: 'u1', role: 'user', content: 'First question', timestamp: 1 },
            { id: 'a1', role: 'assistant', content: 'Answer', timestamp: 2 },
            { id: 'u2', role: 'user', content: 'Follow up', timestamp: 3 },
          ],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 's1',
    } as never)
  })

  afterEach(() => {
    cleanup()
  })

  it('lists user turns and jumps on click', () => {
    // Transcript anchors live outside the outline (main ChatPane).
    const anchor = document.createElement('div')
    anchor.setAttribute('data-message-id', 'u2')
    anchor.scrollIntoView = vi.fn()
    document.body.appendChild(anchor)

    render(<ConversationOutline />)
    expect(screen.getByTestId('conversation-outline')).toBeInTheDocument()
    expect(screen.getByTestId('conversation-outline-item-u1')).toHaveTextContent('First question')
    expect(screen.getByTestId('conversation-outline-item-u2')).toHaveTextContent('Follow up')
    expect(screen.queryByText('Answer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('conversation-outline-item-u2'))
    expect(anchor.scrollIntoView).toHaveBeenCalled()
    expect(useUiStore.getState().scrollTargetMessageId).toBe('u2')
  })

  it('shows empty state when no user turns', () => {
    useDomainStore.setState({
      sessions: [
        {
          id: 's1',
          title: 'T',
          preview: '',
          updatedAtMs: Date.now(),
          config: { ...DEFAULT_CONFIG, surface: 'chat' },
          messages: [],
          status: 'idle',
          loaded: true,
        },
      ],
      activeSessionId: 's1',
    } as never)
    render(<ConversationOutline />)
    expect(screen.getByTestId('conversation-outline-empty')).toBeInTheDocument()
  })
})
