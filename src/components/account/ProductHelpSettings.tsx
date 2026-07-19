import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import {
  HIP_PRODUCT_VERSION,
  HIP_SKILL_DESCRIPTION,
  PRODUCT_CAPABILITY_MAP,
  PRODUCT_HELP_SECTIONS,
  PRODUCT_SKILL_VERSION,
  type ProductHelpSectionId,
} from '@/domain/product'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { cn } from '@/lib/utils'

/** Capability map is a plain bullet list without markdown headers — wrap for prose. */
function capabilityMapMarkdown(map: string): string {
  const lines = map.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return map
  const [title, ...rest] = lines
  const bullets = rest.map((l) => (l.startsWith('- ') ? l : `- ${l}`)).join('\n')
  return `### ${title.replace(/:$/, '')}\n\n${bullets}`
}

export function ProductHelpSettings() {
  const { t } = useTranslation()
  const [sectionId, setSectionId] = useState<ProductHelpSectionId>('overview')

  const section = useMemo(
    () => PRODUCT_HELP_SECTIONS.find((s) => s.id === sectionId) ?? PRODUCT_HELP_SECTIONS[0]!,
    [sectionId],
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="settings-product-help">
      <div className="shrink-0 border-b border-border px-6 pb-4 pt-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-ink-secondary">
            <BookOpen size={18} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-semibold text-ink">{t('settings.productHelp.title')}</h2>
            <p className="mt-1 text-meta text-ink-tertiary">{t('settings.productHelp.intro')}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-ink-tertiary">
              <span data-testid="product-help-version">
                {t('settings.productHelp.version', { version: HIP_PRODUCT_VERSION })}
              </span>
              <span aria-hidden className="text-border">
                ·
              </span>
              <span data-testid="product-help-docs-rev">
                {t('settings.productHelp.docsRev', { rev: PRODUCT_SKILL_VERSION })}
              </span>
            </div>
            <p className="mt-2 text-meta text-ink-secondary">{HIP_SKILL_DESCRIPTION}</p>
          </div>
        </div>

        <div
          className="mt-4 rounded-lg border border-border bg-surface-muted/40 px-3 py-2.5"
          data-testid="product-help-capability"
        >
          <MarkdownBody content={capabilityMapMarkdown(PRODUCT_CAPABILITY_MAP)} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          role="tablist"
          aria-label={t('settings.productHelp.sectionsLabel')}
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 py-2"
        >
          {PRODUCT_HELP_SECTIONS.map((s) => {
            const active = s.id === section.id
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`product-help-tab-${s.id}`}
                onClick={() => setSectionId(s.id)}
                className={cn(
                  'shrink-0 rounded-md px-2.5 py-1.5 text-meta font-medium transition-colors',
                  active
                    ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--border)]'
                    : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
                )}
              >
                {t(s.titleKey)}
              </button>
            )
          })}
        </div>

        <div
          role="tabpanel"
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
          data-testid={`product-help-panel-${section.id}`}
        >
          <MarkdownBody content={section.markdown} />
          <p className="mt-8 text-caption text-ink-tertiary">{t('settings.productHelp.sourceNote')}</p>
        </div>
      </div>
    </div>
  )
}
