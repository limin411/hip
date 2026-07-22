// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileMentionHandler } from './useFileMentionHandler'
import type { LocalAttachment } from './attachmentTypes'

const toastMessage = vi.fn()
vi.mock('sonner', () => ({
  toast: { message: (...args: unknown[]) => toastMessage(...args) },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      opts?.name ? `${key}:${opts.name}` : key,
  }),
}))

vi.mock('nanoid', () => ({ nanoid: () => 'id1' }))

describe('useFileMentionHandler', () => {
  let value: string
  let setValue: (v: string) => void
  let attachments: LocalAttachment[]
  let setAttachments: (
    a: LocalAttachment[] | ((p: LocalAttachment[]) => LocalAttachment[]),
  ) => void
  const inputRef = { current: null as HTMLTextAreaElement | null }

  beforeEach(() => {
    value = '@a'
    setValue = vi.fn((v: string) => {
      value = v
    })
    attachments = []
    setAttachments = vi.fn(
      (a: LocalAttachment[] | ((p: LocalAttachment[]) => LocalAttachment[])) => {
        attachments = typeof a === 'function' ? a(attachments) : a
      },
    )
    toastMessage.mockReset()
  })

  function setup(opts?: {
    searchRoot?: string | null
    attachmentsSupported?: boolean
    value?: string
  }) {
    return renderHook(
      (props: {
        value: string
        searchRoot: string | null
        attachments: LocalAttachment[]
        attachmentsSupported: boolean
      }) =>
        useFileMentionHandler({
          value: props.value,
          setValue,
          searchRoot: props.searchRoot,
          attachments: props.attachments,
          setAttachments,
          attachmentsSupported: props.attachmentsSupported,
          inputRef,
        }),
      {
        initialProps: {
          value: opts?.value ?? value,
          searchRoot: opts && 'searchRoot' in opts ? (opts.searchRoot ?? null) : '/proj',
          attachments,
          attachmentsSupported: opts?.attachmentsSupported ?? true,
        },
      },
    )
  }

  it('atQuery is null without search root', () => {
    const { result } = setup({ searchRoot: null })
    expect(result.current.atQuery).toBeNull()
  })

  it('selects file → token + attachment chip', () => {
    const { result } = setup({ value: '@a' })
    act(() => {
      result.current.handleSelect({
        relativePath: 'src/a.ts',
        absolutePath: '/proj/src/a.ts',
        name: 'a.ts',
        isDir: false,
        score: 0,
      })
    })
    expect(setValue).toHaveBeenCalledWith('@src/a.ts ')
    expect(setAttachments).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'a.ts',
        path: '/proj/src/a.ts',
        source: 'at-mention',
      }),
    ])
  })

  it('directory select keeps prefix open', () => {
    const { result } = setup({ value: '@s' })
    act(() => {
      result.current.handleSelect({
        relativePath: 'src',
        absolutePath: '/proj/src',
        name: 'src',
        isDir: true,
        score: 0,
      })
    })
    expect(setValue).toHaveBeenCalledWith('@src/')
    expect(setAttachments).not.toHaveBeenCalled()
  })

  it('skips chip for unsupported type', () => {
    const { result } = setup({ value: '@M' })
    act(() => {
      result.current.handleSelect({
        relativePath: 'Makefile',
        absolutePath: '/proj/Makefile',
        name: 'Makefile',
        isDir: false,
        score: 0,
      })
    })
    expect(setValue).toHaveBeenCalledWith('@Makefile ')
    expect(setAttachments).not.toHaveBeenCalled()
    expect(toastMessage).toHaveBeenCalled()
  })

  it('skips chip for image when multimodal unsupported', () => {
    const { result } = setup({
      value: '@l',
      attachmentsSupported: false,
    })
    act(() => {
      result.current.handleSelect({
        relativePath: 'logo.png',
        absolutePath: '/proj/logo.png',
        name: 'logo.png',
        isDir: false,
        score: 0,
      })
    })
    expect(setValue).toHaveBeenCalledWith('@logo.png ')
    expect(setAttachments).not.toHaveBeenCalled()
  })

  it('handleDismiss strips token', () => {
    const { result } = setup({ value: 'hello @fo' })
    act(() => {
      result.current.handleDismiss()
    })
    expect(setValue).toHaveBeenCalledWith('hello ')
  })
})
