# SessionHistory 分页与场景筛选设计

日期：2026-07-08  
状态：已确认，待实现

## 背景

`src/components/history/SessionHistory.tsx` 当前会把所有会话一次性渲染出来，仅支持按标题/预览文本搜索。随着会话数量增加，需要在「历史会话」页面增加：

1. **分页能力**：避免长列表一次性渲染过多条目。
2. **场景筛选能力**：按会话的 `surface`（`chat` / `code`，即「办公」/「编码」）过滤。

## 目标

- 在 `SessionHistory` 内实现前端内存分页与筛选，无需改动后端协议。
- 每页固定 20 条，使用页码分页器。
- 保持现有搜索能力，搜索与场景筛选可组合使用。

## 非目标

- 服务端分页或虚拟滚动。
- 新增除 surface 外的其他筛选维度。
- 持久化用户的筛选/页码状态（刷新后恢复默认）。

## UI/UX

页面从上到下的结构：

1. 标题「历史会话」。
2. 搜索框（现有，按标题/预览过滤）。
3. Tabs 筛选栏：
   - 全部
   - 办公（`chat`）
   - 编码（`code`）
4. 会话卡片列表（现有样式）。
5. 页码分页器（仅当过滤后总数 > 20 时显示）：
   - 「上一页」
   - 页码按钮（当前页高亮）
   - 「下一页」
   - 页码信息，例如「第 2 页 / 共 5 页」

筛选或搜索条件变化时，自动回到第 1 页。列表为空时显示现有「暂无历史会话」空状态。

## 数据流与状态

`SessionHistory` 内部维护两个状态：

- `surfaceFilter: 'all' | 'chat' | 'code'` —— 当前场景筛选。
- `page: number` —— 当前页码，从 1 开始。

派生计算（使用 `useMemo`）：

1. `q = query.trim().toLowerCase()`
2. `baseList = [...sessions].sort((a, b) => b.updatedAtMs - a.updatedAtMs)`
3. `searched = q ? baseList.filter(title/preview 包含 q) : baseList`
4. `filtered = surfaceFilter === 'all' ? searched : searched.filter(surfaceOf(config) === surfaceFilter)`
5. `totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))`
6. `safePage = Math.min(page, totalPages)`（实现上通过 effect 在 `query`/`surfaceFilter` 变化时将 `page` 重置为 1；此处作为兜底避免越界）
7. `paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)`

`PAGE_SIZE = 20`。

### 页码重置规则

- `query` 变化 → `setPage(1)`。
- `surfaceFilter` 变化 → `setPage(1)`。

## 组件结构

- `src/components/history/SessionHistory.tsx`：状态、筛选逻辑、布局。
- `src/components/ui/Pagination.tsx`（新增）：纯展示分页器，接收：
  - `currentPage: number`
  - `totalPages: number`
  - `onChange: (page: number) => void`
  - 可选 `className`

`Pagination` 不耦合业务，未来其他列表页可复用。

## 分页器行为

- 上一页/下一页在边界处禁用。
- 页码较多时显示省略号（例如 `1 2 ... 5 6 7 ... 10 11`），保持页码条不会过长。
- 点击页码后直接跳转。

## 国际化

在 `history` 命名空间下新增 key：

```ts
history: {
  title: '历史会话',
  searchPlaceholder: '搜索会话…',
  empty: '暂无历史会话',
  filterAll: '全部',
  filterChat: '办公',
  filterCode: '编码',
  previous: '上一页',
  next: '下一页',
  pageInfo: '第 {{page}} 页 / 共 {{total}} 页',
}
```

同步更新 `zh-CN.ts`、`zh-TW.ts`、`en.ts`。

## 边界处理

- 筛选结果为空：显示 `history.empty`。
- 切换筛选/搜索后当前页超出总页数：自动回到第 1 页。
- 总页数为 1：隐藏分页器。
- 无会话数据：保持搜索框和 Tabs 可见（用户可看到当前为空），只隐藏分页器。原有空状态不变。

## 测试计划

更新 `src/components/history/SessionHistory.test.tsx`，覆盖：

1. 默认渲染全部会话。
2. 搜索过滤仍工作。
3. 点击场景 Tab 只显示对应 surface 的会话。
4. 搜索 + 场景筛选组合生效。
5. 分页：超过 20 条时只显示当前页，点击页码切换。
6. 切换筛选条件后页码重置到第 1 页。
7. 空状态：筛选无结果时显示 `history.empty`。

## 待修改文件

- `src/components/history/SessionHistory.tsx`
- `src/components/history/SessionHistory.test.tsx`
- `src/components/ui/Pagination.tsx`（新增）
- `src/i18n/zh-CN.ts`
- `src/i18n/zh-TW.ts`
- `src/i18n/en.ts`

## 后续可扩展

- 若未来会话数显著增长，可将 `session:list` 扩展为服务端分页/筛选，前端 `Pagination` 组件无需改动。
- 可增加每页条数切换器（10/20/50），本次保持固定 20 条。
