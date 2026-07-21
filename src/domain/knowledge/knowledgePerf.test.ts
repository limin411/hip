import { describe, it, expect, beforeEach } from 'vitest'
import {
  __resetKnowledgePerfForTests,
  enableKnowledgePerf,
  isKnowledgePerfEnabled,
  kbPerfOpenStart,
  kbPerfOpenIpc,
  kbPerfOpenStore,
  kbPerfLiveCreateStart,
  kbPerfLiveCreateEnd,
  kbPerfSerialize,
  kbPerfDraftSet,
  kbPerfShiki,
  kbPerfMermaid,
  kbPerfNodeViewMount,
  knowledgePerfSnapshot,
  resetKnowledgePerf,
} from './knowledgePerf'

describe('knowledgePerf', () => {
  beforeEach(() => {
    __resetKnowledgePerfForTests()
  })

  it('no-ops marks when disabled', () => {
    expect(isKnowledgePerfEnabled()).toBe(false)
    kbPerfOpenStart()
    kbPerfSerialize(12)
    kbPerfDraftSet()
    const snap = knowledgePerfSnapshot()
    expect(snap.enabled).toBe(false)
    expect(snap.open.openStartMs).toBeNull()
    expect(snap.typing.serializeCount).toBe(0)
    expect(snap.typing.draftSetCount).toBe(0)
  })

  it('records open + serialize + block counters when enabled', () => {
    enableKnowledgePerf()
    expect(isKnowledgePerfEnabled()).toBe(true)

    kbPerfOpenStart()
    kbPerfOpenIpc(5)
    kbPerfOpenStore(100, 'live')
    kbPerfLiveCreateStart()
    kbPerfLiveCreateEnd()
    kbPerfSerialize(3.5)
    kbPerfSerialize(4.5)
    kbPerfDraftSet()
    kbPerfShiki(2)
    kbPerfMermaid(10)
    kbPerfNodeViewMount('code')
    kbPerfNodeViewMount('mermaid')
    kbPerfNodeViewMount('svg')

    const snap = knowledgePerfSnapshot()
    expect(snap.enabled).toBe(true)
    expect(snap.open.ipcMs).toBe(5)
    expect(snap.open.bodyChars).toBe(100)
    expect(snap.open.editorMode).toBe('live')
    expect(snap.open.liveCreateMs).not.toBeNull()
    expect(snap.open.firstEditableMs).not.toBeNull()
    expect(snap.typing.serializeCount).toBe(2)
    expect(snap.typing.serializeSamples).toEqual([3.5, 4.5])
    expect(snap.typing.draftSetCount).toBe(1)
    expect(snap.shiki.calls).toBe(1)
    expect(snap.mermaid.renders).toBe(1)
    expect(snap.nodeViews).toEqual({ code: 1, mermaid: 1, svg: 1 })

    resetKnowledgePerf()
    const after = knowledgePerfSnapshot()
    expect(after.enabled).toBe(true)
    expect(after.typing.serializeCount).toBe(0)
    expect(after.open.ipcMs).toBeNull()
  })
})
