// hip 品牌标识 —— 一颗「蜜桃 / 屁股」。三种角色共享同一基因：
//   color   —— 全彩珊瑚桃，登录 hero / 营销主脸
//   tile    —— 白桃嵌 Blue 圆角砖，dock / favicon / 占位替换
//   minimal —— 几何两瓣，小尺寸 favicon 兜底
// 品牌色自带（珊瑚仅在此处出现），不引入全局 token。

interface HipLogoProps {
  variant?: 'color' | 'tile' | 'minimal' | 'hero'
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

interface SparkleProps {
  left: string
  top: string
  size: number
  delay: number
  duration: number
}

const SPARKLES: SparkleProps[] = [
  { left: '20%', top: '15%', size: 5, delay: 0, duration: 2 },
  { left: '65%', top: '10%', size: 4, delay: 0.5, duration: 2 },
  { left: '78%', top: '35%', size: 6, delay: 0.3, duration: 2.2 },
  { left: '42%', top: '8%', size: 3, delay: 0.7, duration: 1.8 },
  { left: '12%', top: '42%', size: 4, delay: 1, duration: 2.1 },
  { left: '18%', top: '55%', size: 3, delay: 0.2, duration: 1.9 },
  { left: '50%', top: '20%', size: 5, delay: 0.9, duration: 2.3 },
  { left: '75%', top: '48%', size: 2, delay: 0.4, duration: 1.7 },
  { left: '28%', top: '60%', size: 4, delay: 0.6, duration: 2 },
  { left: '8%', top: '32%', size: 3, delay: 1.1, duration: 2.4 },
]

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

  if (variant === 'hero') {
    return (
      <div
        className={className}
        style={{ width: size, height: size, position: 'relative' }}
        {...a11y}
      >
        {!decorative && <title>{title}</title>}

        <div
          className="hip-logo-glow"
          style={{
            position: 'absolute',
            inset: 0,
            margin: 'auto',
            width: size * 1.15,
            height: size * 1.15,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(240,154,120,0.18) 0%, rgba(240,154,120,0.05) 40%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <svg
          width={size}
          height={size}
          viewBox="0 0 120 120"
          className="hip-logo-animated"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'relative', zIndex: 1 }}
        >
          <path d={PEACH} fill="#f09a78" />
          <path d={HIGHLIGHT} fill="#f8bda2" opacity={0.5} />
          <path d={CLEFT} fill="none" stroke="#c95a33" strokeWidth={4.5} strokeLinecap="round" />
          <path d={STEM} fill="none" stroke="#7a4a2b" strokeWidth={3} strokeLinecap="round" />
          <g className="hip-logo-leaf">
            <path d={LEAF} fill="#7cbe35" />
            <path d={VEIN} fill="none" stroke="#4b7e16" strokeWidth={1.6} strokeLinecap="round" />
          </g>
        </svg>

        <svg
          width={size}
          height={size * 0.06}
          viewBox="0 0 120 7"
          className="hip-logo-shadow"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            position: 'absolute',
            bottom: -size * 0.01,
            left: 0,
            right: 0,
            margin: 'auto',
            pointerEvents: 'none',
          }}
        >
          <ellipse cx={60} cy={3.5} rx={30} ry={3} fill="rgba(255,255,255,0.1)" />
        </svg>

        {SPARKLES.map((s, i) => (
          <div
            key={i}
            className="hip-logo-sparkle"
            style={{
              position: 'absolute',
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              borderRadius: '50%',
              background: 'white',
              animationDuration: `${s.duration}s`,
              animationDelay: `${s.delay}s`,
              pointerEvents: 'none',
            }}
          />
        ))}
      </div>
    )
  }

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
          <rect x="6" y="6" width="108" height="108" rx="26" fill="#0062ad" />
          <g transform="translate(20 19) scale(0.66)">
            <path d={PEACH} fill="#ffffff" />
            <path d={LEAF} fill="#ffffff" />
            <path d={CLEFT} fill="none" stroke="#0062ad" strokeWidth="5" strokeLinecap="round" />
          </g>
        </>
      )}

      {variant === 'minimal' && (
        <>
          <path
            d="M57 28 C 38 16 17 27 17 56 C 17 82 37 100 57 93 C 53 71 53 50 57 28 Z"
            fill="#0062ad"
          />
          <path
            d="M63 28 C 82 16 103 27 103 56 C 103 82 83 100 63 93 C 67 71 67 50 63 28 Z"
            fill="#00538f"
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
