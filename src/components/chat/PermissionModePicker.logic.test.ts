import { describe, it, expect } from 'vitest'
import { PERMISSION_MODES, resolvePermissionMode } from './PermissionModePicker.js'

describe('PermissionModePicker logic', () => {
  it('exposes the three modes in chat→edit→full order', () => {
    expect(PERMISSION_MODES).toEqual(['chat', 'edit', 'full'])
  })
  it('resolves an explicit mode as-is', () => {
    expect(resolvePermissionMode('full')).toBe('full')
    expect(resolvePermissionMode('chat')).toBe('chat')
    expect(resolvePermissionMode('edit')).toBe('edit')
  })
  it('defaults undefined to edit (back-compat)', () => {
    expect(resolvePermissionMode(undefined)).toBe('edit')
  })
  it('treats an unknown/dirty value as edit (safe default)', () => {
    expect(resolvePermissionMode('garbage' as never)).toBe('edit')
  })
})
