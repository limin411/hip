import { createContext, useContext } from 'react'
import type { KnowledgeNode } from '../types'

export type KnowledgeEditorHost = {
  spaceId: string | null
  nodes: KnowledgeNode[]
  onWikiNavigate?: (payload: {
    title: string
    nodeId: string | null
    broken: boolean
    /** 块引用锚点 `[[title#frag]]`（V2-E1）：BN 块 id 或标题文本。 */
    fragment?: string | null
  }) => void
  onOpenDoc?: (docId: string, fragment?: string | null) => void
}

const defaultHost: KnowledgeEditorHost = {
  spaceId: null,
  nodes: [],
}

export const KnowledgeEditorHostContext =
  createContext<KnowledgeEditorHost>(defaultHost)

export function useKnowledgeEditorHost(): KnowledgeEditorHost {
  return useContext(KnowledgeEditorHostContext)
}
