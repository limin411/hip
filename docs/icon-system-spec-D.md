# Hip 菜单图标系统升级 —— 方案 D（Hierarchical · 分层单色 + 模块几何）

> 配套视觉预览：`docs/examples/icon-preview-D.html`。
> 方案 A/B/C 见同目录 `icon-system-spec.md` / `-B` / `-C`。本方案为**第四备选**，四案并列选一。

## 1. 案例研究

- **Apple SF Symbols Hierarchical**：单色、按图层分主/次/三级透明度（primary 100% / secondary ≈40% / tertiary ≈20%），用**透明度层级**做深度，而不是第二套色。Palette 模式则主次层分色。WWDC：Control Center 等系统控件大量用 hierarchical。
- **SF Symbols Variable Color**：用图层完成度表达进度（Wi‑Fi、信号、加载），不表达深度 —— 深度仍归 hierarchical。
- **Streamline Block（Bauhaus）**：16 网格 + **基础几何形**（圆/方/对角）搭出整套图标，像 logo 一样有骨架；模块化 —— 少量原语拼出大量变体。
- **totakit / Streamline Core**：一份几何定义 → 多风格导出（outline/solid/duo…）；构建期光学补偿；Micro 档简化细节。
- **与 A/B/C 的空隙**：A 是「可选双色实底点缀」；B 是「中性线 + 中性填充 active」；C 是「全图标品牌橙 active + 徽标」。**没有人用「永久分层透明度」做菜单图标深度** —— 这是 D 的空位。

## 2. 方案 D 是什么

一句话：**每枚图标固定 2～3 层（主/次/辅），常态用透明度分层；active 时主层变品牌橙、次层保持中性 —— 选中只「点亮」结构，不整图标染色。**

| 维度 | A | B | C | D（本方案） |
|---|---|---|---|---|
| 深度手段 | 可选双色实底 | 无（单线） | 无（单线） | **分层透明度** |
| active | 底色 / 可选双色 | 中性实底 | **整图标橙实底** | **仅主层橙，次层中性** |
| 构造 | 自由线稿 | 16 像素线稿 | 粗线圆角 | **模块几何原语** |
| 源网格 | 24 | 16 原生 | 24 | **20 设计网格**（菜单 16 缩放 / 工具栏 20 1:1） |
| 描边 | 1.75 round | 1.5 square | 2.0 round | **1.6 round · 主层 1.6 / 次层 1.4** |
| 气质 | 安静工具 | 冷峻极客 | 温暖可靠 | **系统控件感（macOS Control Center）** |

## 3. 规范

### 3.1 图层模型（SF Symbols 法）

| 层 | 透明度 | 角色 | 例 |
|---|---|---|---|
| **primary** | 100% `currentColor` | 语义主体 | 气泡外轮廓、书脊、闪电体 |
| **secondary** | 40% `currentColor` | 结构/衬底 | 气泡内点、窗口标题条、芯片内核 |
| **tertiary**（可选） | 20% | 极弱衬底 | 外框环、背景方 |

- 常态：三层同色不同透明度 → 深度。
- **active**：primary → `--accent`（100%）；secondary/tertiary 仍 `currentColor` @ 40%/20%。**不是整图标变橙**（区别于 C）。
- hover：仅行底色变；图层不变。
- 禁用：整体 `opacity-40`；或 secondary 全消只留 primary（可选）。

### 3.2 模块几何（Bauhaus / Block 法）

原语白名单（新图标只能用这些搭）：

| 原语 | 参数 |
|---|---|
| 圆 | r ∈ {1, 1.5, 2, 3, 4, 5.5, 7} |
| 圆角方 | rx = 2（统一） |
| 线段 | 水平 / 垂直 / 45° |
| 弧 | 90° / 180° / 270° |
| 三角 | 等腰 45° 或 60° |

禁止：自由贝塞尔手绘、透视立方体、解剖脑叶细折。复杂语义用「原语组合」表达（如齿轮 = 圆 + 径向齿条程序化）。

### 3.3 网格与描边

- **设计网格 20×20**（介于 B 的 16 与 A/C 的 24）：菜单 16px 缩放；工具栏 **20px 1:1**（无缩放模糊）。
- 描边：primary **1.6px**；secondary **1.4px**（次层略细，层次更清晰）。
- 终端 round、join round；方圆角统一 **2px**。
- 安全区 18×18。

### 3.4 尺寸档

| 档 | 尺寸 | 说明 |
|---|---|---|
| sm | 16px | 菜单（20 源图缩放） |
| md | **20px** | 工具栏 1:1 |
| lg | 28px | 空状态（1.4×） |
| hero | 40px | 欢迎（仅 primary 层 + 可选吉祥物） |

### 3.5 与 Variable Color（可选，P3+）

加载/信号类图标（`loader`、`wifi` 若有）支持 **variable color**：按完成度点亮 secondary 段。菜单主导航**不用** variable color（避免侧栏闪烁）。

### 3.6 渲染 API

```tsx
<HipIcon name="sessions" layers="hierarchical" />           // 默认
<HipIcon name="sessions" layers="mono" />                   // 压成单层（右键 14px）
<HipIcon name="sessions" active />                          // primary=accent
```

14px 右键菜单强制 `layers="mono"`（分层在 14px 易糊）。

## 4. 图标总表（要点）

主侧栏 6 + footer 3 + 设置 11 + 右键 9 + 状态/通用 —— 与 A 同语义映射；差异在**每图标标注 primary/secondary 路径**。

| 名 | primary | secondary |
|---|---|---|
| sessions | 气泡外轮廓 | 三点 |
| projects | 左右尖括号 | 中缝斜杠 |
| knowledge | 书外轮廓 | 中缝 + 页弧 |
| terminal | 窗口框 | `>_` 提示符 |
| tasks | 勾选框 | 勾 + 条目线 |
| automation | 闪电外轮廓 | （可无次层；或内折高光） |
| settings | 齿轮齿圈 | 中心孔环 |
| … | … | … |

## 5. 迁移

- P1：`hip-icons-d.ts`（每图标 `{ primary, secondary?, tertiary? }`）+ `HipIcon` hierarchical 渲染。
- P2：主入口 9 图标 + active 主层橙。
- P3：全量菜单；右键 mono 模式；variable color 仅 loader。
- P4：移除 lucide；文档化原语白名单贡献指南。

## 6. 四案决策速查

| 决策点 | A | B | C | D |
|---|---|---|---|---|
| 深度 | 双色点缀 | 无 | 无 | **透明度分层** |
| active 品牌 | 弱 | 无 | **整图标橙** | **仅主层橙** |
| 状态徽标 | 无 | 无 | **有** | 无（可用 variable 做进度） |
| 构造纪律 | 中 | 中 | 中 | **强（原语白名单）** |
| 小尺寸 | 中 | **优** | 中 | 14px 需 mono |
| 气质 | 安静 | 极客 | 温暖 | **系统控件 / 精致** |
| 复杂度 | 中 | 中 | 中高 | **中高（图层标注）** |

**适用**：要「macOS 系统感、精致深度、选中克制上色」→ D；要「整图标品牌时刻」→ C；要「像素极简」→ B；要「经典双色点缀」→ A。

## 7. 验收清单

1. [ ] 常态 hierarchical：主 100% / 次 40%，同色，亮暗均可辨
2. [ ] active：仅 primary 为 accent，secondary 仍中性
3. [ ] 14px 右键 mono 模式无糊层
4. [ ] 20px 工具栏 1:1 无缩放模糊
5. [ ] 新图标通过原语白名单审查
6. [ ] loader variable color 不用于主导航
7. [ ] AA：accent primary 与底色对比
8. [ ] 无 lucide 残留

## 8. 相关文件

| 文件 | 内容 |
|---|---|
| `docs/icon-system-spec-D.md` | 本文档 |
| `docs/examples/icon-preview-D.html` | 预览（分层 / active 主层橙 / 原语演示） |
| A/B/C | 并列对照 |
