import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, X } from 'lucide-react'
import { normalizePath, isValidPath } from '@/lib/pathUtils'
import { cn } from '@/lib/utils'
import type { TerminalFileTreeBackend } from './TerminalFileTree'

interface PathInputProps {
  terminalId: string
  currentPath: string | null
  backend: TerminalFileTreeBackend
  onNavigate: (path: string) => void
  onCancel: () => void
  className?: string
}

/**
 * 路径输入框组件
 * 支持直接输入路径跳转到指定目录
 */
export function PathInput({
  terminalId,
  currentPath,
  backend,
  onNavigate,
  onCancel,
  className
}: PathInputProps) {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState(currentPath || '/')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 自动聚焦并选中文本
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  // 处理路径跳转
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    
    const trimmedValue = inputValue.trim()
    if (!trimmedValue) {
      setError(t('terminals.pathInput.emptyError'))
      return
    }

    // 标准化路径
    let normalizedPath: string
    try {
      normalizedPath = normalizePath(trimmedValue, currentPath || undefined)
    } catch (err) {
      setError(t('terminals.pathInput.invalidPath'))
      return
    }

    // 验证路径
    if (!isValidPath(normalizedPath)) {
      setError(t('terminals.pathInput.invalidPath'))
      return
    }

    // 清除错误并导航
    setError(null)
    onNavigate(normalizedPath)
  }, [inputValue, currentPath, onNavigate, t])

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }, [onCancel])

  // 处理输入变化
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    if (error) {
      setError(null)
    }
  }, [error])

  return (
    <div
      className={cn(
        'flex flex-col gap-1 px-2 py-1',
        className
      )}
      data-testid="path-input"
      data-terminal-id={terminalId}
      data-backend={backend}
    >
      <form onSubmit={handleSubmit} className="flex items-center gap-1">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className={cn(
              'w-full rounded border px-2 py-1 pr-6 text-caption bg-surface',
              'focus:outline-none focus:ring-1 focus:ring-accent',
              error ? 'border-danger' : 'border-border'
            )}
            placeholder={t('terminals.pathInput.placeholder')}
            data-testid="path-input-field"
          />
          
          {/* 清除按钮 */}
          {inputValue && (
            <button
              type="button"
              onClick={() => {
                setInputValue('')
                setError(null)
                inputRef.current?.focus()
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-tertiary hover:text-ink-secondary"
              title={t('terminals.pathInput.clear')}
              data-testid="path-input-clear"
            >
              <X size={12} />
            </button>
          )}
        </div>
        
        <button
          type="submit"
          className="rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
          title={t('terminals.pathInput.go')}
          data-testid="path-input-submit"
        >
          <ArrowRight size={13} strokeWidth={1.75} />
        </button>
      </form>

      {/* 错误提示 */}
      {error && (
        <p className="text-caption text-danger" data-testid="path-input-error">
          {error}
        </p>
      )}

      {/* 快捷提示 */}
      <div className="flex items-center gap-2 text-caption text-ink-tertiary/70">
        <span>{t('terminals.pathInput.hint.enter')}</span>
        <span>{t('terminals.pathInput.hint.escape')}</span>
        <span>{t('terminals.pathInput.hint.special')}</span>
      </div>
    </div>
  )
}

export default PathInput
