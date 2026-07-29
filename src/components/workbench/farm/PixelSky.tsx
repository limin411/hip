/**
 * Layered pixel sky: bands, block sun, clouds, distant ridge, meadow, stars (dark).
 */
export function PixelSky({ motion }: { motion: 'live' | 'static' }) {
  return (
    <div
      className="px-sky"
      data-motion={motion}
      data-testid="workbench-farm-sky"
      aria-hidden
    >
      <div className="px-sky-grad" />
      <div className="px-sky-stars" />
      <div className="px-sun">
        <span className="px-sun-core" />
        <span className="px-sun-ray a" />
        <span className="px-sun-ray b" />
      </div>
      <div className="px-cloud px-cloud-a" />
      <div className="px-cloud px-cloud-b" />
      <div className="px-cloud px-cloud-c" />
      <div className="px-ridge" />
      <div className="px-meadow">
        <span className="px-meadow-tuft a" />
        <span className="px-meadow-tuft b" />
        <span className="px-meadow-tuft c" />
        <span className="px-meadow-tuft d" />
      </div>
      <div className="px-vignet" />
    </div>
  )
}
