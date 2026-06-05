import { useEffect, useRef } from 'react'
import { useUiStore } from '@/store/uiStore'
import { tokenize } from '@/lib/stream'
import { seedAgents } from '@/mock/agents'
import { CANNED_REPLY } from '@/mock/messages'
import type { MockMessage } from '@/mock/types'

let counter = 0
function makeId(): string {
  counter += 1
  return `gen-${counter}`
}

export function useSimulatedStream() {
  const timers = useRef<number[]>([])

  useEffect(() => {
    const t = timers.current
    return () => {
      t.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  function schedule(fn: () => void, delay: number) {
    const id = window.setTimeout(fn, delay)
    timers.current.push(id)
  }

  function send(text: string) {
    // 取消上一次未完成的流式定时器，避免两次发送的时间线交错
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current.length = 0

    const store = useUiStore.getState()
    const sessionId = store.activeSessionId

    // 1. 用户消息
    const userMsg: MockMessage = { id: makeId(), role: 'user', content: text }
    store.appendMessage(sessionId, userMsg)

    // 2. 空助手消息（流式填充）
    const assistantMsg: MockMessage = { id: makeId(), role: 'assistant', content: '' }
    store.appendMessage(sessionId, assistantMsg)

    // 3. seed agents 并切到「智能体」tab
    store.setAgents(seedAgents())
    store.setTab('agents')
    if (!store.panelOpen) store.togglePanel()

    // 4. agent 并行状态机：planner/coder/reviewer 依次 running（并填入 token 文本），最后 done
    schedule(() => {
      const s = useUiStore.getState()
      s.setAgentStatus('a1', 'running')
      s.appendAgentTokens('a1', '拆解任务边界：3 个子模块。')
    }, 300)
    schedule(() => {
      const s = useUiStore.getState()
      s.setAgentStatus('a2', 'running')
      s.appendAgentTokens('a2', '生成实现代码与组合层。')
    }, 600)
    schedule(() => {
      const s = useUiStore.getState()
      s.setAgentStatus('a3', 'running')
      s.appendAgentTokens('a3', '审查边界条件与正确性。')
    }, 900)
    schedule(() => {
      const s = useUiStore.getState()
      s.appendAgentTokens('a0', '任务较复杂，分发 3 个子 agent 并行。')
      s.setAgentStatus('a0', 'done')
      s.setAgentElapsed('a0', 1200)
    }, 1000)
    schedule(() => {
      const s = useUiStore.getState()
      s.setAgentStatus('a1', 'done')
      s.setAgentElapsed('a1', 2400)
    }, 2000)
    schedule(() => {
      const s = useUiStore.getState()
      s.setAgentStatus('a3', 'done')
      s.setAgentElapsed('a3', 1800)
    }, 2400)

    // 5. 逐字流式助手回复
    const chunks = tokenize(CANNED_REPLY, 2)
    chunks.forEach((chunk, i) => {
      schedule(() => useUiStore.getState().appendToLastAssistant(sessionId, chunk), 1000 + i * 28)
    })

    // 6. 收尾：coder done
    const total = 1000 + chunks.length * 28
    schedule(() => {
      const s = useUiStore.getState()
      s.setAgentStatus('a2', 'done')
      s.setAgentElapsed('a2', 5200)
    }, total + 200)
  }

  return { send }
}
