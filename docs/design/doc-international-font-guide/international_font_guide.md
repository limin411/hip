# hip 国际化字体方案（跨平台统一）

> 状态：草稿 v2 · 2026-08 · 对齐当前产品（Tauri v2 + React 18 + Tailwind）
> 本文档取代旧版草稿。旧稿的通用性表述（“适用于 Codex / OpenCode 类产品”）
> 保留其思路，但族名、授权、字号、交付方式均按本产品与当前事实修正。

## 一、结论（TL;DR）

1. 三层字体体系：**UI（Inter）→ Code（JetBrains Mono）→ 阅读（Noto Sans，衬线可选）**。
2. “跨平台统一”必须靠**打包字体**，不能靠系统字体栈（三平台系统字体不同：
   macOS SF/PingFang、Windows Segoe UI/微软雅黑、Linux 自由字体）。
3. 两档方案的取舍看**语言主次**（决策表见 §3.3）：
   - **方案 A（拉丁打包 + CJK 系统回退，≈+3.5 MB）**：适合**英文优先**产品 —— 本产品现状。
     拉丁（主视觉面）三平台完全统一，CJK（次要面）走系统回退（macOS PingFang SC /
     Windows 微软雅黑 / Linux Noto Sans CJK SC），均为成熟黑体。
   - **方案 B（追加 4 个 CJK 可变字体，≈+22.5 MB）**：适合中文/日韩为主，或“任何字符必须像素级一致”的硬指标。
     实现上按 A 落地，升级 B 只差 4 个 import。
4. 交付方式：走 Vite 打包进前端资源（`@fontsource-variable/*` npm 包），
   现有 CSP `font-src 'self' data:` 已兼容，**无需改 CSP、无需动 tauri.conf.json**。
5. 旧稿勘误：①“Noto Sans Mono CJK”不是真实族名（见 §4.1）；
   ②Noto Sans CJK 授权已从 Apache 2.0 改为 **SIL OFL 1.1**（2.004 起）；
   ③字号表与产品现有 token 体系冲突，作废，沿用产品 token（§7）。

---

## 二、产品约束与字体触点现状

### 2.1 运行平台与语言

| 维度 | 现状 |
| --- | --- |
| 桌面框架 | Tauri v2，前端为 WebView：macOS WKWebView / Windows WebView2 / Linux WebKitGTK |
| UI 技术 | React 18 + Tailwind，`src/styles/tokens.css` 为全局样式入口 |
| 语言 | 5 个 locale：`en` / `zh-CN` / `zh-TW` / `ja` / `ko`（`src/i18n/`，fallback zh-CN） |
| 代码渲染 | 聊天代码块（DOM）+ xterm 终端（`XtermSurface.tsx`） |
| 阅读区 | 知识库文档（BlockNote，`knowledge-doc-typography.css` 定义字体变量） |
| 导出 | `htmlExport.ts` 生成独立 HTML（不能引用打包字体，见 §6.6） |
| CSP | `font-src 'self' data:` —— 同源打包字体天然放行 |

### 2.2 现有字体触点清单（改造范围）

| # | 位置 | 现状 | 动作 |
| --- | --- | --- | --- |
| 1 | `src/styles/tokens.css` body | 纯系统栈（`system-ui, -apple-system, …`） | 换为统一栈（§5.1） |
| 2 | `tailwind.config.js` `fontFamily.sans/mono` | 与 1 同源的两套系统栈 | 同步统一栈 |
| 3 | `src/components/artifact/XtermSurface.tsx` | 硬编码 `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas` | 改引 `--font-code` |
| 4 | `src/components/knowledge/knowledge-doc-typography.css` | `--kb-font-family` / `--kb-font-mono` 各自系统栈 | 对齐 `--font-ui` / `--font-code` |
| 5 | `src/domain/knowledge/htmlExport.ts` | 系统栈 | 保持系统栈 + 可选内嵌拉丁（§6.6） |
| 6 | `src/components/chat/CodeBlock.tsx` | 用 `font-mono`（跟随 #2，无需改） | — |

---

## 三、统一策略：两档方案

系统字体在“统一性”上的问题：macOS 的 PingFang 与 Windows 的微软雅黑、
Linux 的 Noto Sans CJK 字形与字距明显不同；Windows 的 Segoe UI 与 macOS 的
SF Pro 观感差异更大。**只改字体栈不解决统一，必须打包。**

### 3.1 方案 A：拉丁打包 + CJK 系统回退（推荐默认落地）

打包（可变字体，全字重一档搞定）：

| 字体 | 包 | 约体积 | 用途 |
| --- | --- | --- | --- |
| Inter | `@fontsource-variable/inter` | ~1.9 MB | UI 拉丁（含希腊/西里尔/越南文） |
| JetBrains Mono | `@fontsource-variable/jetbrains-mono` | ~0.2 MB | 代码拉丁 |
| Noto Sans Mono | `@fontsource-variable/noto-sans-mono` | ~1.4 MB | 代码拉丁兜底（未随 CJK 打包时的等宽回退） |

CJK 回退链：`PingFang SC / Hiragino Sans GB`（macOS）→
`Microsoft YaHei UI / Microsoft YaHei`（Windows）→ `Noto Sans CJK SC`（Linux，
多数发行版预装 `fonts-noto-cjk`）。

- ✅ 安装包 +约 3.5 MB；拉丁界面/代码三平台完全统一；
  CJK 三平台都是成熟黑体，字号、行高、粗度一致，观感差异在可接受范围。
- ⚠️ 差异仅在 CJK 字形细节（如“门/直”钩角、撇捺弧度）；
  Linux 未装 CJK 字体时中文会缺字（少见，发行版普遍带 `fonts-noto-cjk`）。

### 3.2 方案 B：全量打包（严格统一）

在 A 基础上追加 4 个 CJK 可变字体：

| 字体 | 包 | 约体积 |
| --- | --- | --- |
| Noto Sans SC（简体） | `@fontsource-variable/noto-sans-sc` | ~4.8 MB |
| Noto Sans TC（繁体） | `@fontsource-variable/noto-sans-tc` | ~4.5 MB |
| Noto Sans JP（日文） | `@fontsource-variable/noto-sans-jp` | ~5.5 MB |
| Noto Sans KR（韩文） | `@fontsource-variable/noto-sans-kr` | ~3.7 MB |

（以上为 npm 包 unpacked 体积，含全部 unicode-range 分块 woff2，属上限值；
均为可变字体，100–900 字重一个文件。）

- ✅ 五语言字形三平台像素级一致；离线/断网一致；Linux 无条件可用。
- ⚠️ 安装包 +约 19 MB；首次字体加载略增（本地读取，可忽略）。

### 3.3 决策

按产品语言主次选择：

| 产品语言主次 | 选择 | 理由 |
| --- | --- | --- |
| **英文优先（本产品现状）** | **方案 A** | 主视觉面（拉丁）已三平台统一；CJK 为次要面，系统字体（PingFang / 微软雅黑 / Noto CJK）均为成熟黑体，字形差异属次级差异，业界惯例可接受（VS Code / Linear / Slack 同款做法）；省 19 MB |
| 中文 / 日韩为主 | 方案 B | CJK 成为主视觉面时，像素级统一才值得 +19 MB 的成本 |
| “任何字符必须像素级一致”为硬指标 | 方案 B | 极端统一需求 |

实现上仍按 A 落地骨架（token、导入、触点改造全部通用），
后续若语言主次变化，追加 4 个 CJK 包即可升级 B（只差一个开关）。

---

## 四、三层字体体系与族名勘误

### 4.1 旧稿勘误表

| 旧稿说法 | 问题 | 修正 |
| --- | --- | --- |
| `"Noto Sans Mono CJK"` | **不是真实字体族名** | 真实族名按语言拆分：`Noto Sans Mono CJK SC / TC / JP / KR`（noto-cjk 仓库）；Google Fonts 另有 `Noto Sans Mono`（仅拉丁/希腊/西里尔，~390 KB/字重） |
| Noto Sans CJK 授权 “Apache License 2.0” | 过时 | **2.004（2021-04）起为 SIL OFL 1.1**；Noto Serif CJK 同为 OFL 1.1 |
| Noto Serif 授权 “开源字体授权” | 含糊 | SIL OFL 1.1 |
| 字号表（Sidebar 13 / Button 14 / Chat 15 / Title 24 …） | 与产品 token 体系分叉 | 作废，沿用产品 token（§7） |
| 只给字体栈，未说明交付 | 不解决“统一” | 本版明确：Vite 打包 + `@fontsource-variable/*`（§5.4） |
| 语言覆盖只有中/英/日/韩 | 缺其他脚本兜底与 emoji | 见 §5.3 |

### 4.2 三层体系（修正后）

| 层 | 用途 | 主字体 | CJK 配套 |
| --- | --- | --- | --- |
| 1. UI Interface Font | 界面、菜单、设置、导航、聊天正文 | Inter | Noto Sans SC / TC / JP / KR（方案 B 打包；否则系统回退） |
| 2. Code Font | 代码块、终端、diff | JetBrains Mono | 等宽 CJK 两案均不打包（fontsource 无 Mono CJK 包），恒走系统等宽回退（如 Linux fonts-noto-cjk 的 Noto Sans Mono CJK SC），行为与 VS Code 终端一致 |
| 3. Reading Font | 知识库文档、Markdown 长文 | Noto Sans（默认跟随 UI，避免字体跳变） | Noto Serif SC 等作**可选衬线档**（产品决策，默认不启用） |

要点：

- **族名按语言拆分是必须的**：CJK 字体没有“一个族名覆盖五语言字形规范”的
  CSS 写法，只能按 `SC/TC/JP/KR` 逐语言列出，由浏览器按字形命中。
  这与本产品五语言 i18n 一一对应。
- **Reading 默认用无衬线**（= UI 字体栈），与知识库现状一致；
  衬线仅作为可选项预留（`--font-reading`），不改变默认渲染。

---

## 五、字体栈定义（落地）

### 5.1 三个 Token（写入 `src/styles/tokens.css` 的 `:root`）

```css
/* 拉丁打包字体 + 五语言 CJK + 系统回退 + emoji 兜底 */
--font-ui:
  'Inter Variable', 'Inter',
  'Noto Sans SC Variable', 'Noto Sans SC',
  'Noto Sans TC Variable', 'Noto Sans TC',
  'Noto Sans JP Variable', 'Noto Sans JP',
  'Noto Sans KR Variable', 'Noto Sans KR',
  'PingFang SC', 'Hiragino Sans GB',
  'Microsoft YaHei UI', 'Microsoft YaHei',
  'Noto Sans CJK SC', 'Noto Sans CJK TC', 'Noto Sans CJK JP', 'Noto Sans CJK KR',
  'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji',
  sans-serif;

/* 代码：JetBrains Mono（DOM 内支持连字）→ 拉丁等宽 → CJK 等宽 → 系统等宽 */
--font-code:
  'JetBrains Mono Variable', 'JetBrains Mono',
  'Noto Sans Mono',
  'Noto Sans Mono CJK SC', 'Noto Sans Mono CJK TC',
  'Noto Sans Mono CJK JP', 'Noto Sans Mono CJK KR',
  ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas,
  monospace;

/* 可选衬线阅读档（默认不启用） */
--font-reading:
  'Noto Serif', 'Noto Serif SC Variable', 'Noto Serif SC',
  'Noto Serif TC', 'Noto Serif JP', 'Noto Serif KR',
  'Songti SC', 'SimSun', serif;
```

> 族名带 ` Variable` 后缀是 `@fontsource-variable/*` 包的默认 family；
> 若想不带后缀（更简洁），用自定义 `@font-face` 重命名（§5.4 附注）。
> 栈内同时列 `'Inter Variable', 'Inter'` 是为了兼容“重命名方案”与
> “系统已装 Inter”两种情况，多余条目会被浏览器直接跳过，无成本。

### 5.2 语言覆盖

| 语言 / 脚本 | 方案 A（拉丁打包） | 方案 B（追加 CJK 打包） |
| --- | --- | --- |
| English（Latin） | **Inter（打包，统一）** | 同 A |
| 简体中文 | PingFang SC / 微软雅黑 / Noto Sans CJK SC（系统） | **Noto Sans SC（打包，统一）** |
| 繁体中文 | 同 zh-CN 系统回退 | **Noto Sans TC** |
| 日本語 | 系统 Hiragino / Yu Gothic / Noto Sans CJK JP | **Noto Sans JP** |
| 한국어 | 系统 Apple SD Gothic / Malgun Gothic / Noto Sans CJK KR | **Noto Sans KR** |
| 代码等宽（CJK 字符） | 系统等宽回退 | 同 A：**恒走系统等宽回退，两案均不打包**（fontsource 无 Mono CJK 包；noto-cjk 仓库 Mono CJK 单文件 ~30 MB，性价比低）。`--font-code` 栈内的 Mono CJK 族名保留，仅在系统已装时命中（如 Linux fonts-noto-cjk）。行为与 VS Code 终端一致，可接受 |

### 5.3 其他脚本与 emoji 兜底

- 拉丁之外的西文脚本（希腊、西里尔、越南文）：Inter 自带覆盖。
- 阿拉伯、希伯来、泰文、天城文等：不在打包范围内，由系统字体兜底
  （macOS Geeza Pro / Arial，Windows Arial / Leelawadee，Linux Noto 系列），
  属可接受行为 —— 本产品界面文案只有 5 个 locale，这些脚本仅出现在用户内容里。
- emoji：栈尾显式列出 `Apple Color Emoji / Segoe UI Emoji / Noto Color Emoji`。

### 5.4 打包与导入（Tauri + Vite）

```bash
# 方案 A（默认）
yarn add @fontsource-variable/inter @fontsource-variable/jetbrains-mono @fontsource-variable/noto-sans-mono
# 方案 B（严格统一）追加
yarn add @fontsource-variable/noto-sans-sc @fontsource-variable/noto-sans-tc @fontsource-variable/noto-sans-jp @fontsource-variable/noto-sans-kr
```

在 `src/main.tsx` 中、`import './styles/tokens.css'` 之前用 JS 导入（**Vite 原生支持；本仓库 PostCSS 未配 postcss-import，CSS 内 `@import` 包路径不可用**，勿在 tokens.css 里写）：

```ts
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/noto-sans-mono'
// 方案 B 追加：
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/noto-sans-tc'
import '@fontsource-variable/noto-sans-jp'
import '@fontsource-variable/noto-sans-kr'
```

说明：

- fontsource 包内为 woff2 + `unicode-range` 分块，浏览器按需取用；
  Vite 打包后全部落到本地资源，桌面端零网络请求。
- 现有 CSP `font-src 'self' data:` 已放行，**不改 CSP、不改 tauri.conf.json**。
- 附注（可选）：想用无后缀族名，可手写 `@font-face` 指向包内 woff2
  （路径如 `@fontsource-variable/inter/files/inter-latin-wght-normal.woff2`），
  把 `font-family` 定为 `'Inter'`，并声明 `font-weight: 100 900; font-style: normal;`。
  默认推荐直接用包自带族名，少一处维护。
- 字体体积预算（方案 A ≈ +3.5 MB，方案 B ≈ +22.5 MB），
  均为安装包增量上限，包含全部 unicode-range 分块。

---

## 六、与现有代码对接

### 6.1 `src/styles/tokens.css`

- 引入字体（§5.4），`:root` 增加 `--font-ui / --font-code / --font-reading`（§5.1）。
- `body` 的 `font-family` 改为 `var(--font-ui)`。
- **保留**：macOS `-webkit-font-smoothing: antialiased`、
  Windows `html[data-platform="windows"]` 的 ClearType 覆写（`auto`）——
  统一字体后这些平台差异处理依旧必要，不要删。

### 6.2 `tailwind.config.js`

```js
fontFamily: {
  sans: ['var(--font-ui)'],
  mono: ['var(--font-code)'],
},
```

`CodeBlock`、diff、各类 `font-sans/font-mono` 用法全部自动跟随，无需逐处改。

### 6.3 `src/components/artifact/XtermSurface.tsx`（终端）

把硬编码的 `fontFamily` 改为与代码层一致的 token：

```ts
fontFamily: 'var(--font-code)',
```

注意：xterm.js **不支持连字（ligatures）**，终端里 JetBrains Mono 以无连字形式
渲染，与 VS Code 终端行为一致，属正常；DOM 代码块（聊天、diff）保留连字。

### 6.4 `src/components/knowledge/knowledge-doc-typography.css`（知识库）

- `--kb-font-family` → 复用 `var(--font-ui)`（阅读区默认无衬线，字形与 UI 统一）；
- `--kb-font-mono` → 复用 `var(--font-code)`；
- `--kb-font-body: 16px` 等阅读字号保持不变（见 §7）。

### 6.5 `src/i18n/`（语言与字形）

字体按族名区分语言字形，不依赖 `lang` 属性；保持 i18n 现有
`zh-CN / zh-TW / en / ja / ko` 五个 locale 不变即可。

### 6.6 `src/domain/knowledge/htmlExport.ts`（导出 HTML）

导出的 HTML 是独立文件，不随应用打包：

- 保持系统字体栈（`system-ui, -apple-system, …`），任何机器打开都不缺字；
- 可选增强：把 Inter 拉丁 woff2 以 base64 内嵌进导出文件（约 +120 KB），
  让导出件在未装 Inter 的机器上也与产品观感一致；CJK 仍走系统回退。
  —— 此项非必须，按需再议。

---

## 七、字号与字重（沿用现有 token，不新增档位）

产品已有成套字号 token（`tailwind.config.js`），字体方案**沿用、不另立**，
避免出现两套字号体系的维护成本。原草稿字号表作废。

| Token | 字号 / 行高 | 典型用途 |
| --- | --- | --- |
| `text-caption` | 11px / 1.4 | 时间戳、元数据、角标 |
| `text-meta` | 12px / 1.45 | 侧栏条目、chip、代码块内文 |
| `text-body` | 13px / 1.5 | 全局默认、按钮、输入 |
| `text-prose` | 14px / 1.7 | 聊天正文、说明文字 |
| `text-title` | 16px / 1.4 | 小节标题 |
| `text-display` | 20px / 1.3 | 卡片标题 |
| `text-stat` | 24px / 1.2 | 数字统计 |
| `text-page` | 32px / 1.25 | 文档页 H1（带 -0.02em 字距） |

字重档位（与产品现状一致，可变字体全覆盖）：

| 字重 | 用途 |
| --- | --- |
| Regular 400 | 正文 |
| Medium 500 | 按钮、chip、次要强调 |
| SemiBold 600 | 标题（`--kb-heading-weight` 等） |
| Bold 700 | 强强调 |

可变字体（100–900）下所有档位都是真实字形，不会出现浏览器“伪粗体”合成。

---

## 八、授权情况（修正后）

| 字体 | 授权 | 商业使用 | 备注 |
| --- | --- | --- | --- |
| Inter | SIL OFL 1.1 | ✅ | 需随分发附 OFL 文本（npm 包自带） |
| JetBrains Mono | SIL OFL 1.1 | ✅ | 同上 |
| Noto Sans（拉丁） | SIL OFL 1.1 | ✅ | Google Fonts 发行版为 OFL |
| Noto Sans CJK / Noto Serif CJK | **SIL OFL 1.1** | ✅ | **2.004（2021-04）起从 Apache 2.0 改为 OFL 1.1**；旧稿“Apache 2.0”过时 |
| Noto Sans Mono | SIL OFL 1.1 | ✅ | Google Fonts 发行版 |
| Noto Sans Mono CJK * | SIL OFL 1.1 | ✅ | noto-cjk 仓库发行版 |

OFL 1.1 允许再分发与商业使用；唯一义务是保留版权声明与许可文本，
`@fontsource-variable/*` 包内自带 `LICENSE` 文件，随 node_modules 分发即满足。

---

## 九、验收清单（三平台 × 五语言）

在 macOS（WKWebView）、Windows（WebView2）、Linux（WebKitGTK）三台机器上逐项验收：

- [ ] UI：菜单/侧栏/设置/标题栏，英文字形三平台一致（Inter）
- [ ] 简体中文（zh-CN）、繁体（zh-TW）、日文（ja）、韩文（ko）切换后
      界面文案无缺字、无乱码，字号行高一致
- [ ] 聊天代码块：JetBrains Mono 生效、连字正常、中文注释有等宽 CJK 回退
- [ ] 终端（xterm）：等宽字体生效、中文无缺字（无连字属预期）
- [ ] 知识库文档：正文/代码块字体跟随统一栈，阅读字号（16px）不变
- [ ] 导出 HTML：在未装自定义字体的机器上打开正常
- [ ] 深浅色两主题下无字体渲染异常；macOS 抗锯齿、Windows ClearType 正常
- [ ] 打包体积符合预算（方案 A ≈ +3.5 MB / 方案 B ≈ +22.5 MB）
- [ ] 重字重（400/500/600/700）与标题渲染无伪粗

---

## 十、附：与同类产品定位

统一字体后的产品定位不变：

> AI Coding Agent = Linear 的 UI（Inter 体系）+ VS Code 的代码体验
> （JetBrains Mono）+ Claude Code 的终端体验（等宽 + 无连字，与 VS Code 终端一致）。
