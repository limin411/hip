// hip 品牌标识 —— 使用 public/logo.svg 的全身吉祥物。

const LOGO_SCALE = 0.75

interface HipLogoProps {
  size?: number
  className?: string
  /** 无障碍名称。 */
  title?: string
  /** 纯装饰：aria-hidden，不进无障碍树。 */
  decorative?: boolean
}

export function HipLogo({
  size = 96,
  className,
  title = 'hip',
  decorative = false,
}: HipLogoProps) {
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': title } as const)

  const base = import.meta.env.BASE_URL ?? '/'
  const src = base.endsWith('/') ? `${base}logo.svg` : `${base}/logo.svg`

  return (
    <div
      className={['flex items-center justify-center', className].filter(Boolean).join(' ')}
      style={{ width: size }}
      {...a11y}
    >
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={Math.round(size * LOGO_SCALE)}
        height={Math.round(size * LOGO_SCALE)}
      />
    </div>
  )
}
