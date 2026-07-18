// @vitest-environment happy-dom
/**
 * Visual class guardrails for document paper shell (PR1 surface + PR7 export).
 * Mode overflow stays in KnowledgeWorkspace.paper.test.tsx.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DOC_PAPER_SHELL, KnowledgeDocCanvas } from './KnowledgeDocCanvas'

afterEach(() => cleanup())

describe('KnowledgeDocCanvas', () => {
  it('locks elevated paper shell class contract (DOC_PAPER_SHELL)', () => {
    expect(DOC_PAPER_SHELL).toContain('shadow-panel')
    expect(DOC_PAPER_SHELL).toContain('rounded-xl')
    expect(DOC_PAPER_SHELL).toContain('bg-surface')
    expect(DOC_PAPER_SHELL).toContain('border-border')
    // Overflow is parent-owned; shell constant must not fight mode-specific paperClassName.
    expect(DOC_PAPER_SHELL).not.toMatch(/\boverflow-/)
  })

  it('renders outer canvas and elevated paper shell with testids', () => {
    render(
      <KnowledgeDocCanvas>
        <span>body</span>
      </KnowledgeDocCanvas>,
    )
    const canvas = screen.getByTestId('knowledge-doc-canvas')
    const paper = screen.getByTestId('knowledge-doc-paper')
    expect(canvas).toContainElement(paper)
    expect(paper).toHaveTextContent('body')
    for (const token of DOC_PAPER_SHELL.split(/\s+/).filter(Boolean)) {
      expect(paper.className).toContain(token)
    }
  })

  it('forwards className to outer and paperClassName to paper', () => {
    render(
      <KnowledgeDocCanvas className="min-h-0 flex-1" paperClassName="overflow-hidden">
        <span>x</span>
      </KnowledgeDocCanvas>,
    )
    expect(screen.getByTestId('knowledge-doc-canvas').className).toContain('min-h-0')
    expect(screen.getByTestId('knowledge-doc-paper').className).toContain('overflow-hidden')
  })
})
