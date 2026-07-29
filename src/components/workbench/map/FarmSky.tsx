/**
 * Layered illustrated farm sky (decorative).
 * Spec: docs/design/2026-07-29-workbench-farm-sky.md
 */

export function FarmSky({ motion }: { motion: 'live' | 'static' }) {
  return (
    <div
      className="iso-farm-sky"
      data-motion={motion}
      data-testid="workbench-farm-sky"
      aria-hidden
    >
      {/* L1 — pure CSS gradient + haze */}
      <div className="farm-sky-gradient" />

      {/* L2 — sun + soft clouds */}
      <div className="farm-atmosphere">
        <div className="farm-sun" />
        <Cloud className="farm-cloud farm-cloud-a" />
        <Cloud className="farm-cloud farm-cloud-b" />
        <Cloud className="farm-cloud farm-cloud-c" />
      </div>

      {/* L3 — far mountains */}
      <MountainsSvg />

      {/* L4 — mid ridge + trees */}
      <RidgeSvg />

      {/* L5 — foreground meadow wash */}
      <div className="farm-meadow" />

      {/* L6 — vignette for HUD / plot legibility */}
      <div className="farm-vignet" />
    </div>
  )
}

function Cloud({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 120 48" preserveAspectRatio="xMidYMid meet">
      <g fill="var(--farm-cloud)">
        <ellipse cx="38" cy="28" rx="28" ry="16" />
        <ellipse cx="62" cy="22" rx="24" ry="18" />
        <ellipse cx="86" cy="28" rx="22" ry="14" />
        <ellipse cx="52" cy="32" rx="36" ry="12" />
      </g>
    </svg>
  )
}

/** Soft multi-ridge far mountains — blue-grey atmospheric silhouettes. */
function MountainsSvg() {
  return (
    <svg
      className="farm-mountains"
      viewBox="0 0 1440 420"
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* farthest — cool haze ridge */}
      <path
        fill="var(--farm-mountain-far)"
        opacity="0.55"
        d="M0 420V248c72-28 128-72 198-58 78 16 118-62 198-48 72 12 118-48 188-28 78 22 112-52 198-32 86 20 128-40 198-18 70 22 118-28 178 8l82 42v298H0Z"
      />
      {/* mid-far peaks */}
      <path
        fill="var(--farm-mountain-far)"
        opacity="0.78"
        d="M0 420V268c58-22 108-88 178-72 82 18 108-78 198-54 78 20 118-58 188-34 76 26 112-64 188-38 86 30 128-48 198-18 72 30 118-36 188 4l102 56v308H0Z"
      />
      {/* nearer mountain band */}
      <path
        fill="var(--farm-mountain-near)"
        d="M0 420V302c48-18 96-64 162-52 74 14 102-54 176-40 68 12 108-48 172-28 70 22 102-56 172-34 78 24 118-42 188-16 66 24 112-28 178 12l92 48v228H0Z"
      />
      {/* soft snow / highlight on a few peaks (light only via low opacity) */}
      <path
        className="farm-mountain-highlight"
        fill="var(--farm-mountain-snow)"
        d="M318 238c18-22 42-38 68-28 12 4 18 14 22 26-28 6-52 14-72 28-8-8-12-16-18-26Zm412-12c22-28 52-44 84-30 10 4 16 14 20 26-32 8-58 18-82 34-10-10-16-18-22-30Zm398 18c16-20 38-34 62-24 10 4 14 12 18 22-24 6-46 14-64 26-8-6-12-14-16-24Z"
      />
    </svg>
  )
}

/** Rolling hills + simple tree silhouettes along the ridge. */
function RidgeSvg() {
  return (
    <svg
      className="farm-ridge"
      viewBox="0 0 1440 320"
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* back hill band */}
      <path
        fill="var(--farm-ridge-back)"
        d="M0 320V168c96-36 168-28 248-12 92 18 148-32 248-18 98 14 148-28 248-8 96 20 152-22 248 4 88 24 148-12 228 18l120 36v134H0Z"
      />
      {/* front rolling meadow edge */}
      <path
        fill="var(--farm-ridge)"
        d="M0 320V198c88-28 156-18 236-6 88 14 136-24 228-10 90 14 138-20 232-4 94 16 148-18 236 8 78 24 138-4 212 22l96 28v84H0Z"
      />
      {/* deep grass pocket for depth */}
      <path
        fill="var(--farm-ridge-deep)"
        opacity="0.55"
        d="M0 320V248c120-22 220-8 340 4 110 12 180-16 300-4 120 12 200-10 320 6 100 14 180 4 280 18l100 14v34H0Z"
      />

      {/* tree clusters — simple canopy + trunk silhouettes */}
      <g className="farm-trees" fill="var(--farm-tree)">
        <Tree x={96} y={168} s={1.15} />
        <Tree x={168} y={176} s={0.85} />
        <Tree x={248} y={172} s={1} />
        <Tree x={520} y={162} s={1.25} />
        <Tree x={590} y={170} s={0.9} />
        <Tree x={820} y={158} s={1.2} />
        <Tree x={900} y={168} s={0.95} />
        <Tree x={1120} y={164} s={1.1} />
        <Tree x={1200} y={172} s={0.8} />
        <Tree x={1320} y={160} s={1.05} />
      </g>
    </svg>
  )
}

function Tree({ x, y, s }: { x: number; y: number; s: number }) {
  const w = 28 * s
  const h = 44 * s
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* trunk */}
      <rect x={w * 0.42} y={h * 0.62} width={w * 0.16} height={h * 0.38} rx={1.5} opacity={0.9} />
      {/* canopy — stacked soft blobs */}
      <ellipse cx={w * 0.5} cy={h * 0.42} rx={w * 0.42} ry={h * 0.32} />
      <ellipse cx={w * 0.32} cy={h * 0.52} rx={w * 0.28} ry={h * 0.22} />
      <ellipse cx={w * 0.68} cy={h * 0.5} rx={w * 0.3} ry={h * 0.24} />
      <ellipse cx={w * 0.5} cy={h * 0.28} rx={w * 0.26} ry={h * 0.22} />
    </g>
  )
}
