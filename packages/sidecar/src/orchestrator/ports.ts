import type { AgentId, NodeId, NodeOutput, RunState, WorkflowDef, OrchestratorEvent } from '@hip/protocol'

export interface AgentRunRequest { runId: string; nodeId: NodeId; agentId: AgentId; input: NodeOutput }

/** 跑一个节点 = 一个外部 agent 的一整个回合。真实实现(后续切片)包 createAgentProvider().runTurn。 */
export interface AgentRunner {
  run(req: AgentRunRequest, signal: AbortSignal): Promise<NodeOutput>
}
export interface WorkflowStore {
  saveDef(def: WorkflowDef): Promise<void>
  loadDef(id: string): Promise<WorkflowDef | null>
  saveRun(run: RunState): Promise<void>
  loadRun(runId: string): Promise<RunState | null>
  /** Append one event to the event log. Optional; not all stores implement event-level persistence. */
  appendEvent?(runId: string, event: OrchestratorEvent): void
}
export interface OrchestratorEventSink { emit(e: OrchestratorEvent): void }
export interface OrchestratorPorts { agentRunner: AgentRunner; store?: WorkflowStore; eventSink?: OrchestratorEventSink }

/** 脚本化的 Fake runner:按 nodeId 返回产物;可注入延迟、抛错;尊重 signal。 */
export interface FakeScript { [nodeId: string]: { text?: string; data?: unknown; delayMs?: number; throws?: string } }
export class FakeAgentRunner implements AgentRunner {
  public readonly calls: AgentRunRequest[] = []
  constructor(private readonly script: FakeScript = {}) {}
  async run(req: AgentRunRequest, signal: AbortSignal): Promise<NodeOutput> {
    this.calls.push(req)
    // 尊重一个 *已经* aborted 的 signal:addEventListener('abort') 只在未来 abort 时触发,
    // 若调用方在 run 之前就 abort 了(ac.abort(); run(...)),delayMs 路径会空等到期再正常 resolve,
    // 静默吞掉取消。这里在顶部直接拒绝,覆盖延迟与非延迟两条路径。
    if (signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
    const s = this.script[req.nodeId] ?? {}
    if (s.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, s.delayMs)
        signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e) }, { once: true })
      })
    }
    if (s.throws) throw new Error(s.throws)
    // 默认回显:把输入透传,便于断言数据流
    return { text: s.text ?? req.input.text, data: s.data }
  }
}
export class InMemoryWorkflowStore implements WorkflowStore {
  private defs = new Map<string, WorkflowDef>()
  private runs = new Map<string, RunState>()
  private events = new Map<string, OrchestratorEvent[]>()
  async saveDef(def: WorkflowDef) { this.defs.set(def.id, structuredClone(def)) }
  async loadDef(id: string) { const d = this.defs.get(id); return d ? structuredClone(d) : null }
  async saveRun(run: RunState) { this.runs.set(run.runId, structuredClone(run)) }
  async loadRun(runId: string) { const r = this.runs.get(runId); return r ? structuredClone(r) : null }
  appendEvent(runId: string, event: OrchestratorEvent): void {
    const evts = this.events.get(runId) ?? []
    evts.push(event)
    this.events.set(runId, evts)
  }
}
export class CollectingEventSink implements OrchestratorEventSink {
  public readonly events: OrchestratorEvent[] = []
  emit(e: OrchestratorEvent) { this.events.push(e) }
  ofType<T extends OrchestratorEvent['type']>(t: T) { return this.events.filter((e) => e.type === t) as Extract<OrchestratorEvent, { type: T }>[] }
}
