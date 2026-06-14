import { SidebarToggle } from './SidebarToggle'

/**
 * 贯穿整个应用顶部的标题栏（macOS Overlay 无原生标题栏，由它统一承载窗口 chrome）。
 * 红绿灯落在最左的留白区（宽度与菜单栏对齐），其右紧接全局唯一的折叠按钮。
 * 整条可拖动窗口；下方各列（菜单栏 / 侧栏 / 对话 / 产物）不再各自预留红绿灯偏移。
 */
export function TitleBar() {
  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center border-b border-border bg-surface"
    >
      {/* 为 macOS 红绿灯让位，并与菜单栏同宽对齐 */}
      <div className="shrink-0" style={{ width: 'var(--rail-width, 72px)' }} aria-hidden />
      <SidebarToggle />
    </header>
  )
}
