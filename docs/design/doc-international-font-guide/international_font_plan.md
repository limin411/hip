# hip 字体统一实施计划

> 配套设计文档：`international_font_guide.md`（同目录）
> 状态：计划定稿 · 2026-08 · 待执行

## 一、方案决策记录

**选定：方案 A（拉丁打包 + CJK 系统回退）** —— 打包 3 个拉丁可变字体包。

理由（基于产品定位：**英文优先，中文第二，全无衬线**）：

1. **主视觉面已统一**：英文优先 → 界面主视觉是拉丁文字，Inter / JetBrains Mono
   打包后三平台完全统一（方案 A 与 B 在这一点上无差别）。
2. **CJK 是次要面，不值得像素级投资**：中文第二 → 系统字体（macOS PingFang SC /
   Windows 微软雅黑 / Linux Noto Sans CJK SC）均为成熟黑体，三平台差异仅在字形
   细节，属可接受的次级差异 —— VS Code / Linear / Slack 等英文优先产品同款做法。
3. **体积账**：方案 B 为次要面多花 ≈ +19 MB（CJK 4 款 ≈ 18.5 MB），性价比低。
   方案 A 增量仅 ≈ +3.5 MB。
4. **升级路径保留**：若未来中文用户占比上升、或“任何字符像素级一致”成为硬指标，
   追加 4 个 CJK import 即升方案 B（§三 步骤 1 的注释内），token 与代码零改动。
5. **无衬线要求**：全栈无衬线（UI / Code / Reading 默认均无衬线），
   `--font-reading` 衬线档仅预留 token、不启用，符合产品定位。

明确不做（记录在案）：

- **CJK 不打包**（含 Mono CJK）：fontsource 无 Mono CJK 包；noto-cjk 仓库
  Mono CJK 可变字体单文件 ~30 MB × 4，性价比低。代码块/终端内 CJK 字符
  恒走系统等宽回退，行为与 VS Code 终端一致。
- **Reading 衬线档（`--font-reading`）不启用**：仅定义 token，默认无衬线。
- **导出 HTML 不内嵌字体**：独立文件，保持系统栈（见步骤 6）。

---

## 二、目标与非目标

目标：

- 五语言（en / zh-CN / zh-TW / ja / ko）界面与代码字体在三平台（macOS /
  Windows / Linux）渲染：**拉丁统一、CJK 无缺字、整体无衬线**；安装包增量 ≤ 5 MB。
- 全部接入点改造完成：全局 body / Tailwind token / 终端 / 知识库。

非目标：

- 不引入字体设置 UI、不新增字号档位、不改 i18n、不改 CSP / tauri.conf.json。
- 不打包任何 CJK 字体（本阶段）。

---

## 三、实施步骤

每阶段完成即提交（AGENTS.md：分阶段提交）。

### 步骤 0：设计文档修正（已完成 ✅）

- guide §3.3 决策表改为按语言主次选择（英文优先 → 方案 A）。
- guide §5.2：Mono CJK 恒走系统回退（两案均不打包）。
- guide §5.4：字体导入改为主入口 JS import（本仓库 PostCSS 无 postcss-import，
  CSS `@import` 包路径不可用）。

### 步骤 1：安装依赖（方案 A：3 个包）

```bash
yarn add @fontsource-variable/inter @fontsource-variable/jetbrains-mono \
  @fontsource-variable/noto-sans-mono
# 升级方案 B 时追加：
# yarn add @fontsource-variable/noto-sans-sc @fontsource-variable/noto-sans-tc \
#   @fontsource-variable/noto-sans-jp @fontsource-variable/noto-sans-kr
```

验证：`yarn tsc` 通过。提交 `feat(font): add fontsource variable font deps`。

### 步骤 2：主入口导入字体

文件：`src/main.tsx` —— 在 `import './styles/tokens.css'` **之前**追加：

```ts
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/noto-sans-mono'
```

验证：`yarn tauri dev` 启动无字体加载报错（DevTools Network 无 failed）。
提交 `feat(font): import bundled variable fonts`。

### 步骤 3：定义字体 token + 全局字体栈

文件：`src/styles/tokens.css`

1. `:root` 增加 `--font-ui / --font-code / --font-reading`（取 guide §5.1 原文）。
2. `body { font-family: … }` 改为 `var(--font-ui)`。
3. **保留不动**：macOS `-webkit-font-smoothing: antialiased`、Windows
   `html[data-platform="windows"]` ClearType 覆写、`color-scheme`。

验证：三平台 UI 文字已为 Inter；中英混排无跳变、中文无缺字。
提交 `feat(font): unified font tokens and body stack`。

### 步骤 4：Tailwind 字体 token

文件：`tailwind.config.js`

```js
fontFamily: {
  sans: ['var(--font-ui)'],
  mono: ['var(--font-code)'],
},
```

效果：CodeBlock、diff、各类 `font-sans/font-mono` 自动跟随，无需逐处改。
提交（可与步骤 3 合并提交）。

### 步骤 5：终端字体

文件：`src/components/artifact/XtermSurface.tsx`（约 L142）

```ts
fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
```

改为：

```ts
fontFamily: 'var(--font-code)',
```

注意：xterm.js 不支持连字，终端内 JetBrains Mono 无连字属预期（与 VS Code
终端一致），DOM 代码块保留连字。提交 `feat(font): terminal uses code font token`。

### 步骤 6：知识库字体对齐

文件：`src/components/knowledge/knowledge-doc-typography.css`

- `--kb-font-family` → `var(--font-ui)`（阅读区默认无衬线）
- `--kb-font-mono` → `var(--font-code)`
- 阅读字号 `--kb-font-body: 16px` 等保持不变

提交 `feat(font): align knowledge doc fonts with global tokens`。

### 步骤 7：导出 HTML —— 不改（记录决策）

`src/domain/knowledge/htmlExport.ts` 保持系统栈：

- 导出件是独立 HTML，不随应用打包；系统栈在任何机器上都不缺字。
- 内嵌 Inter base64（~+120 KB）列为可选增强，本次不做。

### 步骤 8：验证与体积测量

```bash
# 类型与单测（注意：先临时移走 ~/.hip/config/auth.json 防止触发付费 LLM 测试）
mv ~/.hip/config/auth.json ~/.hip/config/auth.json.bak
yarn tsc
yarn test
mv ~/.hip/config/auth.json.bak ~/.hip/config/auth.json

# 构建后测量字体资源体积
yarn tauri build
du -sh dist/assets   # 与改造前基线对比，增量应 ≈ +3.5 MB
```

手工验收（guide §9 清单，三平台各跑一遍）：

- [ ] UI 英文（Inter）三平台一致；zh-CN / zh-TW / ja / ko 切换无缺字乱码
- [ ] 代码块：JetBrains Mono + 连字；中文注释等宽回退
- [ ] 终端：等宽生效、中文无缺字、无连字（预期）
- [ ] 知识库文档正文/代码块跟随统一栈，阅读字号不变
- [ ] 深浅色主题正常；mac 抗锯齿 / Win ClearType 正常
- [ ] 字重 400/500/600/700 无伪粗
- [ ] 安装包增量符合预算（≤ 5 MB）

---

## 四、风险与回退

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 旧版 WebKitGTK 不支持可变字体（< 2.30，2020 前发行版） | 该字体 @font-face 失效 → 回退系统字体 | 可接受降级；如 Linux 验收发现问题，改用 fontsource 静态包（`@fontsource/inter` 等） |
| Linux 未装中文字体（无 fonts-noto-cjk） | 中文缺字（次要面，英文界面不受影响） | 栈尾有 Noto Sans CJK SC 族名，装了即命中；发行版普遍预装；如成为问题可单独升级方案 B |
| 3 款字体加载影响首屏 | 极小（本地磁盘读取 + unicode-range 按需） | font-display: swap 已内置；验收时确认无 FOUT 抖动 |
| 安装包体积超预期 | +3.5 MB 超预算 | 砍掉 Noto Sans Mono（~1.4 MB，仅代码回退用）或按需子集化 |

## 五、工作量估计

| 阶段 | 估计 |
| --- | --- |
| 步骤 1–2（依赖 + 导入） | 0.5 h |
| 步骤 3–4（token + Tailwind） | 0.5 h |
| 步骤 5–6（终端 + 知识库） | 0.5 h |
| 步骤 8（验证 + 三平台验收） | 2–3 h（含打包体积测量） |
| **合计** | **约 4–5 h** |
