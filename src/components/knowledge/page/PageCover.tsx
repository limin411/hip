import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveAssetDataUrl } from '@/domain/knowledge/assetUrl'
import { importAssetFromFile } from '@/domain/knowledge/importAsset'
import { useEffect } from 'react'

export interface PageCoverProps {
  spaceId: string | null
  cover: string | null
  coverY?: number | null
  onChange: (next: { cover: string | null; coverY?: number | null }) => void
  disabled?: boolean
  className?: string
}

export function PageCover({
  spaceId,
  cover,
  coverY = 50,
  onChange,
  disabled,
  className,
}: PageCoverProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!cover || !spaceId) {
      setSrc(null)
      return
    }
    if (
      cover.startsWith('data:') ||
      cover.startsWith('http://') ||
      cover.startsWith('https://') ||
      cover.startsWith('blob:')
    ) {
      setSrc(cover)
      return
    }
    void resolveAssetDataUrl(spaceId, cover).then((r) => {
      if (!cancelled) setSrc(r?.dataUrl ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [cover, spaceId])

  const onPickFile = async (file: File | null) => {
    if (!file || !spaceId || disabled) return
    const res = await importAssetFromFile(spaceId, file)
    if (!res.ok) return
    onChange({ cover: res.meta.relPath, coverY: coverY ?? 50 })
  }

  if (!cover) {
    return (
      <div
        className={cn(
          'knowledge-doc-measure group relative mb-2 flex h-10 items-center',
          className,
        )}
        data-testid="knowledge-page-cover-empty"
      >
        <button
          type="button"
          disabled={disabled || !spaceId}
          className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-meta text-ink-tertiary opacity-0 transition-opacity hover:bg-state-hover hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
          data-testid="knowledge-page-cover-add"
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus size={14} />
          {t('knowledge.doc.coverAdd')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative mb-4 h-40 w-full overflow-hidden bg-surface-muted',
        className,
      )}
      data-testid="knowledge-page-cover"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files?.[0]
        if (f) void onPickFile(f)
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          style={{ objectPosition: `center ${coverY ?? 50}%` }}
          draggable={false}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-meta text-ink-tertiary">
          …
        </div>
      )}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 flex justify-end gap-1 p-2',
          dragging && 'bg-accent/10',
        )}
      >
        <button
          type="button"
          className="rounded-sm bg-surface/90 px-2 py-1 text-meta text-ink shadow-sm hover:bg-surface"
          data-testid="knowledge-page-cover-change"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          {t('knowledge.doc.coverChange')}
        </button>
        <button
          type="button"
          className="rounded-sm bg-surface/90 p-1 text-ink shadow-sm hover:bg-surface"
          data-testid="knowledge-page-cover-remove"
          disabled={disabled}
          aria-label={t('knowledge.doc.coverRemove')}
          onClick={() => onChange({ cover: null, coverY: null })}
        >
          <X size={14} />
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
      />
    </div>
  )
}
