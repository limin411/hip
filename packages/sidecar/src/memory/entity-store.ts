// packages/sidecar/src/memory/entity-store.ts
// Entity graph memory (G8, P2 placeholder): entity→memory association store.
//
// Direction (spec agent-capability-upgrade G8): phase3 entity extraction after
// memory pipeline phase2 consolidation; entities link to memory ids so related
// topics can be recalled across sessions. This file only establishes the
// types and an empty (no-op) store so later phases can fill the persistence
// without changing call sites.

export interface MemoryEntity {
  /** Canonical entity text (lowercased). */
  text: string
  /** Linked memory ids. */
  memoryIds: string[]
  /** Last seen at (ms epoch). */
  updatedAt: number
}

export interface EntityStore {
  /** Upsert an entity with its linked memory id (idempotent). */
  add(entity: string, memoryId: string): void
  /** All memory ids linked to an entity (exact match). */
  get(entity: string): string[]
  /** All entities (for graph visualization / eviction). */
  list(): MemoryEntity[]
}

/** Empty store: add is a no-op, get/list return empty results. */
export class NoopEntityStore implements EntityStore {
  add(_entity: string, _memoryId: string): void {
    // no-op (P2)
  }

  get(_entity: string): string[] {
    return []
  }

  list(): MemoryEntity[] {
    return []
  }
}
