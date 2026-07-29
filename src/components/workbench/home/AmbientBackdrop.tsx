/**
 * Product-grade ambient mesh backdrop (Linear / Stripe / Apple aurora inspired).
 * Spec: docs/design/2026-07-29-workbench-ambient-home.md
 * Decorative only — no illustration, no 3D.
 */

export function AmbientBackdrop({
  motion = 'live',
}: {
  motion?: 'live' | 'static'
}) {
  return (
    <div
      className="wb-ambient"
      data-motion={motion}
      data-testid="workbench-ambient"
      aria-hidden
    >
      <div className="wb-ambient-base" />
      <div className="wb-ambient-blob wb-ambient-blob-a" />
      <div className="wb-ambient-blob wb-ambient-blob-b" />
      <div className="wb-ambient-blob wb-ambient-blob-c" />
      <div className="wb-ambient-blob wb-ambient-blob-d" />
      <div className="wb-ambient-vignette" />
      <div className="wb-ambient-grain" />
    </div>
  )
}
