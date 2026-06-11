// hip 品牌标识 —— 一颗「蜜桃 / 屁股」。三种角色共享同一基因：
//   color   —— 全彩珊瑚桃，登录 hero / 营销主脸
//   tile    —— 白桃嵌 Teal 圆角砖，dock / favicon / 占位替换
//   minimal —— 几何两瓣，小尺寸 favicon 兜底
// 品牌色自带（珊瑚仅在此处出现），不引入全局 token。

interface HipLogoProps {
  variant?: 'color' | 'tile' | 'minimal'
  size?: number
  className?: string
  /** 无障碍名称（variant 为语义图标时朗读）。 */
  title?: string
  /** 纯装饰：aria-hidden，不进无障碍树。 */
  decorative?: boolean
}

const PEACH =
  'M60 33 C 54 19 39 15 29 24 C 17 33 15 52 24 70 C 30 83 45 95 60 105 C 75 95 90 83 96 70 C 105 52 103 33 91 24 C 81 15 66 19 60 33 Z'
const CLEFT = 'M60 37 C 56 49 56 63 60 77'
const LEAF = 'M60 31 C 68 16 83 12 95 17 C 89 31 73 37 61 32 Z'
const VEIN = 'M64 30 C 73 25 83 22 90 20'
const STEM = 'M60 33 C 60 26 60 22 61 18'
const HIGHLIGHT = 'M27 44 C 22 58 25 76 39 88 C 30 75 28 59 33 45 Z'

export function HipLogo({
  variant = 'color',
  size = 96,
  className,
  title = 'hip',
  decorative = false,
}: HipLogoProps) {
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': title } as const)

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      {...a11y}
    >
      {!decorative && <title>{title}</title>}

      {variant === 'tile' && (
        <>
          <rect x="6" y="6" width="108" height="108" rx="26" fill="#0d9488" />
          <g transform="translate(20 19) scale(0.66)">
            <path d={PEACH} fill="#ffffff" />
            <path d={LEAF} fill="#ffffff" />
            <path d={CLEFT} fill="none" stroke="#0d9488" strokeWidth="5" strokeLinecap="round" />
          </g>
        </>
      )}

      {variant === 'minimal' && (
        <>
          <path
            d="M57 28 C 38 16 17 27 17 56 C 17 82 37 100 57 93 C 53 71 53 50 57 28 Z"
            fill="#0d9488"
          />
          <path
            d="M63 28 C 82 16 103 27 103 56 C 103 82 83 100 63 93 C 67 71 67 50 63 28 Z"
            fill="#0f766e"
          />
        </>
      )}

      {variant === 'color' && (
        <>
          <path d={PEACH} fill="#f09a78" />
          <path d={HIGHLIGHT} fill="#f8bda2" />
          <path d={CLEFT} fill="none" stroke="#c95a33" strokeWidth="4.5" strokeLinecap="round" />
          <path d={STEM} fill="none" stroke="#7a4a2b" strokeWidth="3" strokeLinecap="round" />
          <path d={LEAF} fill="#7cbe35" />
          <path d={VEIN} fill="none" stroke="#4b7e16" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
