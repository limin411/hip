# hip 终端内置 Nerd Font 图标字体 SPEC

> 状态：SPEC 定稿 · 2026-08 · 待评审
> 关联文档：`docs/design/doc-international-font-guide/`（UI/代码字体统一方案，已落地）、
> `src/components/artifact/XtermSurface.tsx`（xterm 宿主）、`src/styles/tokens.css`（字体栈）、
> `src-tauri/src/ssh_session.rs`（SSH pty 协商）

## 一、背景与问题（TL;DR）

1. **问题**：用户通过 hip 管理远程 SSH 终端时，界面比 Termius "粗糙"。
   根因排查（见 `terminal_nerd_font_spec.md` 附件调研结论）已排除服务器侧（hip 与 Termius
   同样协商 `xterm-256color` pty，256 色 / truecolor 均支持），差异集中在**客户端渲染**。
2. **本 SPEC 只解决其中可解决的最大一块：终端图标字形缺失**。
   远端 shell 提示符（powerlevel10k、starship、oh-my-zsh）与工具（lsd、eza）大量使用
   **Nerd Font 私有区图标**（U+E000–U+F8FF）。hip 当前字体栈无任何 Nerd Font，这些字符
   fallback 成系统字体甚至豆腐块 → 错位、粗细不一、观感粗糙。Termius 内置 Nerd Fonts，
   故显示完美。
3. **方案**：在应用内**内置子集化的 JetBrainsMono Nerd Font（Mono 变体）**，仅作用于
   xterm 终端表面（不污染全局字体栈），用户无需自行安装任何字体。
4. **文字抗锯齿 / 渲染锐度差异（canvas vs 原生）不在本 SPEC 范围**：那是 WKWebView
   canvas 渲染与原生渲染的引擎差异，字体内置无法解决（见 §3 非目标）。

## 二、现状与事实核查

| # | 事实 | 依据 |
| --- | --- | --- |
| 1 | hip 已打包 3 个拉丁可变字体（Inter / JetBrains Mono / Noto Sans Mono），经 `@fontsource-variable/*` 走 Vite 进前端资源 | `package.json:89-91`、`src/main.tsx:10-12` |
| 2 | `--font-code` 栈：`'JetBrains Mono Variable' → 'JetBrains Mono' → 'Noto Sans Mono' → CJK Mono → ui-monospace/SF Mono/Menlo/Consolas/monospace`，**无任何 Nerd Font** | `src/styles/tokens.css:147-154` |
| 3 | xterm 宿主硬编码 `fontFamily: 'var(--font-code)'`、`fontSize: 13`、`lineHeight: 1.25`，未配 fontWeight / 渲染器 | `XtermSurface.tsx` Terminal 构造 |
| 4 | SSH 侧协商 `xterm-256color` pty（256 色 / truecolor 均支持） | `ssh_session.rs:737` |
| 5 | CSP `font-src 'self' data:` —— 同源 woff2 天然放行，**无需改 CSP** | `international_font_guide.md §1.4` |
| 6 | npm 上**无** Nerd Font 的 fontsource 包（已查 registry），无可用 `nerd-fonts` npm 包 → 必须自建下载+子集化流水线 | 2026-08 registry 核查 |
| 7 | `subset-font@2.5.0`（harfbuzz wasm 纯 JS 子集化器，输出 woff2）可作 devDependency，工具链不引入 Python | registry 核查 |
| 8 | Nerd Fonts 上游以「每家族 zip」发布（如 `JetBrainsMono.zip`，内含 `JetBrainsMonoNerdFontMono-Regular.ttf`），另有 `NerdFontsSymbolsOnly.zip` | ryanoasis/nerd-fonts release 惯例（实现时钉定具体 tag） |
| 9 | 仓库已有第三方组件合规先例：NOTICE 记录 whisper.cpp（MIT） | `NOTICE` |
| 10 | 文档惯例：`docs/design/doc-*/` 目录 + 状态头 | `doc-international-font-guide/` |

**结论**：唯一缺口是 Nerd Font 图标字形；基础拉丁字形已由 fontsource 包内置（用户缺失
JetBrains Mono 的场景已覆盖），因此本 SPEC **只新增图标覆盖，不重复打包拉丁正文**。

## 三、目标与非目标

### 目标（v1）
1. 应用内置 Nerd Font 图标字形，xterm 终端内 p10k / starship / lsd / eza / btop 等图标
   全部按设计渲染，无豆腐块、无错位。
2. 用户零安装：不需要用户本机装任何字体，三平台（macOS / Windows / Linux WebView）一致。
3. 拉丁字形观感零回归：终端正文仍优先使用已打包的 JetBrains Mono Variable。
4. 体积可控：双字重 woff2 合计 ≤ 3 MB（硬上限 4 MB）。
5. 可复现构建：版本钉定 + sha256 校验，产物提交进仓库，离线可构建。

### 非目标（明确不做）
1. **文字锐度 / 抗锯齿**：canvas 与原生渲染的引擎差异，字体内置无法解决。
2. **全局字体栈改造**：`--font-code` 不动，代码块 / 知识库等 DOM 场景保持
   Variable 字体（保留字重轴，避免静态字重破坏 CSS `font-weight: 500` 等取值）。
3. **连字（ligature）**：xterm.js 不支持，需改渲染器，另行评估。
4. **斜体字重**：xterm.js 无独立斜体字重选择，v1 不内置 Italic。
5. **CJK 字形**：终端内 CJK 继续走系统回退（与现有方案一致）。
6. **可配置字体覆盖**（`terminal.fontFamily` 用户偏好键）：列为 v2 可选增强，v1 不做。

## 四、方案设计

### 方案 A：完整 PUA 子集化 JetBrainsMono Nerd Font（推荐）

- 来源：`JetBrainsMono.zip`（Nerd Fonts 官方 release）中的 **Mono 变体**
  `JetBrainsMonoNerdFontMono-Regular.ttf` / `-Bold.ttf`（Mono 变体保证图标严格单格宽，
  不破坏 xterm 对齐）。
- 子集化（`subset-font`）为 woff2，保留字形见 §5.1；族名保持
  `JetBrainsMono Nerd Font Mono`。
- 集成方式：**仅 xterm 表面**引用，字体栈改为
  `'JetBrainsMono Nerd Font Mono', var(--font-code)`；`--font-code` 全局不动。
- 优点：单一族、无跨族 fallback 对齐风险、行为最接近 Termius；PUA 全量收录，
  任何 Nerd 图标（含冷门）都渲染。
- 缺点：需自建流水线；与 fontsource 的 JetBrains Mono 版本存在轻微漂移
  （nerd-fonts 打包的是其发布时刻的 JetBrains Mono 源），ASCII 观感可能有亚像素级差异。

### 方案 B：SymbolsOnly 辅助层（备选）

- 仅内置 `NerdFontsSymbolsOnly`（或它的子集），挂在字体栈**末尾**：
  `var(--font-code), 'Symbols Nerd Font'`。
- 优点：体积最小（≈0.5–1 MB 单字重）、ASCII 零改动。
- 缺点：两族 fallback；xterm 对跨族字形按 `measureText` 逐个测宽（可工作），但
  图标宽度对齐依赖 SymbolsOnly 的单格设计，出问题面更大；且正文缺字时会先走
  系统中文字体再落到图标族，fallback 语义混乱。

### 决策表

| 维度 | 方案 A | 方案 B |
| --- | --- | --- |
| 图标覆盖 | 全量 PUA | 全量 PUA（SymbolsOnly 本身即全量） |
| 对齐风险 | 低（单族） | 中（跨族 fallback） |
| 体积 | ≤ 3 MB（双字重） | ≤ 1 MB（单字重） |
| ASCII 观感 | 与原字体同源，亚像素漂移 | 零改动 |
| 与 Termius 行为一致性 | 高 | 中 |
| 流水线复杂度 | 中 | 低 |

**选定：方案 A**（v1）。理由：对齐风险是终端渲染的正确性红线，体积 3 MB 对桌面应用可接受；
若实施时实测 woff2 超 4 MB 硬上限，降级策略见 §5.3（退化为常用图标子集，属方案 A 的
受限形态，不切换到 B）。

## 五、字体资产与子集化规范

### 5.1 子集化保留字形（text 参数）

| 段 | 范围 / 内容 | 用途 |
| --- | --- | --- |
| ASCII | U+0020–U+007E | 正文、提示符基础 |
| Latin-1 | U+00A0–U+00FF | 欧洲语言、不间断空格 |
| 印刷符号 | U+2010–U+2015、U+2018–U+201D、U+2026、U+2190–U+21FF（箭头）、U+2500–U+259F（制表符+块元素）、U+2B00–U+2BFF（杂项符号） | 边框、进度条、方向指示（htop/btop/tmux） |
| **Nerd Font 私有区** | **U+E000–U+F8FF 全量** | 所有 Nerd 图标（p10k/starship/lsd/eza 等全部依赖此段） |

> 注：U+E000–U+F8FF 全量收录 ≈ 6400 个码位，是图标覆盖的"不做任何裁剪"承诺；
> 冷门图标也渲染，无需维护"常用图标清单"。subtext 构建时由脚本程序化生成。

### 5.2 体积预算

- 预计：单字重 woff2 ≈ 0.8–1.5 MB，双字重合计 ≈ 2–3 MB（PUA 图标为体积主体）。
- 目标 ≤ 3 MB；**硬上限 4 MB**。流水线产物报告实际数值。
- 对比：whisper 组件体积先例（官方包默认内置），3 MB 级别可接受。

### 5.3 超限降级策略

若实测超 4 MB：改为「常用图标子集」——保留 PUA 中 p10k 官方配置、starship、lsd、eza、
bat、btop、tmux、git（``/`` 等）实际引用的码位并落盘为
`scripts/nerd-icon-includes.json`（附引用出处注释），文档化"冷门图标回退系统字体"。
此降级不改变方案 A 的族结构。

### 5.4 版本钉定与校验

- `scripts/font-manifest.json`（新文件）固定：上游 tag（如 `v3.3.0`，实施时取当时最新
  稳定 tag 并写死）、zip 的 **sha256**、内部 ttf 的 sha256、子集化参数（§5.1）。
- 流水线下载后先验 sha256 再解压，任何不匹配即失败退出。
- **生成产物（woff2）提交进 git**：与仓库内 icons/、resources/ 二进制先例一致，
  CI/离线环境 `yarn install && yarn build` 无需网络。

## 六、前端集成

### 6.1 @font-face（新文件 `src/styles/terminal-fonts.css`，由 `XtermSurface.tsx` 按需 import）

```css
@font-face {
  font-family: 'JetBrainsMono Nerd Font Mono';
  src: url('/fonts/nerd/JetBrainsMonoNerdFontMono-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'JetBrainsMono Nerd Font Mono';
  src: url('/fonts/nerd/JetBrainsMonoNerdFontMono-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

- 资产放 `public/fonts/nerd/`（Vite 复制到 dist 根，dev/prod 均以 `/fonts/nerd/…` 可达；
  Tauri 生产走自定义协议同源，CSP `font-src 'self' data:` 放行，无需改 CSP、
  无需动 `tauri.conf.json`）。
- **不写进全局 tokens.css**：CSS 文件按需随终端懒加载（与 xterm 本身 lazy import 对齐）。

### 6.2 xterm 字体栈（`XtermSurface.tsx` 单点改动）

```
fontFamily: "'JetBrainsMono Nerd Font Mono', var(--font-code)",
```

- 族名带引号；缺失字形（如 emoji）继续沿 `var(--font-code)` 回退，行为不变。
- `--font-code` 与 tailwind 全局不动 → 代码块 / 知识库零回归（保留 Variable 字重轴）。

### 6.3 加载时序（关键，防 xterm 测量错位）

xterm 在 `open()` 时按字体度量单元格；若字体在 `open()` 后才加载，首屏行宽错位、
图标叠字。**必须在创建 Terminal 前完成字体加载**：

1. 现有 boot 流程 `await import('@xterm/xterm')` 之后、`new Terminal()` 之前插入：
   ```ts
   const family = '"JetBrainsMono Nerd Font Mono"'
   await Promise.race([
     Promise.all([
       document.fonts.load(`400 13px ${family}`),
       document.fonts.load(`700 13px ${family}`),
       document.fonts.ready,
     ]),
     new Promise((r) => setTimeout(r, 1500)), // 兜底：字体失败不阻塞终端启动
   ])
   ```
   （字号常量与 Terminal 构造的 `fontSize: 13` 同源，建议提为模块级常量。）
2. 字体加载失败 / 超时：终端照常以回退栈运行，行为等同于现状，无硬失败。

### 6.4 与现有主题的关系

图标字形随终端主题前景色渲染（字体文件本身无色），light/dark 与 16 色板均无需改动；
`resolveXtermTheme` 不感知字体。

## 七、构建流水线（`scripts/fetch-nerd-font.mjs`）

新增脚本 + `subset-font`（devDependency，纯 JS，不引入 Python）：

```
fetch-nerd-font.mjs
  1. 读 scripts/font-manifest.json（tag + sha256）
  2. 下载 JetBrainsMono.zip（GitHub release）→ 验 sha256 → 解压
  3. 取 JetBrainsMonoNerdFontMono-{Regular,Bold}.ttf → 验 ttf sha256
  4. subset-font 子集化（§5.1 范围）→ public/fonts/nerd/*.woff2
  5. 报告体积（对照 §5.2 预算，超 4 MB 时按 §5.3 降级并提示）
  6. 幂等：产物已存在且 manifest 未变 → 跳过（离线友好）
```

- 运行方式：`yarn fonts:fetch`（package.json 新 script）；**不挂进 install/build
  钩子**（产物已提交，构建期零网络）。
- 升级流程：改 manifest 版本与 sha256 → 跑脚本 → 提交新 woff2 + manifest。

## 八、授权合规

| 组件 | 授权 | 义务 |
| --- | --- | --- |
| JetBrains Mono（OFL 1.1 基础字体，随 Nerd Font 包分发） | SIL OFL 1.1 | 保留版权声明、不得单独售卖字体文件；打包分发需附许可证文本 |
| Nerd Fonts 补丁脚本 / 分发 | MIT（字体文件本身仍为其上游授权） | 保留 MIT 版权声明 |

落地动作：
1. `public/fonts/nerd/LICENSE-OFL.txt`：OFL 1.1 全文 + JetBrains Mono 版权行。
2. `public/fonts/nerd/LICENSE-NerdFonts.txt`：Nerd Fonts MIT 声明。
3. `NOTICE` 增加条目（参照 whisper 段落格式）：组件名、授权、来源 URL、版本。
4. `scripts/font-manifest.json` 记录上游源 URL 与版本，保证来源可溯。

## 九、测试计划

### 9.1 自动化（Vitest，随仓库现有测试体系）
1. `terminalTheme.test.ts` 旁新增：断言 `src/components/artifact/XtermSurface.tsx`
   的 `fontFamily` 以 `'JetBrainsMono Nerd Font Mono'` 开头（防回归）。
2. 新增测试：`public/fonts/nerd/` 下两个 woff2 存在且非空、manifest 存在
   （轻量资产完整性断言）。
3. `scripts/font-manifest.json` 与产物清单一致性的脚本自检（`yarn fonts:verify` 可选）。

### 9.2 手动验收矩阵（三平台 × 场景）

| 场景 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| 本地 PTY 终端 + p10k 提示符（含图标段） | ✅ | ✅ | ✅ |
| SSH 远程终端（starship 主题） | ✅ | ✅ | ✅ |
| lsd / eza 文件列表图标 | ✅ | ✅ | ✅ |
| btop / htop 边框与块元素 | ✅ | ✅ | ✅ |
| tmux 状态栏符号 | ✅ | ✅ | ✅ |
| 终端内中文混排（回退 CJK） | ✅ | ✅ | ✅ |
| 浅色 / 深色 / 三种 colorTheme 切换后图标仍在 | ✅ | ✅ | ✅ |
| 首开终端无字体闪烁 / 行宽错位 | ✅ | ✅ | ✅ |
| 断网冷启动（离线构建产物） | ✅ | ✅ | ✅ |

判定标准：无豆腐块、图标单格对齐、与 Termius 同机同主题对比无明显缺失。

## 十、风险与回滚

| 风险 | 概率 | 缓解 |
| --- | --- | --- |
| woff2 超体积预算 | 中 | §5.3 降级策略；产物报告实测值 |
| nerd-fonts 上游 tag 变动 / 资产改名 | 低 | manifest 钉定 + sha256 校验，脚本失败即红 |
| 与 fontsource JetBrains Mono 版本漂移致 ASCII 观感微变 | 低 | 子集仅影响终端表面；验收矩阵含目测项 |
| `document.fonts` 加载拖慢首开终端 | 低 | 1500 ms 兜底超时；字体仅终端懒加载 |
| WebKitGTK / WebView2 woff2 兼容性 | 极低 | woff2 三 WebView 均支持（现代版本）；验收矩阵覆盖 |

回滚：删除 XtermSurface 的字体栈前缀与 lazy import、移除 `public/fonts/nerd/`，
即可整体还原；无 schema / 配置迁移负担。

## 十一、实施步骤（建议拆分）

1. **P0**：`scripts/fetch-nerd-font.mjs` + `font-manifest.json` + `subset-font` 依赖，
   产出 woff2 并提交（含体积报告）。
2. **P0**：`src/styles/terminal-fonts.css` + `public/fonts/nerd/` 落位。
3. **P0**：`XtermSurface.tsx` 两处改动：字体栈前缀 + boot 时序 `document.fonts` 等待。
4. **P0**：授权文件（OFL / MIT）+ `NOTICE` 条目。
5. **P1**：自动化测试（§9.1）。
6. **P1**：三平台手动验收矩阵（§9.2）。
7. **P2（可选，v2）**：`terminal.fontFamily` 用户覆盖键。

## 十二、验收标准（Definition of Done）

1. `yarn fonts:fetch` 从 manifest 可复现产物；双 woff2 已提交，`yarn build` 产物含
   `/fonts/nerd/*.woff2`。
2. xterm 终端字体栈首项为 `'JetBrainsMono Nerd Font Mono'`；首开终端先等字体后建
   Terminal（有超时兜底）。
3. 三平台 × 验收矩阵全绿；与 Termius 同服务器对比，p10k / starship 图标无缺失、无错位。
4. 全局 `--font-code`、代码块、知识库渲染零回归（回归面 = 终端表面改动）。
5. NOTICE 与 LICENSE 文件齐全；CSP / tauri.conf.json 零改动。
6. 体积报告 ≤ 3 MB（硬上限 4 MB），记录在实施 PR 描述中。
