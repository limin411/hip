import { ChevronRight } from 'lucide-react'

const LANGUAGES = ['简体中文', 'English', '日本語']

export function SettingsPanel() {
  return (
    <div className="flex items-center justify-between px-6 py-5">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-ink">界面语言</div>
        <div className="mt-0.5 text-[12px] text-ink-tertiary">应用界面的显示语言</div>
      </div>
      <button className="ml-4 flex shrink-0 items-center gap-1 text-[13px] text-ink-secondary transition-colors hover:text-ink">
        {LANGUAGES[0]}
        <ChevronRight size={14} className="text-ink-tertiary" />
      </button>
    </div>
  )
}
