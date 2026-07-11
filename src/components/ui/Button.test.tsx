// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Button } from './Button'

afterEach(() => {
  cleanup()
})

describe('Button variants', () => {
  it('primary is neutral elevated, not sage fill', () => {
    const { getByRole } = render(<Button variant="primary">Save</Button>)
    const cls = getByRole('button', { name: 'Save' }).className
    expect(cls).toMatch(/border-ink/)
    expect(cls).toMatch(/bg-surface/)
    expect(cls).not.toMatch(/\bbg-accent\b/)
    expect(cls).not.toMatch(/text-on-accent/)
  })

  it('default variant matches primary neutrality', () => {
    const { getByRole } = render(<Button>Default</Button>)
    const cls = getByRole('button', { name: 'Default' }).className
    expect(cls).not.toMatch(/\bbg-accent\b/)
    expect(cls).toMatch(/border-ink/)
  })

  it('secondary uses soft gray fill without accent paint', () => {
    const { getByRole } = render(<Button variant="secondary">Cancel</Button>)
    const cls = getByRole('button', { name: 'Cancel' }).className
    expect(cls).toMatch(/bg-surface-subtle/)
    expect(cls).not.toMatch(/\bbg-accent\b/)
  })

  it('danger keeps filled semantic', () => {
    const { getByRole } = render(<Button variant="danger">Delete</Button>)
    const cls = getByRole('button', { name: 'Delete' }).className
    expect(cls).toMatch(/bg-danger/)
    expect(cls).toMatch(/text-on-accent/)
  })
})
