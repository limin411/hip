import type { CSSProperties } from 'react'
import { isoProject, YARD_CELL } from '../map/isoLayout'

/**
 * Decorative farmyard props — path, well, trees, fence, flowers, critter.
 * Purely visual; no navigation.
 */
export function FarmScenery({
  originX,
  originY,
}: {
  originX: number
  originY: number
}) {
  const yard = isoProject(YARD_CELL.col, YARD_CELL.row)
  const north = isoProject(2, 0)
  const south = isoProject(2, 3)
  const west = isoProject(0, 2)
  const east = isoProject(4, 2)

  const at = (x: number, y: number, z = 3): CSSProperties => ({
    position: 'absolute',
    left: originX + x,
    top: originY + y,
    zIndex: z,
  })

  return (
    <div className="px-scenery" aria-hidden data-testid="workbench-farm-scenery">
      {/* dirt paths: N–S and W–E through yard */}
      <div
        className="px-path-seg px-path-v"
        style={{
          ...at(yard.x - 12, north.y + 55, 1),
          height: Math.max(80, south.y - north.y - 20),
        }}
      />
      <div
        className="px-path-seg px-path-h"
        style={{
          ...at(west.x + 50, yard.y + 72, 1),
          width: Math.max(100, east.x - west.x - 60),
        }}
      />
      <div className="px-path-pad" style={at(yard.x - 32, yard.y + 52, 1)} />

      {/* well */}
      <div className="px-well" style={at(yard.x - 24, yard.y + 22, 5)}>
        <span className="px-well-roof" />
        <span className="px-well-post a" />
        <span className="px-well-post b" />
        <span className="px-well-bucket" />
        <span className="px-well-rim" />
        <span className="px-well-water" />
      </div>

      {/* trees */}
      <PixelTree style={at(isoProject(-0.6, -0.4).x - 18, isoProject(-0.6, -0.4).y + 8, 2)} />
      <PixelTree
        variant="pine"
        style={at(isoProject(5.1, -0.2).x - 8, isoProject(5.1, -0.2).y + 4, 2)}
      />
      <PixelTree style={at(isoProject(-0.7, 3.3).x - 14, isoProject(-0.7, 3.3).y + 24, 6)} />
      <PixelTree
        variant="fruit"
        style={at(isoProject(5.1, 3.2).x - 6, isoProject(5.1, 3.2).y + 22, 6)}
      />

      {/* fence posts */}
      {[
        isoProject(-0.35, 0.3),
        isoProject(-0.35, 1.5),
        isoProject(4.4, 0.3),
        isoProject(4.4, 1.7),
        isoProject(0.8, 3.55),
        isoProject(3.2, 3.55),
      ].map((p, i) => (
        <span key={i} className="px-fence" style={at(p.x - 3, p.y + 48, 2)} />
      ))}

      {/* flowers */}
      <span className="px-flowers a" style={at(west.x + 48, west.y + 92, 3)} />
      <span className="px-flowers b" style={at(east.x - 56, east.y + 90, 3)} />
      <span className="px-flowers c" style={at(south.x + 36, south.y + 96, 3)} />
      <span className="px-flowers a" style={at(north.x - 60, north.y + 70, 3)} />

      {/* rocks + scarecrow */}
      <span className="px-rocks" style={at(north.x + 58, north.y + 28, 2)} />
      <div className="px-scarecrow" style={at(north.x - 74, north.y + 16, 4)}>
        <span className="px-scare-head" />
        <span className="px-scare-body" />
        <span className="px-scare-arm" />
      </div>

      {/* chicken */}
      <div className="px-chicken" style={at(yard.x + 40, yard.y + 80, 6)}>
        <span className="px-chicken-body" />
        <span className="px-chicken-comb" />
      </div>

      {/* mailbox at gate */}
      <div className="px-mailbox" style={at(south.x - 52, south.y + 36, 4)}>
        <span className="px-mail-box" />
        <span className="px-mail-post" />
      </div>
    </div>
  )
}

function PixelTree({
  style,
  variant = 'round',
}: {
  style: CSSProperties
  variant?: 'round' | 'pine' | 'fruit'
}) {
  return (
    <div className={`px-tree px-tree--${variant}`} style={style}>
      <span className="px-tree-canopy" />
      <span className="px-tree-trunk" />
      {variant === 'fruit' && (
        <>
          <span className="px-tree-fruit a" />
          <span className="px-tree-fruit b" />
        </>
      )}
    </div>
  )
}
