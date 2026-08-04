/**
 * Inline SVG icons for Live DOM chrome (gutter / bubble).
 * Avoids React/lucide in ProseMirror plugin code.
 */

function svg(paths: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  el.setAttribute('viewBox', viewBox)
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('focusable', 'false')
  el.innerHTML = paths
  return el
}

export function iconGripVertical(): SVGSVGElement {
  return svg(
    '<circle cx="9" cy="5" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="9" cy="19" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="15" cy="5" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/>',
  )
}

export function iconPlus(): SVGSVGElement {
  return svg('<path d="M12 5v14M5 12h14"/>')
}

export function iconBold(): SVGSVGElement {
  return svg(
    '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>',
  )
}

export function iconItalic(): SVGSVGElement {
  return svg('<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>')
}

export function iconStrike(): SVGSVGElement {
  return svg('<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>')
}

export function iconInlineCode(): SVGSVGElement {
  return svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>')
}

export function iconHeading(level: 1 | 2 | 3): SVGSVGElement {
  const label = String(level)
  return svg(
    `<path d="M4 12h8"/><path d="M4 18V6"/><path d="M12 18V6"/><text x="16" y="18" font-size="10" fill="currentColor" stroke="none" font-family="system-ui,sans-serif" font-weight="600">${label}</text>`,
  )
}

export function iconLink(): SVGSVGElement {
  return svg(
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  )
}

export function iconTurnInto(): SVGSVGElement {
  return svg('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>')
}

export function iconClearMarks(): SVGSVGElement {
  return svg(
    '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/><line x1="4" x2="20" y1="15" y2="9"/>',
  )
}

export function iconCheck(): SVGSVGElement {
  return svg('<polyline points="20 6 9 17 4 12"/>')
}

export function iconX(): SVGSVGElement {
  return svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')
}

export function iconList(): SVGSVGElement {
  return svg(
    '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  )
}

export function iconListOrdered(): SVGSVGElement {
  return svg(
    '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  )
}

export function iconQuote(): SVGSVGElement {
  return svg('<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3"/>')
}

export function iconFence(): SVGSVGElement {
  return svg(
    '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  )
}

/** Replace button contents with an SVG icon. */
export function setButtonIcon(btn: HTMLElement, icon: SVGSVGElement): void {
  btn.replaceChildren(icon)
}
