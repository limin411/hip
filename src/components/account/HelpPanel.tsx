import { Keyboard, Package, ChevronDown } from 'lucide-react'
import { Separator } from '@/components/ui/Separator'
import { mockVersion, mockShortcuts, mockFaqs } from '@/mock/help'

export function HelpPanel() {
  return (
    <div className="px-6 py-6">
      {/* 版本信息 */}
      <div className="rounded-xl border border-border bg-surface-subtle p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <Package size={15} className="text-accent" />
          版本信息
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <VersionRow label="应用" value={mockVersion.app} />
          <VersionRow label="Tauri" value={mockVersion.tauri} />
          <VersionRow label="React" value={mockVersion.react} />
          <VersionRow label="构建日期" value={mockVersion.build} />
        </div>
      </div>

      <Separator className="my-6" />

      {/* 快捷键 */}
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ink-tertiary">
        <Keyboard size={14} />
        快捷键
      </div>
      <div className="rounded-xl border border-border bg-surface-subtle">
        {mockShortcuts.map((s, i) => (
          <div key={s.action}>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[13px] text-ink">{s.action}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((k, ki) => (
                  <span key={k} className="flex items-center gap-1">
                    <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] font-mono text-ink-secondary">
                      {k}
                    </kbd>
                    {ki < s.keys.length - 1 && <span className="text-ink-tertiary">+</span>}
                  </span>
                ))}
              </div>
            </div>
            {i < mockShortcuts.length - 1 && <Separator className="mx-4 w-auto" />}
          </div>
        ))}
      </div>

      <Separator className="my-6" />

      {/* FAQ */}
      <div className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-tertiary">常见问题</div>
      <div className="flex flex-col gap-2">
        {mockFaqs.map((faq) => (
          <FaqItem key={faq.q} faq={faq} />
        ))}
      </div>
    </div>
  )
}

function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-secondary">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  )
}

function FaqItem({ faq }: { faq: (typeof mockFaqs)[0] }) {
  return (
    <details className="group rounded-xl border border-border bg-surface-subtle">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-[14px] font-medium text-ink">
        {faq.q}
        <ChevronDown size={14} className="text-ink-tertiary transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-3 text-[13px] leading-relaxed text-ink-secondary">{faq.a}</div>
    </details>
  )
}
