// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { KnowledgeDocCanvas } from './KnowledgeDocCanvas'

afterEach(() => cleanup())

describe('KnowledgeDocCanvas', () => {
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
    expect(paper.className).toContain('shadow-panel')
    expect(paper.className).toContain('rounded-xl')
    expect(paper.className).toContain('bg-surface')
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
