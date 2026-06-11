# hip — login hero & "peach/butt" logo — design

- **Date:** 2026-06-11
- **Status:** Direction approved (decisions locked); pending implementation review

## Goal

Replace the placeholder `Bot` icon and flat-gray left pane of the login screen
([src/routes/LoginScreen.tsx:15-26](../../../src/routes/LoginScreen.tsx#L15)) with a branded,
bold-but-designed **peach/butt** logo system and a **rich illustrated teal hero** — leaning into
the `hip` pun (hip = the body part 髋/臀).

## Locked decisions

1. **Primary mark:** coral, full-colour peach (the expressive "face").
2. **Palette:** embrace **teal + coral** on the login hero. Coral is **contained to the login
   screen only** — the rest of the app stays strictly teal + monochrome. No global token changes
   ([tokens.css:5-19](../../../src/styles/tokens.css#L5) untouched).

## Logo system — one peach DNA, three roles

Canonical peach silhouette (viewBox `0 0 120 120`):

```
peach: M60 33 C 54 19 39 15 29 24 C 17 33 15 52 24 70 C 30 83 45 95 60 105 C 75 95 90 83 96 70 C 105 52 103 33 91 24 C 81 15 66 19 60 33 Z
cleft: M60 37 C 56 49 56 63 60 77            (stroke, round cap)
leaf:  M60 31 C 68 16 83 12 95 17 C 89 31 73 37 61 32 Z
vein:  M64 30 C 73 25 83 22 90 20            (stroke)
stem:  M60 33 C 60 26 60 22 61 18            (stroke)
```

| Variant | Use | Colours |
|---|---|---|
| **Peach** (primary, colour) | hero + marketing | body `#F09A78`, highlight `#F8BDA2`, cleft `#C95A33`, stem `#7A4A2B`, leaf `#7CBE35`, vein `#4B7E16` |
| **App icon** | dock / `.icns` / `.ico` / `.png` / favicon; replaces `Bot` | white peach + leaf on a `#0d9488` rounded tile (`rx 26`); cleft in tile-teal |
| **Minimal** | 16px favicon fallback | two-lobe geometric, `#0d9488` / `#0f766e`, no leaf |

(Alt kept on the bench: **Cheeks** — leafless, deepened cleft — reads butt-first; not primary.)

## Left panel — illustrated hero

- **Background:** teal gradient `linear-gradient(150deg, #119c8d 0%, #0c766b 52%, #083f39 100%)`
  (deepened from the first mockup so full-white slogan text clears WCAG AA ≈ 5.5:1 on the mid stop).
- **Depth layer (decorative, `aria-hidden`):** 2 large translucent white circles; 2–3 faint floating
  mini-peaches; 2 `ti-sparkles` glints.
- **Center stack:** peach mark (~138px) → `hip` wordmark (white, weight 700, ~46px, `-1.5px`
  tracking) → tagline.
- **Slogan:** **kept the existing `login.slogan` joke** ("没有人比我更懂摸鱼" / "Nobody knows slacking
  better than me") per user preference. A butt-pun tagline ("Get to the bottom of it." / "刨根问底")
  was proposed but **not adopted**.
- macOS window keeps the existing traffic-light offset (`--traffic-lights-offset`).

## Right panel — unchanged

Existing `AuthButton` stack (email = solid teal, GitHub, Google) + "skip" link. Not touched.

## Implementation sketch

- **New** `src/components/login/HipLogo.tsx` — renders the peach SVG. Props:
  `variant: 'color' | 'tile' | 'minimal'`, `size?: number`. Self-contained brand palette (no global
  tokens). Decorative when used as art (`aria-hidden`), semantic `role="img"` + `<title>` as the mark.
- **Rewrite** the left `<div>` of `LoginScreen.tsx` (lines 15–26) into the hero: gradient +
  decoration layer + `<HipLogo variant="color" />` + wordmark + tagline. Right half untouched.
- **i18n:** none — original `login.slogan` joke kept (the proposed pun was reverted).
- **a11y:** decorative SVGs `aria-hidden`; verify tagline contrast ≥ 4.5:1 on the teal gradient
  (lighten the tint or drop opacity if it falls short); preserve existing focus states on the right.
- No global token edits; gradient stops inlined in the component.

## Non-goals / follow-ups

- **App-icon binaries** (`src-tauri/icons/*`) — **done** (2026-06-11): regenerated from the `tile`
  mark. Master at `src-tauri/icons/source/app-icon.svg` (+ `app-icon-1024.png`); regen via
  `yarn tauri icon src-tauri/icons/source/app-icon-1024.png` (then drop the emitted `ios/`/`android/`
  dirs — desktop app).
- No animation added (the hero is static; respects the `prefers-reduced-motion` fallback already in
  tokens.css).

## Testing

- **GUI acceptance** (project norm — no LLM / paid calls involved in this change).
- Optional: a render smoke test for `<HipLogo />` and `<LoginScreen />`.
