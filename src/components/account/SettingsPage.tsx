import { SettingsPanel } from './SettingsPanel'

/**
 * 设置页内容容器 —— 标题已上移到全宽 TitleBar，本组件不再渲染单独的头行。
 */
export function SettingsPage() {
  return (
    <div className="h-full bg-surface">
      <SettingsPanel />
    </div>
  )
}
