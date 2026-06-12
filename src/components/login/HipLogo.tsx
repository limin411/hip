// hip 品牌标识 —— 一对「大眼睛」(参考 Cookie Monster × #0062AD 色卡)。变体共享同一眼睛基因：
//   tile    —— cream 眼 + navy 瞳，嵌 #0062AD 圆角砖；通吃 app 图标 / favicon / 内联品牌
//   minimal —— 去高光、瞳放大，16px favicon 兜底
//   mono    —— 透明底、单色描边眼 + 实心瞳 (currentColor)，菜单栏/单色场景
//   hero    —— 仅眼放大，叠在登录页蓝色渐变上，带柔光 + 眨眼 + 斜瞄动画
// 品牌色自带 (cream / navy 仅在此处出现)，不引入全局 token。

interface HipLogoProps {
  variant?: 'tile' | 'minimal' | 'hero' | 'mono'
  size?: number
  className?: string
  /** 无障碍名称（variant 为语义图标时朗读）。 */
  title?: string
  /** 纯装饰：aria-hidden，不进无障碍树。 */
  decorative?: boolean
}

const BLUE = '#0062ad'
const CREAM = '#f4ecd8'
const NAVY = '#003b68'

// 砖内眼睛 DNA —— 瞳孔朝右下「斜瞄」(瞄一眼老板有没有在看 / agent 盯着你的代码)。
function TileEyes({ pupilR, highlight }: { pupilR: number; highlight: boolean }) {
  return (
    <>
      <circle cx={42} cy={58} r={24} fill={CREAM} />
      <circle cx={78} cy={58} r={24} fill={CREAM} />
      <circle cx={49} cy={65} r={pupilR} fill={NAVY} />
      <circle cx={85} cy={64} r={pupilR} fill={NAVY} />
      {highlight && (
        <>
          <circle cx={45.5} cy={61.5} r={3} fill="#ffffff" />
          <circle cx={81.5} cy={60.5} r={3} fill="#ffffff" />
        </>
      )}
    </>
  )
}

export function HipLogo({
  variant = 'tile',
  size = 96,
  className,
  title = 'hip',
  decorative = false,
}: HipLogoProps) {
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': title } as const)

  if (variant === 'hero') {
    // 放大眼 + 柔光；眨眼包整组、斜瞄只动瞳孔。
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
              'radial-gradient(circle, rgba(244,236,216,0.22) 0%, rgba(244,236,216,0.06) 42%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <svg
          width={size}
          height={size}
          viewBox="0 0 120 120"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'relative', zIndex: 1 }}
        >
          <g className="hip-eyes-blink">
            <circle cx={42} cy={60} r={30} fill={CREAM} />
            <circle cx={78} cy={60} r={30} fill={CREAM} />
            <g className="hip-eyes-glance">
              <circle cx={51} cy={69} r={13} fill={NAVY} />
              <circle cx={87} cy={68} r={13} fill={NAVY} />
              <circle cx={46.5} cy={64.5} r={3.8} fill="#ffffff" />
              <circle cx={82.5} cy={63.5} r={3.8} fill="#ffffff" />
            </g>
          </g>
        </svg>
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
          <rect x={4} y={4} width={112} height={112} rx={26} fill={BLUE} />
          <TileEyes pupilR={10.5} highlight />
        </>
      )}

      {variant === 'minimal' && (
        <>
          <rect x={4} y={4} width={112} height={112} rx={26} fill={BLUE} />
          <TileEyes pupilR={12} highlight={false} />
        </>
      )}

      {variant === 'mono' && (
        <g fill="currentColor">
          <circle cx={40} cy={58} r={22} fill="none" stroke="currentColor" strokeWidth={7} />
          <circle cx={80} cy={58} r={22} fill="none" stroke="currentColor" strokeWidth={7} />
          <circle cx={46} cy={63} r={8.5} />
          <circle cx={82} cy={63} r={8.5} />
        </g>
      )}
    </svg>
  )
}
