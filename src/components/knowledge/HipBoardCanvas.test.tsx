/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
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
  vi.useRealTimers()
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

const SCENE_WITH_TEXT: HipBoardSceneDisk = {
  type: 'hip-board',
  version: 1,
  source: 'hip',
  hip: { schemaVersion: 1 },
  elements: [
    {
      id: 't1',
      type: 'text',
      x: 0,
      y: 0,
      w: 160,
      h: 28,
      text: 'hello',
      fill: '#111111',
      fontSize: 16,
    },
  ],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
}

function renderCanvas(
  props: Partial<{
    initialJson: string
    onDraftBody: ReturnType<typeof vi.fn>
    boardId: string
  }> = {},
) {
  const ref = createRef<HipBoardCanvasHandle>()
  const onDraftBody = props.onDraftBody ?? vi.fn()
  render(
    <HipBoardCanvas
      ref={ref}
      boardId={props.boardId ?? 'brd_hip_shell'}
      spaceId="spc_1"
      initialJson={props.initialJson ?? EMPTY_HIP_BOARD_SCENE_JSON}
      onDraftBody={onDraftBody}
    />,
  )
  return { ref, onDraftBody, root: screen.getByTestId('knowledge-board-canvas') }
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

  it('pan via middle-button drag updates camera without calling onDraftBody', () => {
    const { ref, onDraftBody, root } = renderCanvas()
    act(() => {
      fireEvent.pointerDown(root, { button: 1, clientX: 100, clientY: 100, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 1, clientX: 130, clientY: 140, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 1, clientX: 130, clientY: 140, pointerId: 1 })
    })
    const cam = ref.current?.getCamera()
    expect(cam).toBeDefined()
    expect(cam!.x).toBeCloseTo(30)
    expect(cam!.y).toBeCloseTo(40)
    expect(onDraftBody).not.toHaveBeenCalled()
  })

  it('wheel zoom does not call onDraftBody', () => {
    const { ref, onDraftBody, root } = renderCanvas()
    const before = ref.current!.getCamera().zoom
    act(() => {
      fireEvent.wheel(root, { deltaY: -100, clientX: 50, clientY: 50 })
    })
    const after = ref.current!.getCamera().zoom
    expect(after).not.toBe(before)
    expect(onDraftBody).not.toHaveBeenCalled()
  })

  it('flushToStore calls onDraftBody with hip-board dehydrated body', () => {
    const { ref, onDraftBody } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
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
    const { ref } = renderCanvas()
    expect(ref.current?.isReady()).toBe(true)
  })

  it('invalid initialJson falls back to empty hip scene', () => {
    render(
      <HipBoardCanvas
        boardId="brd_hip_shell"
        spaceId="spc_1"
        initialJson="not-json{{{"
      />,
    )
    expect(screen.getByTestId('hip-board-world').children).toHaveLength(0)
  })

  it('excalidraw initialJson seeds empty hip (no silent migrate)', () => {
    const excal = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [{ id: 'stroke1', type: 'freedraw' }],
      appState: { viewBackgroundColor: '#fff' },
      files: {},
    })
    render(
      <HipBoardCanvas boardId="brd_hip_shell" spaceId="spc_1" initialJson={excal} />,
    )
    expect(document.querySelector('[data-element-id="stroke1"]')).toBeNull()
    expect(screen.getByTestId('hip-board-world').children).toHaveLength(0)
  })

  it('flushToStore leave freezes isReady and ignores further camera/draft', () => {
    const { ref, onDraftBody, root } = renderCanvas()
    act(() => {
      ref.current?.flushToStore({ mode: 'leave' })
    })
    expect(onDraftBody).toHaveBeenCalledTimes(1)
    expect(ref.current?.isReady()).toBe(false)

    const camBefore = ref.current!.getCamera()
    act(() => {
      fireEvent.wheel(root, { deltaY: -200, clientX: 10, clientY: 10 })
      fireEvent.pointerDown(root, { button: 1, clientX: 0, clientY: 0, pointerId: 2 })
      fireEvent.pointerMove(root, { button: 1, clientX: 50, clientY: 50, pointerId: 2 })
      fireEvent.pointerUp(root, { button: 1, clientX: 50, clientY: 50, pointerId: 2 })
    })
    expect(ref.current!.getCamera()).toEqual(camBefore)
    // Snapshot flush after leave is a no-op for draft
    act(() => {
      ref.current?.flushToStore({ mode: 'snapshot' })
    })
    expect(onDraftBody).toHaveBeenCalledTimes(1)
  })

  it('flushToStore without onDraftBody does not throw', () => {
    const ref = createRef<HipBoardCanvasHandle>()
    render(
      <HipBoardCanvas
        ref={ref}
        boardId="brd_hip_shell"
        spaceId="spc_1"
        initialJson={EMPTY_HIP_BOARD_SCENE_JSON}
      />,
    )
    expect(() => {
      act(() => {
        ref.current?.flushToStore({ mode: 'snapshot' })
      })
    }).not.toThrow()
  })

  it('renders arrow with polygon head', () => {
    const scene: HipBoardSceneDisk = {
      type: 'hip-board',
      version: 1,
      source: 'hip',
      hip: { schemaVersion: 1 },
      elements: [
        {
          id: 'a1',
          type: 'arrow',
          x: 0,
          y: 0,
          x2: 40,
          y2: 0,
          stroke: '#111',
          strokeWidth: 2,
        },
      ],
      appState: { viewBackgroundColor: '#fff' },
      files: {},
    }
    render(
      <HipBoardCanvas
        boardId="brd_hip_shell"
        spaceId="spc_1"
        initialJson={serializeHipBoard(scene)}
      />,
    )
    const g = document.querySelector('[data-element-id="a1"][data-element-type="arrow"]')
    expect(g).toBeTruthy()
    expect(g?.querySelector('polygon')).toBeTruthy()
  })
})

describe('HipBoardCanvas tools + text (PR-2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('toolbar has role=toolbar and aria-pressed on active tool', () => {
    const { ref } = renderCanvas()
    const toolbar = screen.getByTestId('hip-board-toolbar')
    expect(toolbar.getAttribute('role')).toBe('toolbar')
    const selectBtn = screen.getByTestId('hip-board-tool-select')
    expect(selectBtn.getAttribute('aria-pressed')).toBe('true')
    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-rect'))
    })
    expect(ref.current?.getTool()).toBe('rect')
    expect(screen.getByTestId('hip-board-tool-rect').getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(selectBtn.getAttribute('aria-pressed')).toBe('false')
  })

  it('keyboard R/O/L/A/T/V switches tools when canvas focused', () => {
    const { ref, root } = renderCanvas()
    act(() => {
      root.focus()
      fireEvent.keyDown(root, { key: 'r' })
    })
    expect(ref.current?.getTool()).toBe('rect')
    act(() => {
      fireEvent.keyDown(root, { key: 'o' })
    })
    expect(ref.current?.getTool()).toBe('ellipse')
    act(() => {
      fireEvent.keyDown(root, { key: 'l' })
    })
    expect(ref.current?.getTool()).toBe('line')
    act(() => {
      fireEvent.keyDown(root, { key: 'a' })
    })
    expect(ref.current?.getTool()).toBe('arrow')
    act(() => {
      fireEvent.keyDown(root, { key: 't' })
    })
    expect(ref.current?.getTool()).toBe('text')
    act(() => {
      fireEvent.keyDown(root, { key: 'v' })
    })
    expect(ref.current?.getTool()).toBe('select')
  })

  it('drag with rect tool creates rect and throttles draft with hip-board serialize', () => {
    const { ref, onDraftBody, root } = renderCanvas()
    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-rect'))
    })
    expect(ref.current?.getTool()).toBe('rect')

    // happy-dom: getBoundingClientRect is 0-size by default; stub for world coords.
    const rootEl = root as HTMLElement
    vi.spyOn(rootEl, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 10, clientY: 20, pointerId: 5 })
      fireEvent.pointerMove(root, { button: 0, clientX: 90, clientY: 80, pointerId: 5 })
      fireEvent.pointerUp(root, { button: 0, clientX: 90, clientY: 80, pointerId: 5 })
    })

    const rects = document.querySelectorAll('[data-element-type="rect"]')
    expect(rects.length).toBeGreaterThanOrEqual(1)
    const created = Array.from(rects).find((n) => n.getAttribute('data-element-id') !== 'r1')
    expect(created).toBeTruthy()
    expect(Number(created!.getAttribute('width'))).toBeCloseTo(80)
    expect(Number(created!.getAttribute('height'))).toBeCloseTo(60)

    // Draft is throttled — not immediate.
    expect(onDraftBody).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(onDraftBody).toHaveBeenCalled()
    const [raw, opts] = onDraftBody.mock.calls[0]!
    expect(opts).toEqual({ docId: 'brd_hip_shell', persist: 'auto' })
    const parsed = JSON.parse(raw as string)
    expect(parsed.type).toBe('hip-board')
    expect(parsed.elements).toHaveLength(1)
    expect(parsed.elements[0].type).toBe('rect')
    expect(parsed.elements[0].w).toBeCloseTo(80)
    expect(parsed.elements[0].h).toBeCloseTo(60)
    // Camera fields must not appear in draft appState
    expect(parsed.appState.zoom).toBeUndefined()
    expect(parsed.appState.scrollX).toBeUndefined()
  })

  it('drag with ellipse / line / arrow tools create matching elements', () => {
    const { root } = renderCanvas()
    const rootEl = root as HTMLElement
    vi.spyOn(rootEl, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const drag = (toolTestId: string) => {
      act(() => {
        fireEvent.click(screen.getByTestId(toolTestId))
        fireEvent.pointerDown(root, { button: 0, clientX: 0, clientY: 0, pointerId: 7 })
        fireEvent.pointerMove(root, { button: 0, clientX: 40, clientY: 30, pointerId: 7 })
        fireEvent.pointerUp(root, { button: 0, clientX: 40, clientY: 30, pointerId: 7 })
      })
    }

    drag('hip-board-tool-ellipse')
    expect(document.querySelector('[data-element-type="ellipse"]')).toBeTruthy()

    drag('hip-board-tool-line')
    expect(document.querySelector('[data-element-type="line"]')).toBeTruthy()

    drag('hip-board-tool-arrow')
    expect(document.querySelector('[data-element-type="arrow"]')).toBeTruthy()
  })

  it('text tool click places text and opens textarea with white-space pre', () => {
    const { root } = renderCanvas()
    const rootEl = root as HTMLElement
    vi.spyOn(rootEl, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-text'))
      fireEvent.pointerDown(root, { button: 0, clientX: 50, clientY: 50, pointerId: 3 })
      fireEvent.pointerUp(root, { button: 0, clientX: 50, clientY: 50, pointerId: 3 })
    })

    const ta = screen.getByTestId('hip-board-text-edit') as HTMLTextAreaElement
    expect(ta).toBeTruthy()
    expect(ta.style.whiteSpace).toBe('pre')
  })

  it('text edit blur commits newlines and height from line count', () => {
    const { ref, onDraftBody } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_TEXT),
    })
    const root = screen.getByTestId('knowledge-board-canvas')
    const rootEl = root as HTMLElement
    vi.spyOn(rootEl, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    // Double-click near text origin to edit.
    act(() => {
      fireEvent.doubleClick(root, { clientX: 5, clientY: 5 })
    })
    const ta = screen.getByTestId('hip-board-text-edit') as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'line1\nline2' } })
      fireEvent.blur(ta)
    })

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(onDraftBody).toHaveBeenCalled()
    const raw = onDraftBody.mock.calls[onDraftBody.mock.calls.length - 1]![0] as string
    const parsed = JSON.parse(raw)
    const textEl = parsed.elements.find((e: { id: string }) => e.id === 't1')
    expect(textEl.text).toBe('line1\nline2')
    // h = padding*2 + 2 * (16*1.25) = 8 + 40 = 48
    expect(textEl.h).toBe(48)

    // updateText handle also works
    act(() => {
      ref.current?.updateText('t1', 'x')
      vi.advanceTimersByTime(150)
    })
    const raw2 = onDraftBody.mock.calls[onDraftBody.mock.calls.length - 1]![0] as string
    expect(JSON.parse(raw2).elements[0].text).toBe('x')
  })

  it('Escape cancels text edit without committing draft text', () => {
    const { ref, onDraftBody } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_TEXT),
    })
    const root = screen.getByTestId('knowledge-board-canvas')
    vi.spyOn(root as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    act(() => {
      fireEvent.doubleClick(root, { clientX: 5, clientY: 5 })
    })
    const ta = screen.getByTestId('hip-board-text-edit') as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'CHANGED' } })
      fireEvent.keyDown(ta, { key: 'Escape' })
    })
    expect(screen.queryByTestId('hip-board-text-edit')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(150)
    })
    // Cancel keeps original; serialize unchanged → no auto draft required.
    // flush confirms elements still "hello".
    onDraftBody.mockClear()
    act(() => {
      ref.current?.flushToStore({ mode: 'snapshot' })
    })
    const raw = onDraftBody.mock.calls[0]![0] as string
    expect(JSON.parse(raw).elements[0].text).toBe('hello')
    const textNode = document.querySelector('[data-element-id="t1"]')
    expect(textNode?.textContent).toContain('hello')
    expect(textNode?.textContent).not.toContain('CHANGED')
  })

  it('Escape returns shape tool to select; second Escape clears selection', () => {
    const { ref, root } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
    vi.spyOn(root as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-rect'))
    })
    expect(ref.current?.getTool()).toBe('rect')
    act(() => {
      root.focus()
      fireEvent.keyDown(root, { key: 'Escape' })
    })
    expect(ref.current?.getTool()).toBe('select')

    // Select element then Escape clears
    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 20, clientY: 30, pointerId: 9 })
      fireEvent.pointerUp(root, { button: 0, clientX: 20, clientY: 30, pointerId: 9 })
    })
    expect(ref.current?.getSelectedIds()).toContain('r1')
    act(() => {
      fireEvent.keyDown(root, { key: 'Escape' })
    })
    expect(ref.current?.getSelectedIds()).toEqual([])
  })

  it('camera pan does not schedule draft after shape create', () => {
    const { onDraftBody, root } = renderCanvas()
    vi.spyOn(root as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-rect'))
      fireEvent.pointerDown(root, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 50, clientY: 50, pointerId: 1 })
    })
    act(() => {
      vi.advanceTimersByTime(150)
    })
    const callsAfterCreate = onDraftBody.mock.calls.length
    expect(callsAfterCreate).toBeGreaterThanOrEqual(1)

    act(() => {
      fireEvent.pointerDown(root, { button: 1, clientX: 0, clientY: 0, pointerId: 2 })
      fireEvent.pointerMove(root, { button: 1, clientX: 40, clientY: 40, pointerId: 2 })
      fireEvent.pointerUp(root, { button: 1, clientX: 40, clientY: 40, pointerId: 2 })
      vi.advanceTimersByTime(150)
    })
    expect(onDraftBody.mock.calls.length).toBe(callsAfterCreate)
  })

  it('tiny drag discards shape without draft', () => {
    const { onDraftBody, root } = renderCanvas()
    vi.spyOn(root as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-rect'))
      fireEvent.pointerDown(root, { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 0, clientX: 10.5, clientY: 10.5, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 10.5, clientY: 10.5, pointerId: 1 })
      vi.advanceTimersByTime(150)
    })
    expect(document.querySelector('[data-element-type="rect"]')).toBeNull()
    expect(onDraftBody).not.toHaveBeenCalled()
  })

  it('toolbar pointerDown does not place text or create shapes on the canvas', () => {
    const { ref, root } = renderCanvas()
    vi.spyOn(root as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-text'))
    })
    expect(ref.current?.getTool()).toBe('text')

    // Pointer on toolbar must not bubble into canvas placeTextAt / create-drag.
    const textBtn = screen.getByTestId('hip-board-tool-rect')
    act(() => {
      fireEvent.pointerDown(textBtn, { button: 0, clientX: 200, clientY: 10, pointerId: 11 })
      fireEvent.pointerUp(textBtn, { button: 0, clientX: 200, clientY: 10, pointerId: 11 })
      fireEvent.click(textBtn)
    })
    expect(ref.current?.getTool()).toBe('rect')
    expect(document.querySelector('[data-element-type="text"]')).toBeNull()
    expect(document.querySelector('[data-element-type="rect"]')).toBeNull()
    expect(screen.queryByTestId('hip-board-text-edit')).toBeNull()
  })

  it('Escape drops brand-new text placement and clears selection', () => {
    const { ref, onDraftBody, root } = renderCanvas()
    vi.spyOn(root as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-text'))
      fireEvent.pointerDown(root, { button: 0, clientX: 40, clientY: 40, pointerId: 3 })
      fireEvent.pointerUp(root, { button: 0, clientX: 40, clientY: 40, pointerId: 3 })
    })
    const ta = screen.getByTestId('hip-board-text-edit') as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'scratch' } })
      fireEvent.keyDown(ta, { key: 'Escape' })
    })
    expect(screen.queryByTestId('hip-board-text-edit')).toBeNull()
    expect(document.querySelector('[data-element-type="text"]')).toBeNull()
    expect(ref.current?.getSelectedIds()).toEqual([])

    act(() => {
      vi.advanceTimersByTime(150)
    })
    // Place scheduled a draft then cancel removed the element — net flush is empty or last draft empty.
    onDraftBody.mockClear()
    act(() => {
      ref.current?.flushToStore({ mode: 'snapshot' })
    })
    expect(JSON.parse(onDraftBody.mock.calls[0]![0] as string).elements).toHaveLength(0)
  })

  it('Escape does not delete pre-existing empty text', () => {
    const scene: HipBoardSceneDisk = {
      type: 'hip-board',
      version: 1,
      source: 'hip',
      hip: { schemaVersion: 1 },
      elements: [
        {
          id: 'empty_txt',
          type: 'text',
          x: 0,
          y: 0,
          w: 160,
          h: 28,
          text: '',
          fill: '#111111',
          fontSize: 16,
        },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    }
    const { ref, onDraftBody, root } = renderCanvas({
      initialJson: serializeHipBoard(scene),
    })
    vi.spyOn(root as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    act(() => {
      fireEvent.doubleClick(root, { clientX: 5, clientY: 5 })
    })
    const ta = screen.getByTestId('hip-board-text-edit') as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'typed' } })
      fireEvent.keyDown(ta, { key: 'Escape' })
    })
    expect(screen.queryByTestId('hip-board-text-edit')).toBeNull()
    // Element must remain (empty original restored).
    expect(document.querySelector('[data-element-id="empty_txt"]')).toBeTruthy()
    expect(ref.current?.getSelectedIds()).toContain('empty_txt')

    onDraftBody.mockClear()
    act(() => {
      ref.current?.flushToStore({ mode: 'snapshot' })
    })
    const el = JSON.parse(onDraftBody.mock.calls[0]![0] as string).elements[0]
    expect(el.id).toBe('empty_txt')
    expect(el.text).toBe('')
  })

  it('flushToStore snapshot includes in-progress textarea text', () => {
    const { ref, onDraftBody, root } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_TEXT),
    })
    vi.spyOn(root as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    act(() => {
      fireEvent.doubleClick(root, { clientX: 5, clientY: 5 })
    })
    const ta = screen.getByTestId('hip-board-text-edit') as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'mid-edit\nbody' } })
    })
    // Editor stays open; snapshot must capture live draft.
    expect(screen.getByTestId('hip-board-text-edit')).toBeTruthy()
    onDraftBody.mockClear()
    act(() => {
      ref.current?.flushToStore({ mode: 'snapshot' })
    })
    expect(onDraftBody).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(onDraftBody.mock.calls[0]![0] as string)
    expect(parsed.elements[0].text).toBe('mid-edit\nbody')
    expect(parsed.elements[0].h).toBe(48)
    // Editor still mounted after soft-commit.
    expect(screen.getByTestId('hip-board-text-edit')).toBeTruthy()
  })
})
