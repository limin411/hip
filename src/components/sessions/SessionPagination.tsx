import { useTranslation } from 'react-i18next'

interface SessionPaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

export function SessionPagination({ page, totalPages, onChange }: SessionPaginationProps) {
  const { t } = useTranslation()

  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-2 text-body text-ink-secondary">
      <button
        type="button"
        data-testid="pagination-previous"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="rounded-md px-2 py-1 transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t('sidebar.previousPage')}
      </button>
      <span className="min-w-[3ch] text-center text-caption">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        data-testid="pagination-next"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="rounded-md px-2 py-1 transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t('sidebar.nextPage')}
      </button>
    </div>
  )
}
