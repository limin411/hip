// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import {
  KnowledgeBoardCanvas,
  type KnowledgeBoardCanvasHandle,
} from './KnowledgeBoardCanvas'
import { EMPTY_BOARD_SCENE_JSON } from '@/domain/knowledge/boardScene'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

describe('KnowledgeBoardCanvas placeholder', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders empty-state shell without Milkdown / live editor', () => {
    render(
      <KnowledgeBoardCanvas
        boardId="brd_test000001"
        spaceId="spc_1"
        initialJson={EMPTY_BOARD_SCENE_JSON}
      />,
    )
    expect(screen.getByTestId('knowledge-board-canvas')).toBeInTheDocument()
    expect(screen.getByText('knowledge.board.placeholderTitle')).toBeInTheDocument()
    expect(screen.getByText('knowledge.board.placeholderHint')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-doc-live-editor')).toBeNull()
    expect(screen.getByTestId('knowledge-board-json-preview')).toBeInTheDocument()
  })

  it('exposes synchronous flushToStore(mode) and exportPngBlob stub', async () => {
    const ref = createRef<KnowledgeBoardCanvasHandle>()
    render(
      <KnowledgeBoardCanvas
        ref={ref}
        boardId="brd_test000001"
        spaceId="spc_1"
        initialJson="{}"
      />,
    )
    expect(ref.current).not.toBeNull()
    expect(() => ref.current!.flushToStore({ mode: 'leave' })).not.toThrow()
    expect(() => ref.current!.flushToStore({ mode: 'snapshot' })).not.toThrow()
    expect(() => ref.current!.flushToStore()).not.toThrow()
    await expect(ref.current!.exportPngBlob()).resolves.toBeNull()
  })
})
