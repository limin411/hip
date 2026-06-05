import { Sidebar } from '@/components/sidebar/Sidebar'

export function AppLayout() {
  return (
    <div className="flex h-screen">
      <div className="w-60 border-r border-border">
        <Sidebar />
      </div>
      <div className="flex-1 bg-surface" />
    </div>
  )
}
