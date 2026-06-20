import { describe, it, expect } from 'vitest'
import { normalizeMessageContent } from './normalizeMessageContent'

describe('normalizeMessageContent', () => {
  it('collapses runs of single-character CJK lines into prose', () => {
    const input = '让\n我\n先\n看\n看\n项\n目\n。'
    expect(normalizeMessageContent(input)).toBe('让我先看看项目。')
  })

  it('only collapses runs of 5 or more short CJK lines', () => {
    const input = '让\n我\n先\n看\n\n这是正常的段落。'
    // 4 short lines stay as-is; blank line and paragraph stay as-is.
    expect(normalizeMessageContent(input)).toBe('让\n我\n先\n看\n\n这是正常的段落。')
  })

  it('preserves normal multi-line prose', () => {
    const input = '第一行正常。\n第二行正常。\n第三行正常。'
    expect(normalizeMessageContent(input)).toBe(input)
  })

  it('preserves fenced code blocks', () => {
    const input = '让\n我\n先\n看\n看\n代码：\n\n```\n让\n我\n先\n```\n\n然后继续。'
    expect(normalizeMessageContent(input)).toBe('让我先看看代码：\n\n```\n让\n我\n先\n```\n\n然后继续。')
  })

  it('preserves nested fenced code blocks (4+ backticks)', () => {
    const input = '让\n我\n先\n看\n看\n````\n```\n让\n我\n先\n```\n````\n\n然后继续。'
    expect(normalizeMessageContent(input)).toBe('让我先看看\n````\n```\n让\n我\n先\n```\n````\n\n然后继续。')
  })

  it('preserves fenced code blocks with language identifier', () => {
    const input = '让\n我\n先\n看\n看\n```typescript\n让\n我\n先\n```\n\n然后继续。'
    expect(normalizeMessageContent(input)).toBe('让我先看看\n```typescript\n让\n我\n先\n```\n\n然后继续。')
  })

  it('preserves tilde fenced code blocks', () => {
    const input = '让\n我\n先\n看\n看\n~~~\n让\n我\n先\n~~~\n\n然后继续。'
    expect(normalizeMessageContent(input)).toBe('让我先看看\n~~~\n让\n我\n先\n~~~\n\n然后继续。')
  })

  it('allows closing fences longer than opening fences', () => {
    const input = '让\n我\n先\n看\n看\n~~~\n让\n我\n先\n~~~~\n\n然后继续。'
    expect(normalizeMessageContent(input)).toBe('让我先看看\n~~~\n让\n我\n先\n~~~~\n\n然后继续。')
  })

  it('does not collapse ASCII list markers', () => {
    const input = '- a\n- b\n- c\n- d\n- e'
    expect(normalizeMessageContent(input)).toBe(input)
  })

  it('collapses mixed CJK/punctuation short lines including Latin words', () => {
    const input = '的\n相\n关\n信\n息\nOpenCode\n。'
    expect(normalizeMessageContent(input)).toBe('的相关信息\nOpenCode\n。')
  })

  it('keeps longer CJK lines unchanged', () => {
    const input = '这是一句正常长度的中文。\n这是另一句。'
    expect(normalizeMessageContent(input)).toBe(input)
  })

  it('does not alter empty input', () => {
    expect(normalizeMessageContent('')).toBe('')
  })

  it('handles falsy input defensively', () => {
    expect(normalizeMessageContent(undefined as unknown as string)).toBe('')
    expect(normalizeMessageContent(null as unknown as string)).toBe('')
  })

  it('does not treat inline backticks as fenced code blocks', () => {
    const input = '让\n我\n先\n看\n看\n这里的 ````` 语法。\n\n然后继续。'
    expect(normalizeMessageContent(input)).toBe('让我先看看\n这里的 ````` 语法。\n\n然后继续。')
  })

  it('does not treat backticks followed immediately by text as fence openers', () => {
    const input = '让\n我\n先\n看\n看\n```hello 这种写法。\n\n然后继续。'
    expect(normalizeMessageContent(input)).toBe('让我先看看\n```hello 这种写法。\n\n然后继续。')
  })

  it('collapses lines ending with CJK curly quotes', () => {
    const input = '他\n说\n“\n你\n好\n”\n。'
    expect(normalizeMessageContent(input)).toBe('他说“你好”。')
  })

  it('handles CRLF line endings', () => {
    const input = '让\r\n我\r\n先\r\n看\r\n看\r\n然\r\n后\r\n继\r\n续\r\n。'
    expect(normalizeMessageContent(input)).toBe('让我先看看然后继续。')
  })
})
