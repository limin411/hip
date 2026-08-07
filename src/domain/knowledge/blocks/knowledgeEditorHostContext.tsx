import { createContext, useContext } from 'react'
import type { KnowledgeNode } from '../types'

export type KnowledgeEditorHost = {
  spaceId: string | null
  nodes: KnowledgeNode[]
  onWikiNavigate?: (payload: {
    title: string
    nodeId: string | null
    broken: boolean
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
