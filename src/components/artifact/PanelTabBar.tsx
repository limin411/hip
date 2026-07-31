import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MoreHorizontal } from 'lucide-react'
import type { ArtifactTab, ChatTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { CODE_TERMINAL } from './terminalFeature'
import { visibleArtifactTabs, type PanelTabValue } from './visibleArtifactTabs'
import { cn } from '@/lib/utils'
import { focusChrome } from '@/components/ui/focusClasses'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'

/**
 * Tab strip for the shell right rail titlebar (code ArtifactPanel / chat PreviewPanel).
 * Sits in the first row beside collapse / branch controls; selected tab uses a rounded wash.
 *
 * Narrow rail: tabs are shrink-0, so when the strip clips we surface a right-edge fade
 * plus a "⋯" jump menu — otherwise clipped tabs silently disappear (macOS overlay
 * scrollbars stay hidden until you scroll). The active tab is auto-scrolled into view.
 */
export function PanelTabBar({ surface }: { surface: 'code' | 'chat' }) {
  const { t } = useTranslation()
  const sid = useDomainStore((s) => s.activeSessionId)
  const isGitRepo = useDiffStore((s) => (sid ? s.bySession[sid]?.isGitRepo : false)) ?? false
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const chatActiveTab = useUiStore((s) => s.chatActiveTab)
  const setChatActiveTab = useUiStore((s) => s.setChatActiveTab)

  const tabs = visibleArtifactTabs({
    surface,
    isGitRepo,
    codeTerminal: CODE_TERMINAL,
  }).filter((tab) => !tab.gated)

  const current: PanelTabValue =
    surface === 'code'
      ? activeTab === 'tasks'
        ? 'agents'
        : activeTab
      : chatActiveTab === 'tasks'
        ? 'agents'
        : chatActiveTab

  const onSelect = (value: PanelTabValue) => {
    if (surface === 'code') {
      setTab(value as ArtifactTab)
    } else {
      setChatActiveTab(value as ChatTab)
    }
  }

  // --- Narrow-rail overflow chrome -------------------------------------------
  // Re-measure on tab-set changes (git state / terminal flag / surface) and on
  // container resizes; scroll position drives whether the edge fade is shown.
  const stripRef = useRef<HTMLDivElement>(null)
  const activeTabRef = useRef<HTMLButtonElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [atEnd, setAtEnd] = useState(false)
  const tabKey = tabs.map((tab) => tab.value).join(',')

  useLayoutEffect(() => {
    const el = stripRef.current
    if (!el) return
    const measure = () => {
      setOverflowing(el.scrollWidth > el.clientWidth + 1)
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tabKey])

  // Keep the selected tab in view when it changes or the strip starts clipping.
  useEffect(() => {
    if (overflowing) {
      activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [current, overflowing])

  return (
    <div
      role="tablist"
      aria-label={t('chat.togglePanel')}
      data-testid="panel-tab-bar"
      data-tauri-drag-region="false"
      className="flex min-w-0 flex-1 items-center gap-0.5"
    >
      <div
        ref={stripRef}
        data-testid="panel-tab-strip"
        className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        onScroll={() => {
          const el = stripRef.current
          if (el) setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2)
        }}
      >
        {tabs.map((tab) => {
          const selected = current === tab.value
          const label = t(tab.labelKey)
          return (
            <button
              key={tab.value}
              ref={selected ? activeTabRef : undefined}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`panel-tab-${tab.value}`}
              onClick={() => onSelect(tab.value)}
              className={cn(
                'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-meta font-medium transition-colors duration-chrome',
                focusChrome,
                selected
                  ? 'bg-state-active text-ink'
                  : 'text-ink-tertiary hover:bg-state-hover hover:text-ink-secondary',
              )}
            >
              {label}
            </button>
          )
        })}
        {overflowing && !atEnd ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent"
          />
        ) : null}
      </div>
      {overflowing ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={t('artifact.moreTabs')}
              aria-label={t('artifact.moreTabs')}
              data-testid="panel-tabs-overflow"
              className={cn(
                'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink-secondary',
                focusChrome,
              )}
            >
              <MoreHorizontal size={16} strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" data-testid="panel-tab-overflow-menu">
            {tabs.map((tab) => {
              const selected = current === tab.value
              return (
                <DropdownMenuItem
                  key={tab.value}
                  onSelect={() => onSelect(tab.value)}
                  data-testid={`panel-tab-overflow-${tab.value}`}
                >
                  <span className="flex w-4 shrink-0 items-center justify-center">
                    {selected ? <Check size={14} className="text-accent" /> : null}
                  </span>
                  {t(tab.labelKey)}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
