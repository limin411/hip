// hip 品牌标识 —— 大眼睛长出身体的「摸鱼小人」。变体共享眼睛 DNA（cream 眼白 + navy 瞳 + 白高光）：
//   tile    —— 大眼睛 + 蓝砖 + 怀里捧一条 coral 小鱼（右爪搭鱼背 = 抚摸）；通吃 app 图标 / 内联品牌
//   minimal —— 纯眼睛、去高光、瞳放大，16px favicon 兜底（public/hip.svg 镜像它）
//   mono    —— 透明底、单色描边眼 + 实心瞳（currentColor），菜单栏/单色场景
//   hero    —— 全身吉祥物（抱大鱼）叠在登录蓝渐变上，奶油聚光衬底 + 眨眼/斜瞄/抚摸动画
//
// 颜色令牌化说明：
// - 蓝砖 #0062ad 映射到全局 --accent。
// - cream / navy / coral 三鱼色是品牌专属色，没有对应全局 token，保留为常量并加注说明。

interface HipLogoProps {
  variant?: 'tile' | 'minimal' | 'hero' | 'mono'
  size?: number
  className?: string
  /** 无障碍名称（variant 为语义图标时朗读）。 */
  title?: string
  /** 纯装饰：aria-hidden，不进无障碍树。 */
  decorative?: boolean
}

const CREAM = '#f4ecd8' // 品牌专属：眼白高光色，无对应全局 token
const NAVY = '#003b68' // 品牌专属：瞳/四肢深色，无对应全局 token
const CORAL = '#f0997b' // 品牌专属：鱼身，无对应全局 token
const CORAL_DEEP = '#d85a30' // 品牌专属：鱼尾/鳍/嘴，无对应全局 token
const CORAL_PALE = '#f5c4b3' // 品牌专属：鱼肚，无对应全局 token

// 砖内眼睛 DNA —— 瞳孔朝右下「斜瞄」（瞄一眼老板有没有在看）。
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

// 砖内小鱼 —— 横在大眼睛下方，左爪托尾、右爪搭背抚摸（120 viewBox 系，y≈84..102）。
function TileFish() {
  return (
    <>
      <ellipse cx={60} cy={93} rx={26} ry={9} fill={CORAL} />
      <path d="M38 93 L26 85 L32 93 L26 101 Z" fill={CORAL_DEEP} />
      <path d="M40 96 Q60 104 80 96 Q60 100 40 96 Z" fill={CORAL_PALE} opacity={0.85} />
      <circle cx={76} cy={90} r={3.4} fill={CREAM} />
      <circle cx={77} cy={90.5} r={1.7} fill={NAVY} />
      <ellipse cx={38} cy={96} rx={7} ry={5.5} fill="var(--accent)" />
      <ellipse cx={62} cy={85} rx={7} ry={5.5} fill="var(--accent)" />
    </>
  )
}

// 全身吉祥物「抱大鱼」（viewBox 0 0 160 178）。animated=true 时挂眨眼 / 斜瞄 / 抚摸 / 摆鱼动画。
function HugMascot({ animated }: { animated: boolean }) {
  const blink = animated ? 'hip-eyes-blink' : undefined
  const glance = animated ? 'hip-eyes-glance' : undefined
  const pet = animated ? 'hip-pet' : undefined
  const wiggle = animated ? 'hip-fish-wiggle' : undefined
  return (
    <>
      {/* 脚（奶油描边：蓝身在蓝底脱离） */}
      <ellipse cx={62} cy={153} rx={13} ry={8} fill="var(--accent)" stroke={CREAM} strokeWidth={2.5} />
      <ellipse cx={98} cy={153} rx={13} ry={8} fill="var(--accent)" stroke={CREAM} strokeWidth={2.5} />
      {/* 身体（奶油描边） */}
      <ellipse cx={80} cy={98} rx={46} ry={54} fill="var(--accent)" stroke={CREAM} strokeWidth={2.5} />
      {/* 腮红 */}
      <ellipse cx={49} cy={64} rx={6} ry={3.4} fill={CORAL} opacity={0.5} />
      <ellipse cx={111} cy={64} rx={6} ry={3.4} fill={CORAL} opacity={0.5} />
      {/* 抱臂（鱼后；奶油描边 = 先铺一层略宽的 cream 垫底再压蓝） */}
      <path d="M44 98 Q38 128 60 142" stroke={CREAM} strokeWidth={22} strokeLinecap="round" fill="none" />
      <path d="M116 98 Q122 128 100 142" stroke={CREAM} strokeWidth={22} strokeLinecap="round" fill="none" />
      <path d="M44 98 Q38 128 60 142" stroke="var(--accent)" strokeWidth={17} strokeLinecap="round" fill="none" />
      <path d="M116 98 Q122 128 100 142" stroke="var(--accent)" strokeWidth={17} strokeLinecap="round" fill="none" />
      {/* 鱼（含开心摆动） */}
      <g className={wiggle}>
        <path d="M108 110 L128 100 L121 116 L129 130 Z" fill={CORAL_DEEP} />
        <ellipse cx={80} cy={118} rx={34} ry={30} fill={CORAL} />
        <path d="M48 124 Q80 150 112 124 Q80 140 48 124 Z" fill={CORAL_PALE} opacity={0.85} />
        <path d="M50 118 L40 112 L46 124 Z" fill={CORAL_DEEP} />
        <circle cx={70} cy={115} r={7.5} fill={CREAM} />
        <circle cx={90} cy={115} r={7.5} fill={CREAM} />
        <circle cx={71} cy={117} r={3.4} fill={NAVY} />
        <circle cx={91} cy={117} r={3.4} fill={NAVY} />
        <path d="M72 131 q8 6 16 0" stroke={CORAL_DEEP} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      </g>
      {/* 抱爪（鱼前，轻揉抚摸；奶油描边） */}
      <g className={pet}>
        <ellipse cx={60} cy={142} rx={9} ry={7} fill="var(--accent)" stroke={CREAM} strokeWidth={2.5} />
        <ellipse cx={100} cy={142} rx={9} ry={7} fill="var(--accent)" stroke={CREAM} strokeWidth={2.5} />
      </g>
      {/* 小人大眼睛（眨眼包整组、斜瞄只动瞳孔） */}
      <g className={blink}>
        <circle cx={63} cy={53} r={19} fill={CREAM} />
        <circle cx={97} cy={53} r={19} fill={CREAM} />
        <g className={glance}>
          <circle cx={66} cy={60} r={8} fill={NAVY} />
          <circle cx={100} cy={59} r={8} fill={NAVY} />
          <circle cx={62.5} cy={55.5} r={2.6} fill="#ffffff" />
          <circle cx={96.5} cy={54.5} r={2.6} fill="#ffffff" />
        </g>
      </g>
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
    // 全身吉祥物 portrait（160×178）；奶油聚光衬底让蓝身在蓝渐变上脱离。
    const height = Math.round((size * 178) / 160)
    return (
      <div className={className} style={{ width: size, height }} {...a11y}>
        {/* 外层 div 已挂 role/aria-label；内层 svg 对 AT 隐藏，避免重复朗读，<title> 仅作文档。 */}
        <svg
          width={size}
          height={height}
          viewBox="0 0 160 178"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {!decorative && <title>{title}</title>}
          <ellipse
            className="hip-mascot-glow"
            cx={80}
            cy={104}
            rx={60}
            ry={66}
            fill={CREAM}
            opacity={0.13}
          />
          <HugMascot animated />
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
          <rect x={4} y={4} width={112} height={112} rx={26} fill="var(--accent)" />
          <TileEyes pupilR={10.5} highlight />
          <TileFish />
        </>
      )}

      {variant === 'minimal' && (
        <>
          <rect x={4} y={4} width={112} height={112} rx={26} fill="var(--accent)" />
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
