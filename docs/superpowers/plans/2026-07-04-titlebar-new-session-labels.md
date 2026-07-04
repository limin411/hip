# TitleBar New Session Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the top TitleBar "new session" dropdown labels for Chat and Code sessions across zh-CN, zh-TW, and en locales.

**Architecture:** The labels are pure i18n values accessed via `t('dropdown.newChat')` and `t('dropdown.newCode')` in `src/components/tabs/SessionTabBar.tsx`. No component or logic changes are required; only the translation files change.

**Tech Stack:** React, react-i18next, TypeScript, Vitest.

## Global Constraints

- Keep changes surgical; only edit i18n values.
- Do not rename translation keys or change component code.
- Existing tests use key names, so no test code changes are needed.
- Verify by running the existing `SessionTabBar` test.

---

### Task 1: Update i18n labels for Chat and Code sessions

**Files:**
- Modify: `src/i18n/zh-CN.ts:523-526`
- Modify: `src/i18n/zh-TW.ts:523-526`
- Modify: `src/i18n/en.ts:523-526`
- Test: `src/components/tabs/SessionTabBar.test.tsx`

**Interfaces:**
- Consumes: The translation keys `dropdown.newChat` and `dropdown.newCode` defined in each locale file.
- Produces: Updated string values for those keys; no new exports or signatures.

- [ ] **Step 1: Update zh-CN labels**

  In `src/i18n/zh-CN.ts`, change the `dropdown` block:

  ```ts
  dropdown: {
    newChat: '新建办公对话',
    newCode: '新建编码任务',
  },
  ```

- [ ] **Step 2: Update zh-TW labels**

  In `src/i18n/zh-TW.ts`, change the `dropdown` block:

  ```ts
  dropdown: {
    newChat: '新增辦公對話',
    newCode: '新增編碼任務',
  },
  ```

- [ ] **Step 3: Update en labels**

  In `src/i18n/en.ts`, change the `dropdown` block:

  ```ts
  dropdown: {
    newChat: 'New Work Chat',
    newCode: 'New Coding Task',
  },
  ```

- [ ] **Step 4: Run the existing regression test**

  Run:

  ```bash
  yarn test src/components/tabs/SessionTabBar.test.tsx
  ```

  Expected: all tests pass.

- [ ] **Step 5: Type-check the project**

  Run:

  ```bash
  yarn type-check
  ```

  Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
  git commit -m "feat(i18n): update titlebar new-session labels to work/coding copy"
  ```
