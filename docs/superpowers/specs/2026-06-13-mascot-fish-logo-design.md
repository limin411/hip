# hip 摸鱼小人 LOGO 升级 — 设计 & 接入 spec

**日期:** 2026-06-13
**状态:** 已批准方向(B+C),进入实现
**承接:** `2026-06-12-eyes-logo-design.md`(大眼睛)。本次在大眼睛基础上长出身体,不删眼睛 DNA。

## 背景 & 核心洞察

现标识是「一对大眼睛」(cream 眼白 + navy 瞳 + 白高光) 贴 `#0062AD` 蓝砖,主题「摸鱼」=
瞄一眼老板有没有在看。用户要在此基础上「画一个身体,拿着一条鱼在抚摸」。

关键洞察:**「摸鱼」字面就是「摸·鱼」**。给大眼睛接上身体、怀里抱一条鱼在抚摸,把「摸鱼」
从比喻变成字面画面。那两只大眼睛天然就是小人的脸——是大眼睛的有机延伸,不是替换。

经 3 方向真机渲染(A 抱鱼抚摸 / B 抱大鱼 / C 图标蓝砖),用户选定 **B + C**:

- **B(抱大鱼)= 全身吉祥物主形**,用于登录 hero(及未来浅底品牌位)。
- **C(蓝砖捧鱼)= 图标**,用于 app 图标 / dock / 应用内品牌徽标。

## 决策(用户已确认)

1. **登录 hero → B 吉祥物 + 奶油聚光**:小人蹲在奶油柔光上,保留眨眼 + 斜瞄,新增轻柔「抚摸」动作。
   (蓝身在蓝底会糊 → 用 cream 聚光衬底脱离,沿用登录页已有的奶油柔光语言。)
2. **app 图标 / dock → C**;**favicon 保持纯眼睛**(现 `public/hip.svg` / `minimal` 不动,16px 才清晰)。
3. 眼睛 DNA、cream/navy 隔离约定、reduce-motion 兜底全部沿用。

## 调色板(仅限 logo 局部,不进全局 token,沿用 cream/navy 隔离约定)

| 角色 | hex | 来源 |
|------|-----|------|
| 品牌蓝 / 身体 / 砖底 | `#0062ad` | 既有 BLUE |
| 眼白 cream | `#f4ecd8` | 既有 CREAM |
| 瞳孔 navy | `#003b68` | 既有 NAVY |
| 高光 white | `#ffffff` | — |
| 鱼身 coral | `#f0997b` | 新增 CORAL |
| 鱼尾/鳍/嘴 coral-deep | `#d85a30` | 新增 CORAL_DEEP |
| 鱼肚 coral-pale | `#f5c4b3` | 新增 CORAL_PALE |

coral 三色仅在 HipLogo 内声明(与 cream/navy 同级,不外泄全局)。橙珊瑚是蓝的互补色,鱼在蓝身上自然跳出。

## 几何 — B 吉祥物(hero / mascot),viewBox `0 0 160 178`

绘制顺序(z 由低到高):

1. **脚** ×2:`ellipse L(62,153) R(98,153) rx13 ry8` blue
2. **身体**:`ellipse (80,98) rx46 ry54` blue
3. **腮红** ×2:`ellipse L(49,64) R(111,64) rx6 ry3.4` coral opacity .5
4. **抱臂** ×2(blue stroke 17, linecap round, fill none):
   - L `M44 98 Q38 128 60 142`
   - R `M116 98 Q122 128 100 142`
5. **鱼尾**(在身后):`path M108 110 L128 100 L121 116 L129 130 Z` coral-deep
6. **鱼身**:`ellipse (80,118) rx34 ry30` coral
7. **鱼肚**:`path M48 124 Q80 150 112 124 Q80 140 48 124 Z` coral-pale opacity .85
8. **侧鳍**:`path M50 118 L40 112 L46 124 Z` coral-deep
9. **鱼的大眼睛** ×2(呼应品牌 DNA,但明显小于小人眼):
   - 眼白 `circle L(70,115) R(90,115) r7.5` cream
   - 瞳 `circle L(71,117) R(91,117) r3.4` navy
10. **鱼嘴(微笑)**:`path M72 131 q8 6 16 0` stroke coral-deep 2.4 round
11. **抱爪** ×2:`ellipse L(60,142) R(100,142) rx9 ry7` blue
12. **小人大眼睛**(主角,最上层):
    - 眼白 `circle L(63,53) R(97,53) r19` cream
    - 瞳(朝下瞄向鱼)`circle L(66,60) R(100,59) r8` navy
    - 高光 `circle L(62.5,55.5) R(96.5,54.5) r2.6` white

层级要点:小人眼 r19 > 鱼眼 r7.5,且小人眼在上方探头、鱼眼在下方,两对眼睛主次分明不打架。

## 几何 — C 图标蓝砖(tile / app 图标),viewBox `0 0 160 160`

1. **砖**:`rect x6 y6 w148 h148 rx34` blue
2. **鱼身**:`ellipse (80,121) rx31 ry11.5` coral
3. **鱼尾**:`path M53 121 L38 110 L46 121 L38 132 Z` coral-deep
4. **鱼肚**:`path M55 124 Q80 134 105 124 Q80 129 55 124 Z` coral-pale opacity .85
5. **鱼眼**:cream `circle (99,117) r4` + navy `circle (100,118) r2`
6. **托/摸爪** ×2:`ellipse 托(51,125) 摸(83,112) rx9 ry7` blue(右爪搭在鱼背上=抚摸)
7. **大眼睛**(照旧,略上移腾出鱼位):
   - 眼白 `circle L(58,60) R(102,60) r26` cream
   - 瞳 `circle L(66,68) R(110,67) r11` navy
   - 高光 `circle L(61.5,63.5) R(105.5,62.5) r3.4` white

## HipLogo 组件变体(API)

变体集不变:`variant: 'tile' | 'minimal' | 'hero' | 'mono'`,默认 `tile`。

| variant | 改动 | 用途 |
|---------|------|------|
| `tile` | **改** → C 几何(大眼睛 + 蓝砖 + 捧鱼) | app 图标 master / 应用内品牌徽标(默认) |
| `hero` | **重写** → B 吉祥物 + 奶油聚光 + 动画 | LoginScreen 登录左栏 |
| `minimal` | **不动**(纯眼睛蓝砖,瞳 r12,无高光) | 16px favicon 兜底 = `public/hip.svg` |
| `mono` | **不动**(透明底,描边眼 + 实心瞳 currentColor) | 菜单栏 / 单色场景 |

- 抽出内部 `HugMascot`(B 几何,纯 SVG group),`hero` 包裹它再叠聚光 + 动画 class。
- B 几何为 portrait(160×178)。`hero` 渲染时:宽 = `size`,高 = `size × 178/160 ≈ size×1.1125`。
  奶油聚光 = `hero` SVG 内一只 `ellipse (80,104) rx60 ry66` fill cream opacity .16,挂呼吸 class,
  绘于 mascot 之下。(取代旧 hero 的方形 div glow;新结构按 portrait 尺寸算。)
- 唯一 React 消费方是 LoginScreen(hero);改 `tile` 不波及任何现有页面。

## 动画(tokens.css)

复用现有(类名不变,直接挂到 B 的对应组):

- `hip-eyes-blink`(~4.5s)— 包小人**两只眼整组**,scaleY 瞬时压扁 = 眨眼。
- `hip-eyes-glance`(~5s)— 仅小人**瞳孔 + 高光**组,小幅扫视 = 偷瞄老板。
- `hip-glow-breathe`(3s)— 奶油聚光呼吸(挂到 hero 的 cream ellipse)。

新增:

- `hip-pet`(~3.2s ease-in-out)— 「抱臂 + 抱爪」组轻微挤压(`translateY 0→1px` + `scaleX 1→1.01` 往复)
  = 轻轻抚摸/抱紧。
- `hip-fish-wiggle`(~2.4s,可选)— 鱼身组小幅 `rotate ±1.5°` = 鱼被摸得很享受。

全部:`transform-box: fill-box; transform-origin: center`(wiggle 用鱼身中心);
靠既有 `@media (prefers-reduced-motion: reduce)` 全局兜底自动禁用。

## 接入清单(文件)

| 文件 | 改动 |
|------|------|
| `src/components/login/HipLogo.tsx` | 加 coral 三色常量;抽 `HugMascot`;`hero` 重写为 mascot + 聚光 + 动画;`tile` 改 C 几何;`minimal`/`mono` 不动 |
| `src/styles/tokens.css` | 复用 blink/glance/glow;新增 `hip-pet`(+ 可选 `hip-fish-wiggle`)keyframe & class |
| `src/routes/LoginScreen.tsx` | 注释「大眼睛 hero」→「摸鱼小人 hero」;用法不变(`variant="hero" size={260}`) |
| `src-tauri/icons/source/app-icon.svg` | 换成 C 几何(蓝砖 + 眼 + 捧鱼);注释更新 |
| 图标二进制 | `yarn tauri icon src-tauri/icons/source/app-icon.svg`(命令支持 SVG 直接输入) |
| `public/hip.svg` | **不动**(纯眼睛,favicon 决策) |
| `index.html` | **不动**(favicon 已是 `/hip.svg`,title 已 `hip`) |

## 验收

- `yarn type-check` 通过。
- 渲染自检:`hero` / `tile` / `minimal` / `mono` 全尺寸 + C 砖 @22/44px(Playwright 截图核对调色板/可读性)。
- GUI 验收(手动,沿用「GUI 验收优先」约定,纯 UI 无 LLM):
  - 登录页 hero 换成摸鱼小人,蓝身在蓝底借奶油聚光清晰可读;眨眼 / 斜瞄 / 抚摸动作自然不抢戏。
  - dock 图标换成 C(蓝砖捧鱼),大尺寸看得清鱼;favicon 仍为纯眼睛、16px 清晰。
  - reduce-motion 下动画全停、构图不塌。

## 非目标

- 不删大眼睛 DNA,不动全局 token,不把 cream/coral 提为全局色。
- 不重构 LoginScreen 其余部分。
- 暂不加独立 `mascot`(浅底静态 B)变体——当前无消费方,YAGNI;将来浅底内联/关于页/空状态有需求再加。
- favicon 不换 C(16px 鱼会糊),菜单栏 mono 暂不接。
