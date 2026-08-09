/**
 * Shared titlebar chrome tokens so AppSidebar and MainToolbar keep left/right
 * icon controls on one horizontal baseline (same height, border, button box).
 * Height: --titlebar-height (40px default; 48px on mac so content meets traffic lights).
 */
export const titlebarRowClass =
  'box-border flex h-[var(--titlebar-height)] shrink-0 items-center border-b border-border'

export const titlebarIconBtnClass =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 leading-none text-ink transition-[background-color,color] duration-chrome ease-out hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20'

export const titlebarIconProps = {
  size: 16 as const,
  strokeWidth: 1.75,
  className: 'block',
  'aria-hidden': true as const,
}
