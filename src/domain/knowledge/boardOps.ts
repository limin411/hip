/**
 * Pure geometry / hit-test / transform helpers for the hip SVG whiteboard.
 * No React; camera is session-only (LKD-14).
 */
import {
  HIP_BOARD_DEFAULT_CAMERA,
  HIP_BOARD_ZOOM_MAX,
  HIP_BOARD_ZOOM_MIN,
  type HipBoardCamera,
  type HipBoardElement,
  type HipBoardLine,
} from './boardScene'

export type WorldPoint = { x: number; y: number }
export type ScreenPoint = { x: number; y: number }
export type WorldAabb = { x: number; y: number; w: number; h: number }

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return HIP_BOARD_DEFAULT_CAMERA.zoom
  return Math.min(HIP_BOARD_ZOOM_MAX, Math.max(HIP_BOARD_ZOOM_MIN, zoom))
}

export function clampCamera(camera: HipBoardCamera): HipBoardCamera {
  return {
    x: Number.isFinite(camera.x) ? camera.x : 0,
    y: Number.isFinite(camera.y) ? camera.y : 0,
    zoom: clampZoom(camera.zoom),
  }
}

/** Screen → world: wx = (sx - panX) / zoom */
export function screenToWorld(
  sx: number,
  sy: number,
  camera: HipBoardCamera,
): WorldPoint {
  const z = camera.zoom || 1
  return {
    x: (sx - camera.x) / z,
    y: (sy - camera.y) / z,
  }
}

/** World → screen (inverse of screenToWorld). */
export function worldToScreen(
  wx: number,
  wy: number,
  camera: HipBoardCamera,
): ScreenPoint {
  const z = camera.zoom || 1
  return {
    x: wx * z + camera.x,
    y: wy * z + camera.y,
  }
}

/**
 * Zoom toward a screen anchor so the world point under the cursor stays fixed.
 * Returns a new camera; does not mutate.
 */
export function zoomAtScreenPoint(
  camera: HipBoardCamera,
  screenX: number,
  screenY: number,
  nextZoom: number,
): HipBoardCamera {
  const z1 = clampZoom(nextZoom)
  const z0 = camera.zoom || 1
  if (z1 === z0) return clampCamera(camera)
  // world under cursor before zoom
  const wx = (screenX - camera.x) / z0
  const wy = (screenY - camera.y) / z0
  // keep that world point under the same screen pixel
  return {
    x: screenX - wx * z1,
    y: screenY - wy * z1,
    zoom: z1,
  }
}

/** Axis-aligned bounding box in world space. */
export function elementAabb(el: HipBoardElement): WorldAabb {
  switch (el.type) {
    case 'rect':
    case 'ellipse':
    case 'text':
    case 'image':
      return {
        x: Math.min(el.x, el.x + el.w),
        y: Math.min(el.y, el.y + el.h),
        w: Math.abs(el.w),
        h: Math.abs(el.h),
      }
    case 'line':
    case 'arrow': {
      const x = Math.min(el.x, el.x2)
      const y = Math.min(el.y, el.y2)
      return {
        x,
        y,
        w: Math.abs(el.x2 - el.x),
        h: Math.abs(el.y2 - el.y),
      }
    }
  }
}

function pointInAabb(px: number, py: number, box: WorldAabb, pad = 0): boolean {
  return (
    px >= box.x - pad &&
    px <= box.x + box.w + pad &&
    py >= box.y - pad &&
    py <= box.y + box.h + pad
  )
}

function pointInEllipse(
  px: number,
  py: number,
  el: Extract<HipBoardElement, { type: 'ellipse' }>,
): boolean {
  const rx = Math.abs(el.w) / 2 + el.strokeWidth / 2
  const ry = Math.abs(el.h) / 2 + el.strokeWidth / 2
  if (rx <= 0 || ry <= 0) return false
  const cx = el.x + el.w / 2
  const cy = el.y + el.h / 2
  const nx = (px - cx) / rx
  const ny = (py - cy) / ry
  return nx * nx + ny * ny <= 1
}

function distPointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = x1 + t * dx
  const qy = y1 + t * dy
  return Math.hypot(px - qx, py - qy)
}

function hitLine(
  px: number,
  py: number,
  el: HipBoardLine,
  zoom: number,
): boolean {
  const threshold = Math.max(4, el.strokeWidth / 2) / (zoom || 1)
  return distPointToSegment(px, py, el.x, el.y, el.x2, el.y2) <= threshold
}

/**
 * Hit-test: array end is topmost. Returns element id or null.
 * `zoom` is used for line hit threshold (screen-stable width).
 */
export function hitTest(
  elements: readonly HipBoardElement[],
  worldX: number,
  worldY: number,
  zoom = 1,
): string | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!
    switch (el.type) {
      case 'rect':
      case 'text':
      case 'image':
        if (pointInAabb(worldX, worldY, elementAabb(el))) return el.id
        break
      case 'ellipse':
        if (pointInEllipse(worldX, worldY, el)) return el.id
        break
      case 'line':
      case 'arrow':
        if (hitLine(worldX, worldY, el, zoom)) return el.id
        break
    }
  }
  return null
}

/** Marquee: world AABB intersects element AABB (ellipse uses bounding box). */
export function hitTestMarquee(
  elements: readonly HipBoardElement[],
  marquee: WorldAabb,
): string[] {
  const ids: string[] = []
  const mx2 = marquee.x + marquee.w
  const my2 = marquee.y + marquee.h
  for (const el of elements) {
    const b = elementAabb(el)
    const bx2 = b.x + b.w
    const by2 = b.y + b.h
    if (b.x <= mx2 && bx2 >= marquee.x && b.y <= my2 && by2 >= marquee.y) {
      ids.push(el.id)
    }
  }
  return ids
}

/** Translate elements by (dx, dy). Skips locked. Returns new array (same refs for untouched). */
export function moveElements(
  elements: readonly HipBoardElement[],
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): HipBoardElement[] {
  if (ids.size === 0 || (dx === 0 && dy === 0)) return elements as HipBoardElement[]
  return elements.map((el) => {
    if (!ids.has(el.id) || el.locked) return el
    if (el.type === 'line' || el.type === 'arrow') {
      return { ...el, x: el.x + dx, y: el.y + dy, x2: el.x2 + dx, y2: el.y2 + dy }
    }
    return { ...el, x: el.x + dx, y: el.y + dy }
  })
}

/** Remove elements by id. Skips locked (they stay). */
export function deleteElements(
  elements: readonly HipBoardElement[],
  ids: ReadonlySet<string>,
): HipBoardElement[] {
  if (ids.size === 0) return elements as HipBoardElement[]
  return elements.filter((el) => !ids.has(el.id) || el.locked === true)
}

/** SVG transform for the world group: translate(pan) scale(zoom). */
export function worldGroupTransform(camera: HipBoardCamera): string {
  const c = clampCamera(camera)
  return `translate(${c.x},${c.y}) scale(${c.zoom})`
}
