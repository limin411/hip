// @vitest-environment happy-dom
/**
 * Visual class guardrails for full-page document surface (no elevated card).
 * Mode overflow stays in KnowledgeWorkspace.paper.test.tsx.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DOC_PAGE_SHELL, KnowledgeDocCanvas } from './KnowledgeDocCanvas'
import { DOC_WIDTH_MEASURE } from '@/domain/knowledge/docWidth'

const hipConfigState = {
  config: {
    version: 1 as const,
    knowledge: { docWidth: 'default' as const },
  },
}

vi.mock('@/store/hipConfigStore', () => ({
  useHipConfigStore: (sel: (s: typeof hipConfigState) => unknown) => sel(hipConfigState),
}))

afterEach(() => {
  cleanup()
  hipConfigState.config.knowledge = { docWidth: 'default' }
})

describe('KnowledgeDocCanvas', () => {
  it('locks full-page shell contract (no card chrome)', () => {
    expect(DOC_PAGE_SHELL).toContain('bg-surface-content')
    expect(DOC_PAGE_SHELL).toContain('w-full')
    expect(DOC_PAGE_SHELL).toContain('flex-1')
    // Must not reintroduce floating paper card.
    expect(DOC_PAGE_SHELL).not.toContain('rounded-xl')
    expect(DOC_PAGE_SHELL).not.toContain('shadow-panel')
    expect(DOC_PAGE_SHELL).not.toMatch(/\bborder-border\b/)
    // Overflow is parent-owned; shell constant must not fight mode-specific paperClassName.
    expect(DOC_PAGE_SHELL).not.toMatch(/\boverflow-/)
  })

  it('renders full-bleed canvas and body with testids', () => {
    render(
      <KnowledgeDocCanvas>
        <span>body</span>
      </KnowledgeDocCanvas>,
    )
    const canvas = screen.getByTestId('knowledge-doc-canvas')
    const paper = screen.getByTestId('knowledge-doc-paper')
    expect(canvas).toContainElement(paper)
    expect(paper).toHaveTextContent('body')
    expect(canvas.className).toContain('w-full')
    expect(canvas.className).toContain('flex-1')
    expect(paper.className).not.toContain('rounded-xl')
    expect(paper.className).not.toContain('shadow-panel')
  })

  it('forwards className to outer and paperClassName to body', () => {
    render(
      <KnowledgeDocCanvas className="min-h-0 flex-1" paperClassName="overflow-hidden">
        <span>x</span>
      </KnowledgeDocCanvas>,
    )
    expect(screen.getByTestId('knowledge-doc-canvas').className).toContain('min-h-0')
    expect(screen.getByTestId('knowledge-doc-paper').className).toContain('overflow-hidden')
  })

  it('keeps horizontal gutter off the paper host (scrollbar can sit on panel edge)', () => {
    render(
      <KnowledgeDocCanvas>
        <span>body</span>
      </KnowledgeDocCanvas>,
    )
    const paper = screen.getByTestId('knowledge-doc-paper')
    expect(paper.className).not.toMatch(/\bpx-8\b/)
    expect(paper.className).not.toMatch(/\bsm:px-12\b/)
    expect(paper.className).not.toMatch(/\blg:px-16\b/)
    expect(paper.className).not.toContain('knowledge-doc-inline-pad')
  })

  it('applies default doc width measure on the paper host', () => {
    render(
      <KnowledgeDocCanvas>
        <span>body</span>
      </KnowledgeDocCanvas>,
    )
    const paper = screen.getByTestId('knowledge-doc-paper')
    expect(paper).toHaveAttribute('data-doc-width', 'default')
    expect(paper.style.getPropertyValue('--kb-measure')).toBe(DOC_WIDTH_MEASURE.default)
  })

  it('applies wide and full doc width measures from config', () => {
    hipConfigState.config.knowledge = { docWidth: 'wide' }
    const { rerender } = render(
      <KnowledgeDocCanvas>
        <span>body</span>
      </KnowledgeDocCanvas>,
    )
    let paper = screen.getByTestId('knowledge-doc-paper')
    expect(paper).toHaveAttribute('data-doc-width', 'wide')
    expect(paper.style.getPropertyValue('--kb-measure')).toBe(DOC_WIDTH_MEASURE.wide)

    hipConfigState.config.knowledge = { docWidth: 'full' }
    rerender(
      <KnowledgeDocCanvas>
        <span>body</span>
      </KnowledgeDocCanvas>,
    )
    paper = screen.getByTestId('knowledge-doc-paper')
    expect(paper).toHaveAttribute('data-doc-width', 'full')
    expect(paper.style.getPropertyValue('--kb-measure')).toBe(DOC_WIDTH_MEASURE.full)
  })
})
