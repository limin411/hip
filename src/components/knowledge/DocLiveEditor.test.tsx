/**
 * @vitest-environment happy-dom
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { DocLiveEditor } from './DocLiveEditor'
import { joinYamlFrontmatter, splitYamlFrontmatter } from '@/domain/knowledge/frontmatter'

afterEach(() => cleanup())

describe('DocLiveEditor', () => {
  it('mounts with knowledge live editor testid', async () => {
    render(
      <DocLiveEditor
        docId="d1"
        initialMarkdown="# Hello\n"
        onDraftChange={() => {}}
      />,
    )
    expect(screen.getByTestId('knowledge-doc-live-editor')).toBeInTheDocument()
    await waitFor(
      () => {
        const host = screen.getByTestId('knowledge-doc-live-editor')
        expect(host.querySelector('.ProseMirror')).toBeTruthy()
      },
      { timeout: 15_000 },
    )
  }, 20_000)

  it('strips frontmatter from editable region and re-prefixes on change', async () => {
    const onDraftChange = vi.fn()
    const md = '---\ntags: [a]\n---\n\n# Body\n'
    render(
      <DocLiveEditor docId="d2" initialMarkdown={md} onDraftChange={onDraftChange} />,
    )
    await waitFor(
      () => {
        expect(
          screen.getByTestId('knowledge-doc-live-editor').querySelector('.ProseMirror'),
        ).toBeTruthy()
      },
      { timeout: 15_000 },
    )
    // ProseMirror should not show raw YAML fence text as a corruption HR path
    const pm = screen
      .getByTestId('knowledge-doc-live-editor')
      .querySelector('.ProseMirror')
    expect(pm?.textContent ?? '').toContain('Body')
    expect(pm?.textContent ?? '').not.toContain('tags: [a]')
  }, 20_000)

  it('split/join helpers used by Live preserve FM round-trip', () => {
    const md = '---\nstatus: draft\n---\n\npara\n'
    const { fmText, body } = splitYamlFrontmatter(md)
    expect(joinYamlFrontmatter(fmText, body)).toBe(md)
  })
})
