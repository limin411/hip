import { describe, expect, it } from 'vitest'
import { countTasks, toggleTaskAt } from './mdTasks'

describe('toggleTaskAt', () => {
  it('toggles the first unchecked task to checked (lowercase x)', () => {
    const md = '- [ ] one\n- [ ] two\n'
    expect(toggleTaskAt(md, 0)).toBe('- [x] one\n- [ ] two\n')
  })

  it('toggles a checked task back to unchecked', () => {
    expect(toggleTaskAt('- [x] done', 0)).toBe('- [ ] done')
    expect(toggleTaskAt('- [X] done', 0)).toBe('- [ ] done')
  })

  it('selects by document-order index across multiple markers', () => {
    const md = '- [ ] a\n- [x] b\n- [ ] c'
    expect(toggleTaskAt(md, 1)).toBe('- [ ] a\n- [ ] b\n- [ ] c')
    expect(toggleTaskAt(md, 2)).toBe('- [ ] a\n- [x] b\n- [x] c')
  })

  it('handles nested task lists', () => {
    const md = '- [ ] parent\n  - [ ] child\n  - [x] other'
    expect(toggleTaskAt(md, 1)).toBe('- [ ] parent\n  - [x] child\n  - [x] other')
    expect(toggleTaskAt(md, 2)).toBe('- [ ] parent\n  - [ ] child\n  - [ ] other')
  })

  it('supports *, +, and ordered-list task markers', () => {
    expect(toggleTaskAt('* [ ] star', 0)).toBe('* [x] star')
    expect(toggleTaskAt('+ [x] plus', 0)).toBe('+ [ ] plus')
    expect(toggleTaskAt('1. [ ] ordered', 0)).toBe('1. [x] ordered')
    expect(toggleTaskAt('12. [X] ordered', 0)).toBe('12. [ ] ordered')
  })

  it('ignores task-like lines inside fenced code blocks', () => {
    const md = ['- [ ] real', '```', '- [ ] fake', '```', '- [ ] after'].join('\n')
    expect(countTasks(md)).toBe(2)
    expect(toggleTaskAt(md, 1)).toBe(
      ['- [ ] real', '```', '- [ ] fake', '```', '- [x] after'].join('\n'),
    )
  })

  it('returns original when index is out of range or negative', () => {
    const md = '- [ ] only'
    expect(toggleTaskAt(md, 1)).toBe(md)
    expect(toggleTaskAt(md, -1)).toBe(md)
  })

  it('preserves trailing text and indentation', () => {
    const md = '  - [ ]  spaced task with **md**'
    expect(toggleTaskAt(md, 0)).toBe('  - [x]  spaced task with **md**')
  })
})

describe('countTasks', () => {
  it('counts only real task lines', () => {
    expect(countTasks('- item\n- [ ] task\nnot a task')).toBe(1)
  })
})
