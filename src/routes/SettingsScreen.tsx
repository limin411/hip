import { ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Separator } from '@/components/ui/Separator'
import { mockSettings } from '@/mock/settings'

export function SettingsScreen() {
  return (
    <div className="flex h-screen flex-col bg-surface">
      <PageHeader title="设置" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-6 py-8">
          {mockSettings.map((group, gi) => (
            <div key={group.title} className={gi > 0 ? 'mt-8' : ''}>
              <div className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-tertiary">
                {group.title}
              </div>
              <div className="rounded-xl border border-border bg-surface-subtle">
                {group.items.map((item, ii) => (
                  <div key={item.id}>
                    <div className="flex items-center justify-between px-4 py-3.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-medium text-ink">{item.label}</div>
                        <div className="mt-0.5 text-[12px] text-ink-tertiary">{item.description}</div>
                      </div>
                      <div className="ml-4 shrink-0">
                        <SettingControl item={item} />
                      </div>
                    </div>
                    {ii < group.items.length - 1 && <Separator className="mx-4 w-auto" />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SettingControl({ item }: { item: (typeof mockSettings)[0]['items'][0] }) {
  if (item.type === 'toggle') {
    const on = Boolean(item.value)
    return (
      <button
        className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-border'}`}
        title={on ? '开启' : '关闭'}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5.5' : 'translate-x-0.5'}`}
          style={{ transform: on ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </button>
    )
  }

  if (item.type === 'select') {
    return (
      <button className="flex items-center gap-1 text-[13px] text-ink-secondary transition-colors hover:text-ink">
        {String(item.value)}
        <ChevronRight size={14} className="text-ink-tertiary" />
      </button>
    )
  }

  return (
    <span className="text-[13px] text-ink-secondary">{String(item.value)}</span>
  )
}
