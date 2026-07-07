import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

export interface PaginationProps {
  currentPage: number
  totalPages: number
  onChange: (page: number) => void
  className?: string
  previousLabel?: string
  nextLabel?: string
}

function generatePageItems(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis', total]
  }
  if (current >= total - 3) {
    return [1, 'ellipsis', total - 4, total - 3, total - 2, total - 1, total]
  }
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total]
}

export function Pagination({
  currentPage,
  totalPages,
  onChange,
  className,
  previousLabel = 'Previous page',
  nextLabel = 'Next page',
}: PaginationProps) {
  const items = generatePageItems(currentPage, totalPages)

  return (
    <div className={cn('flex items-center gap-1', className)} role="navigation" aria-label="Pagination">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChange(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label={previousLabel}
      >
        <ChevronLeft size={16} />
      </Button>

      {items.map((item, index) =>
        item === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} className="px-2 text-ink-tertiary">
            …
          </span>
        ) : (
          <Button
            key={item}
            variant={item === currentPage ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => onChange(item)}
            aria-label={`Page ${item}`}
            aria-current={item === currentPage ? 'page' : undefined}
          >
            {item}
          </Button>
        ),
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label={nextLabel}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  )
}
