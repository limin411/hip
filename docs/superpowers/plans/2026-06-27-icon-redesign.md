# Icon Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the content of `public/icon.svg` with the new minimal-friendly-face design that matches `public/logo.svg`.

**Architecture:** The change is a single-file SVG replacement. No code, build, or dependency changes are required. We keep the existing `viewBox="0 0 120 120"` and overwrite the file contents, then verify the SVG renders at small and large sizes.

**Tech Stack:** SVG, git.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `public/icon.svg` | Modify | The favicon/desktop icon asset being redesigned. |
| `docs/superpowers/specs/2026-06-27-icon-redesign-design.md` | Read-only reference | Contains the approved SVG specification and geometry notes. |

## Task 1: Backup the Current Icon

**Files:**
- Read: `public/icon.svg`

- [ ] **Step 1: Inspect current icon**

Run:
```bash
cat public/icon.svg
```

Expected: A 120×120 SVG with a green rounded square, two white eyes, and two blue pupils.

- [ ] **Step 2: Stage the existing file for rename tracking (optional)**

Run:
```bash
git mv public/icon.svg public/icon.svg.bak || true
```

Expected: If the command succeeds, git records a rename. If it fails because the backup name exists, skip this step.

- [ ] **Step 3: Commit backup (optional)**

Run:
```bash
git add public/icon.svg.bak 2>/dev/null && git commit -m "chore: backup old icon.svg before redesign" || echo "No backup needed"
```

Expected: A backup commit is created only if a backup file was staged.

## Task 2: Replace icon.svg with the New Design

**Files:**
- Modify: `public/icon.svg`

- [ ] **Step 1: Write the new SVG content**

Overwrite `public/icon.svg` with exactly this content:

```svg
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <!-- hip favicon — minimal friendly face matching logo.svg -->
  <circle cx="60" cy="60" r="54" fill="#9faf8b"/>
  <circle cx="42" cy="56" r="22" fill="#ffffff"/>
  <circle cx="78" cy="56" r="22" fill="#ffffff"/>
  <circle cx="34" cy="48" r="9" fill="#1a1a1a"/>
  <circle cx="86" cy="64" r="9" fill="#1a1a1a"/>
  <path d="M46,86 Q60,96 74,86" fill="none" stroke="#1a1a1a" stroke-width="7" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 2: Verify the file contents**

Run:
```bash
cat public/icon.svg
```

Expected: Output matches the SVG above, with no trailing garbage and no external references.

- [ ] **Step 3: Check git diff**

Run:
```bash
git diff public/icon.svg
```

Expected: Diff shows the old content replaced by the new SVG.

## Task 3: Validate the SVG Renders Correctly

**Files:**
- Read: `public/icon.svg`

- [ ] **Step 1: Validate XML well-formedness**

Run:
```bash
xmllint --noout public/icon.svg
```

Expected: No output and exit code 0.

- [ ] **Step 2: Render at favicon size and verify readability**

Use ImageMagick or any SVG renderer to produce a 16×16 PNG preview:

```bash
convert -background none -resize 16x16 public/icon.svg /tmp/icon-16.png
file /tmp/icon-16.png
```

Expected: `/tmp/icon-16.png` is created and identifies as a PNG image.

- [ ] **Step 3: Render at desktop-icon size and verify resemblance to logo**

```bash
convert -background none -resize 256x256 public/icon.svg /tmp/icon-256.png
file /tmp/icon-256.png
```

Expected: `/tmp/icon-256.png` is created and identifies as a PNG image.

> Note: If `convert` is unavailable, use `rsvg-convert` instead:
> ```bash
> rsvg-convert -w 16 -h 16 public/icon.svg -o /tmp/icon-16.png
> rsvg-convert -w 256 -h 256 public/icon.svg -o /tmp/icon-256.png
> ```

## Task 4: Commit the Change

**Files:**
- Modify: `public/icon.svg`

- [ ] **Step 1: Stage the new icon**

Run:
```bash
git add public/icon.svg
```

Expected: No output; file staged.

- [ ] **Step 2: Commit**

Run:
```bash
git commit -m "feat: redesign icon.svg to match logo.svg

- Replace rounded-square background with logo green round head
- Use logo black for pupils and mouth
- Add googly-eye offset for playful/dazed expression
- Drop antennae/eyebrows/side bumps for favicon clarity"
```

Expected: Commit succeeds with the message above.

## Self-Review Checklist

1. **Spec coverage:**
   - [x] Green round head with `#9faf8b` — Task 2.
   - [x] White eyes and black pupils/mouth — Task 2.
   - [x] Googly-eye offset within eyeballs — Task 2 geometry.
   - [x] Drops antennae/eyebrows/side bumps — Task 2.
   - [x] Keeps `viewBox="0 0 120 120"` — Task 2.

2. **Placeholder scan:**
   - [x] No "TBD", "TODO", or vague instructions.
   - [x] Every step has an exact command or exact file content.

3. **Type/file consistency:**
   - [x] Path `public/icon.svg` used consistently.
   - [x] Color values match the approved spec.
