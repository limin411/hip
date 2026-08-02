import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Loader2, Plus, Send, TerminalSquare, XCircle } from 'lucide-react'
import { sessionService } from '@/domain'
import { useDomainStore } from '@/domain/sessionStore'
import { useManagedTerminalStore } from '@/store/managedTerminalStore'
import { useTerminalAgentStore } from '@/store/terminalAgentStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { useAgents } from '@/store/hipConfigStore'
import { sshWrite } from '@/ipc/ssh'
import { terminalSessionsFor } from '@/store/terminalAgentStore'
import { isTerminalSession } from '@/lib/sessions'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { Message, ToolCall } from '@hip/protocol'
import { startTerminalAgentChat } from './terminalAgentSession'

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
  let inputText = ''
  try {
    inputText = typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)
  } catch {
    inputText = String(tool.input ?? '')
  }
  const isExec = tool.name === 'terminal_exec'
  const timedOut = isExec && /status: timed_out/.test(tool.output ?? '')
  const statusLabel =
    tool.status === 'error'
      ? t('terminals.agent.execError')
      : tool.status === 'running'
        ? t('terminals.agent.running')
        : tool.status === 'finished'
          ? 'completed'
          : tool.status
  return (
    <div
      className="rounded-md border border-border bg-surface-muted/60 px-2 py-1.5"
      data-testid="terminal-tool-card"
      data-tool={tool.name}
      data-status={tool.status}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-caption font-medium text-ink">
          {isExec ? t('terminals.agent.execTitle') : tool.name}
        </span>
        <span className="shrink-0 text-caption text-ink-tertiary">{statusLabel}</span>
      </div>
      {isExec ? (
        <p className="mt-1 truncate font-mono text-caption text-ink-secondary" title={inputText}>
          {inputText}
        </p>
      ) : null}
      {tool.output ? (
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-caption text-ink-tertiary">
          {tool.output.slice(0, 2000)}
          {tool.output.length > 2000 ? '\n…' : ''}
        </pre>
      ) : null}
      {tool.error ? (
        <p className="mt-1 text-caption text-danger">{tool.error}</p>
      ) : null}
      {timedOut ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-caption text-warning">
            {t('terminals.agent.execTimedOut')}
          </span>
          <button
            type="button"
            onClick={() => void sshWrite(terminalId, '\x03')}
            className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-caption text-ink-secondary hover:bg-state-hover"
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
            className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-caption text-ink-secondary hover:bg-state-hover"
            data-testid="terminal-tool-continue-watching"
          >
            {t('terminals.agent.continueWatching')}
          </button>
          <button
            type="button"
            onClick={() =>
              sessionService.sendMessageToSession(sessionId, t('terminals.agent.askUserPrompt'))
            }
            className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-caption text-ink-secondary hover:bg-state-hover"
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
  const isUser = message.role === 'user'
  if (message.role === 'notice') {
    return (
      <div className="px-2 py-1 text-center text-meta text-ink-tertiary" data-testid="terminal-notice">
        {message.content}
      </div>
    )
  }
  return (
    <div
      className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}
      data-testid={`terminal-msg-${message.role}`}
    >
      <div
        className={cn(
          'max-w-[92%] rounded-lg px-2.5 py-1.5 text-body',
          isUser
            ? 'rounded-br-sm bg-accent/10 text-ink'
            : 'rounded-bl-sm border border-border bg-surface',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <MarkdownBody content={message.content} />
        )}
      </div>
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <div className="flex w-full flex-col gap-1">
          {message.toolCalls.map((tc) => (
            <ToolCard key={tc.callId} tool={tc} t={t} terminalId={terminalId} sessionId={sessionId} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Session-scoped HITL approval card (not the global active session modal). */
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
      className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-2"
      data-testid="terminal-permission-card"
    >
      <p className="text-caption font-medium text-ink">{t('terminals.agent.permissionTitle')}</p>
      <p className="mt-0.5 font-mono text-caption text-ink-secondary">{tool.content ?? tool.title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
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

/** Compact terminal agent composer (≥350px rail). Explicit sessionId — no active-session coupling. */
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
    <div className="shrink-0 border-t border-border bg-surface-subtle px-2 py-2" data-testid="terminal-composer">
      <div className="mb-1.5 flex items-center gap-1.5">
        <select
          value={selectedAgentId}
          onChange={(e) => onSelectAgent(e.target.value)}
          className="h-6 max-w-[9rem] truncate rounded-sm border border-border bg-surface px-1 text-caption text-ink"
          data-testid="terminal-agent-picker"
          aria-label={t('terminals.agent.emptyTitle')}
        >
          <option value="builtin">{t('terminals.agent.emptyTitle')}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={permissionMode}
          onChange={(e) => onSelectPermissionMode(e.target.value as 'chat' | 'edit' | 'full')}
          className="h-6 rounded-sm border border-border bg-surface px-1 text-caption text-ink"
          data-testid="terminal-permission-mode"
          aria-label="permission mode"
        >
          <option value="chat">chat</option>
          <option value="edit">edit</option>
          <option value="full">full</option>
        </select>
      </div>
      <div className="flex items-end gap-1.5">
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
          className="min-h-10 flex-1 resize-none rounded-sm border border-border bg-surface px-2 py-1.5 text-body text-ink outline-none placeholder:text-ink-tertiary focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/10 disabled:opacity-50"
          data-testid="terminal-composer-input"
        />
        <Button size="sm" onClick={send} disabled={disabled || !text.trim()} data-testid="terminal-composer-send">
          <Send size={14} className="mr-1" />
          {t('terminals.agent.send')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Terminal Ops agent panel (spec §3.4): status strip + session-scoped message list
 * + compact composer + HITL. Never mounted for local terminals.
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

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-surface"
      data-testid="terminal-agent-panel"
    >
      {/* Status strip */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5"
        data-testid="terminal-agent-status"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-caption text-ink-secondary">
          <TerminalSquare size={12} className="shrink-0 text-ink-tertiary" />
          <span className="truncate">{statusText}</span>
          {!connected ? <span className="size-1.5 shrink-0 rounded-full bg-ink-tertiary/50" aria-hidden /> : null}
        </span>
        {sessionsForTerminal.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={startChat}
            data-testid="terminal-agent-new-chat"
          >
            <Plus size={12} className="mr-0.5" />
            {t('terminals.agent.newChat')}
          </Button>
        ) : null}
      </div>

      {active && isTerminalSession(active.config) ? (
        <>
          {/* Message list */}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2" data-testid="terminal-message-list">
            {active.messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
                <p className="text-body font-medium text-ink">{t('terminals.agent.emptyTitle')}</p>
                <p className="text-caption text-ink-tertiary">{t('terminals.agent.emptyBody')}</p>
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
          </div>

          {acpLimited ? (
            <div
              className="flex shrink-0 items-start gap-1.5 border-t border-border px-2 py-1.5 text-caption text-ink-secondary"
              data-testid="terminal-acp-limited"
            >
              <XCircle size={12} className="mt-0.5 shrink-0 text-ink-tertiary" />
              {t('terminals.agent.acpLimited')}
            </div>
          ) : null}

          {active.pendingPermission ? (
            <div className="shrink-0 px-2 pb-2">
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
              className="flex shrink-0 items-center gap-1.5 border-t border-border px-2 py-1.5 text-caption text-ink-secondary"
              data-testid="terminal-exec-flight"
            >
              <Loader2 size={12} className="animate-spin" />
              {t('terminals.agent.running')}… {flight.command}
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
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
          data-testid="terminal-agent-empty"
        >
          <p className="text-body font-medium text-ink">{t('terminals.agent.emptyTitle')}</p>
          <p className="text-caption leading-relaxed text-ink-tertiary">
            {connected ? t('terminals.agent.emptyBody') : t('terminals.agent.needSsh')}
          </p>
          <Button onClick={startChat} data-testid="terminal-agent-start" disabled={!term}>
            {t('terminals.agent.start')}
          </Button>
        </div>
      )}
    </div>
  )
}
