// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  ImageLightbox,
  imageLightboxTargetFromEvent,
} from './ImageLightbox'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

afterEach(() => {
  cleanup()
})

describe('ImageLightbox', () => {
  it('renders enlarged image when open with src', () => {
    render(
      <ImageLightbox
        open
        onOpenChange={() => {}}
        src="data:image/png;base64,aaa"
        alt="diagram"
      />,
    )
    expect(screen.getByTestId('image-lightbox')).toBeInTheDocument()
    const img = screen.getByTestId('image-lightbox-img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,aaa')
    expect(img).toHaveAttribute('alt', 'diagram')
    expect(screen.getByTestId('image-lightbox-caption')).toHaveTextContent('diagram')
  })

  it('does not mount content when closed or src missing', () => {
    const { rerender } = render(
      <ImageLightbox open={false} onOpenChange={() => {}} src="data:image/png;base64,aaa" />,
    )
    expect(screen.queryByTestId('image-lightbox')).toBeNull()

    rerender(<ImageLightbox open onOpenChange={() => {}} src={null} />)
    expect(screen.queryByTestId('image-lightbox')).toBeNull()
  })

  it('close button requests dismiss', () => {
    const onOpenChange = vi.fn()
    render(
      <ImageLightbox
        open
        onOpenChange={onOpenChange}
        src="data:image/png;base64,aaa"
      />,
    )
    fireEvent.click(screen.getByTestId('image-lightbox-close'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('imageLightboxTargetFromEvent', () => {
  it('returns img targets and respects opt-out', () => {
    const wrap = document.createElement('div')
    const img = document.createElement('img')
    img.src = 'data:image/png;base64,aaa'
    wrap.appendChild(img)
    expect(imageLightboxTargetFromEvent(img)).toBe(img)

    wrap.setAttribute('data-no-image-lightbox', '')
    expect(imageLightboxTargetFromEvent(img)).toBeNull()
  })
})
