import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useDraftStore } from '@/store/draftStore'
import { useUiStore } from '@/store/uiStore'
import { useProvidersStore } from '@/store/providersStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useSkillsStore } from '@/store/skillsStore'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { sessionService, useActiveSessionId, useDomainStore } from '@/domain'
import { Composer } from './Composer'
import { SlashCommandPalette, extractSlashQuery } from './SlashCommandPalette'
import { FileMentionPalette } from './FileMentionPalette'
import { useFileMentionHandler } from './useFileMentionHandler'
import { SkillArgInput, extractSkillInvocation } from './SkillArgInput'
import { useSlashCommandHandler } from './useSlashCommandHandler'
import { resolveSearchRoot } from '@/lib/resolveSearchRoot'
import { isMultimodalAttachmentMime } from '@/lib/attachmentAllowlist'
import { useProjectPathStore } from '@/store/projectPathStore'
import { readSkillFile } from '@/ipc/skills'
import { FolderPill } from './FolderPill'
import { ComposerLeftSlot } from './ComposerLeftSlot'
import { FirstRunSetupCard } from './FirstRunSetupCard'
import { AcpCapabilityCliffBanner } from './AcpCapabilityCliffBanner'
import { isAttachmentSupported } from '@/lib/attachmentEligibility'
import { activeModelKey, parseModelKey } from '@/lib/modelKey'
import { cn } from '@/lib/utils'
import type { LocalAttachment } from './attachmentTypes'
import { MascotActor } from '@/components/login/MascotActor'
import {
  selectEmptyGreeting,
  resolveSystemTimeZone,
  localParts,
  timeCacheBucket,
} from '@/lib/emptyGreeting'
import { EMPTY_GREETING } from '@/lib/emptyGreeting.keys'
import { readRecentTipIds, pushRecentTipId } from '@/lib/emptyGreeting.recent'
import {
  buildGenerateContext,
  llmGreetingCacheKey,
  llmGreetingCacheTtlMs,
  memoryHintsFingerprint,
  readLlmGreetingCache,
  sanitizeMemoryHintsForGreeting,
  validateLlmGreeting,
  writeLlmGreetingCache,
  type LlmGreetingPair,
} from '@/lib/emptyGreeting.llm'

export function NewConversation() {
  const { t, i18n } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const language = useUiStore((s) => s.language)
  const surface = activeView === 'code' ? 'code' : 'chat'
  const draft = useDraftStore((s) => s.draft)
  const text = draft?.text ?? ''
  const activeId = useActiveSessionId()
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])

  // Ensure a draft exists; keep Chat drafts in chat mode so a leftover project draft (e.g. a
  // folder picked in Code, then switched to Chat without sending) can't commit as a Code session.
  // (configFromDraft derives surface from draft.mode, so mode must match the surface here.)
  // Also drop a stale slash query on the first mount so the slash palette doesn't pop up on a
  // fresh screen; don't clear on surface changes or the user loses text when switching views.
  const hasClearedStaleSlash = useRef(false)
  useEffect(() => {
    useDraftStore.getState().ensureDraft(surface)
    if (surface === 'chat' && useDraftStore.getState().draft?.mode === 'project') {
      useDraftStore.getState().clearProject()
    }
    if (!hasClearedStaleSlash.current) {
      hasClearedStaleSlash.current = true
      const draftText = useDraftStore.getState().draft?.text ?? ''
      if (extractSlashQuery(draftText) !== null) {
        useDraftStore.getState().setText('')
      }
    }
  }, [surface])

  const catalog = useProvidersStore((s) => s.catalog)
  const providersConfig = useProvidersStore((s) => s.config)
  const agents = useHipConfigStore(useShallow((s) => s.config.agents ?? []))
  const currentKey = draft?.modelKey ?? activeModelKey(providersConfig)
  const attachmentsSupported = isAttachmentSupported(currentKey, agents, catalog)

  // K10: drop only multimodal chips when model lacks attachment support.
  useEffect(() => {
    if (!attachmentsSupported) {
      setAttachments((prev) => {
        const next = prev.filter((a) => !isMultimodalAttachmentMime(a.mimeType))
        return next.length === prev.length ? prev : next
      })
    }
  }, [attachmentsSupported])

  // Code requires a project folder before the first send; Chat is always sandboxed.
  const hasFolder = draft?.mode === 'project' && !!draft.cwd
  const canSend = surface === 'chat'
    ? !!text.trim() || attachments.length > 0
    : (!!text.trim() || attachments.length > 0) && hasFolder

  const submit = () => {
    if (!canSend) return
    sessionService.sendMessage(text, attachments) // commit: creates the session (surface-aware) + resets the draft
    setAttachments([])
  }

  // Dynamic empty-state title/sub under the mascot (locale + TZ + holiday + tips).
  // Recompute only on language/surface; no midnight ticker (accepted for v1).
  const pick = useMemo(
    () =>
      selectEmptyGreeting({
        now: new Date(),
        timeZone: resolveSystemTimeZone(),
        language,
        surface,
        recentTipIds: readRecentTipIds(),
      }),
    [language, surface],
  )

  useEffect(() => {
    if (pick.tipId) pushRecentTipId(pick.tipId)
  }, [pick.tipId])

  const surfaceFb = EMPTY_GREETING.surface[surface]
  // Dynamic keys from emptyGreeting selector; cast because i18n typed keys don't cover runtime selection.
  const tDyn = t as unknown as (key: string) => string
  const resolveKey = useCallback(
    (key: string, fallbackKey: string): string => {
      if (i18n.exists(key)) return tDyn(key)
      return tDyn(fallbackKey)
    },
    [i18n, tDyn],
  )
  const baseGreeting = resolveKey(pick.titleKey, surfaceFb.title)
  const baseGreetingSub = resolveKey(pick.subKey, surfaceFb.sub)

  // Always-on LLM enrich (built-in model only): rule text first, then replace when ready.
  // Pulls light global/project memory hints so copy feels continuous rather than template-stiff.
  const [llmGreeting, setLlmGreeting] = useState<LlmGreetingPair | null>(null)
  useEffect(() => {
    setLlmGreeting(null)
    const modelKey = currentKey
    const { providerID, modelID } = modelKey ? parseModelKey(modelKey) : { providerID: '', modelID: '' }
    const parts = localParts(new Date(), resolveSystemTimeZone())
    const holidayId =
      pick.tier === 'holiday' && pick.id.startsWith('holiday:')
        ? pick.id.slice('holiday:'.length)
        : undefined

    let cancelled = false

    const loadMemoryHints = async (): Promise<string[]> => {
      try {
        // Respect global memory toggle when available; fail open to empty hints.
        const cfg = await Promise.race([
          sessionService.getMemoryConfig(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 600)),
        ])
        if (cfg && cfg.useMemories === false) return []

        const items = await Promise.race([
          sessionService.listMemories({ scope: 'global', limit: 24 }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
        ])
        if (!items) return []
        return sanitizeMemoryHintsForGreeting(items, 3)
      } catch {
        return []
      }
    }

    void (async () => {
      const memoryHints = await loadMemoryHints()
      if (cancelled) return

      // Timely cache: key includes local hour + weekEdge + timeOfDay so night→Monday dawn refreshes.
      const cacheKey = llmGreetingCacheKey({
        timeBucket: timeCacheBucket(parts, pick.weekEdge),
        language,
        region: pick.region,
        surface,
        tier: pick.tier,
        timeOfDay: pick.timeOfDay,
        modelKey: modelKey || 'default',
        holidayId,
        memoryFp: memoryHintsFingerprint(memoryHints),
      })
      const cached = readLlmGreetingCache(cacheKey)
      if (cached) {
        setLlmGreeting(cached)
        return
      }

      const recentTitles = useDomainStore
        .getState()
        .sessions.map((s) => s.title)
        .filter(Boolean)
      const context = buildGenerateContext({
        pick,
        baseTitle: baseGreeting,
        baseSub: baseGreetingSub,
        language,
        surface,
        recentSessionTitles: recentTitles,
        memoryHints,
      })

      try {
        const result = await sessionService.generateEmptyGreeting({
          ...(providerID ? { providerID } : {}),
          ...(modelID ? { modelID } : {}),
          context,
          timeoutMs: 4_000,
        })
        if (cancelled || !result.ok) return
        const valid = validateLlmGreeting(result)
        if (!valid) return
        // Write cache immediately so reopen within the same hour hits cache.
        writeLlmGreetingCache(cacheKey, valid, {
          ttlMs: llmGreetingCacheTtlMs(pick.timeOfDay, pick.weekEdge),
        })
        setLlmGreeting(valid)
      } catch {
        // Keep rule-based fallback silently.
      }
    })()

    return () => {
      cancelled = true
    }
    // baseGreeting/sub intentionally included so cache miss regenerates after language change.
  }, [pick, language, surface, currentKey, baseGreeting, baseGreetingSub])

  const greeting = llmGreeting?.title ?? baseGreeting
  const greetingSub = llmGreeting?.sub ?? baseGreetingSub
  const mascotInitial =
    pick.tier === 'holiday' ? 'party' : surface === 'code' ? 'coding' : 'wave'
  // J1 empty-state CTA identity for e2e (@smooth-p4)

  const setText = useCallback((value: string) => useDraftStore.getState().setText(value), [])

  const allSkills = useSkillsStore((s) => s.skills)
  const skills = useMemo(() => allSkills.filter((sk) => sk.userInvocable !== false), [allSkills])
  const query = useMemo(() => extractSlashQuery(text), [text])
  const invocation = useMemo(() => extractSkillInvocation(text), [text])
  const selectedSkill = useMemo(() => {
    if (!invocation) return undefined
    return skills.find((s) => s.name === invocation.skillName)
  }, [invocation, skills])

  const [skillBody, setSkillBody] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!selectedSkill) {
      setSkillBody(undefined)
      return
    }
    let cancelled = false
    readSkillFile(selectedSkill.id, 'SKILL.md').then((body) => {
      if (!cancelled) setSkillBody(body)
    }).catch(() => {
      if (!cancelled) setSkillBody(undefined)
    })
    return () => { cancelled = true }
  }, [selectedSkill])

  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { handleCommandSelect, handleDismiss } = useSlashCommandHandler(surface, {
    sessionId: activeId,
    skills,
    value: text,
    setText,
    inputRef,
  })

  const pathStatus = useProjectPathStore((s) => s.statusOf(draft?.cwd))
  const searchRoot = useMemo(
    () =>
      resolveSearchRoot({
        draft: draft
          ? { mode: draft.mode === 'project' ? 'project' : 'chat', cwd: draft.cwd }
          : null,
        pathStatus,
      }),
    [draft, pathStatus],
  )

  const {
    atQuery,
    handleSelect: handleFileMentionSelect,
    handleDismiss: handleFileMentionDismiss,
  } = useFileMentionHandler({
    value: text,
    setValue: setText,
    searchRoot,
    attachments,
    setAttachments,
    attachmentsSupported,
    inputRef,
  })

  // D18: when global ⌘K opens, dismiss active slash / @ query so palettes never stack.
  const globalPaletteOpen = useCommandPaletteStore((s) => s.open)
  useEffect(() => {
    if (!globalPaletteOpen) return
    if (extractSlashQuery(text) !== null) {
      handleDismiss()
    } else if (atQuery !== null) {
      handleFileMentionDismiss()
    }
  }, [globalPaletteOpen, text, handleDismiss, atQuery, handleFileMentionDismiss])

  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-32',
        surface === 'chat' && 'px-8',
      )}
      data-testid="new-conversation"
      data-surface={surface}
    >
      <div className="w-full max-w-2xl">
        <div className="mb-3 flex justify-center">
          <MascotActor
            key={surface}
            size={360}
            initialAction={mascotInitial}
            transition="slide"
          />
        </div>
        <div key={surface} className="animate-greeting-enter">
          <h1 className="mb-2 text-center text-display font-semibold tracking-tight text-ink">
            {greeting}
          </h1>
          <p className="mb-6 text-center text-body text-ink-secondary">
            {greetingSub}
          </p>
        </div>
        <FirstRunSetupCard surface={surface} />
        <AcpCapabilityCliffBanner />
        <div className="relative">
          {query !== null && (
            <SlashCommandPalette value={text} surface={surface} sessionId={activeId} skills={skills} onSelect={handleCommandSelect} onDismiss={handleDismiss} />
          )}
          {query === null && atQuery !== null && searchRoot && (
            <FileMentionPalette
              query={atQuery}
              searchRoot={searchRoot}
              onSelect={handleFileMentionSelect}
              onDismiss={handleFileMentionDismiss}
            />
          )}
          <Composer
            variant="card"
            value={text}
            onChange={(v) => setText(v)}
            onSubmit={submit}
            autoFocus
            submitDisabled={!canSend}
            inputRef={inputRef}
            leftSlot={
              <ComposerLeftSlot
                surface={surface}
                sessionBound={false}
                onAttach={
                  surface === 'code'
                    ? setAttachments
                    : (add) => setAttachments((prev) => [...prev, ...add])
                }
              />
            }
            attachments={attachments}
            onAttachmentsChange={setAttachments}
          />
          {selectedSkill && (
            <SkillArgInput
              value={text}
              skillBody={skillBody}
              skillArgs={selectedSkill.arguments}
            />
          )}
        </div>
        {surface === 'code' && (
          <div className="mt-2 flex flex-col items-center gap-1">
            <FolderPill />
            {!hasFolder && <span className="text-meta text-ink-tertiary">{t('chat.codeNeedFolder')}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
