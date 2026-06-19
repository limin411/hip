import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Shield } from 'lucide-react'
import type { ToolPermissionMode } from '@hip/protocol'

const TOOL_CATEGORIES = [
  { labelKey: 'settings.permissions.fileTools', tools: ['read_file', 'write_file', 'edit_file', 'ls', 'glob', 'grep'] },
  { labelKey: 'settings.permissions.execTools', tools: ['run_script'] },
  { labelKey: 'settings.permissions.gitTools', tools: ['git_commit', 'git_create_branch', 'git_switch_branch', 'git_worktree_create', 'git_worktree_list', 'git_worktree_remove'] },
  { labelKey: 'settings.permissions.otherTools', tools: ['task', 'dispatch_agent', 'use_skill', 'write_todos', 'web_search', 'web_fetch', 'generate_agent'] },
] as const

const MODES: ToolPermissionMode[] = ['auto', 'prompt', 'approve', 'deny']
const selectCls = 'rounded-md border border-border bg-surface px-2 py-1 text-caption focus:outline-none focus:ring-1 focus:ring-accent/60'

export function PermissionsConfig() {
  const { t } = useTranslation()
  const [defaultMode, setDefaultMode] = useState<ToolPermissionMode>('auto')
  const [overrides, setOverrides] = useState<Record<string, ToolPermissionMode>>({})

  const modeLabels: Record<ToolPermissionMode, string> = {
    auto: t('settings.permissions.modeAuto'),
    prompt: t('settings.permissions.modePrompt'),
    approve: t('settings.permissions.modeApprove'),
    deny: t('settings.permissions.modeDeny'),
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <Shield size={18} />
        <h3 className="text-title">{t('settings.permissions.title')}</h3>
      </div>
      <p className="text-caption text-ink-muted">{t('settings.permissions.description')}</p>

      <div className="flex flex-col gap-2">
        <label className="text-body font-medium">{t('settings.permissions.defaultMode')}</label>
        <select className={selectCls} value={defaultMode} onChange={(e) => setDefaultMode(e.target.value as ToolPermissionMode)}>
          {MODES.map((m) => (<option key={m} value={m}>{modeLabels[m]}</option>))}
        </select>
      </div>

      {TOOL_CATEGORIES.map((cat) => (
        <div key={cat.labelKey} className="flex flex-col gap-2">
          <h4 className="text-body font-medium">{t(cat.labelKey)}</h4>
          <div className="grid grid-cols-2 gap-2">
            {cat.tools.map((toolName) => {
              const effective = overrides[toolName] ?? defaultMode
              return (
                <div key={toolName} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <span className="text-caption font-mono">{toolName}</span>
                  <select className={selectCls} value={effective} onChange={(e) => {
                    const v = e.target.value as ToolPermissionMode
                    if (v === defaultMode) { const next = { ...overrides }; delete next[toolName]; setOverrides(next) }
                    else setOverrides({ ...overrides, [toolName]: v })
                  }}>
                    <option value={defaultMode}>{modeLabels[defaultMode]}</option>
                    {MODES.filter((m) => m !== defaultMode).map((m) => (<option key={m} value={m}>{modeLabels[m]}</option>))}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
