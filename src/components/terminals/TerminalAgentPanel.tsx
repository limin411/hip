import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Square,
  TerminalSquare,
  TriangleAlert,
} from 'lucide-react'
import { sessionService } from '@/domain'
import { useSessionTokenMeterFor, type SessionTokenMeter } from '@/domain'
import { useDomainStore } from '@/domain/sessionStore'
import { useManagedTerminalStore, type ManagedTerminalStatus } from '@/store/managedTerminalStore'
import { useTerminalAgentStore, terminalSessionsFor } from '@/store/terminalAgentStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { useAgents } from '@/store/hipConfigStore'
import { useDetectionStore } from '@/store/detectionStore'
import { isSelectableAcpAgent } from '@/lib/sessionAgent'
import { sshWrite } from '@/ipc/ssh'
import { isTerminalSession } from '@/lib/sessions'
import { abortExecFlight } from '@/domain/terminalAgentBridge'
import { formatAbsolute, formatClockTime } from '@/lib/datetime'
import { formatTokensCompact } from '@/lib/formatTokens'
import { formatUsdMaybeIncomplete } from '@/lib/usageCost'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { ComposerChip } from '@/components/chat/ComposerChip'
import {
  applyCommand,
  extractSlashQuery,
  SlashCommandPalette,
} from '@/components/chat/SlashCommandPalette'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { Button } from '@/components/ui/Button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/Popover'
import { cn } from '@/lib/utils'
import type { Message, ToolCall } from '@hip/protocol'
import { startTerminalAgentChat } from './terminalAgentSession'

const STATUS_DOT: Record<ManagedTerminalStatus, string> = {
  connecting: 'bg-warning animate-pulse',
  connected: 'bg-success',
  disconnected: 'bg-ink-tertiary/40',
  error: 'bg-danger',
}

function MetaLine({ role, timestamp }: { role: string; timestamp?: number }) {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  return (
    <div className="mb-1.5 flex min-h-4 items-center gap-2 text-meta leading-4 text-ink-tertiary">
      <span className="font-medium text-ink-secondary">{role}</span>
      {timestamp ? (
        <span
          className="font-normal tabular-nums"
          title={formatAbsolute(timestamp, locale)}
        >
          {formatClockTime(timestamp, locale)}
        </span>
      ) : null}
    </div>
  )
}

function ToolStatusChip({ tool, timedOut, t }: { tool: ToolCall; timedOut: boolean; t: TFunction }) {
  const running = tool.status === 'running'
  const error = tool.status === 'error'
  const label = error
    ? t('terminals.agent.execError')
    : running
      ? t('terminals.agent.running')
      : timedOut
        ? t('terminals.agent.execTimedOut')
        : 'completed'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-caption font-medium',
        error
          ? 'bg-danger/10 text-danger'
          : running
            ? 'bg-accent/10 text-accent'
            : timedOut
              ? 'bg-warning/10 text-warning'
              : 'bg-surface-muted text-ink-tertiary',
      )}
      data-testid="terminal-tool-status"
    >
      {running ? <Loader2 size={10} className="animate-spin" aria-hidden /> : null}
      {label}
    </span>
  )
}

function ToolCard({
  tool,
  t,
  terminalId,
  sessionId,
}: {
  tool: ToolCall
  t: TFunction
  terminalId: string
  sessionId: string
}) {
  const [expanded, setExpanded] = useState(false)
  let inputText = ''
  try {
    inputText = typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)
  } catch {
    inputText = String(tool.input ?? '')
  }
  const isExec = tool.name === 'terminal_exec'
  const timedOut = isExec && /status: timed_out/.test(tool.output ?? '')
  let parsedInput: unknown = null
  try {
    parsedInput = JSON.parse(inputText)
  } catch {
    parsedInput = null
  }
  const command = isExec
    ? parsedInput &&
      typeof parsedInput === 'object' &&
      'command' in parsedInput &&
      typeof (parsedInput as { command?: unknown }).command === 'string'
      ? ((parsedInput as { command: string }).command as string).slice(0, 200)
      : (inputText.split('\n')[0]?.slice(0, 200) ?? inputText)
    : inputText
  const title = isExec ? t('terminals.agent.execTitle') : tool.name
  // 终端执行卡片默认折叠（只占一行）；其他工具卡保持展开。
  const showBody = !isExec || expanded

  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-surface-subtle/70"
      data-testid="terminal-tool-card"
      data-tool={tool.name}
      data-status={tool.status}
      data-expanded={showBody ? 'true' : 'false'}
    >
      {/* Header: icon + title + status (ActivityBar-like compact row). Click to expand. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={showBody}
        aria-label={title}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-state-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
        data-testid="terminal-tool-header"
      >
        {isExec ? (
          <span className="shrink-0 text-ink-tertiary" aria-hidden>
            {showBody ? (
              <ChevronDown size={12} strokeWidth={1.75} />
            ) : (
              <ChevronRight size={12} strokeWidth={1.75} />
            )}
          </span>
        ) : null}
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
            tool.status === 'error'
              ? 'bg-danger/10 text-danger'
              : tool.status === 'running'
                ? 'bg-accent/10 text-accent'
                : 'bg-surface-muted text-ink-tertiary',
          )}
          aria-hidden
        >
          <TerminalSquare size={12} strokeWidth={1.75} />
        </span>
        {isExec && !showBody ? (
          <span
            className="min-w-0 flex-1 truncate font-mono text-caption font-medium text-ink"
            title={inputText}
          >
            {command}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-caption font-medium text-ink">
            {title}
          </span>
        )}
        <ToolStatusChip tool={tool} timedOut={timedOut} t={t} />
      </button>

      {showBody && isExec && command ? (
        <div className="border-t border-border/60 px-2.5 py-1.5">
          <p
            className="truncate font-mono text-caption text-ink-secondary"
            title={inputText}
          >
            {command}
          </p>
        </div>
      ) : null}

      {showBody && tool.output ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words border-t border-border/60 bg-surface-muted/40 px-2.5 py-2 font-mono text-caption leading-relaxed text-ink-secondary">
          {tool.output.slice(0, 2000)}
          {tool.output.length > 2000 ? '\n…' : ''}
        </pre>
      ) : null}

      {showBody && tool.error ? (
        <p className="border-t border-border/60 px-2.5 py-1.5 text-caption text-danger">
          {tool.error}
        </p>
      ) : null}

      {showBody && timedOut ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-warning/5 px-2.5 py-1.5">
          <TriangleAlert size={12} className="shrink-0 text-warning" aria-hidden />
          <span className="text-caption text-warning">{t('terminals.agent.execTimedOut')}</span>
          <button
            type="button"
            onClick={() => void sshWrite(terminalId, '\x03')}
            className="ml-auto rounded-sm border border-border bg-surface px-1.5 py-0.5 text-caption text-ink-secondary transition-colors hover:bg-state-hover"
            data-testid="terminal-tool-send-ctrl-c"
          >
            {t('terminals.agent.sendCtrlC')}
          </button>
          <button
            type="button"
            onClick={() =>
              sessionService.sendMessageToSession(
                sessionId,
                t('terminals.agent.continueWatchingPrompt'),
              )
            }
            className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-caption text-ink-secondary transition-colors hover:bg-state-hover"
            data-testid="terminal-tool-continue-watching"
          >
            {t('terminals.agent.continueWatching')}
          </button>
          <button
            type="button"
            onClick={() =>
              sessionService.sendMessageToSession(sessionId, t('terminals.agent.askUserPrompt'))
            }
            className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-caption text-ink-secondary transition-colors hover:bg-state-hover"
            data-testid="terminal-tool-ask-user"
          >
            {t('terminals.agent.askUser')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function MessageRow({
  message,
  t,
  terminalId,
  sessionId,
}: {
  message: Message
  t: TFunction
  terminalId: string
  sessionId: string
}) {
  const { t: translate } = useTranslation()
  const isUser = message.role === 'user'
  const isNotice = message.role === 'notice'

  if (isNotice) {
    return (
      <div
        className="my-1 w-fit bg-surface-muted px-2 py-0.5 text-meta text-ink-tertiary"
        data-testid="terminal-notice"
      >
        {message.content}
      </div>
    )
  }

  return (
    <div className="min-w-0 w-full" data-testid={`terminal-msg-${message.role}`}>
      <MetaLine
        role={isUser ? translate('chat.you') : 'hip'}
        timestamp={message.timestamp || undefined}
      />
      <div className="min-w-0">
        {isUser ? (
          <div
            className="w-fit max-w-full rounded-lg bg-surface-muted px-3.5 py-2"
            data-testid="terminal-user-bubble"
          >
            <MarkdownBody content={message.content} />
          </div>
        ) : (
          <>
            {/* Process first: tool execution happened before the final answer
                (same order as the main Chat process trail → answer). */}
            {message.toolCalls && message.toolCalls.length > 0 ? (
              <div className="mb-2 space-y-1.5">
                {message.toolCalls.map((tc) => (
                  <ToolCard
                    key={tc.callId}
                    tool={tc}
                    t={t}
                    terminalId={terminalId}
                    sessionId={sessionId}
                  />
                ))}
              </div>
            ) : null}
            <MarkdownBody content={message.content} />
          </>
        )}
      </div>
    </div>
  )
}

/** Session-scoped HITL approval card styled like the chat interrupt card. */
function PermissionCard({
  sessionId,
  requestId,
  tool,
  options,
  t,
}: {
  sessionId: string
  requestId: string
  tool: { title: string; kind: string; content?: string; meta?: Record<string, unknown> }
  options: Array<{ optionId: string; name: string; kind: string }>
  t: TFunction
}) {
  return (
    <div
      className="rounded-lg border border-accent/30 bg-accent-subtle px-3 py-2.5"
      data-testid="terminal-permission-card"
    >
      <p className="flex items-center gap-1.5 text-caption font-medium text-ink">
        <ShieldCheck size={13} className="shrink-0 text-accent" aria-hidden />
        {t('terminals.agent.permissionTitle')}
      </p>
      <div className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface/80 px-2 py-1.5 font-mono text-caption leading-relaxed text-ink-secondary">
        {tool.content ?? tool.title}
      </div>
      <p className="mt-1 text-meta text-ink-tertiary">{t('terminals.agent.execHint')}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <Button
            key={opt.optionId}
            size="sm"
            variant={opt.kind.startsWith('allow') ? 'primary' : 'ghost'}
            onClick={() => {
              sessionService.respondPermission(sessionId, requestId, { optionId: opt.optionId })
              useDomainStore.getState().clearPermission(requestId)
            }}
            data-testid={`terminal-permission-${opt.optionId}`}
          >
            {opt.name}
          </Button>
        ))}
      </div>
    </div>
  )
}

function DropdownChip({
  icon,
  label,
  active,
  disabled,
  title,
  testid,
  menuTestid,
  children,
}: {
  icon: ReactNode
  label: string
  active: boolean
  disabled?: boolean
  title: string
  testid: string
  menuTestid: string
  children: ReactNode
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip
          active={active}
          disabled={disabled}
          data-testid={testid}
          title={title}
          aria-label={title}
        >
          <span className="shrink-0" aria-hidden>
            {icon}
          </span>
          <span className="max-w-[7rem] truncate">{label}</span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="min-w-[10rem]"
        data-testid={menuTestid}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DropdownCheckItem({
  selected,
  testid,
  onSelect,
  children,
}: {
  selected: boolean
  testid: string
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      data-testid={testid}
      data-selected={selected ? 'true' : 'false'}
      className="gap-2 py-1"
    >
      <Check
        size={13}
        strokeWidth={1.75}
        className={cn('shrink-0', selected ? 'opacity-100' : 'opacity-0')}
        aria-hidden
      />
      <span className={cn('min-w-0 flex-1 truncate text-meta', selected && 'font-medium')}>
        {children}
      </span>
    </DropdownMenuItem>
  )
}

const USAGE_ZONE_CLASS: Record<string, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

/** Session-scoped token / cost chip next to send (Chat composer parity). */
function SessionUsageChip({ meter, t }: { meter: SessionTokenMeter; t: TFunction }) {
  const [open, setOpen] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimers = () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }
  const scheduleOpen = () => {
    clearTimers()
    openTimer.current = setTimeout(() => setOpen(true), 180)
  }
  const scheduleClose = () => {
    clearTimers()
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }
  const primary =
    meter.percent !== null
      ? t('chat.usage.percentage', { percent: meter.percent })
      : formatTokensCompact(meter.contextTokens)
  const zoneClass = meter.zone ? USAGE_ZONE_CLASS[meter.zone] : 'text-ink-tertiary'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          data-testid="terminal-session-usage"
          data-zone={meter.zone ?? undefined}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          onFocus={scheduleOpen}
          onBlur={scheduleClose}
          tabIndex={0}
          className={cn(
            'hidden shrink-0 cursor-default select-none rounded-full bg-surface-muted px-1.5 py-0.5 text-caption tabular-nums sm:inline-block',
            zoneClass,
          )}
        >
          {primary}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-[min(240px,calc(100vw-2rem))] p-3"
        data-testid="terminal-session-usage-popover"
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-caption font-medium text-ink">{t('chat.usage.contextTitle')}</span>
            <span className="text-meta text-ink-tertiary">
              {t('chat.usage.percentage', { percent: meter.percent ?? 0 })}
            </span>
          </div>
          {meter.contextWindow ? (
            <p className="text-meta text-ink-tertiary">
              {t('chat.usage.percentageTooltip', {
                used: meter.contextTokens.toLocaleString(),
                total: meter.contextWindow.toLocaleString(),
                percent: meter.percent ?? 0,
              })}
            </p>
          ) : null}
          <div className="space-y-1 border-t border-border pt-2 text-meta text-ink-secondary">
            <div className="flex justify-between gap-3">
              <span>
                {t('chat.usage.io', {
                  input: meter.cumulative.inputTokens,
                  output: meter.cumulative.outputTokens,
                })}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>{t('chat.usage.sessionTotal')}</span>
              <span className="tabular-nums">{meter.cumulative.totalTokens.toLocaleString()}</span>
            </div>
            {meter.cacheHitRate != null ? (
              <div className="flex justify-between gap-3" data-testid="terminal-session-usage-cache-hit">
                <span>{t('chat.usage.cacheHitLabel')}</span>
                <span className="tabular-nums">
                  {t('chat.usage.cacheHitRate', {
                    percent: Math.round(meter.cacheHitRate * 100),
                  })}
                </span>
              </div>
            ) : null}
            {meter.costUsd != null ? (
              <div className="flex justify-between gap-3">
                <span>{t('chat.usage.costLabel')}</span>
                <span
                  className="tabular-nums"
                  data-testid="terminal-session-usage-cost"
                  title={meter.costIncomplete ? t('chat.usage.costIncompleteHint') : undefined}
                >
                  {formatUsdMaybeIncomplete(meter.costUsd, meter.costIncomplete)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Compact card composer mirroring the chat Composer (`variant="card"`). */
function CompactComposer({
  sessionId,
  disabled,
  running,
  onStop,
  agents,
  selectedAgentId,
  onSelectAgent,
  permissionMode,
  onSelectPermissionMode,
}: {
  sessionId: string
  disabled: boolean
  running: boolean
  onStop: () => void
  agents: Array<{ id: string; name: string }>
  selectedAgentId: string
  onSelectAgent: (id: string) => void
  permissionMode: 'chat' | 'edit' | 'full'
  onSelectPermissionMode: (m: 'chat' | 'edit' | 'full') => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const meter = useSessionTokenMeterFor(sessionId)
  // Optimistic local selection: apply immediately, reconcile when the sidecar
  // echoes the config change (session:agentChanged / session:permissionMode).
  const [agent, setAgent] = useState(selectedAgentId)
  const [mode, setMode] = useState(permissionMode)
  useEffect(() => setAgent(selectedAgentId), [selectedAgentId])
  useEffect(() => setMode(permissionMode), [permissionMode])
  const runCompact = (focus?: string) => {
    sessionService.compactSession(sessionId, focus)
    setText('')
  }
  const send = () => {
    const value = text.trim()
    if (!value || disabled) return
    // /compact — summarize the conversation locally (never sent as a prompt).
    const compactMatch = value.match(/^\/compact(?:\s+(.*))?$/)
    if (compactMatch) {
      runCompact(compactMatch[1]?.trim() || undefined)
      return
    }
    sessionService.sendTerminalContext(sessionId)
    sessionService.sendMessageToSession(sessionId, value)
    setText('')
  }
  const slashQuery = extractSlashQuery(text)
  return (
    <div className="shrink-0 px-3 pb-3 pt-1.5" data-testid="terminal-composer">
      <div className="relative rounded-lg border border-border bg-surface-subtle p-2.5 transition-colors duration-chrome focus-within:border-accent/40">
        {slashQuery !== null ? (
          <SlashCommandPalette
            value={text}
            surface="terminal"
            sessionId={sessionId}
            onSelect={(cmd) => {
              // 终端面只提供 /compact：选中后填入命令文本，回车再执行（与对话一致）。
              if (cmd.id === 'compact') {
                setText(applyCommand(cmd, text))
              }
            }}
            onComplete={(cmd) => {
              if (cmd.id === 'compact') {
                setText(applyCommand(cmd, text))
              }
            }}
            onDismiss={() => {}}
            enterFallsThroughOnEmpty
          />
        ) : null}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={2}
          placeholder={t('terminals.agent.placeholder')}
          disabled={disabled}
          className="min-h-10 w-full resize-none border-0 bg-transparent px-0.5 py-1 text-body leading-relaxed text-ink outline-none placeholder:text-ink-tertiary disabled:opacity-50"
          data-testid="terminal-composer-input"
        />
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-border/60 pt-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <DropdownChip
              icon={<Bot size={13} strokeWidth={1.75} />}
              label={
                agent === 'builtin'
                  ? t('terminals.agent.emptyTitle')
                  : (agents.find((a) => a.id === agent)?.name ?? agent)
              }
              active={agent !== 'builtin'}
              disabled={disabled}
              title={t('terminals.agent.emptyTitle')}
              testid="terminal-agent-picker"
              menuTestid="terminal-agent-picker-menu"
            >
              <DropdownCheckItem
                selected={agent === 'builtin'}
                testid="terminal-agent-option-builtin"
                onSelect={() => {
                  setAgent('builtin')
                  onSelectAgent('builtin')
                }}
              >
                {t('terminals.agent.emptyTitle')}
              </DropdownCheckItem>
              {agents.map((a) => (
                <DropdownCheckItem
                  key={a.id}
                  selected={agent === a.id}
                  testid={`terminal-agent-option-${a.id}`}
                  onSelect={() => {
                    setAgent(a.id)
                    onSelectAgent(a.id)
                  }}
                >
                  {a.name}
                </DropdownCheckItem>
              ))}
            </DropdownChip>
            <DropdownChip
              icon={<KeyRound size={13} strokeWidth={1.75} />}
              label={mode}
              active={mode !== 'edit'}
              disabled={disabled}
              title="permission mode"
              testid="terminal-permission-mode"
              menuTestid="terminal-permission-mode-menu"
            >
              {(['chat', 'edit', 'full'] as const).map((m) => (
                <DropdownCheckItem
                  key={m}
                  selected={mode === m}
                  testid={`terminal-permission-option-${m}`}
                  onSelect={() => {
                    setMode(m)
                    onSelectPermissionMode(m)
                  }}
                >
                  {m}
                </DropdownCheckItem>
              ))}
            </DropdownChip>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {meter ? <SessionUsageChip meter={meter} t={t} /> : null}
            {running ? (
              <Button
                type="button"
                variant="primary"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-sm"
                onClick={onStop}
                data-testid="terminal-composer-stop"
                title={t('chat.stop')}
              >
                <Square size={12} strokeWidth={1.75} />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-sm"
                onClick={send}
                disabled={disabled || !text.trim()}
                data-testid="terminal-composer-send"
                title={t('terminals.agent.send')}
              >
                <ArrowUp size={15} strokeWidth={1.75} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Terminal Ops agent panel (spec §3.4) — visual language aligned with the main
 * Chat surface (CLI-style meta rows, soft user bubbles, card composer).
 */
export function TerminalAgentPanel({ terminalId }: { terminalId: string }) {
  const { t } = useTranslation()
  const term = useManagedTerminalStore((s) => s.terminals.find((x) => x.id === terminalId))
  const allSessions = useDomainStore((s) => s.sessions)
  const sessionsForTerminal = useMemo(
    () => terminalSessionsFor(allSessions, terminalId),
    [allSessions, terminalId],
  )
  const activeSessionId = useTerminalAgentStore((s) => s.activeSessionByTerminal[terminalId])
  const flight = useTerminalAgentStore((s) => s.execFlightByTerminal[terminalId])
  const host = useTerminalHostStore((s) =>
    term?.hostId ? s.hosts.find((h) => h.id === term.hostId) : undefined,
  )
  const installed = useDetectionStore((s) => s.installed)
  const detectionChecked = useDetectionStore((s) => s.checked)
  const refreshDetection = useDetectionStore((s) => s.refresh)
  const agents = useAgents().filter((a) => {
    if (!a.enabled) return false
    // Internal/custom stay selectable when enabled; preset ACP needs binaries on PATH.
    if (a.kind === 'acp' || a.kind === 'opencode') {
      return isSelectableAcpAgent(a, { installed, detectionChecked })
    }
    return true
  })
  const [pickedAgent, setPickedAgent] = useState('builtin')

  useEffect(() => {
    void refreshDetection()
  }, [refreshDetection])
  const [pickedMode, setPickedMode] = useState<'chat' | 'edit' | 'full'>('edit')
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const active =
    useDomainStore((s) =>
      activeSessionId ? s.sessions.find((x) => x.id === activeSessionId) : undefined,
    ) ?? sessionsForTerminal[0]

  const activeAgentKind = active?.config.agentId
    ? agents.find((a) => a.id === active.config.agentId)?.kind
    : undefined
  const acpLimited =
    activeAgentKind === 'acp' || activeAgentKind === 'opencode'

  useEffect(() => {
    if (active && !active.loaded) {
      sessionService.loadSessionMessages(active.id)
    }
  }, [active?.id, active?.loaded])

  // Reset the bottom-pin when switching sessions (ChatPane parity).
  useEffect(() => {
    setAtBottom(true)
  }, [active?.id])

  // Follow the transcript like ChatPane: only autoscroll while pinned to bottom.
  useEffect(() => {
    if (!atBottom) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [active?.id, active?.messages.length, atBottom])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setAtBottom(nearBottom)
  }

  const startChat = () => {
    if (!term) return
    void startTerminalAgentChat(terminalId, { agentId: pickedAgent, permissionMode: pickedMode })
  }

  const connected = term?.kind === 'ssh' && term.status === 'connected'
  const turnRunning = active?.status === 'running' || !!flight
  const statusText = connected
    ? host
      ? `${host.username}@${host.hostname}:${host.port}`
      : t('terminals.connected')
    : term?.status === 'disconnected' || term?.status === 'error'
      ? t('terminals.agent.ptyDead')
      : t('terminals.connecting')
  const statusDot = term?.kind === 'ssh' ? STATUS_DOT[term.status] : STATUS_DOT.disconnected

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-surface"
      data-testid="terminal-agent-panel"
    >
      {/* Status strip */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-subtle/70 px-3 py-1.5"
        data-testid="terminal-agent-status"
      >
        <span className="flex min-w-0 items-center gap-2 text-caption text-ink-secondary">
          <span
            className={cn('size-1.5 shrink-0 rounded-full', connected ? 'bg-success' : statusDot)}
            aria-hidden
          />
          <TerminalSquare size={12} className="shrink-0 text-ink-tertiary" aria-hidden />
          <span className="truncate font-mono">{statusText}</span>
          {connected ? (
            <span className="shrink-0 rounded-md bg-success/10 px-1.5 py-0.5 text-caption font-medium text-success">
              {t('terminals.connected')}
            </span>
          ) : null}
        </span>
        {sessionsForTerminal.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={startChat} data-testid="terminal-agent-new-chat">
            <Plus size={12} className="mr-0.5" />
            {t('terminals.agent.newChat')}
          </Button>
        ) : null}
      </div>

      {active && isTerminalSession(active.config) ? (
        <>
          {/* Message list (chat transcript rhythm: px-3 py-4, soft gaps). */}
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="h-full min-h-0 space-y-4 overflow-y-auto px-3 py-4"
              data-testid="terminal-message-list"
            >
              {active.messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <TerminalSquare size={22} strokeWidth={1.5} aria-hidden />
                  </span>
                  <div>
                    <p className="text-body font-semibold text-ink">{t('terminals.agent.emptyTitle')}</p>
                    <p className="mt-1 text-meta leading-relaxed text-ink-tertiary">
                      {t('terminals.agent.emptyBody')}
                    </p>
                  </div>
                </div>
              ) : (
                active.messages.map((m) => (
                  <MessageRow
                    key={m.id}
                    message={m}
                    t={t}
                    terminalId={terminalId}
                    sessionId={active.id}
                  />
                ))
              )}
              <div ref={bottomRef} data-testid="terminal-transcript-end" />
            </div>
            {!atBottom && active.messages.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setAtBottom(true)
                  bottomRef.current?.scrollIntoView({ block: 'end' })
                }}
                data-testid="jump-to-latest"
                title={t('chat.jumpToLatest')}
                className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-sm border border-border bg-surface px-3 py-1.5 text-meta text-ink-secondary shadow-menu animate-menu-in transition-[background-color,color] duration-chrome ease-out hover:bg-state-hover"
              >
                <ChevronDown size={14} strokeWidth={1.75} />
                {t('chat.jumpToLatest')}
              </button>
            ) : null}
          </div>

          {acpLimited ? (
            <div
              className="mx-3 mb-2 flex shrink-0 items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-caption text-ink-secondary"
              data-testid="terminal-acp-limited"
            >
              <TriangleAlert size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              {t('terminals.agent.acpLimited')}
            </div>
          ) : null}

          {active.pendingPermission ? (
            <div className="shrink-0 px-3 pb-2">
              <PermissionCard
                sessionId={active.id}
                requestId={active.pendingPermission.requestId}
                tool={active.pendingPermission.tool}
                options={active.pendingPermission.options}
                t={t}
              />
            </div>
          ) : null}

          {flight ? (
            <div
              className="flex shrink-0 items-center gap-2 border-t border-accent/20 bg-accent/5 px-3 py-1.5 text-meta text-ink-secondary"
              data-testid="terminal-exec-flight"
            >
              <Loader2 size={12} className="shrink-0 animate-spin text-accent" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-caption">{flight.command}</span>
              <span className="shrink-0">{t('terminals.agent.running')}…</span>
            </div>
          ) : null}

          <CompactComposer
            sessionId={active.id}
            disabled={!!flight}
            running={turnRunning}
            onStop={() => {
              // 打断输出：若有 exec flight，先结束桥接等待并向共享 PTY 发送 Ctrl-C；
              // 任何 running 状态都取消本轮 LLM turn（与主对话 Stop 对齐）。
              if (flight) {
                abortExecFlight(terminalId)
                void sshWrite(terminalId, '\x03').catch(() => {})
              }
              sessionService.cancelSessionTurn(active.id)
            }}
            agents={agents.map((a) => ({ id: a.id, name: a.name }))}
            selectedAgentId={active.config.agentId ?? 'builtin'}
            onSelectAgent={(id) => {
              setPickedAgent(id)
              sessionService.setAgent(active.id, id === 'builtin' ? '' : id)
            }}
            permissionMode={active.config.permissionMode ?? 'edit'}
            onSelectPermissionMode={(m) => {
              setPickedMode(m)
              sessionService.setPermissionMode(active.id, m)
            }}
          />
        </>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
          data-testid="terminal-agent-empty"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <TerminalSquare size={26} strokeWidth={1.5} aria-hidden />
          </span>
          <div>
            <p className="text-body font-semibold text-ink">{t('terminals.agent.emptyTitle')}</p>
            <p className="mt-1 text-meta leading-relaxed text-ink-tertiary">
              {connected ? t('terminals.agent.emptyBody') : t('terminals.agent.needSsh')}
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={startChat}
            disabled={!term}
            data-testid="terminal-agent-start"
          >
            {t('terminals.agent.start')}
          </Button>
        </div>
      )}
    </div>
  )
}
