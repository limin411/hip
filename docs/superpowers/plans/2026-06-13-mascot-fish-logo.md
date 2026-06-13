# 摸鱼小人 LOGO 升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有「大眼睛」标识基础上长出蓝色身体、怀里抱一条 coral 大鱼在抚摸,登录 hero 换成全身吉祥物 + 奶油聚光,app 图标换成「蓝砖大眼睛 + 捧鱼」。

**Architecture:** 纯前端 SVG/CSS。`HipLogo` 组件抽出内部 `HugMascot`(portrait 160×178,hero 用)与 `TileFish`(120×120 砖内小鱼,tile 用);`hero` 重写为 mascot + cream 聚光 + 动画,`tile` 在大眼睛下加小鱼,`minimal`/`mono` 纯眼睛不动。动画走 `tokens.css` keyframe,reduce-motion 由既有全局 `*` 兜底自动禁用。

**Tech Stack:** React + TypeScript(Vite),内联 SVG,`src/styles/tokens.css`,Tauri 图标生成(`yarn tauri icon`)。

**Spec:** `docs/superpowers/specs/2026-06-13-mascot-fish-logo-design.md`

**测试取向(重要):** 本仓 `src` 下只有逻辑/store 的 `*.test.ts`,无 React 组件渲染测试基建(无 jsdom / testing-library),且前作「大眼睛 LOGO」按 `type-check + Playwright/Preview 截图自检 + 手动 GUI 验收` 收尾(见其 spec),用户偏好亦为「GUI 验收优先」。故本计划**不写红绿单测**(无基建、纯视觉、违背既有模式),每个任务以 `yarn type-check` + 截图/视觉核对收尾,与项目约定一致。截图用本环境 Preview MCP 工具(`mcp__Claude_Preview__preview_*`,首次用 ToolSearch `select:` 加载 schema)。

**调色板(已在 spec 锁定,仅 logo 局部):** BLUE `#0062ad` / CREAM `#f4ecd8` / NAVY `#003b68` / CORAL `#f0997b`(鱼身) / CORAL_DEEP `#d85a30`(尾鳍嘴) / CORAL_PALE `#f5c4b3`(鱼肚)。

---

## File Structure

| 文件 | 责任 | 本计划改动 |
|------|------|-----------|
| `src/styles/tokens.css` | 全站 token + logo 动画 keyframe/class | Task 1:聚光 keyframe/class 重命名 + 新增 `hip-pet` / `hip-fish-wiggle` |
| `src/components/login/HipLogo.tsx` | 品牌标识组件(全部变体) | Task 2:加 coral 常量、`TileFish`、`HugMascot`;重写 `hero`;`tile` 加鱼 |
| `src/routes/LoginScreen.tsx` | 登录页(唯一 hero 消费方) | Task 3:仅注释更新 |
| `src-tauri/icons/source/app-icon.svg` | app 图标 master(镜像 tile) | Task 4:换成 tile 几何(眼 + 鱼) |
| `src-tauri/icons/*`(二进制) | 各平台图标 | Task 4:`yarn tauri icon` 重生成 |

**不动:** `public/hip.svg`(favicon = 纯眼睛,决策保留)、`index.html`(favicon 已指 `/hip.svg`、title 已 `hip`)、`mono`/`minimal` 几何。

---

## Task 1: tokens.css —— 聚光重命名 + 抚摸/摆鱼动画

**Files:**
- Modify: `src/styles/tokens.css:79`(注释)、`src/styles/tokens.css:93-96`(keyframe `hip-glow-breathe`)、`src/styles/tokens.css:113-115`(class `.hip-logo-glow`)

旧 `hero` 用 div 柔光(`.hip-logo-glow` + `hip-glow-breathe`,opacity 0.35↔0.55);新 `hero` 改用 SVG cream 聚光椭圆,需更低透明度,故把这对重命名为 `hip-spotlight` / `.hip-mascot-glow` 并降透明度,再新增抚摸 `hip-pet`、摆鱼 `hip-fish-wiggle`。无其它消费方(全仓仅 `HipLogo.tsx` 引用 glow),重命名安全。

- [ ] **Step 1: 更新注释行**

把 `src/styles/tokens.css:79`:

```css
/* —— Login logo animations（大眼睛：眨眼 + 斜瞄 + 柔光呼吸）—— */
```

改为:

```css
/* —— Login logo animations（摸鱼小人：眨眼 + 斜瞄 + 抚摸 + 聚光呼吸）—— */
```

- [ ] **Step 2: 替换 `hip-glow-breathe` keyframe → `hip-spotlight` + 新增 pet/wiggle**

把:

```css
@keyframes hip-glow-breathe {
  0%, 100% { opacity: 0.35; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(1.08); }
}
```

替换为:

```css
@keyframes hip-spotlight {
  0%, 100% { opacity: 0.13; transform: scale(1); }
  50% { opacity: 0.2; transform: scale(1.05); }
}

@keyframes hip-pet {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(1.6px); }
}

@keyframes hip-fish-wiggle {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(1.6deg); }
  75% { transform: rotate(-1.6deg); }
}
```

- [ ] **Step 3: 替换 `.hip-logo-glow` class → `.hip-mascot-glow` + pet/wiggle class**

把:

```css
.hip-logo-glow {
  animation: hip-glow-breathe 3s ease-in-out infinite;
}
```

替换为:

```css
/* 奶油聚光：登录 hero 衬底，柔和呼吸 */
.hip-mascot-glow {
  transform-box: fill-box;
  transform-origin: center;
  animation: hip-spotlight 3.4s ease-in-out infinite;
}

/* 抚摸：抱爪轻揉 */
.hip-pet {
  transform-box: fill-box;
  transform-origin: center;
  animation: hip-pet 3.2s ease-in-out infinite;
}

/* 鱼被摸得很享受：小幅摆动 */
.hip-fish-wiggle {
  transform-box: fill-box;
  transform-origin: center;
  animation: hip-fish-wiggle 2.6s ease-in-out infinite;
}
```

- [ ] **Step 4: 确认无残留引用**

Run: `grep -rn "hip-glow-breathe\|hip-logo-glow" src`
Expected: 无输出(旧名已全部移除;`HipLogo.tsx` 在 Task 2 才改,此刻它仍引用旧 `hip-logo-glow` 也无妨——本步只确认 tokens.css 内无残留。若想严格,本步可跳过,统一在 Task 2 后校验)。

实际校验放宽为:`grep -n "hip-spotlight\|hip-mascot-glow\|hip-pet\|hip-fish-wiggle" src/styles/tokens.css`
Expected: 命中上面新增的 keyframe 与 class。

- [ ] **Step 5: type-check(CSS 不参与 tsc,仅确保未误伤)**

Run: `yarn type-check`
Expected: 通过(无 TS 报错)。

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat(logo): tokens — rename glow→spotlight, add hip-pet/hip-fish-wiggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: HipLogo.tsx —— coral 常量 + TileFish + HugMascot + 重写 hero/tile

**Files:**
- Modify(全量重写): `src/components/login/HipLogo.tsx`

整文件替换为以下内容(`minimal`/`mono` 几何与现状一致,逐字保留):

- [ ] **Step 1: 用下面内容整体替换 `src/components/login/HipLogo.tsx`**

```tsx
// hip 品牌标识 —— 大眼睛长出身体的「摸鱼小人」。变体共享眼睛 DNA（cream 眼白 + navy 瞳 + 白高光）：
//   tile    —— 大眼睛 + 蓝砖 + 怀里捧一条 coral 小鱼（右爪搭鱼背 = 抚摸）；通吃 app 图标 / 内联品牌
//   minimal —— 纯眼睛、去高光、瞳放大，16px favicon 兜底（public/hip.svg 镜像它）
//   mono    —— 透明底、单色描边眼 + 实心瞳（currentColor），菜单栏/单色场景
//   hero    —— 全身吉祥物（抱大鱼）叠在登录蓝渐变上，奶油聚光衬底 + 眨眼/斜瞄/抚摸动画
// 品牌色（cream / navy / coral 三鱼色）仅在此处出现，不引入全局 token。

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
const CORAL = '#f0997b' // 鱼身
const CORAL_DEEP = '#d85a30' // 鱼尾 / 鳍 / 嘴
const CORAL_PALE = '#f5c4b3' // 鱼肚

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
      <ellipse cx={38} cy={96} rx={7} ry={5.5} fill={BLUE} />
      <ellipse cx={62} cy={85} rx={7} ry={5.5} fill={BLUE} />
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
      {/* 脚 */}
      <ellipse cx={62} cy={153} rx={13} ry={8} fill={BLUE} />
      <ellipse cx={98} cy={153} rx={13} ry={8} fill={BLUE} />
      {/* 身体 */}
      <ellipse cx={80} cy={98} rx={46} ry={54} fill={BLUE} />
      {/* 腮红 */}
      <ellipse cx={49} cy={64} rx={6} ry={3.4} fill={CORAL} opacity={0.5} />
      <ellipse cx={111} cy={64} rx={6} ry={3.4} fill={CORAL} opacity={0.5} />
      {/* 抱臂（鱼后） */}
      <path d="M44 98 Q38 128 60 142" stroke={BLUE} strokeWidth={17} strokeLinecap="round" fill="none" />
      <path d="M116 98 Q122 128 100 142" stroke={BLUE} strokeWidth={17} strokeLinecap="round" fill="none" />
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
      {/* 抱爪（鱼前，轻揉抚摸） */}
      <g className={pet}>
        <ellipse cx={60} cy={142} rx={9} ry={7} fill={BLUE} />
        <ellipse cx={100} cy={142} rx={9} ry={7} fill={BLUE} />
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
        <svg
          width={size}
          height={height}
          viewBox="0 0 160 178"
          xmlns="http://www.w3.org/2000/svg"
        >
          {!decorative && <title>{title}</title>}
          <ellipse
            className="hip-mascot-glow"
            cx={80}
            cy={104}
            rx={60}
            ry={66}
            fill={CREAM}
            opacity={0.16}
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
          <rect x={4} y={4} width={112} height={112} rx={26} fill={BLUE} />
          <TileEyes pupilR={10.5} highlight />
          <TileFish />
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
```

- [ ] **Step 2: type-check**

Run: `yarn type-check`
Expected: 通过。若报 `'title' is declared but never read` 之类——不会,`title` 用于 a11y 与 `<title>`。若报未用变量,检查是否漏接。

- [ ] **Step 3: 启动 dev server 并截图 hero(真组件)**

用 Preview MCP(先 `ToolSearch` `select:mcp__Claude_Preview__preview_start,mcp__Claude_Preview__preview_screenshot,mcp__Claude_Preview__preview_console_logs` 加载 schema):
- `preview_start`(命令 `yarn dev`,默认 vite `http://localhost:5173/`,首屏即 LoginScreen)。
- `preview_console_logs`:Expected 无报错。
- `preview_screenshot`:Expected 登录左栏出现蓝身小人抱 coral 大鱼、两对眼睛(小人眼大、鱼眼小)、奶油聚光在身后透出;蓝身在蓝渐变上清晰不糊。
- 观察数秒确认眨眼 / 斜瞄 / 抱爪轻揉 / 鱼摆动有动作且不抢戏(可连续两次 `preview_screenshot` 比对眼睛/鱼角度变化)。

- [ ] **Step 4: 截图核对 tile(经 app 图标 master 间接验,Task 4 做);本步先核对 minimal 仍正常**

`preview_screenshot`(`url` 指 `http://localhost:5173/hip.svg`)或浏览器打开 `/hip.svg`:Expected 纯眼睛蓝砖不变(确认改 tile 未波及 favicon 源)。

- [ ] **Step 5: Commit**

```bash
git add src/components/login/HipLogo.tsx
git commit -m "feat(logo): grow mascot — HugMascot hero + TileFish on tile, add coral palette

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: LoginScreen.tsx —— 注释更新

**Files:**
- Modify: `src/routes/LoginScreen.tsx:16`

用法不变(`variant="hero" size={260}`;hero 现按 178/160 自算高度,容器是居中 flex,不受影响)。仅更新描述注释。

- [ ] **Step 1: 改注释**

把 `src/routes/LoginScreen.tsx:16`:

```tsx
      {/* 左侧品牌区 —— 动态大眼睛 hero（眨眼 + 斜瞄） */}
```

改为:

```tsx
      {/* 左侧品牌区 —— 摸鱼小人 hero（抱鱼抚摸 + 眨眼 + 斜瞄） */}
```

- [ ] **Step 2: type-check**

Run: `yarn type-check`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/routes/LoginScreen.tsx
git commit -m "docs(login): comment — 大眼睛 hero → 摸鱼小人 hero

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: app-icon.svg 换 tile 几何 + 重生成图标

**Files:**
- Modify(全量替换): `src-tauri/icons/source/app-icon.svg`
- Regenerate: `src-tauri/icons/*`(`yarn tauri icon` 产物)

app-icon 必须镜像 `HipLogo` 的 `tile` 分支(眼 + 鱼),坐标逐字对应 Task 2 的 `TileEyes(pupilR 10.5, highlight)` + `TileFish`。

- [ ] **Step 1: 用下面内容整体替换 `src-tauri/icons/source/app-icon.svg`**

```svg
<svg width="1024" height="1024" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <!--
    hip app-icon master — 'tile' variant (大眼睛 + 怀里捧一条小鱼).
    Mirrors the tile branch of src/components/login/HipLogo.tsx (TileEyes + TileFish).
    Cream googly eyes + navy pupils + white catchlights on a #0062ad rounded tile (rx 26),
    coral fish below, blue paws cradling tail / stroking the back. Outside the tile is transparent.
    Regenerate the icon set from this source (accepts an SVG with transparency):
      yarn tauri icon src-tauri/icons/source/app-icon.svg
  -->
  <rect x="4" y="4" width="112" height="112" rx="26" fill="#0062ad"/>
  <circle cx="42" cy="58" r="24" fill="#f4ecd8"/>
  <circle cx="78" cy="58" r="24" fill="#f4ecd8"/>
  <circle cx="49" cy="65" r="10.5" fill="#003b68"/>
  <circle cx="85" cy="64" r="10.5" fill="#003b68"/>
  <circle cx="45.5" cy="61.5" r="3" fill="#ffffff"/>
  <circle cx="81.5" cy="60.5" r="3" fill="#ffffff"/>
  <ellipse cx="60" cy="93" rx="26" ry="9" fill="#f0997b"/>
  <path d="M38 93 L26 85 L32 93 L26 101 Z" fill="#d85a30"/>
  <path d="M40 96 Q60 104 80 96 Q60 100 40 96 Z" fill="#f5c4b3" opacity="0.85"/>
  <circle cx="76" cy="90" r="3.4" fill="#f4ecd8"/>
  <circle cx="77" cy="90.5" r="1.7" fill="#003b68"/>
  <ellipse cx="38" cy="96" rx="7" ry="5.5" fill="#0062ad"/>
  <ellipse cx="62" cy="85" rx="7" ry="5.5" fill="#0062ad"/>
</svg>
```

- [ ] **Step 2: 截图核对 master SVG(缩小测试)**

临时拷到 public 让 vite 服务并截图,然后删除:

```bash
cp src-tauri/icons/source/app-icon.svg public/_tile-check.svg
```

`preview_screenshot`(`url` `http://localhost:5173/_tile-check.svg`):Expected 大眼睛照旧 + 底部 coral 小鱼,整体读作「捧鱼」;再用浏览器缩放或 `preview_resize` 看 ~44 / 22px 缩略——眼睛始终立得住(鱼在极小尺寸糊成色块属预期,favicon 另有纯眼睛兜底)。

```bash
rm public/_tile-check.svg
```

- [ ] **Step 3: 重生成图标二进制**

Run: `yarn tauri icon src-tauri/icons/source/app-icon.svg`
Expected: 成功,覆写 `src-tauri/icons/` 下 `icon.png` / `icon.ico` / `icon.icns` / `*.png`(含 Square*Logo / StoreLogo)。

- [ ] **Step 4: 清理非本项目跟踪的平台目录(沿用前作约定)**

Run: `git status --porcelain src-tauri`
若生成了项目未跟踪的 `src-tauri/gen` 下 ios/android 图标目录(前作 spec 记录会出现),按既有约定移除,只保留 `src-tauri/icons` 资产:

```bash
# 仅当上一步 status 显示新出现 ios/android 图标目录时执行；按实际路径调整
git status --porcelain src-tauri | grep -Ei 'ios|android' || echo "无 ios/android 新增，跳过"
```

(若确有新增且非本仓跟踪,`rm -rf` 之;若本就跟踪则保留。以 `git status` 实际为准,勿误删既有跟踪文件。)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/icons/source/app-icon.svg src-tauri/icons
git commit -m "feat(icon): app icon → 大眼睛 + 捧鱼 tile, regenerate icon set

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 视觉验收总扫 + reduce-motion + GUI 验收

**Files:** 无(仅验证)

- [ ] **Step 1: type-check 全量**

Run: `yarn type-check`
Expected: 通过。

- [ ] **Step 2: 全量(非付费)单测确认未误伤**

⚠️ 按记忆,`yarn test`(= `vitest run`)会从 `~/.hip/config/auth.json` 重新播种 API key、可能触发付费实测。**确保不触发付费**:先把 `~/.hip/config/auth.json` 临时移走(陷阱-恢复),跑完再还原。本次只改前端 SVG/CSS,不动逻辑/sidecar,主要确认无连带破坏:

```bash
test -f ~/.hip/config/auth.json && mv ~/.hip/config/auth.json ~/.hip/config/auth.json.bak || true
yarn test
test -f ~/.hip/config/auth.json.bak && mv ~/.hip/config/auth.json.bak ~/.hip/config/auth.json || true
```

Expected: 既有逻辑/store 测试全绿;无付费 LLM 调用。

- [ ] **Step 3: hero 动画 + 静止双态截图**

dev server 已起(否则 `preview_start`)。`preview_screenshot` 登录页两次(间隔约 1–2s),比对:Expected 眨眼(眼整组偶尔压扁)、斜瞄(瞳孔移动)、抱爪轻揉、鱼小幅摆动,均自然、不打架。

- [ ] **Step 4: reduce-motion 兜底**

用 Preview 在模拟「减少动态」下复看(若 MCP 支持 emulate;否则系统开启「减少动态效果」后 `preview_screenshot`)。Expected:动画全停,构图不塌(小人 / 鱼 / 聚光静止且完整)。

- [ ] **Step 5: 手动 GUI 验收清单(沿用「GUI 验收优先」约定)**

逐项确认并记录:
- [ ] 登录页 hero = 摸鱼小人,蓝身借奶油聚光在蓝底清晰;动画自然。
- [ ] dock / 任务栏图标 = 蓝砖大眼睛 + 捧鱼(`yarn tauri dev` 或打包后看 dock 大图标看得清鱼)。
- [ ] favicon 仍为纯眼睛、16px 清晰(浏览器标签 / `/hip.svg`)。
- [ ] reduce-motion 下静态完整。

- [ ] **Step 6: 收尾确认无残留临时文件**

Run: `git status --porcelain`
Expected: 干净(无 `public/_tile-check.svg` 等临时文件遗留)。

- [ ] **Step 7:(可选)若验收中微调了坐标/动画幅度,补一次 commit**

```bash
git add -A
git commit -m "fix(logo): mascot 视觉验收微调

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review(已核对)

- **Spec 覆盖:** 调色板(Task 2 常量)✓;B hero 几何 + 聚光 + 动画(Task 1+2)✓;C tile/app 图标几何(Task 2+4)✓;favicon 纯眼睛不动(明确不改 `public/hip.svg`)✓;`minimal`/`mono` 不动(Task 2 逐字保留)✓;`hip-pet`/可选摆鱼(Task 1)✓;LoginScreen 注释(Task 3)✓;验收 type-check + 截图自检 + GUI(Task 5)✓;非目标(不加 `mascot` 变体、不动全局 token)——计划未引入,符合。
- **占位符:** 无 TBD/TODO;每个改动给出完整代码/SVG。
- **类型/命名一致:** `HugMascot({animated})`、`TileFish()`、`TileEyes({pupilR,highlight})` 在 Task 2 内定义并使用;CSS class `hip-mascot-glow`/`hip-pet`/`hip-fish-wiggle`/`hip-eyes-blink`/`hip-eyes-glance` 在 Task 1 定义、Task 2 引用,名称逐字一致;app-icon.svg 坐标与 `TileEyes`+`TileFish` 逐字对应。
- **顺序:** Task 1(class)先于 Task 2(引用 class);Task 4 图标在组件定稿后镜像。
