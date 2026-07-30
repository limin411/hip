import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Components } from 'react-markdown'
import { Sparkles, FileText, Eye, Trash2, MoreVertical, TerminalSquare, Zap, GitFork, Wrench, BookOpen } from 'lucide-react'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import type { PluginMeta, SkillMeta } from '@hip/protocol'
import { useSkillsStore } from '@/store/skillsStore'
import { usePluginsStore } from '@/store/pluginsStore'
import { useExtensionStore } from '@/store/extensionStore'
import { partitionSkillsFromSnapshot } from '@/lib/extensionSnapshot'
import { readSkillFile } from '@/ipc/skills'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { SETTINGS_SHELL_PAGE, useUiStore } from '@/store/uiStore'

// ── Display helpers (pure functions, testable) ──

export function badgeForAutoInvoke(skill: SkillMeta): { label: string; variant: 'auto' | 'manual' } | null {
  if (skill.autoInvoke !== false) return null
  return { label: 'Manual', variant: 'manual' }
}

export function badgeForContext(skill: SkillMeta): { label: string } | null {
  if (skill.context !== 'fork') return null
  return { label: 'Fork' }
}

export function refCountLabel(skill: SkillMeta): string | null {
  const refs = skill.hasReferences ? 1 : 0
  const assets = skill.hasAssets ? 1 : 0
  const count = refs + assets
  if (count === 0) return null
  const parts: string[] = []
  if (refs) parts.push('refs')
  if (assets) parts.push('assets')
  return parts.join(', ')
}

export function toolAllowlistPreview(skill: SkillMeta, max = 3): string | null {
  if (!skill.allowedTools || skill.allowedTools.length === 0) return null
  const preview = skill.allowedTools.slice(0, max).join(', ')
  if (skill.allowedTools.length > max) return `${preview} +${skill.allowedTools.length - max}`
  return preview
}

/** True when a skill is owned by a plugin package (not a standalone ~/.hip/skills entry). */
export function isPluginManagedSkill(skill: SkillMeta): boolean {
  return skill.scope === 'plugin' || Boolean(skill.pluginId)
}

/** True when a skill is a product built-in (hip / hip-coding under ~/.hip/builtin-skills). */
export function isBuiltinSkill(skill: SkillMeta): boolean {
  if (skill.scope === 'builtin') return true
  // Fallback for older snapshots that still stamp scope=global.
  return /(?:^|[\\/])builtin-skills[\\/]/.test(skill.dir)
}

/**
 * Build read-only SkillMeta entries from plugin manifests.
 * - Standalone skills take precedence over plugin-provided skills with the same id.
 * - If multiple plugins export the same skill id, the first plugin in the list wins.
 */
export function derivePluginSkills(
  plugins: PluginMeta[],
  standaloneSkillIds: Set<string>,
): Array<{ skill: SkillMeta; pluginName: string }> {
  const seen = new Set<string>()
  const result: Array<{ skill: SkillMeta; pluginName: string }> = []
  for (const plugin of plugins) {
    for (const skillId of plugin.skills ?? []) {
      if (standaloneSkillIds.has(skillId)) continue
      if (seen.has(skillId)) continue
      seen.add(skillId)
      result.push({
        skill: {
          id: skillId,
          name: skillId,
          description: '',
          dir: plugin.dir,
          hasScripts: false,
          pluginId: plugin.id,
          scope: 'plugin',
        },
        pluginName: plugin.name,
      })
    }
  }
  return result
}

/**
 * Split scanned skills into standalone (user-owned), product built-ins (locked),
 * and plugin-managed (toggle-only).
 * Merges list_skills plugin-scoped rows with manifest-derived rows so neither is lost.
 * `pluginEnabled` follows the parent plugin market switch (false when parent is off).
 */
export function partitionSkillsForSettings(
  skills: SkillMeta[],
  plugins: PluginMeta[],
): {
  standalone: SkillMeta[]
  builtin: SkillMeta[]
  pluginEntries: Array<{ skill: SkillMeta; pluginName: string; pluginEnabled: boolean }>
} {
  const nonPlugin = skills.filter((s) => !isPluginManagedSkill(s))
  const builtin = nonPlugin.filter((s) => isBuiltinSkill(s))
  const standalone = nonPlugin.filter((s) => !isBuiltinSkill(s))
  const standaloneIds = new Set(nonPlugin.map((s) => s.id))
  const pluginById = new Map(plugins.map((p) => [p.id, p]))

  const pluginEntries: Array<{ skill: SkillMeta; pluginName: string; pluginEnabled: boolean }> = []
  const seen = new Set<string>()

  for (const s of skills) {
    if (!isPluginManagedSkill(s)) continue
    if (seen.has(s.id)) continue
    seen.add(s.id)
    const parent = s.pluginId ? pluginById.get(s.pluginId) : undefined
    pluginEntries.push({
      skill: s,
      pluginName: parent?.name || s.pluginId || 'plugin',
      // Parent off / missing ⇒ skill treated as disabled in settings + session.
      pluginEnabled: parent?.enabled === true,
    })
  }

  for (const row of derivePluginSkills(plugins, standaloneIds)) {
    if (seen.has(row.skill.id)) continue
    seen.add(row.skill.id)
    const parent = row.skill.pluginId ? pluginById.get(row.skill.pluginId) : undefined
    pluginEntries.push({
      skill: row.skill,
      pluginName: row.pluginName,
      pluginEnabled: parent?.enabled === true,
    })
  }

  return { standalone, builtin, pluginEntries }
}

/** Effective skill switch: parent plugin must be on AND per-skill enabled. */
export function effectivePluginSkillEnabled(
  skillEnabled: boolean,
  pluginEnabled: boolean,
): boolean {
  return pluginEnabled && skillEnabled
}

export function SkillConfig() {
  const { t } = useTranslation()
  const { skills, enabled, loaded, load, toggle, remove } = useSkillsStore()
  const { plugins, loaded: pluginsLoaded, load: loadPlugins } = usePluginsStore()
  const snapshot = useExtensionStore((s) => s.snapshot)
  const inspect = useExtensionStore((s) => s.inspect)
  const partitioned = useMemo(() => {
    if (snapshot) {
      const fromSnap = partitionSkillsFromSnapshot(snapshot, plugins)
      // Merge scanned skill bodies when snapshot meta is thin
      const byId = new Map(skills.map((s) => [s.id, s]))
      return {
        standalone: fromSnap.standalone.map((s) => byId.get(s.id) ?? s),
        builtin: fromSnap.builtin.map((s) => byId.get(s.id) ?? s),
        pluginEntries: fromSnap.pluginEntries.map((e) => ({
          skill: byId.get(e.skill.id) ?? e.skill,
          pluginName: e.pluginName,
          pluginEnabled: e.pluginEnabled,
          registryActive: e.registryActive,
        })),
      }
    }
    const base = partitionSkillsForSettings(skills, plugins)
    return {
      standalone: base.standalone,
      builtin: base.builtin,
      pluginEntries: base.pluginEntries.map((e) => ({ ...e, registryActive: e.pluginEnabled })),
    }
  }, [snapshot, skills, plugins])
  const { standalone, builtin, pluginEntries } = partitioned
  const settingsShellRoute = useUiStore((s) => s.settingsShellRoute)
  const setSettingsShellRoute = useUiStore((s) => s.setSettingsShellRoute)
  const [deleting, setDeleting] = useState<SkillMeta | null>(null)

  const skillViewId =
    settingsShellRoute.type === 'skill-view' ? settingsShellRoute.skillId : null
  const viewingSkill = useMemo(() => {
    if (!skillViewId) return null
    const fromStandalone = standalone.find((s) => s.id === skillViewId)
    if (fromStandalone) return fromStandalone
    const fromBuiltin = builtin.find((s) => s.id === skillViewId)
    if (fromBuiltin) return fromBuiltin
    return pluginEntries.find((e) => e.skill.id === skillViewId)?.skill ?? null
  }, [skillViewId, standalone, builtin, pluginEntries])

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  useEffect(() => {
    if (!pluginsLoaded) void loadPlugins()
  }, [pluginsLoaded, loadPlugins])

  useEffect(() => {
    // Shared TTL/coalesce in extensionStore — no page banner; conflicts toast bottom-right.
    void inspect()
  }, [inspect])

  // In-shell L2: skill detail replaces list body (no second Modal).
  if (viewingSkill) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SkillViewModal
          skill={viewingSkill}
          mode="inline"
          onClose={() => setSettingsShellRoute(SETTINGS_SHELL_PAGE)}
        />
        {deleting && (
          <Modal
            open
            variant="confirm"
            onOpenChange={(o) => {
              if (!o) setDeleting(null)
            }}
            title={t('settings.skill.deleteConfirmTitle', { name: deleting.name })}
          >
            <div className="p-5">
              <p className="text-body text-ink-secondary">{t('settings.skill.deleteConfirmBody')}</p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                  {t('settings.skill.cancel')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    void remove(deleting.id)
                    setDeleting(null)
                  }}
                >
                  {t('settings.skill.delete')}
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  return (
    <div className="p-6">
      <div>
        <h2 className="text-title font-semibold text-ink">{t('settings.skill.title')}</h2>
        <p className="mt-1 text-body text-ink-secondary">{t('settings.skill.intro')}</p>
      </div>

      <div className="mt-5">
        {standalone.length === 0 && builtin.length === 0 && pluginEntries.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            tier="professional"
            title={t('settings.skill.empty')}
            description={t('settings.skill.emptyHint')}
            className="border border-dashed border-border bg-surface-subtle"
            data-testid="skill-config-empty"
          />
        ) : (
          <>
            {standalone.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {standalone.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    enabled={enabled[skill.id] !== false}
                    onToggle={(on) => void toggle(skill.id, on)}
                    onView={() => setSettingsShellRoute({ type: 'skill-view', skillId: skill.id })}
                    onDelete={() => setDeleting(skill)}
                  />
                ))}
              </div>
            )}
            {builtin.length > 0 && (
              <div className={standalone.length > 0 ? 'mt-6' : undefined}>
                <h3 className="text-meta font-medium text-ink-secondary">{t('settings.skill.builtinSkills')}</h3>
                <p className="mt-1 text-caption text-ink-tertiary">{t('settings.skill.builtinSkillsHint')}</p>
                <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {builtin.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      enabled
                      onToggle={() => {}}
                      onView={() => setSettingsShellRoute({ type: 'skill-view', skillId: skill.id })}
                      onDelete={() => {}}
                      locked
                      switchDisabled
                    />
                  ))}
                </div>
              </div>
            )}
            {pluginEntries.length > 0 && (
              <div className="mt-6">
                <h3 className="text-meta font-medium text-ink-secondary">{t('settings.skill.pluginSkills')}</h3>
                <p className="mt-1 text-caption text-ink-tertiary">{t('settings.skill.pluginSkillsHint')}</p>
                <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {pluginEntries.map(({ skill, pluginName, pluginEnabled, registryActive }) => {
                    const skillOn = enabled[skill.id] !== false
                    return (
                      <SkillCard
                        key={skill.id}
                        skill={skill}
                        enabled={
                          effectivePluginSkillEnabled(skillOn, pluginEnabled) && registryActive !== false
                        }
                        onToggle={(on) => void toggle(skill.id, on)}
                        onView={() => setSettingsShellRoute({ type: 'skill-view', skillId: skill.id })}
                        onDelete={() => {}}
                        readOnly={{
                          pluginName,
                          pluginEnabled,
                          registryActive,
                        }}
                        switchDisabled={!pluginEnabled || registryActive === false}
                      />
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {deleting && (
        <Modal
          open
          variant="confirm"
          onOpenChange={(o) => {
            if (!o) setDeleting(null)
          }}
          title={t('settings.skill.deleteConfirmTitle', { name: deleting.name })}
        >
          <div className="p-5">
            <p className="text-body text-ink-secondary">{t('settings.skill.deleteConfirmBody')}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                {t('settings.skill.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  void remove(deleting.id)
                  setDeleting(null)
                }}
              >
                {t('settings.skill.delete')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export function SkillCard({
  skill,
  enabled,
  onToggle,
  onView,
  onDelete,
  readOnly,
  locked,
  switchDisabled,
}: {
  skill: SkillMeta
  enabled: boolean
  onToggle: (on: boolean) => void
  onView: () => void
  onDelete: () => void
  readOnly?: { pluginName: string; pluginEnabled?: boolean; registryActive?: boolean }
  /** Product built-in: always on, not deletable, not toggleable. */
  locked?: boolean
  /** When true, the enable switch cannot be flipped (e.g. parent plugin is off). */
  switchDisabled?: boolean
}) {
  const { t } = useTranslation()
  const autoBadge = badgeForAutoInvoke(skill)
  const ctxBadge = badgeForContext(skill)
  const refLabel = refCountLabel(skill)
  const toolsPreview = toolAllowlistPreview(skill)
  const canDelete = !readOnly && !locked
  // Card chrome on permanent outer so CONTEXT_MENUS=false keeps layout.
  return (
    <div
      data-testid="skill-card"
      data-skill-locked={locked ? 'true' : undefined}
      className={`flex flex-col gap-3 rounded-lg border border-border bg-surface p-4${!enabled ? ' opacity-60' : ''}`}
    >
      <DeclarativeContextMenu
        kind="skillConfig"
        payload={{
          skillId: skill.id,
          name: skill.name,
          canDelete,
          onView,
          onDelete,
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-start gap-3">
          <Avatar name={skill.name} shape="square" size={38} />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">{skill.name}</span>
            {locked && (
              <Badge variant="accent" className="shrink-0">
                {t('settings.skill.builtinBadge')}
              </Badge>
            )}
            {readOnly && (
              <Badge variant="accent" className="shrink-0">
                via {readOnly.pluginName}
              </Badge>
            )}
            {readOnly && readOnly.pluginEnabled === false && (
              <Badge className="shrink-0 bg-surface-muted text-ink-tertiary">
                {t('settings.skill.pluginDisabledBadge')}
              </Badge>
            )}
            {readOnly && readOnly.registryActive === false && (
              <Badge className="shrink-0 bg-amber-500/15 text-amber-800 dark:text-amber-200">
                {t('settings.extensions.shadowedBadge', { defaultValue: 'Shadowed' })}
              </Badge>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={enabled}
              onCheckedChange={onToggle}
              disabled={switchDisabled || locked}
              ariaLabel={
                locked ? t('settings.skill.builtinAlwaysOn') : t('settings.skill.enableThis')
              }
            />
            {/* modal={false}: a modal menu + a dialog its item opens both lock body{pointer-events:none};
                stacking them leaves the lock stuck after close. A kebab needs no trap, so non-modal is safe. */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
                  aria-label={t('settings.skill.menuMore')}
                >
                  <MoreVertical size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onView}>
                  <Eye size={14} /> {t('settings.skill.view')}
                </DropdownMenuItem>
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-danger focus:bg-danger/10" onSelect={onDelete}>
                      <Trash2 size={14} /> {t('settings.skill.delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {skill.description && (
          <p className="truncate text-caption text-ink-tertiary">{skill.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {skill.hasScripts && (
            <Badge title={t('settings.skill.hasScriptsTitle')}>
              <TerminalSquare size={11} />
              {t('settings.skill.hasScripts')}
            </Badge>
          )}
          {autoBadge && (
            <Badge
              className={
                autoBadge.variant === 'auto'
                  ? 'bg-success/10 text-success'
                  : 'bg-surface-muted text-ink-tertiary'
              }
            >
              <Zap size={11} />
              {autoBadge.label}
            </Badge>
          )}
          {ctxBadge && (
            <Badge variant="accent">
              <GitFork size={11} />
              {ctxBadge.label}
            </Badge>
          )}
          {refLabel && (
            <Badge>
              <BookOpen size={11} />
              {refLabel}
            </Badge>
          )}
          {toolsPreview && (
            <Badge title={skill.allowedTools?.join(', ')}>
              <Wrench size={11} />
              {toolsPreview}
            </Badge>
          )}
        </div>
      </DeclarativeContextMenu>
    </div>
  )
}

export function SkillViewModal({
  skill,
  onClose,
  mode = 'inline',
}: {
  skill: SkillMeta
  onClose: () => void
  /** `inline` = in-shell Settings L2 (default). `modal` = legacy portaled Task dialog. */
  mode?: 'modal' | 'inline'
}) {
  const { t } = useTranslation()
  const [body, setBody] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const title = t('settings.skill.viewTitle', { name: skill.name })

  useEffect(() => {
    let live = true
    setBody(null)
    setError(false)
    readSkillFile(skill.id, 'SKILL.md')
      .then((b) => {
        if (live) setBody(b)
      })
      .catch(() => {
        if (live) setError(true)
      })
    return () => {
      live = false
    }
  }, [skill.id])

  const markdownComponents: Components = {
    code({ className, children, ...props }) {
      const text = String(children).replace(/\n$/, '')
      const isCmd = /^!\S/.test(text)
      if (isCmd) {
        return (
          <code className="rounded bg-accent/15 px-1.5 py-0.5 text-[0.85em] font-semibold text-accent" {...props}>
            {children}
          </code>
        )
      }
      const isBlock = className?.startsWith('language-')
      return (
        <code
          className={isBlock ? className : undefined}
          {...props}
        >
          {children}
        </code>
      )
    },
  }

  const content = (
    <div className="p-6" data-testid="settings-skill-view">
      {error ? (
        <div className="flex items-center gap-2 text-body text-danger">
          <FileText size={16} /> {t('settings.skill.loadError')}
        </div>
      ) : body === null ? (
        <div className="text-body text-ink-tertiary">…</div>
      ) : (
        <MarkdownBody content={body} components={markdownComponents} />
      )}
    </div>
  )

  if (mode === 'inline') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-5">
          <h2 className="text-title font-semibold tracking-tight text-ink">{title}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      </div>
    )
  }

  return (
    <Modal
      open
      variant="task"
      nested
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={title}
      resizable
      storageKey="skill-view"
    >
      {content}
    </Modal>
  )
}
