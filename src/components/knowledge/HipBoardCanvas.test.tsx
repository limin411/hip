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
import { useKnowledgeStore } from '@/store/knowledgeStore'

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

  it('resumeEditing re-enables input after leave freeze', () => {
    const ref = createRef<HipBoardCanvasHandle>()
    const onDraft = vi.fn()
    render(
      <HipBoardCanvas
        ref={ref}
        boardId="brd_resume00001"
        spaceId="spc_1"
        initialJson={EMPTY_HIP_BOARD_SCENE_JSON}
        onDraftBody={onDraft}
      />,
    )
    expect(ref.current?.isReady()).toBe(true)
    act(() => {
      ref.current?.flushToStore({ mode: 'leave' })
    })
    expect(ref.current?.isReady()).toBe(false)
    act(() => {
      ref.current?.resumeEditing()
    })
    expect(ref.current?.isReady()).toBe(true)
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

const SCENE_TWO_RECTS: HipBoardSceneDisk = {
  type: 'hip-board',
  version: 1,
  source: 'hip',
  hip: { schemaVersion: 1 },
  elements: [
    {
      id: 'r1',
      type: 'rect',
      x: 10,
      y: 10,
      w: 40,
      h: 40,
      fill: '#fff',
      stroke: '#111',
      strokeWidth: 2,
      cornerRadius: 0,
    },
    {
      id: 'r2',
      type: 'rect',
      x: 100,
      y: 100,
      w: 40,
      h: 40,
      fill: '#fff',
      stroke: '#111',
      strokeWidth: 2,
      cornerRadius: 0,
    },
  ],
  appState: { viewBackgroundColor: '#fff' },
  files: {},
}

const SCENE_WITH_LOCKED: HipBoardSceneDisk = {
  type: 'hip-board',
  version: 1,
  source: 'hip',
  hip: { schemaVersion: 1 },
  elements: [
    {
      id: 'free',
      type: 'rect',
      x: 0,
      y: 0,
      w: 50,
      h: 50,
      fill: '#fff',
      stroke: '#111',
      strokeWidth: 2,
      cornerRadius: 0,
    },
    {
      id: 'locked',
      type: 'rect',
      x: 80,
      y: 0,
      w: 50,
      h: 50,
      fill: '#fff',
      stroke: '#111',
      strokeWidth: 2,
      cornerRadius: 0,
      locked: true,
    },
  ],
  appState: { viewBackgroundColor: '#fff' },
  files: {},
}

const SCENE_WITH_IMAGE_FILES: HipBoardSceneDisk = {
  type: 'hip-board',
  version: 1,
  source: 'hip',
  hip: { schemaVersion: 1, boardId: 'brd_img' },
  elements: [
    {
      id: 'img1',
      type: 'image',
      x: 0,
      y: 0,
      w: 80,
      h: 60,
      fileId: 'file_a',
    },
    {
      id: 'r1',
      type: 'rect',
      x: 100,
      y: 0,
      w: 40,
      h: 40,
      fill: '#fff',
      stroke: '#111',
      strokeWidth: 2,
      cornerRadius: 0,
    },
  ],
  appState: { viewBackgroundColor: '#fff' },
  files: {
    file_a: {
      id: 'file_a',
      mimeType: 'image/png',
      created: 1,
      hipAssetRel: 'assets/boards/brd_img/file_a.png',
    },
  },
}

function stubRect(root: HTMLElement) {
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
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
}

describe('HipBoardCanvas selection / transform / undo (PR-3)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('marquee multi-selects intersecting rects (normalized AABB)', () => {
    const { ref, root } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_TWO_RECTS),
    })
    stubRect(root as HTMLElement)

    // Drag marquee covering both (including inverted direction).
    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 200, clientY: 200, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
    })
    const ids = ref.current!.getSelectedIds().slice().sort()
    expect(ids).toEqual(['r1', 'r2'])
  })

  it('move selected element by drag and schedules draft once', () => {
    const { ref, onDraftBody, root } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
    stubRect(root as HTMLElement)

    act(() => {
      // Select + start move on r1 (x=10..90, y=20..60)
      fireEvent.pointerDown(root, { button: 0, clientX: 30, clientY: 40, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 0, clientX: 50, clientY: 55, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 50, clientY: 55, pointerId: 1 })
    })
    const el = ref.current!.getElements().find((e) => e.id === 'r1')!
    expect(el).toMatchObject({ x: 30, y: 35 })

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(onDraftBody).toHaveBeenCalled()
    const parsed = JSON.parse(onDraftBody.mock.calls[0]![0] as string)
    expect(parsed.elements[0].x).toBeCloseTo(30)
  })

  it('resize box via se handle', () => {
    const { ref, root } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
    stubRect(root as HTMLElement)

    // Select first
    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 30, clientY: 40, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 30, clientY: 40, pointerId: 1 })
    })
    expect(ref.current!.getSelectedIds()).toEqual(['r1'])
    expect(screen.getByTestId('hip-board-handle-se')).toBeTruthy()

    // Drag SE handle from (90,60) toward (120,90)
    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 90, clientY: 60, pointerId: 2 })
      fireEvent.pointerMove(root, { button: 0, clientX: 120, clientY: 90, pointerId: 2 })
      fireEvent.pointerUp(root, { button: 0, clientX: 120, clientY: 90, pointerId: 2 })
    })
    const el = ref.current!.getElements().find((e) => e.id === 'r1')!
    expect(el).toMatchObject({ x: 10, y: 20, w: 110, h: 70 })
  })

  it('Delete key removes unlocked selection and skips locked', () => {
    const { ref, root } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_LOCKED),
    })
    stubRect(root as HTMLElement)

    // Select free
    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 25, clientY: 25, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 25, clientY: 25, pointerId: 1 })
      root.focus()
      fireEvent.keyDown(root, { key: 'Delete' })
    })
    expect(ref.current!.getElements().map((e) => e.id)).toEqual(['locked'])

    // Select locked and try delete — stays
    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 100, clientY: 25, pointerId: 2 })
      fireEvent.pointerUp(root, { button: 0, clientX: 100, clientY: 25, pointerId: 2 })
      fireEvent.keyDown(root, { key: 'Backspace' })
    })
    expect(ref.current!.getElements().map((e) => e.id)).toEqual(['locked'])
    expect(ref.current!.getSelectedIds()).toEqual(['locked'])
  })

  it('locked element rejects move and style patch', () => {
    const { ref, root } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_LOCKED),
    })
    stubRect(root as HTMLElement)

    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 100, clientY: 25, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 0, clientX: 140, clientY: 40, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 140, clientY: 40, pointerId: 1 })
    })
    const locked = ref.current!.getElements().find((e) => e.id === 'locked')!
    expect(locked).toMatchObject({ x: 80, y: 0 })
    expect(ref.current!.getHistoryPastLength()).toBe(0)

    act(() => {
      ref.current!.applyStylePatch(['locked'], { fill: '#ff0000' })
    })
    expect(
      (ref.current!.getElements().find((e) => e.id === 'locked') as { fill: string }).fill,
    ).toBe('#fff')
  })

  it('undo restores elements and filesRel; redo reapplies', () => {
    const { ref, onDraftBody, root } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_IMAGE_FILES),
      boardId: 'brd_img',
    })
    stubRect(root as HTMLElement)

    expect(ref.current!.getFilesRel()).toEqual({
      file_a: 'assets/boards/brd_img/file_a.png',
    })
    expect(ref.current!.getElements()).toHaveLength(2)

    // Delete the image (and its presence); filesRel stays until undo/redo policy —
    // delete only removes elements; filesRel map is kept (orphan ok). Then delete rect.
    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 40, clientY: 30, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 40, clientY: 30, pointerId: 1 })
      root.focus()
      fireEvent.keyDown(root, { key: 'Delete' })
    })
    expect(ref.current!.getElements().map((e) => e.id)).toEqual(['r1'])
    expect(ref.current!.getHistoryPastLength()).toBe(1)
    // filesRel still present (delete does not purge files)
    expect(ref.current!.getFilesRel().file_a).toBe('assets/boards/brd_img/file_a.png')

    // Simulate a history entry that also mutates filesRel via applyStylePatch-style:
    // Use undo to restore image element + filesRel, then mutate filesRel out and undo.
    act(() => {
      ref.current!.undo()
      vi.advanceTimersByTime(150)
    })
    expect(ref.current!.getElements().map((e) => e.id).sort()).toEqual(['img1', 'r1'])
    expect(ref.current!.getFilesRel()).toEqual({
      file_a: 'assets/boards/brd_img/file_a.png',
    })

    // Delete again, then manually verify redo
    act(() => {
      fireEvent.pointerDown(root, { button: 0, clientX: 40, clientY: 30, pointerId: 2 })
      fireEvent.pointerUp(root, { button: 0, clientX: 40, clientY: 30, pointerId: 2 })
      fireEvent.keyDown(root, { key: 'Delete' })
      ref.current!.redo()
      vi.advanceTimersByTime(150)
    })
    // After delete then redo of delete-state... wait: delete pushes before;
    // redo after delete with empty future until undo. Sequence above:
    // delete → undo (restored) → delete → redo should re-delete.
    // Actually after second delete, future is cleared. redo is no-op.
    // Fix: undo after second delete then redo.
    act(() => {
      ref.current!.undo()
    })
    expect(ref.current!.getElements().some((e) => e.id === 'img1')).toBe(true)
    act(() => {
      ref.current!.redo()
    })
    expect(ref.current!.getElements().map((e) => e.id)).toEqual(['r1'])

    // Keyboard undo
    act(() => {
      fireEvent.keyDown(root, { key: 'z', metaKey: true })
    })
    expect(ref.current!.getElements().some((e) => e.id === 'img1')).toBe(true)

    // filesRel must survive undo of element delete
    expect(ref.current!.getFilesRel().file_a).toBeDefined()

    // Draft was scheduled by undo/redo
    expect(onDraftBody.mock.calls.length).toBeGreaterThan(0)
  })

  it('undo restores filesRel when history entry had different map', () => {
    // Seed scene with filesRel; delete image element; history "before" has both.
    // Then force a new commit that clears filesRel by re-applying via internal path:
    // create a rect (pushes history with filesRel), then verify undo of create keeps filesRel.
    const { ref, root } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_IMAGE_FILES),
      boardId: 'brd_img',
    })
    stubRect(root as HTMLElement)

    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-rect'))
      fireEvent.pointerDown(root, { button: 0, clientX: 200, clientY: 200, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 0, clientX: 250, clientY: 240, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 250, clientY: 240, pointerId: 1 })
    })
    expect(ref.current!.getElements().length).toBe(3)
    expect(ref.current!.getFilesRel().file_a).toBe('assets/boards/brd_img/file_a.png')

    act(() => {
      ref.current!.undo()
    })
    expect(ref.current!.getElements().length).toBe(2)
    expect(ref.current!.getFilesRel()).toEqual({
      file_a: 'assets/boards/brd_img/file_a.png',
    })
  })

  it('camera-only pan/zoom never calls onDraftBody (0 draft calls)', () => {
    const { onDraftBody, root } = renderCanvas({
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
    stubRect(root as HTMLElement)

    act(() => {
      // pan
      fireEvent.pointerDown(root, { button: 1, clientX: 0, clientY: 0, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 1, clientX: 40, clientY: 30, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 1, clientX: 40, clientY: 30, pointerId: 1 })
      // zoom
      fireEvent.wheel(root, { deltaY: -120, clientX: 50, clientY: 50 })
      fireEvent.wheel(root, { deltaY: 80, clientX: 50, clientY: 50 })
      // selection-only click
      fireEvent.pointerDown(root, { button: 0, clientX: 30, clientY: 40, pointerId: 2 })
      fireEvent.pointerUp(root, { button: 0, clientX: 30, clientY: 40, pointerId: 2 })
      vi.advanceTimersByTime(500)
    })
    expect(onDraftBody).not.toHaveBeenCalled()
  })

  it('Cmd+Shift+Z / Ctrl+Y redo after undo of create', () => {
    const { ref, root } = renderCanvas()
    stubRect(root as HTMLElement)

    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-rect'))
      fireEvent.pointerDown(root, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 0, clientX: 40, clientY: 30, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 40, clientY: 30, pointerId: 1 })
    })
    expect(ref.current!.getElements()).toHaveLength(1)

    act(() => {
      root.focus()
      fireEvent.keyDown(root, { key: 'z', ctrlKey: true })
    })
    expect(ref.current!.getElements()).toHaveLength(0)

    act(() => {
      fireEvent.keyDown(root, { key: 'z', ctrlKey: true, shiftKey: true })
    })
    expect(ref.current!.getElements()).toHaveLength(1)

    act(() => {
      fireEvent.keyDown(root, { key: 'z', ctrlKey: true })
      fireEvent.keyDown(root, { key: 'y', ctrlKey: true })
    })
    expect(ref.current!.getElements()).toHaveLength(1)
  })

  it('leave discards undo history', () => {
    const { ref, root } = renderCanvas()
    stubRect(root as HTMLElement)

    act(() => {
      fireEvent.click(screen.getByTestId('hip-board-tool-rect'))
      fireEvent.pointerDown(root, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
      fireEvent.pointerMove(root, { button: 0, clientX: 40, clientY: 30, pointerId: 1 })
      fireEvent.pointerUp(root, { button: 0, clientX: 40, clientY: 30, pointerId: 1 })
    })
    expect(ref.current!.getHistoryPastLength()).toBe(1)

    act(() => {
      ref.current!.flushToStore({ mode: 'leave' })
    })
    expect(ref.current!.getHistoryPastLength()).toBe(0)
    act(() => {
      ref.current!.undo()
    })
    // Frozen after leave; elements stay
    expect(ref.current!.getElements()).toHaveLength(1)
  })
})

describe('HipBoardCanvas companion rail publish (PR-4)', () => {
  beforeEach(() => {
    useKnowledgeStore.setState({
      activeDocId: 'brd_hip_shell',
      boardOutline: null,
      boardSelection: null,
      pendingBoardFocus: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('publishes empty selection + outline on mount when activeDocId matches', async () => {
    renderCanvas({
      boardId: 'brd_hip_shell',
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })
    // Immediate outline seed (sync layout)
    expect(useKnowledgeStore.getState().boardOutline?.boardId).toBe('brd_hip_shell')
    expect(useKnowledgeStore.getState().boardOutline?.totalElements).toBe(1)
    expect(useKnowledgeStore.getState().boardSelection?.ids).toEqual([])
  })

  it('selection publish no-ops when signature unchanged (pan does not thrash)', async () => {
    const { ref, root } = renderCanvas({
      boardId: 'brd_hip_shell',
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })

    act(() => {
      ref.current!.selectAndScrollTo(['r1'], { scroll: false })
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })
    const afterSelect = useKnowledgeStore.getState().boardSelection
    expect(afterSelect?.ids).toEqual(['r1'])

    // Second select same ids — store equality no-op; lastSel sig short-circuits rAF set
    const setSpy = vi.spyOn(useKnowledgeStore.getState(), 'setBoardSelection')
    act(() => {
      ref.current!.selectAndScrollTo(['r1'], { scroll: false })
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })
    // rAF may call setBoardSelection but store equality keeps same reference
    expect(useKnowledgeStore.getState().boardSelection).toBe(afterSelect)

    // Pan/zoom must not change selection store
    act(() => {
      fireEvent.pointerDown(root, { button: 1, clientX: 10, clientY: 10, pointerId: 9 })
      fireEvent.pointerMove(root, { button: 1, clientX: 40, clientY: 50, pointerId: 9 })
      fireEvent.pointerUp(root, { button: 1, clientX: 40, clientY: 50, pointerId: 9 })
    })
    expect(useKnowledgeStore.getState().boardSelection).toBe(afterSelect)
    setSpy.mockRestore()
  })

  it('leave cancels companion publish so delayed rAF does not write store', async () => {
    const { ref } = renderCanvas({
      boardId: 'brd_hip_shell',
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })

    useKnowledgeStore.getState().clearBoardPanelState()
    act(() => {
      ref.current!.selectAndScrollTo(['r1'], { scroll: false })
      // Freeze before rAF runs
      ref.current!.flushToStore({ mode: 'leave' })
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })
    // Leave cancelled selRaf; selection must stay cleared
    expect(useKnowledgeStore.getState().boardSelection).toBeNull()
  })

  it('pendingBoardFocus selects when ready', async () => {
    const { ref } = renderCanvas({
      boardId: 'brd_hip_shell',
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })

    act(() => {
      useKnowledgeStore.getState().requestBoardFocus(['r1'], { scroll: false })
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })
    expect(ref.current!.getSelectedIds()).toEqual(['r1'])
    expect(useKnowledgeStore.getState().pendingBoardFocus).toBeNull()
  })

  it('pendingBoardFocus holds while frozen; resumeEditing re-consumes (LKD-25)', async () => {
    const { ref } = renderCanvas({
      boardId: 'brd_hip_shell',
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    })

    act(() => {
      ref.current!.flushToStore({ mode: 'leave' })
    })
    expect(ref.current!.isReady()).toBe(false)

    act(() => {
      useKnowledgeStore.getState().requestBoardFocus(['r1'], { scroll: false })
    })
    // Still frozen — pending held
    expect(useKnowledgeStore.getState().pendingBoardFocus?.ids).toEqual(['r1'])
    expect(ref.current!.getSelectedIds()).toEqual([])

    act(() => {
      ref.current!.resumeEditing()
    })
    expect(ref.current!.isReady()).toBe(true)
    expect(ref.current!.getSelectedIds()).toEqual(['r1'])
    expect(useKnowledgeStore.getState().pendingBoardFocus).toBeNull()
  })

  it('applyStylePatch no-ops when activeDocId !== boardId', async () => {
    const { ref } = renderCanvas({
      boardId: 'brd_hip_shell',
      initialJson: serializeHipBoard(SCENE_WITH_RECT),
    })
    useKnowledgeStore.setState({ activeDocId: 'brd_other' })
    act(() => {
      ref.current!.applyStylePatch(['r1'], { fill: '#ff0000' })
    })
    const el = ref.current!.getElements().find((e) => e.id === 'r1')
    expect(el && el.type === 'rect' ? el.fill : null).toBe('#ffffff')
  })
})
