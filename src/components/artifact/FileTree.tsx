import { useState } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileNode[]
}

interface TreeNodeProps {
  node: FileNode
  depth: number
  selected: string
  onSelect: (path: string) => void
}

function TreeNode({ node, depth, selected, onSelect }: TreeNodeProps) {
  const [open, setOpen] = useState(true)
  const isDir = node.type === 'dir'
  const isSelected = selected === node.path

  return (
    <div>
      <div
        onClick={() => (isDir ? setOpen((v) => !v) : onSelect(node.path))}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-[13px] transition-colors',
          isSelected ? 'bg-accent-subtle text-accent' : 'text-ink hover:bg-surface-muted',
        )}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {isDir ? (
          <>
            {open ? <ChevronDown size={14} className="text-ink-tertiary" /> : <ChevronRight size={14} className="text-ink-tertiary" />}
            {open ? <FolderOpen size={15} className="text-accent" /> : <Folder size={15} className="text-accent" />}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File size={15} className="text-ink-tertiary" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {isDir && open && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  )
}

export function FileTree() {
  const [selected, setSelected] = useState('')
  // TODO: wire to real workspace filesystem once agent tools are enabled
  const root: FileNode | null = null

  if (!root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-ink-tertiary">
        <Folder size={32} className="opacity-40" />
        <div className="text-[13px]">暂无文件</div>
        <div className="max-w-[180px] text-center text-[12px] opacity-70">
          与智能体协作时，文件将自动显示在这里
        </div>
      </div>
    )
  }

  return (
    <div className="py-1">
      <TreeNode node={root} depth={0} selected={selected} onSelect={setSelected} />
    </div>
  )
}
