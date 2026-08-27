import { useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { splitPath, getPathDepth } from '@/lib/pathUtils'
import { cn } from '@/lib/utils'
import type { TerminalFileTreeBackend } from './TerminalFileTree'

interface TerminalBreadcrumbProps {
  terminalId: string
  currentPath: string | null
  backend: TerminalFileTreeBackend
  onNavigate: (path: string) => void
  className?: string
}

/**
 * 终端文件面板面包屑导航组件
 * 显示当前路径的层级结构，支持点击导航
 */
export function TerminalBreadcrumb({
  terminalId,
  currentPath,
  backend,
  onNavigate,
  className
}: TerminalBreadcrumbProps) {
  const { t } = useTranslation()

  // 解析路径为面包屑片段
  const pathParts = useMemo(() => {
    if (!currentPath) return []
    return splitPath(currentPath)
  }, [currentPath])

  // 处理面包屑点击
  const handleBreadcrumbClick = useCallback((path: string) => {
    onNavigate(path)
  }, [onNavigate])

  // 如果没有路径，不显示面包屑
  if (!currentPath || currentPath === '/') {
    return null
  }

  // 路径深度超过 5 时，折叠中间部分
  const depth = getPathDepth(currentPath)
  const shouldCollapse = depth > 5
  const displayParts = shouldCollapse
    ? [
        ...pathParts.slice(0, 2),
        { name: '...', path: '' }, // 折叠占位符
        ...pathParts.slice(-2)
      ]
    : pathParts

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 px-2 py-1 text-caption text-ink-tertiary overflow-x-auto',
        className
      )}
      data-testid="terminal-breadcrumb"
      data-terminal-id={terminalId}
      data-backend={backend}
    >
      {/* 根目录按钮 */}
      <button
        onClick={() => handleBreadcrumbClick('/')}
        className="hover:text-ink-secondary hover:underline whitespace-nowrap"
        title={t('terminals.breadcrumb.root')}
        data-testid="breadcrumb-root"
      >
        /
      </button>

      {/* 路径片段 */}
      {displayParts.map((part, index) => (
        <div key={part.path || `collapsed-${index}`} className="flex items-center gap-0.5">
          <ChevronRight size={12} className="text-ink-tertiary/50" />
          
          {part.path ? (
            <button
              onClick={() => handleBreadcrumbClick(part.path)}
              className={cn(
                'hover:text-ink-secondary hover:underline whitespace-nowrap',
                index === displayParts.length - 1 && 'text-ink-secondary font-medium'
              )}
              title={part.path}
              data-testid={`breadcrumb-part-${index}`}
            >
              {part.name}
            </button>
          ) : (
            <span className="text-ink-tertiary/50" title={t('terminals.breadcrumb.collapsed')}>
              {part.name}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export default TerminalBreadcrumb
