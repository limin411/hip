# Login Logo Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static login page logo with a massive (260px) animated bouncing peach with sparkle particles and background glow, using pure CSS keyframes.

**Architecture:** Add 5 `@keyframes` to `tokens.css`, add a `hero` variant to the existing `HipLogo` component that wraps the SVG in animated containers, and simplify the `LoginScreen` left brand area to render just the hero logo.

**Tech Stack:** React, TypeScript, Tailwind CSS, CSS keyframes

---

### Task 1: Add animation keyframes to tokens.css

**Files:**
- Modify: `src/styles/tokens.css:76` (append after existing content)

- [ ] **Step 1: Append keyframes**

Add the following CSS to the end of `src/styles/tokens.css`:

```css
/* —— Login logo animations —— */

@keyframes peach-bounce {
  0%, 100% { transform: translateY(0); }
  30%  { transform: translateY(-14px); }
  50%  { transform: translateY(0); }
  70%  { transform: translateY(-6px); }
  85%  { transform: translateY(0); }
}

@keyframes leaf-wiggle {
  0%, 100% { transform: rotate(0deg); }
  40% { transform: rotate(3deg); }
  80% { transform: rotate(-2deg); }
}

@keyframes shadow-squash {
  0%, 100% { transform: scaleX(1); opacity: 0.1; }
  30%  { transform: scaleX(0.72); opacity: 0.04; }
  50%  { transform: scaleX(1); opacity: 0.1; }
  70%  { transform: scaleX(0.82); opacity: 0.06; }
  85%  { transform: scaleX(1); opacity: 0.1; }
}

@keyframes sparkle-twinkle {
  0%, 100% { opacity: 0; transform: scale(0.3) translateY(0); }
  30% { opacity: 1; transform: scale(1) translateY(-2px); }
  60% { opacity: 0.7; transform: scale(0.8) translateY(-6px); }
}

@keyframes glow-breathe {
  0%, 100% { opacity: 0.35; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(1.08); }
}

.hip-logo-animated {
  animation: peach-bounce 2.2s ease-in-out infinite;
}

.hip-logo-leaf {
  animation: leaf-wiggle 2.2s ease-in-out infinite;
  transform-origin: 60px 31px;
}

.hip-logo-shadow {
  animation: shadow-squash 2.2s ease-in-out infinite;
}

.hip-logo-sparkle {
  animation: sparkle-twinkle 2s ease-in-out infinite;
  will-change: transform, opacity;
}

.hip-logo-glow {
  animation: glow-breathe 3s ease-in-out infinite;
}
```

- [ ] **Step 2: Verify no syntax errors**

```bash
npx tailwindcss -i src/styles/tokens.css --dry-run 2>&1 | head -5
```

Expected: No CSS parse errors. (May show Tailwind build output which is fine.)

- [ ] **Step 3: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat: add login logo animation keyframes"
```

---

### Task 2: Add hero variant to HipLogo component

**Files:**
- Modify: `src/components/login/HipLogo.tsx` (entire file)

- [ ] **Step 1: Define sparkle positions array and hero variant**

Replace the file content with the following (adds `variant="hero"` branch + sparkle configuration):

```tsx
interface HipLogoProps {
  variant?: 'color' | 'tile' | 'minimal' | 'hero'
  size?: number
  className?: string
  title?: string
  decorative?: boolean
}

const PEACH =
  'M60 33 C 54 19 39 15 29 24 C 17 33 15 52 24 70 C 30 83 45 95 60 105 C 75 95 90 83 96 70 C 105 52 103 33 91 24 C 81 15 66 19 60 33 Z'
const CLEFT = 'M60 37 C 56 49 56 63 60 77'
const LEAF = 'M60 31 C 68 16 83 12 95 17 C 89 31 73 37 61 32 Z'
const VEIN = 'M64 30 C 73 25 83 22 90 20'
const STEM = 'M60 33 C 60 26 60 22 61 18'
const HIGHLIGHT = 'M27 44 C 22 58 25 76 39 88 C 30 75 28 59 33 45 Z'

interface SparkleProps {
  left: string
  top: string
  size: number
  delay: number
  duration: number
}

const SPARKLES: SparkleProps[] = [
  { left: '20%', top: '15%', size: 5, delay: 0, duration: 2 },
  { left: '65%', top: '10%', size: 4, delay: 0.5, duration: 2 },
  { left: '78%', top: '35%', size: 6, delay: 0.3, duration: 2.2 },
  { left: '42%', top: '8%', size: 3, delay: 0.7, duration: 1.8 },
  { left: '12%', top: '42%', size: 4, delay: 1, duration: 2.1 },
  { left: '18%', top: '55%', size: 3, delay: 0.2, duration: 1.9 },
  { left: '50%', top: '20%', size: 5, delay: 0.9, duration: 2.3 },
  { left: '75%', top: '48%', size: 2, delay: 0.4, duration: 1.7 },
  { left: '28%', top: '60%', size: 4, delay: 0.6, duration: 2 },
  { left: '8%', top: '32%', size: 3, delay: 1.1, duration: 2.4 },
]

export function HipLogo({
  variant = 'color',
  size = 96,
  className,
  title = 'hip',
  decorative = false,
}: HipLogoProps) {
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': title } as const)

  if (variant === 'hero') {
    return (
      <div
        className={className}
        style={{ width: size, height: size, position: 'relative' }}
        {...a11y}
      >
        {!decorative && <title>{title}</title>}

        <div
          className="hip-logo-glow"
          style={{
            position: 'absolute',
            inset: 0,
            margin: 'auto',
            width: size * 1.15,
            height: size * 1.15,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(240,154,120,0.18) 0%, rgba(240,154,120,0.05) 40%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <svg
          width={size}
          height={size}
          viewBox="0 0 120 120"
          className="hip-logo-animated"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'relative', zIndex: 1 }}
        >
          <path d={PEACH} fill="#f09a78" />
          <path d={HIGHLIGHT} fill="#f8bda2" opacity={0.5} />
          <path d={CLEFT} fill="none" stroke="#c95a33" strokeWidth={4.5} strokeLinecap="round" />
          <path d={STEM} fill="none" stroke="#7a4a2b" strokeWidth={3} strokeLinecap="round" />
          <g className="hip-logo-leaf">
            <path d={LEAF} fill="#7cbe35" />
            <path d={VEIN} fill="none" stroke="#4b7e16" strokeWidth={1.6} strokeLinecap="round" />
          </g>
        </svg>

        <svg
          width={size}
          height={size * 0.06}
          viewBox="0 0 120 7"
          className="hip-logo-shadow"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            position: 'absolute',
            bottom: -size * 0.01,
            left: 0,
            right: 0,
            margin: 'auto',
            pointerEvents: 'none',
          }}
        >
          <ellipse cx={60} cy={3.5} rx={30} ry={3} fill="rgba(255,255,255,0.1)" />
        </svg>

        {SPARKLES.map((s, i) => (
          <div
            key={i}
            className="hip-logo-sparkle"
            style={{
              position: 'absolute',
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              borderRadius: '50%',
              background: 'white',
              animationDuration: `${s.duration}s`,
              animationDelay: `${s.delay}s`,
              pointerEvents: 'none',
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      {...a11y}
    >
      {!decorative && <title>{title}</title>}

      {variant === 'tile' && (
        <>
          <rect x="6" y="6" width="108" height="108" rx="26" fill="#0d9488" />
          <g transform="translate(20 19) scale(0.66)">
            <path d={PEACH} fill="#ffffff" />
            <path d={LEAF} fill="#ffffff" />
            <path d={CLEFT} fill="none" stroke="#0d9488" strokeWidth="5" strokeLinecap="round" />
          </g>
        </>
      )}

      {variant === 'minimal' && (
        <>
          <path
            d="M57 28 C 38 16 17 27 17 56 C 17 82 37 100 57 93 C 53 71 53 50 57 28 Z"
            fill="#0d9488"
          />
          <path
            d="M63 28 C 82 16 103 27 103 56 C 103 82 83 100 63 93 C 67 71 67 50 63 28 Z"
            fill="#0f766e"
          />
        </>
      )}

      {variant === 'color' && (
        <>
          <path d={PEACH} fill="#f09a78" />
          <path d={HIGHLIGHT} fill="#f8bda2" />
          <path d={CLEFT} fill="none" stroke="#c95a33" strokeWidth={4.5} strokeLinecap="round" />
          <path d={STEM} fill="none" stroke="#7a4a2b" strokeWidth={3} strokeLinecap="round" />
          <path d={LEAF} fill="#7cbe35" />
          <path d={VEIN} fill="none" stroke="#4b7e16" strokeWidth={1.6} strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
yarn type-check 2>&1
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/login/HipLogo.tsx
git commit -m "feat: add hero variant with animated peach logo"
```

---

### Task 3: Update LoginScreen left brand area

**Files:**
- Modify: `src/routes/LoginScreen.tsx:17-38` (replace the left brand area content)

- [ ] **Step 1: Replace the left brand area JSX**

In `src/routes/LoginScreen.tsx`, replace the left brand area (lines 17-38, the `<div>` with `className="relative hidden w-1/2..."` and its entire contents) with:

```tsx
      {/* 左侧品牌区 —— 轰炸级动态蜜桃 hero */}
      <div
        className="relative hidden w-1/2 items-center justify-center overflow-hidden md:flex"
        style={{ background: 'linear-gradient(150deg, #119c8d 0%, #0c766b 52%, #083f39 100%)' }}
      >
        <HipLogo variant="hero" size={260} title="hip" />
      </div>
```

This removes: the decorative floating elements, the wordmark "hip", the slogan text, and the `variant="color"` logo. Replaces with a single centered `hero` variant at 260px.

- [ ] **Step 2: Also remove unused imports**

Remove `Sparkles` from the lucide-react import on line 3 (it was only used in the removed decorative section). Change:

```tsx
import { Mail, Github, Chrome, ArrowRight, Sparkles } from 'lucide-react'
```

to:

```tsx
import { Mail, Github, Chrome, ArrowRight } from 'lucide-react'
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
yarn type-check 2>&1
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/LoginScreen.tsx
git commit -m "feat: replace static login logo with animated hero variant"
```

---

### Verification

After all tasks complete, verify the full build:

```bash
yarn build 2>&1
```

Expected: Build succeeds with no errors.

Manual visual verification:
- Login page left side shows a 260px bouncing peach
- 10 sparkle dots twinkle around the peach at staggered intervals
- Peach shadow squashes/stretches with the bounce
- Leaf wiggles independently
- Background glow breathes
- On `prefers-reduced-motion`, all animations stop (handled by existing global rule in `tokens.css:67-76`)
- Right side login area unchanged
