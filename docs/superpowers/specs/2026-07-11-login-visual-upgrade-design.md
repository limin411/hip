# Login Screen Visual Upgrade

**Status:** approved  
**Date:** 2026-07-11

## Goal

Upgrade the login page atmosphere while keeping the left/right split layout and existing auth flow.

## Decisions

| Area | Choice |
|------|--------|
| Layout | Unchanged: left brand 50% / right form; hide brand below `md` |
| Brand panel | **White background** (reverted) — no three.js / dark field |
| Mascot | `public/gif/*.gif` action clips, not static-only logo |
| Auth buttons | **D · elevated white stack** — soft gray secondary, white primary with dark hairline border (no solid sage fill) |
| Motion a11y | `prefers-reduced-motion: reduce` → static `logo.svg` |
| Extra libs | none beyond app baseline |

## Mascot state machine

1. **Enter:** `wave.gif`
2. **Idle pool** (random, with pause): `blink`, `look-around`, `tilt`, `think` (blink weighted higher)
3. **Optional:** hover primary auth → `happy`; long idle → `sleep` (nice-to-have)
4. **Reduced motion:** single static `/logo.svg`

## Button styling (login only)

- Primary (`solid`): white bg, near-black border, medium-semibold weight, subtle shadow
- Secondary (`outline`): `#fafafa`-like muted fill, soft border
- Do not change global `buttonVariants` primary (app chrome keeps sage accent)

## Scope boundaries

- No auth/backend changes
- No global token rebrand
- Do not regenerate GIF assets

## Files (expected)

- `src/routes/LoginScreen.tsx` — white left brand + form
- `src/components/login/MascotActor.tsx` — GIF cycling
- `src/components/login/AuthButton.tsx` — login-local elevated styles
