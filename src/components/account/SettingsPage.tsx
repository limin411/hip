import { SettingsPanel } from './SettingsPanel'

/**
 * 设置页内容容器 —— 标题在 MainToolbar；本组件仍不渲染头行。
 */
export function SettingsPage() {
  return (
    <div className="h-full bg-surface">
      <SettingsPanel />
    </div>
  )
}
