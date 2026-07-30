/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { HipBoardCanvas, type HipBoardCanvasHandle } from './HipBoardCanvas'
import {
  EMPTY_HIP_BOARD_SCENE_JSON,
  serializeHipBoard,
  type HipBoardSceneDisk,
} from '@/domain/knowledge/boardScene'

afterEach(() => {
  cleanup()
})

const SCENE_WITH_RECT: HipBoardSceneDisk = {
  type: 'hip-board',
  version: 1,
  source: 'hip',
  hip: { schemaVersion: 1, boardId: 'brd_hip_shell' },
  elements: [
    {
      id: 'r1',
      type: 'rect',
      x: 10,
      y: 20,
      w: 80,
      h: 40,
      fill: '#ffffff',
      stroke: '#111111',
      strokeWidth: 2,
      cornerRadius: 0,
    },
  ],
  appState: { viewBackgroundColor: '#f0f0f0' },
  files: {},
}

describe('HipBoardCanvas shell', () => {
  it('mounts empty SVG scene with test ids', () => {
    render(
      <HipBoardCanvas
        boardId="brd_hip_shell"
        spaceId="spc_1"
        initialJson={EMPTY_HIP_BOARD_SCENE_JSON}
      />,
    )
    expect(screen.getByTestId('knowledge-board-canvas')).toBeTruthy()
    expect(screen.getByTestId('hip-board-svg')).toBeTruthy()
    expect(screen.getByTestId('hip-board-world')).toBeTruthy()
    expect(screen.getByTestId('knowledge-board-canvas').getAttribute('data-engine')).toBe(
      'hip',
    )
  })

  it('renders hip-board elements from initialJson', () => {
    render(
      <HipBoardCanvas
        boardId="brd_hip_shell"
        spaceId="spc_1"
        initialJson={serializeHipBoard(SCENE_WITH_RECT)}
      />,
    )
    const rect = document.querySelector('[data-element-id="r1"]')
    expect(rect).toBeTruthy()
    expect(rect?.tagName.toLowerCase()).toBe('rect')
  })

  it('pan via pointer drag updates camera without calling onDraftBody', () => {
    const onDraftBody = vi.fn()
    const ref = createRef<HipBoardCanvasHandle>()
    render(
      <HipBoardCanvas
        ref={ref}
        boardId="brd_hip_shell"
        spaceId="spc_1"
        initialJson={EMPTY_HIP_BOARD_SCENE_JSON}
        onDraftBody={onDraftBody}
      />,
    )
    const root = screen.getByTestId('knowledge-board-canvas')
    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 0, clientX: 130, clientY: 140, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 130, clientY: 140, pointerId: 1 })
    })
    const cam = ref.current?.getCamera()
    expect(cam).toBeDefined()
    expect(cam!.x).toBeCloseTo(30)
    expect(cam!.y).toBeCloseTo(40)
    expect(onDraftBody).not.toHaveBeenCalled()
  })

  it('wheel zoom does not call onDraftBody', () => {
    const onDraftBody = vi.fn()
    const ref = createRef<HipBoardCanvasHandle>()
    render(
      <HipBoardCanvas
        ref={ref}
        boardId="brd_hip_shell"
        spaceId="spc_1"
        initialJson={EMPTY_HIP_BOARD_SCENE_JSON}
        onDraftBody={onDraftBody}
      />,
    )
    const root = screen.getByTestId('knowledge-board-canvas')
    const before = ref.current!.getCamera().zoom
    act(() => {
      fireEvent.wheel(root, { deltaY: -100, clientX: 50, clientY: 50 })
    })
    const after = ref.current!.getCamera().zoom
    expect(after).not.toBe(before)
    expect(onDraftBody).not.toHaveBeenCalled()
  })

  it('flushToStore calls onDraftBody with hip-board dehydrated body', () => {
    const onDraftBody = vi.fn()
    const ref = createRef<HipBoardCanvasHandle>()
    render(
      <HipBoardCanvas
        ref={ref}
        boardId="brd_hip_shell"
        spaceId="spc_1"
        initialJson={serializeHipBoard(SCENE_WITH_RECT)}
        onDraftBody={onDraftBody}
      />,
    )
    act(() => {
      ref.current?.flushToStore({ mode: 'snapshot' })
    })
    expect(onDraftBody).toHaveBeenCalledTimes(1)
    const [raw, opts] = onDraftBody.mock.calls[0]!
    expect(opts).toEqual({ docId: 'brd_hip_shell', persist: 'none' })
    const parsed = JSON.parse(raw as string)
    expect(parsed.type).toBe('hip-board')
    expect(parsed.elements).toHaveLength(1)
  })

  it('isReady is true after mount', () => {
    const ref = createRef<HipBoardCanvasHandle>()
    render(
      <HipBoardCanvas
        ref={ref}
        boardId="brd_hip_shell"
        spaceId="spc_1"
        initialJson={EMPTY_HIP_BOARD_SCENE_JSON}
      />,
    )
    expect(ref.current?.isReady()).toBe(true)
  })
})
