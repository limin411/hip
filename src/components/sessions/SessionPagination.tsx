interface SessionPaginationProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
}

export function SessionPagination({ page, totalPages, onChange }: SessionPaginationProps) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-center gap-2 text-body text-ink-secondary">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="rounded-md px-2 py-1 transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Previous
      </button>
      <span className="min-w-[3ch] text-center text-caption">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="rounded-md px-2 py-1 transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  )
}
