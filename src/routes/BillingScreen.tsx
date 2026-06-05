import { Zap, MessageSquare, Cpu } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Separator } from '@/components/ui/Separator'
import { mockPlans, mockUsage, mockUsageHistory } from '@/mock/billing'

export function BillingScreen() {
  const currentPlan = mockPlans.find((p) => p.current) ?? mockPlans[0]

  return (
    <div className="flex h-screen flex-col bg-surface">
      <PageHeader title="账单与用量" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-6 py-8">
          {/* 当前套餐 */}
          <div className="rounded-xl border border-border bg-surface-subtle p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">当前套餐</div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-ink">{currentPlan.price}</span>
                  <span className="text-sm text-ink-secondary">{currentPlan.period}</span>
                </div>
              </div>
              <Badge className="bg-accent-subtle text-accent">{currentPlan.name}</Badge>
            </div>
            <ul className="mt-4 flex flex-col gap-1.5">
              {currentPlan.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-[13px] text-ink-secondary">
                  <Zap size={13} className="text-success" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <Separator className="my-6" />

          {/* 本月用量 */}
          <div className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-tertiary">本月用量</div>
          <div className="flex flex-col gap-3">
            {mockUsage.map((u) => (
              <UsageBar key={u.label} usage={u} />
            ))}
          </div>

          <Separator className="my-6" />

          {/* 历史用量 */}
          <div className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-tertiary">近 6 个月 Token 用量</div>
          <div className="flex items-end gap-3 rounded-xl border border-border bg-surface-subtle p-4">
            {mockUsageHistory.map((h) => {
              const max = Math.max(...mockUsageHistory.map((x) => x.tokens))
              const pct = Math.round((h.tokens / max) * 100)
              return (
                <div key={h.month} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="text-[11px] text-ink-tertiary">{(h.tokens / 1000).toFixed(0)}k</div>
                  <div className="w-full rounded-sm bg-surface-muted">
                    <div
                      className="rounded-sm bg-accent transition-all"
                      style={{ height: `${Math.max(pct * 0.8, 4)}px` }}
                    />
                  </div>
                  <div className="text-[11px] text-ink-secondary">{h.month.slice(5)}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function UsageBar({ usage }: { usage: (typeof mockUsage)[0] }) {
  const pct = Math.min(Math.round((usage.used / usage.limit) * 100), 100)
  const icons: Record<string, typeof Zap> = {
    '本月 Token': Cpu,
    '本月请求': MessageSquare,
    '并行 Agent': Zap,
  }
  const Icon = icons[usage.label] ?? Zap

  return (
    <div className="rounded-lg border border-border bg-surface-subtle p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <Icon size={14} className="text-ink-secondary" />
          {usage.label}
        </div>
        <span className="text-[12px] text-ink-secondary">
          {usage.used.toLocaleString()} / {usage.limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
