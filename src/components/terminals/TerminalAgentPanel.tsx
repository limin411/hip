import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  TerminalSquare,
  TriangleAlert,
} from 'lucide-react'
import { sessionService } from '@/domain'
import { useDomainStore } from '@/domain/sessionStore'
import { useManagedTerminalStore, type ManagedTerminalStatus } from '@/store/managedTerminalStore'
import { useTerminalAgentStore, terminalSessionsFor } from '@/store/terminalAgentStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { useAgents } from '@/store/hipConfigStore'
import { sshWrite } from '@/ipc/ssh'
import { isTerminalSession } from '@/lib/sessions'
import { formatAbsolute, formatClockTime } from '@/lib/datetime'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { Button } from '@/components/ui/Button'
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
          <MarkdownBody content={message.content} />
        )}
        {message.toolCalls && message.toolCalls.length > 0 ? (
          <div className="mt-2 space-y-1.5">
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

function ModeChip({
  icon,
  value,
  onChange,
  options,
  label,
  testid,
}: {
  icon: ReactNode
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  label: string
  testid: string
}) {
  return (
    <label
      className="flex h-6 max-w-[10rem] cursor-pointer items-center gap-1 rounded-md bg-surface-muted px-1.5 text-meta text-ink-secondary transition-colors hover:bg-state-hover"
      title={label}
    >
      <span className="shrink-0 text-ink-tertiary" aria-hidden>
        {icon}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 cursor-pointer appearance-none border-0 bg-transparent text-meta font-medium text-ink-secondary outline-none"
        data-testid={testid}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Compact card composer mirroring the chat Composer (`variant="card"`). */
function CompactComposer({
  sessionId,
  disabled,
  agents,
  selectedAgentId,
  onSelectAgent,
  permissionMode,
  onSelectPermissionMode,
}: {
  sessionId: string
  disabled: boolean
  agents: Array<{ id: string; name: string }>
  selectedAgentId: string
  onSelectAgent: (id: string) => void
  permissionMode: 'chat' | 'edit' | 'full'
  onSelectPermissionMode: (m: 'chat' | 'edit' | 'full') => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const send = () => {
    const value = text.trim()
    if (!value || disabled) return
    sessionService.sendTerminalContext(sessionId)
    sessionService.sendMessageToSession(sessionId, value)
    setText('')
  }
  return (
    <div className="shrink-0 px-3 pb-3 pt-1.5" data-testid="terminal-composer">
      <div className="rounded-lg border border-border bg-surface-subtle p-2.5 transition-colors duration-chrome focus-within:border-accent/40">
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
            <ModeChip
              icon={<Bot size={11} strokeWidth={1.75} />}
              value={selectedAgentId}
              onChange={(v) => onSelectAgent(v)}
              options={[
                { value: 'builtin', label: t('terminals.agent.emptyTitle') },
                ...agents.map((a) => ({ value: a.id, label: a.name })),
              ]}
              label={t('terminals.agent.emptyTitle')}
              testid="terminal-agent-picker"
            />
            <ModeChip
              icon={<KeyRound size={11} strokeWidth={1.75} />}
              value={permissionMode}
              onChange={(v) => onSelectPermissionMode(v as 'chat' | 'edit' | 'full')}
              options={[
                { value: 'chat', label: 'chat' },
                { value: 'edit', label: 'edit' },
                { value: 'full', label: 'full' },
              ]}
              label="permission mode"
              testid="terminal-permission-mode"
            />
          </div>
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
  const agents = useAgents().filter((a) => a.enabled)
  const [pickedAgent, setPickedAgent] = useState('builtin')
  const [pickedMode, setPickedMode] = useState<'chat' | 'edit' | 'full'>('edit')
  const bottomRef = useRef<HTMLDivElement>(null)

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

  // Follow the transcript like ChatPane (new messages / session switch).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [active?.id, active?.messages.length])

  const startChat = () => {
    if (!term) return
    void startTerminalAgentChat(terminalId, { agentId: pickedAgent, permissionMode: pickedMode })
  }

  const connected = term?.kind === 'ssh' && term.status === 'connected'
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
          <div
            className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4"
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
