# SessionHistory Header Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the pagination control to the top-right of the SessionHistory page on the same horizontal line as the surface filter tabs, and improve tab spacing.

**Architecture:** A single React component (`SessionHistory.tsx`) is changed: the existing `Tabs` block and bottom pagination block are combined into one flex toolbar row. Tab spacing is increased by passing classes through the existing `TabsList`/`TabsTrigger` props without modifying the shared `Tabs` primitives.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Radix UI Tabs, Vitest + React Testing Library.

## Global Constraints

- Keep existing behavior: search and filter changes reset page to 1.
- Pagination and page info render only when `totalPages > 1`.
- Do not modify shared `Tabs`, `TabsList`, `TabsTrigger`, or `Pagination` components.
- Preserve existing Chinese copy and i18n keys.
- Clear-all button stays in the title row.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/components/history/SessionHistory.tsx` | Main page component. Reorganize toolbar row and tab styling. |
| `src/components/history/SessionHistory.test.tsx` | Add layout assertions; existing tests continue to pass. |

---

### Task 1: Combine tabs and pagination into a single toolbar row

**Files:**
- Modify: `src/components/history/SessionHistory.tsx:90-100` and `src/components/history/SessionHistory.tsx:152-165`
- Test: `src/components/history/SessionHistory.test.tsx`

**Interfaces:**
- Consumes: `surfaceFilter`, `handleSurfaceChange`, `totalPages`, `safePage`, `setPage`, `t`
- Produces: A new `data-testid="session-history-toolbar"` flex row containing the tabs on the left and pagination + page info on the right.

- [ ] **Step 1: Write the failing test**

Add a new test that asserts the pagination navigation and page info live inside the toolbar row.

```tsx
it('renders pagination in the same toolbar row as surface tabs', () => {
  render(<SessionHistory />)
  const toolbar = screen.getByTestId('session-history-toolbar')
  expect(toolbar).toContainElement(screen.getByRole('navigation'))
  expect(toolbar).toContainElement(screen.getByText('history.filterAll'))
  expect(toolbar).toContainElement(screen.getByText('Page 1 of 3'))
})
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
yarn vitest run src/components/history/SessionHistory.test.tsx -t "renders pagination in the same toolbar row"
```

Expected: FAIL — `session-history-toolbar` is not found and pagination is outside the toolbar.

- [ ] **Step 3: Implement the toolbar row**

Replace the current `Tabs` block (lines 90–100) with a flex toolbar row, and remove the bottom pagination block (lines 152–165).

Current code to remove/replace:

```tsx
      <Tabs
        value={surfaceFilter}
        onValueChange={(v) => handleSurfaceChange(v as SurfaceFilter)}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="all">{t('history.filterAll')}</TabsTrigger>
          <TabsTrigger value="chat">{t('history.filterChat')}</TabsTrigger>
          <TabsTrigger value="code">{t('history.filterCode')}</TabsTrigger>
        </TabsList>
      </Tabs>
```

Bottom pagination block to remove:

```tsx
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <Pagination
                currentPage={safePage}
                totalPages={totalPages}
                onChange={setPage}
                previousLabel={t('history.previous')}
                nextLabel={t('history.next')}
              />
              <span className="text-caption text-ink-secondary">
                {t('history.pageInfo', { page: safePage, total: totalPages })}
              </span>
            </div>
          )}
```

New toolbar block:

```tsx
      <div
        className="mb-4 flex items-center justify-between gap-4"
        data-testid="session-history-toolbar"
      >
        <Tabs
          value={surfaceFilter}
          onValueChange={(v) => handleSurfaceChange(v as SurfaceFilter)}
        >
          <TabsList className="h-9 gap-2">
            <TabsTrigger className="px-4" value="all">
              {t('history.filterAll')}
            </TabsTrigger>
            <TabsTrigger className="px-4" value="chat">
              {t('history.filterChat')}
            </TabsTrigger>
            <TabsTrigger className="px-4" value="code">
              {t('history.filterCode')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {totalPages > 1 && (
          <div className="flex items-center gap-3">
            <Pagination
              currentPage={safePage}
              totalPages={totalPages}
              onChange={setPage}
              previousLabel={t('history.previous')}
              nextLabel={t('history.next')}
            />
            <span className="text-caption text-ink-secondary">
              {t('history.pageInfo', { page: safePage, total: totalPages })}
            </span>
          </div>
        )}
      </div>
```

- [ ] **Step 4: Run the new test**

Run:

```bash
yarn vitest run src/components/history/SessionHistory.test.tsx -t "renders pagination in the same toolbar row"
```

Expected: PASS.

- [ ] **Step 5: Run the full SessionHistory test suite**

Run:

```bash
yarn vitest run src/components/history/SessionHistory.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 6: Type-check**

Run:

```bash
yarn tsc
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/history/SessionHistory.tsx src/components/history/SessionHistory.test.tsx
git commit -m "feat(history): move pagination to toolbar row with tabs and improve tab spacing"
```

---

## Self-Review

**Spec coverage:**
- Pagination top-right same line as tabs → Task 1 toolbar row.
- Tabs no longer crowded → `gap-2` on `TabsList` and `px-4` on each `TabsTrigger`, plus `h-9` for alignment.
- Pagination visible only when `totalPages > 1` → preserved via `{totalPages > 1 && (...)}`.
- Page info at top-right → included next to pagination.
- No changes to shared primitives → only `SessionHistory.tsx` and its test are touched.

**Placeholder scan:** No TBD/TODO/fill-in-details found; all code and commands are concrete.

**Type consistency:** The same variables and prop names from the original component are reused; no new types introduced.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-session-history-header-layout.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach would you like?
