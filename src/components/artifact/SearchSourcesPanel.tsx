import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Globe } from 'lucide-react'
import { open } from '@tauri-apps/plugin-shell'
import { useActiveMessages } from '@/domain'
import { collectConversationSearchSources, type SearchSource } from '@/lib/searchSources'
import { faviconCandidatesFor } from '@/lib/siteFavicon'
import { cn } from '@/lib/utils'

async function openExternalUrl(url: string): Promise<void> {
  try {
    await open(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Human label for the producing tool (hide noisy builtin names). */
function toolLabel(toolName?: string): string | null {
  if (!toolName) return null
  if (toolName === 'web_search' || toolName === 'web_fetch') return null
  // mcp__server__tool → server/tool
  if (toolName.startsWith('mcp__')) {
    const rest = toolName.slice('mcp__'.length)
    const i = rest.indexOf('__')
    if (i > 0) return `${rest.slice(0, i)}/${rest.slice(i + 2)}`
  }
  return toolName
}

/**
 * Site favicon with cascade: origin /favicon.ico → DuckDuckGo icons → Globe.
 * CSP allows https: img-src (see tauri.conf.json).
 */
export function SiteFavicon({ pageUrl, className }: { pageUrl: string; className?: string }) {
  const candidates = useMemo(() => faviconCandidatesFor(pageUrl), [pageUrl])
  const [index, setIndex] = useState(0)
  const exhausted = candidates.length === 0 || index >= candidates.length
  const src = exhausted ? null : candidates[index]

  if (!src) {
    return (
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center text-ink-tertiary',
          className,
        )}
        data-testid="source-favicon-fallback"
        aria-hidden
      >
        <Globe size={14} strokeWidth={1.75} />
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      data-testid="source-favicon"
      data-favicon-src={src}
      onError={() => setIndex((i) => i + 1)}
      className={cn(
        'mt-0.5 h-4 w-4 shrink-0 rounded-sm bg-surface-muted object-contain',
        className,
      )}
      aria-hidden
    />
  )
}

function SourceRow({ source }: { source: SearchSource }) {
  const { t } = useTranslation()
  const host = hostname(source.url)
  const tool = toolLabel(source.toolName)
  return (
    <li className="m-0 p-0">
      <button
        type="button"
        data-testid="search-source-row"
        data-url={source.url}
        data-tool={source.toolName ?? ''}
        title={source.url}
        onClick={() => void openExternalUrl(source.url)}
        className={cn(
          'mb-0.5 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors',
          'hover:bg-state-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
        )}
      >
        <SiteFavicon pageUrl={source.url} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1">
            <span className="min-w-0 flex-1 truncate text-meta font-medium leading-snug text-ink">
              {source.title}
            </span>
            <ExternalLink size={12} className="mt-0.5 shrink-0 text-ink-tertiary" aria-hidden />
          </span>
          <span className="mt-0.5 block truncate text-caption leading-snug text-ink-tertiary">
            {host}
            {source.query ? (
              <span className="text-ink-tertiary/80">
                {' · '}
                {t('artifact.sourcesQuery', { query: source.query })}
              </span>
            ) : null}
            {tool ? (
              <span className="text-ink-tertiary/80">
                {' · '}
                {tool}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  )
}

/**
 * Chat right-panel list of web_search / web_fetch sources used in this conversation.
 * Click opens the URL in the system browser.
 */
export function SearchSourcesPanel() {
  const { t } = useTranslation()
  const messages = useActiveMessages()
  const sources = useMemo(() => collectConversationSearchSources(messages), [messages])

  if (sources.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
        data-testid="search-sources-empty"
        role="status"
      >
        <Globe size={22} className="text-ink-tertiary" aria-hidden />
        <p className="text-body text-ink-tertiary">{t('artifact.sourcesEmpty')}</p>
        <p className="text-caption text-ink-tertiary/80">{t('artifact.sourcesEmptyHint')}</p>
      </div>
    )
  }

  return (
    <nav
      className="flex h-full min-h-0 flex-col"
      data-testid="search-sources"
      aria-label={t('artifact.sources')}
    >
      <ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-1.5">
        {sources.map((s) => (
          <SourceRow key={s.url} source={s} />
        ))}
      </ol>
    </nav>
  )
}
