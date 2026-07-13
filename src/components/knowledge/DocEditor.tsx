interface DocEditorProps {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
}

export function DocEditor({ value, onChange, onBlur }: DocEditorProps) {
  return (
    <textarea
      data-testid="knowledge-doc-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className="min-h-[min(60vh,480px)] w-full max-w-3xl resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60"
      spellCheck={false}
    />
  )
}
