// hip 品牌标识 —— 使用 public/logo.svg 的全身吉祥物。

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

  return (
    <div
      className={className}
      style={{ width: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      {...a11y}
    >
      <img
        src={`${import.meta.env.BASE_URL}logo.svg`}
        alt=""
        aria-hidden="true"
        width={Math.round(size * 0.75)}
        height={Math.round(size * 0.75)}
        style={{ width: Math.round(size * 0.75), height: 'auto' }}
      />
    </div>
  )
}
