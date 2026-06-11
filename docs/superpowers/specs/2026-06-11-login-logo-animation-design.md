# Login Page Logo Animation Design

**Date**: 2026-06-11
**Status**: Approved
**Scope**: 登录页左侧品牌区 LOGO 动态化重设计

## Overview

将登录页左侧品牌区从 "静态 140px 蜜桃 + 字标" 改为 "轰炸级 260px 弹跳蜜桃 + 粒子光效"，纯 CSS 实现，不引入新依赖。

## Motivation

当前登录页左侧品牌区视觉冲击力不足。蜜桃 LOGO（屁股）是 hip 品牌的核心视觉资产，但静态展示未能充分利用其趣味性。用户希望：
- 夸张：大幅面撑满屏幕
- 动态：蜜桃有生命感
- 细腻：闪光粒子、光晕等多层细节

## Feature Specification

### 1. 尺度

- SVG viewBox 保持 `0 0 120 120`，渲染尺寸固定 `260px × 260px`
- 蜜桃撑满 teal 渐变左半侧（~50vw），部分边缘可能超出容器边界（由父容器 `overflow-hidden` 裁剪）
- **移除字标**：右侧登录区已有 "hip" 标题和 slogan，左侧不重复

### 2. 核心动画

所有动画使用 CSS `@keyframes`，定义在 `src/index.css`。

#### 2.1 弹跳 (bounce) — 2.2s

| Keyframe | 0% | 30% | 50% | 70% | 85% | 100% |
|----------|----|-----|-----|-----|-----|------|
| translateY | 0 | -14px | 0 | -6px | 0 | 0 |

- easing: ease-in-out, infinite
- 模拟果冻落地弹跳：大跳→回落→小跳→回落→静止→循环

#### 2.2 落地阴影缩放 (shadowPulse) — 2.2s

| Keyframe | 0% | 30% | 50% | 70% | 85% | 100% |
|----------|----|-----|-----|-----|-----|------|
| scaleX | 1 | 0.72 | 1 | 0.82 | 1 | 1 |
| opacity | 0.1 | 0.04 | 0.1 | 0.06 | 0.1 | 0.1 |

- 应用在 SVG 下方的 `<ellipse>` 元素
- 蜜桃上升时阴影缩小变淡，下降时恢复

#### 2.3 叶子摇摆 (leafWiggle) — 2.2s

| Keyframe | 0% | 40% | 80% | 100% |
|----------|----|-----|-----|------|
| rotate | 0 | 3deg | -2deg | 0 |

- ease-in-out, infinite
- `transform-origin: 60px 31px`（叶子根部）
- 频率与弹跳相同但运动维度独立

#### 2.4 闪光粒子 (sparkle) ×10 — 1.7~2.4s

每颗粒子独立 keyframe：

| Keyframe | 0% | 30% | 60% | 100% |
|----------|----|-----|-----|------|
| opacity | 0 | 1 | 0.7 | 0 |
| scale | 0.3 | 1 | 0.8 | 0.3 |
| translateY | 0 | -2px | -6px | 0 |

- ease-in-out, infinite
- 10 颗白色圆点（2~6px），绝对定位在 SVG 容器内
- 各粒子 `animation-delay` 错开 0~1.1s，营造不规则闪烁
- 分布覆盖蜜桃上方、两侧

#### 2.5 背景光晕 (bgGlowPulse) — 3s

| Keyframe | 0% | 50% | 100% |
|----------|----|-----|------|
| opacity | 0.35 | 0.55 | 0.35 |
| scale | 1 | 1.08 | 1 |

- ease-in-out, infinite
- `radial-gradient` 圆形 div，300px 直径
- 颜色：`rgba(240,154,120,0.18)` → transparent
- 置于蜜桃背后，让 LOGO 与 teal 背景融合

### 3. 图形细节（不变）

蜜桃 SVG 路径保持现有 `color` 变体的全部元素：
- `PEACH` 主体填充 `#f09a78`
- `HIGHLIGHT` 高光层 `#f8bda2`
- `CLEFT` 屁股缝描线 `#c95a33`，stroke-width 4.5
- `STEM` 茎 `#7a4a2b`
- `LEAF` 叶子 `#7cbe35` + `VEIN` 叶脉 `#4b7e16`

### 4. 无障碍与性能

#### prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  .hip-logo-animated { animation: none; }
  .hip-logo-leaf { animation: none; }
  .hip-logo-shadow { animation: none; }
  .hip-logo-sparkle { animation: none; opacity: 0; }
  .hip-logo-glow { animation: none; }
}
```

检测方式：
- 在 JS 中通过 `window.matchMedia('(prefers-reduced-motion: reduce)')` 检测
- 将结果作为 prop 传入组件，或通过 CSS media query 自动处理（推荐 CSS only）

#### 渲染性能

- 所有动画使用 `transform` 和 `opacity`，仅触发 composite（不触发 layout/paint）
- 无 JavaScript 动画循环
- 粒子使用 `will-change: transform, opacity`

### 5. 响应式

| 断点 | 行为 |
|------|------|
| md+ (≥768px) | 左侧品牌区可见，渲染动画 LOGO |
| <768px | 左侧隐藏（`hidden`），保持现有逻辑 |

## Implementation Plan

### Files to Modify

| File | Change |
|------|--------|
| `src/index.css` | 新增 5 组 `@keyframes` + reduced-motion 覆盖 |
| `src/components/login/HipLogo.tsx` | 新增 `variant="hero"` 或 `animated` prop，输出完整动画 DOM |
| `src/routes/LoginScreen.tsx` | 左侧品牌区简化为居中 260px 动画 LOGO |

### HipLogo 新变体设计

```tsx
// variant="hero" 输出结构：
<div className="hip-logo-hero" style={{ position: 'relative', width: 260, height: 260 }}>
  {/* 背景光晕 */}
  <div className="hip-logo-glow" />
  {/* 落地阴影 */}
  <ellipse className="hip-logo-shadow" />
  {/* 蜜桃 SVG (bounce animation) */}
  <svg className="hip-logo-animated">...</svg>
  {/* 10 颗闪光粒子 */}
  {sparkles.map((s, i) => <div key={i} className="hip-logo-sparkle" style={s} />)}
</div>
```

### LoginScreen 改动

```tsx
// Before:
<HipLogo variant="color" size={140} title="hip" />
<div>hip</div>
<div>slogan</div>

// After:
<HipLogo variant="hero" size={260} title="hip" />
// 无字标，无 slogan（右侧已有）
```

## Trade-offs Considered

| Decision | Rationale |
|----------|-----------|
| CSS keyframes over framer-motion | 零依赖，composite-only 性能足够好 |
| 无腮红 | 保持一点克制，不过度萌化 |
| 无 3D 径向渐变 | 保留现有扁平配色一致性，减少复杂度 |
| 粒子仅包围蜜桃（非全屏） | 聚焦视觉中心，不分散注意力 |
| removes wordmark | 右侧登录区已有标题，避免重复 |

## Testing

- 手动验证：登录页左侧动画运行正常，各元素同步
- prefers-reduced-motion：系统设置开启后动画停止
- 响应式：小屏下左侧不渲染
- 性能：Chrome DevTools Performance 面板确认无 layout thrashing

## Appendix: Selected vs. Rejected Options

| 选项 | 状态 |
|------|------|
| 呼吸缩放 | Rejected |
| 扭动摇摆 | Rejected |
| 弹跳 | **Selected** |
| 叶子独立动画 | **Selected** |
| 轰炸尺度 260px | **Selected** |
| 无字标 | **Selected** |
| 闪光粒子 | **Selected** |
| 背景光晕 | **Selected** |
| 腮红 | Rejected |
| 3D 径向渐变 | Rejected |
| 全屏漂浮粒子 | Rejected |
| 字标叠在桃上 | Rejected |
