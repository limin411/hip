// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Button } from './Button'

afterEach(() => {
  cleanup()
})

describe('Button variants', () => {
  // Non-goal (KD2): primary stays soft monochrome inverse — never sage accent fill.
  it('primary is soft solid inverse monochrome, not sage or elevated outline', () => {
    const { getByRole } = render(<Button variant="primary">Save</Button>)
    const cls = getByRole('button', { name: 'Save' }).className
    expect(cls).toMatch(/bg-btn-primary/)
    expect(cls).toMatch(/text-on-btn-primary/)
    // Guard against sage accent as primary fill/hover/text
    expect(cls).not.toMatch(/\bbg-accent\b/)
    expect(cls).not.toMatch(/hover:bg-accent/)
    expect(cls).not.toMatch(/text-on-accent/)
    expect(cls).not.toMatch(/border-ink/)
  })

  it('default variant matches primary solid inverse', () => {
    const { getByRole } = render(<Button>Default</Button>)
    const cls = getByRole('button', { name: 'Default' }).className
    expect(cls).toMatch(/bg-btn-primary/)
    expect(cls).toMatch(/text-on-btn-primary/)
    expect(cls).not.toMatch(/\bbg-accent\b/)
    expect(cls).not.toMatch(/hover:bg-accent/)
  })

  it('secondary uses soft fill without heavy stroke', () => {
    const { getByRole } = render(<Button variant="secondary">Cancel</Button>)
    const cls = getByRole('button', { name: 'Cancel' }).className
    expect(cls).toMatch(/bg-surface-subtle/)
    expect(cls).not.toMatch(/\bbg-accent\b/)
  })

  it('ghost is quiet chrome', () => {
    const { getByRole } = render(<Button variant="ghost">More</Button>)
    const cls = getByRole('button', { name: 'More' }).className
    expect(cls).toMatch(/text-ink-secondary/)
    expect(cls).not.toMatch(/\bbg-ink\b/)
  })

  it('danger keeps filled semantic', () => {
    const { getByRole } = render(<Button variant="danger">Delete</Button>)
    const cls = getByRole('button', { name: 'Delete' }).className
    expect(cls).toMatch(/bg-danger/)
    expect(cls).toMatch(/text-on-accent/)
  })

  it('dangerSoft is outline/text danger, not solid fill', () => {
    const { getByRole } = render(<Button variant="dangerSoft">Remove</Button>)
    const cls = getByRole('button', { name: 'Remove' }).className
    expect(cls).toMatch(/text-danger/)
    // solid paint would be `bg-danger` without opacity suffix; hover:bg-danger/10 is fine
    expect(cls).not.toMatch(/(?<![\w/-])bg-danger(?![/\w])/)
    expect(cls).not.toMatch(/\bbg-danger\s/)
    expect(cls.split(/\s+/)).not.toContain('bg-danger')
  })
})
