# Icon Redesign: Make `public/icon.svg` Match `public/logo.svg`

## Goal

Update `public/icon.svg` so it visually matches the project's `public/logo.svg` character, while remaining readable as a favicon and desktop icon at small sizes.

## Context

- `public/icon.svg` is currently a simplified 120×120 favicon: green rounded-square background, two large off-white eyes, and blue pupils.
- `public/logo.svg` is a detailed 1320×1320 character illustration: green round head with side bumps, antennae, white elliptical eyes, black pupils and eyebrows, and a thin curved mouth.
- The icon is used for favicon (16 px) and desktop icons (up to 256 px or more), so it must stay legible across a wide size range.

## Constraints

1. Keep `viewBox="0 0 120 120"` and single-file SVG format.
2. Must be clearly recognizable as the same character/brand as `logo.svg`.
3. Fine details (antennae, eyebrows, thin mouth) must not be relied upon below ~32 px.
4. Prefer logo colors (`#9faf8b` green, `#1a1a1a` black, `#ffffff` white).
5. Avoid placeholders or external references; file must be self-contained.

## Chosen Approach: Minimal Friendly Face with Googly Eyes

After comparing three directions, we selected the minimal friendly face:
- Keeps the logo's round green head, white eyes, black pupils, and smile.
- Drops antennae, side bumps, and eyebrows because they vanish or blur at favicon size.
- Thickens the smile so it survives at 16 px.
- Offsets the pupils in opposite directions (left pupil upper-left, right pupil lower-right) to give a dazed/cute expression, while keeping each pupil fully inside its eyeball.

## SVG Specification

```svg
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <!-- Green round head -->
  <circle cx="60" cy="60" r="54" fill="#9faf8b"/>

  <!-- White eyes -->
  <circle cx="42" cy="56" r="22" fill="#ffffff"/>
  <circle cx="78" cy="56" r="22" fill="#ffffff"/>

  <!-- Black pupils, offset for googly expression -->
  <circle cx="34" cy="48" r="9" fill="#1a1a1a"/>
  <circle cx="86" cy="64" r="9" fill="#1a1a1a"/>

  <!-- Smile -->
  <path d="M46,86 Q60,96 74,86" fill="none" stroke="#1a1a1a" stroke-width="7" stroke-linecap="round"/>
</svg>
```

### Geometry Notes

- Left eye center `(42, 56)`, radius `22`. Pupil `(34, 48)` radius `9` is ~11.3 px from eye center, leaving ~2 px margin inside the eyeball.
- Right eye center `(78, 56)`, radius `22`. Pupil `(86, 64)` radius `9` is ~11.3 px from eye center, leaving ~2 px margin inside the eyeball.
- Head circle `(60, 60)` radius `54` leaves a 6 px margin to the 120×120 canvas edges.
- Smile stroke width `7` is thick enough to be visible at 16 px but not clumsy at larger sizes.

## Rejected Alternatives

- **Faithful mini-logo**: Scaled all logo details (antennae, eyebrows, mouth) into 120×120. Looked correct at large sizes but turned into noise at favicon size.
- **Minimal face without expression**: Dropped both googly pupils and smile; looked too generic and lost the playful brand personality.

## Acceptance Criteria

- [ ] `public/icon.svg` contains the SVG above (or equivalent) and opens correctly in a browser.
- [ ] At 16×16 px, the icon reads as a green face with two eyes and a mouth.
- [ ] At 180×180 px, it clearly resembles the `logo.svg` character.
- [ ] Both pupils stay fully inside their respective eyeballs at all sizes.
- [ ] No external resources or CSS are referenced.
