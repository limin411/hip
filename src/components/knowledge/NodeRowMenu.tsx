import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal } from 'lucide-react'
import { buildContextMenuItems } from '@/components/context-menu/registry'
import { createContextMenuBuildContext } from '@/components/context-menu/buildContext'
import type {
  ContextMenuItemDef,
  ContextPayloadMap,
  ContextRequest,
} from '@/components/context-menu/types'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'

/**
 * 行尾 ⋯ 菜单：与右键菜单共用 knowledgeNode provider（单一数据源）。
 * 用于浏览视图行 / 网格 tile / 侧边栏目录行（doc-notion-polish PR-5/PR-6）。
 */
export function NodeRowMenu({
  nodeId,
  payload,
  className,
}: {
  nodeId: string
  payload: ContextPayloadMap['knowledgeNode']
  className?: string
}) {
  const { t } = useTranslation()
  const [items, setItems] = useState<ContextMenuItemDef[]>([])
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          const ctx = createContextMenuBuildContext(t, {})
          setItems(
            buildContextMenuItems(
              { kind: 'knowledgeNode', payload } as ContextRequest,
              ctx,
            ),
          )
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={`kb-node-menu-${nodeId}`}
          aria-label={t('knowledge.tree.rename')}
          onClick={(e) => e.stopPropagation()}
          className={className}
        >
          <MoreHorizontal size={14} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item, i) => (
          <div key={item.id}>
            {i > 0 && items[i - 1].group !== item.group ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem
              className={item.danger ? 'text-danger' : undefined}
              onSelect={() => item.run()}
            >
              {item.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
