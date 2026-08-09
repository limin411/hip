// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { KnowledgeAssetImage } from './KnowledgeAssetImage'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const resolveAssetDataUrl = vi.fn()
vi.mock('@/domain/knowledge/assetUrl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/knowledge/assetUrl')>()
  return {
    ...actual,
    resolveAssetDataUrl: (...args: unknown[]) => resolveAssetDataUrl(...args),
  }
})

vi.mock('@/ipc/knowledge', () => ({
  knowledgeErrorMessage: (e: unknown) => String(e),
  knowledgeRevealPath: vi.fn(),
}))

beforeEach(() => {
  resolveAssetDataUrl.mockReset()
  resolveAssetDataUrl.mockResolvedValue({
    dataUrl: 'data:image/png;base64,abc',
    mime: 'image/png',
  })
})

afterEach(() => {
  cleanup()
})

describe('KnowledgeAssetImage lightbox', () => {
  it('opens floating preview when local asset image is clicked', async () => {
    render(
      <KnowledgeAssetImage
        spaceId="spc_1"
        src="assets/pic.png"
        alt="photo"
        className="max-w-full"
      />,
    )
    const img = await screen.findByTestId('knowledge-asset-img')
    expect(img).toHaveClass('cursor-zoom-in')
    fireEvent.click(img)
    await waitFor(() => {
      expect(screen.getByTestId('image-lightbox')).toBeInTheDocument()
    })
    expect(screen.getByTestId('image-lightbox-img')).toHaveAttribute(
      'src',
      'data:image/png;base64,abc',
    )
  })

  it('opens floating preview for remote images', () => {
    render(
      <KnowledgeAssetImage
        spaceId="spc_1"
        src="https://example.com/a.png"
        alt="remote"
      />,
    )
    fireEvent.click(screen.getByTestId('knowledge-asset-img-remote'))
    expect(screen.getByTestId('image-lightbox')).toBeInTheDocument()
  })
})
