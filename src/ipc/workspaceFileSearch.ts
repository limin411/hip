import { invoke } from '@tauri-apps/api/core'

export type WorkspaceFileSearchHit = {
  relativePath: string
  absolutePath: string
  name: string
  isDir: boolean
  score: number
}

export type WorkspaceFileSearchResult = {
  root: string
  query: string
  hits: WorkspaceFileSearchHit[]
  truncated: boolean
}

export async function workspaceFileSearch(args: {
  root: string
  query: string
  limit?: number
  /** Include directory hits for prefix nav. Default true. */
  includeDirs?: boolean
}): Promise<WorkspaceFileSearchResult> {
  const query = args.query
  // FE short-circuit: empty query = hint only, no IPC
  if (!query.trim()) {
    return {
      root: args.root,
      query,
      hits: [],
      truncated: false,
    }
  }
  return invoke<WorkspaceFileSearchResult>('workspace_file_search', {
    root: args.root,
    query,
    limit: args.limit,
    includeDirs: args.includeDirs,
  })
}
