import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
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
import { sshWrite } from '@/ipc/ssh'
import { isTerminalSession } from '@/lib/sessions'
import { abortExecFlight } from '@/domain/terminalAgentBridge'
import { rulePatternFromCommand } from '@/domain/terminalRules'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { formatAbsolute, formatClockTime } from '@/lib/datetime'
import { formatTokensCompact } from '@/lib/formatTokens'
import { formatUsdMaybeIncomplete } from '@/lib/usageCost'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { ModelPicker } from '@/components/chat/ModelPicker'
import { EffortLevelPicker } from '@/components/chat/EffortLevelPicker'
import { PermissionModePicker } from '@/components/chat/PermissionModePicker'
import { PlanProgressPanel } from '@/components/chat/PlanProgressPanel'
import { shouldHideInterruptForPlanApproval } from '@/components/chat/planApproval'
import { selectLivePlan } from '@/lib/todos'
import {
  applyCommand,
  extractSlashQuery,
  SlashCommandPalette,
} from '@/components/chat/SlashCommandPalette'
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

/** Parse `exitCode: N` from a formatted terminal_exec result (fence / wrapEc). */
export function execExitCodeFromOutput(output: string | undefined): number | null {
  if (!output) return null
  const m = /exitCode:\s*(\d+)/.exec(output)
  return m ? Number(m[1]) : null
}

function ExitChip({ code }: { code: number }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-caption font-medium',
        code === 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
      )}
      data-testid="terminal-tool-exit"
    >
      exit {code}
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
  const exitCode = isExec && tool.status === 'finished' ? execExitCodeFromOutput(tool.output) : null
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
        {isExec && tool.status === 'finished' && exitCode !== null ? (
          <ExitChip code={exitCode} />
        ) : null}
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

/** Session-scoped HITL approval card styled like the chat permission prompt
 *  (PermissionModal): same container/typography/button dialects, allow-first order. */
function orderPermissionOptions(
  options: Array<{ optionId: string; name: string; kind: string }>,
): Array<{ optionId: string; name: string; kind: string }> {
  const allow = options.filter((o) => !o.kind.startsWith('reject'))
  const reject = options.filter((o) => o.kind.startsWith('reject'))
  return [...allow, ...reject]
}

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
      className="flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent-subtle px-4 py-3 animate-view-enter"
      data-testid="terminal-permission-card"
    >
      <p className="flex items-center gap-1.5 text-body font-medium text-ink">
        <ShieldCheck size={15} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
        {t('terminals.agent.permissionTitle')}
      </p>
      <div className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface px-3 py-2 font-mono text-meta leading-relaxed text-ink-secondary">
        {tool.content ?? tool.title}
      </div>
      <p className="text-meta text-ink-tertiary">{t('terminals.agent.execHint')}</p>
      <div className="flex flex-wrap gap-2">
        {orderPermissionOptions(options).map((opt) => (
          <Button
            key={opt.optionId}
            size="sm"
            variant={opt.kind.startsWith('allow') ? 'primary' : 'outline'}
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

/**
 * Permission mode picker — chat composer parity: the shared
 * `PermissionModePicker` bound to the terminal session. The new-chat default
 * (`pickedMode`) is fed through `onSelect`; the plan-approval gate through
 * `disabled`.
 */
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

/** Compact card composer mirroring the chat Composer (`variant="card"`).
 *  Terminal ops assistant only runs the built-in hip agent — the left slot carries
 *  the shared session-bound composer controls (model / thinking intensity /
 *  permission mode), each bound to the terminal session via `sessionId`.
 *  The card's danger border follows the store `permissionMode` (sidecar echo). */
function CompactComposer({
  sessionId,
  disabled,
  running,
  onStop,
  permissionMode,
  onSelectPermissionMode,
  flightActive,
  onQueueMessage,
}: {
  sessionId: string
  disabled: boolean
  running: boolean
  onStop: () => void
  permissionMode: 'chat' | 'edit' | 'full'
  onSelectPermissionMode: (m: 'chat' | 'edit' | 'full') => void
  /** Exec flight in progress: sends are queued instead of delivered (T3). */
  flightActive: boolean
  onQueueMessage: (text: string) => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const meter = useSessionTokenMeterFor(sessionId)
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
    if (flightActive) {
      // Exec flight holds the terminal — queue the prompt, deliver on flight end (T3).
      onQueueMessage(value)
      setText('')
      return
    }
    sessionService.sendTerminalContext(sessionId)
    sessionService.sendMessageToSession(sessionId, value)
    setText('')
  }
  const slashQuery = extractSlashQuery(text)
  return (
    <div className="shrink-0 px-3 pb-3 pt-1.5" data-testid="terminal-composer">
      <div
        className={cn(
          'relative rounded-lg border bg-surface-subtle p-2.5',
          // Full access — red border, chat composer parity: gradient flow while a
          // turn runs, glow pulse when idle/stopped.
          permissionMode === 'full'
            ? running
              ? 'composer-danger-flow'
              : 'composer-danger-glow border-danger-soft'
            : 'border-border',
        )}
        data-testid="terminal-composer-card"
      >
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
            // IME: Enter confirms composition (pinyin etc.) — must not send (chat composer parity).
            if (e.nativeEvent.isComposing || e.key === 'Process') return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={2}
          placeholder={t('terminals.agent.placeholder')}
          disabled={disabled}
          className="w-full resize-none rounded-none border-0 bg-transparent px-2 py-1 text-body text-ink placeholder:text-ink-tertiary transition-[border-color,box-shadow,background-color] duration-chrome ease-out focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="terminal-composer-input"
        />
        <div className="flex items-center justify-between px-0.5 pt-1.5">
          <div className="flex min-w-0 items-center gap-0.5">
            <ModelPicker sessionId={sessionId} />
            <EffortLevelPicker sessionId={sessionId} />
            <PermissionModePicker
              sessionId={sessionId}
              disabled={disabled}
              onSelect={onSelectPermissionMode}
            />
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
  const pendingConfirm = useTerminalAgentStore((s) => s.pendingConfirmByTerminal[terminalId])
  /** Messages queued while an exec flight held the terminal (T3, Warp-style). */
  const [queuedMsgs, setQueuedMsgs] = useState<{ content: string; at: number }[]>([])
  const host = useTerminalHostStore((s) =>
    term?.hostId ? s.hosts.find((h) => h.id === term.hostId) : undefined,
  )
  const [pickedMode, setPickedMode] = useState<'chat' | 'edit' | 'full'>('edit')
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const active =
    useDomainStore((s) =>
      activeSessionId ? s.sessions.find((x) => x.id === activeSessionId) : undefined,
    ) ?? sessionsForTerminal[0]

  // Sticky plan/todo panel above the composer (chat ComposerPlanPanel parity):
  // live plan while drafting/executing, approval CTA while awaiting approval.
  const livePlan = useMemo(
    () =>
      active
        ? selectLivePlan({
            messages: active.messages,
            status: active.status,
            forcePlan: Boolean(active.config.forcePlan),
            planApprovalPending: active.planApprovalPending,
            activeTurnPlan: active.activeTurnPlan,
            activeTurnPlanMarkdown: active.activeTurnPlanMarkdown,
            activeTurnPlanPath: active.activeTurnPlanPath,
            activeTurnPlanMarkdownTruncated: active.activeTurnPlanMarkdownTruncated,
          })
        : null,
    [active],
  )

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

  // Deliver queued prompts as soon as the exec flight ends (T3).
  const queuedCount = queuedMsgs.length
  useEffect(() => {
    if (flight || !active || queuedCount === 0) return
    const batch = queuedMsgs
    setQueuedMsgs([])
    for (const m of batch) {
      sessionService.sendTerminalContext(active.id)
      sessionService.sendMessageToSession(active.id, m.content)
    }
  }, [flight, queuedCount, active])

  // Confirm card (T4): sticky decisions write a hip.toml `[terminal]` rule.
  const settleUiConfirm = (
    confirm: NonNullable<typeof pendingConfirm>,
    decision: { ok: boolean; sticky?: 'allow' | 'deny' },
  ) => {
    if (decision.sticky) {
      const pattern = rulePatternFromCommand(confirm.title)
      const section = decision.sticky === 'allow' ? 'approveRules' : 'denyRules'
      void useHipConfigStore
        .getState()
        .updateSection('terminal', (prev) => ({
          ...prev,
          [section]: [...(prev?.[section] ?? []), pattern],
        }))
    }
    useTerminalAgentStore.getState().settleConfirm(terminalId, decision)
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setAtBottom(nearBottom)
  }

  const startChat = () => {
    if (!term) return
    void startTerminalAgentChat(terminalId, { permissionMode: pickedMode })
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
              {/* Pending HITL question — chat interrupt card parity (plan approval owns the CTA). */}
              {active.interrupt &&
              !shouldHideInterruptForPlanApproval(active.planApprovalPending, active.interrupt) ? (
                <div
                  className="border border-accent/30 bg-accent-subtle px-3 py-2.5 text-body text-ink"
                  data-testid="terminal-interrupt"
                >
                  <p className="flex items-start gap-2">
                    <span aria-hidden>⏸</span>
                    <span>{active.interrupt.question}</span>
                  </p>
                  <p className="mt-1 text-meta text-ink-secondary">{t('chat.interruptHint')}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      data-testid="terminal-interrupt-continue"
                      onClick={() =>
                        sessionService.sendMessageToSession(
                          active.id,
                          t('chat.interruptContinueMessage'),
                        )
                      }
                    >
                      {t('chat.interruptContinue')}
                    </Button>
                  </div>
                </div>
              ) : null}
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

          {livePlan ? (
            <div className="shrink-0 px-3 pb-2" data-testid="terminal-plan-slot">
              <PlanProgressPanel
                view={livePlan}
                onApprove={() => sessionService.respondPlanFor(active.id, 'approve')}
                onReject={() => sessionService.respondPlanFor(active.id, 'reject')}
                onAmend={(content) => sessionService.respondPlanFor(active.id, 'amend', content)}
              />
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
              <span className="shrink-0">
                {flight.phase === 'handed_off'
                  ? t('terminals.agent.handedOff')
                  : `${t('terminals.agent.running')}…`}
              </span>
            </div>
          ) : null}

          {flight?.phase === 'handed_off' ? (
            <div
              className="flex shrink-0 items-center gap-2 border border-warning/30 bg-warning/5 px-3 py-2 text-meta"
              data-testid="terminal-handoff-banner"
            >
              <TriangleAlert size={13} className="shrink-0 text-warning" aria-hidden />
              <span className="min-w-0 flex-1 text-ink-secondary">
                {t('terminals.agent.handoffBanner')}
              </span>
              <button
                type="button"
                className="shrink-0 rounded-md bg-warning/15 px-2 py-1 text-caption font-medium text-warning transition-colors hover:bg-warning/25"
                data-testid="terminal-handoff-resume"
                onClick={() => useTerminalAgentStore.getState().resumeExecFlight(terminalId)}
              >
                {t('terminals.agent.handoffCta')}
              </button>
            </div>
          ) : null}

          {queuedCount > 0 ? (
            <div
              className="flex shrink-0 items-center gap-2 px-3 text-meta text-warning"
              data-testid="terminal-queued-msgs"
            >
              <span className="shrink-0">⏳</span>
              <span className="min-w-0 flex-1">
                {t('terminals.agent.queuedMsgs', { count: queuedCount })}
              </span>
            </div>
          ) : null}

          {pendingConfirm ? (
            <div
              className="mx-3 mb-1 shrink-0 overflow-hidden rounded-lg border border-danger-soft bg-surface-subtle"
              data-testid="terminal-confirm-card"
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className="rounded bg-danger/10 px-1.5 py-0.5 text-caption font-bold text-danger">
                  {pendingConfirm.kind === 'danger' ? t('terminals.agent.confirmHighRisk') : t('terminals.agent.confirmOverwrite')}
                </span>
                <span className="min-w-0 flex-1 truncate text-caption font-semibold text-ink">
                  {pendingConfirm.kind === 'danger'
                    ? t('terminals.agent.confirmTitle')
                    : t('terminals.agent.confirmOverwriteTitle')}
                </span>
              </div>
              <div className="px-3 py-2">
                <p className="rounded-md bg-ink/5 px-2.5 py-1.5 font-mono text-caption leading-relaxed text-ink break-all">
                  {pendingConfirm.title}
                </p>
                {pendingConfirm.detail ? (
                  <p className="mt-1.5 text-meta leading-relaxed text-ink-tertiary">
                    {pendingConfirm.detail}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-1.5 px-3 pb-2.5">
                <button
                  type="button"
                  className="flex-1 rounded-md bg-surface-muted px-2 py-1.5 text-caption font-medium text-ink-secondary transition-colors hover:bg-state-hover"
                  data-testid="terminal-confirm-once"
                  onClick={() => settleUiConfirm(pendingConfirm, { ok: true })}
                >
                  {t('terminals.agent.confirmOnce')}
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-md bg-success/10 px-2 py-1.5 text-caption font-medium text-success transition-colors hover:bg-success/20"
                  data-testid="terminal-confirm-always"
                  onClick={() => settleUiConfirm(pendingConfirm, { ok: true, sticky: 'allow' })}
                >
                  {t('terminals.agent.confirmAlwaysAllow')}
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-md bg-danger/10 px-2 py-1.5 text-caption font-medium text-danger transition-colors hover:bg-danger/20"
                  data-testid="terminal-confirm-never"
                  onClick={() => settleUiConfirm(pendingConfirm, { ok: false, sticky: 'deny' })}
                >
                  {t('terminals.agent.confirmAlwaysDeny')}
                </button>
              </div>
            </div>
          ) : null}

          <CompactComposer
            sessionId={active.id}
            disabled={Boolean(active.planApprovalPending)}
            running={turnRunning}
            flightActive={!!flight}
            onQueueMessage={(text) => setQueuedMsgs((q) => [...q, { content: text, at: Date.now() }])}
            onStop={() => {
              // 打断输出：若有 exec flight，先结束桥接等待并向共享 PTY 发送 Ctrl-C；
              // 任何 running 状态都取消本轮 LLM turn（与主对话 Stop 对齐）。
              if (flight) {
                abortExecFlight(terminalId)
                void sshWrite(terminalId, '\x03').catch(() => {})
              }
              sessionService.cancelSessionTurn(active.id)
            }}
            permissionMode={active.config.permissionMode ?? 'edit'}
            onSelectPermissionMode={(m) => {
              // The shared picker already calls sessionService.setPermissionMode
              // for the bound session — here we only keep the new-chat default.
              setPickedMode(m)
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
