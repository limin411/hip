import type { PersonaId, RoundtableLang } from './types.js'
import { PERSONA_IDS } from './types.js'

export const COUNCIL_AGENT_PREFIX = 'roundtable:'

export function councilAgentId(persona: PersonaId): string {
  return `${COUNCIL_AGENT_PREFIX}${persona}`
}

export function personaFromAgentId(agentId: string): PersonaId | null {
  if (!agentId.startsWith(COUNCIL_AGENT_PREFIX)) return null
  const p = agentId.slice(COUNCIL_AGENT_PREFIX.length) as PersonaId
  return (PERSONA_IDS as readonly string[]).includes(p) ? p : null
}

export function isCouncilAgentId(agentId: string): boolean {
  return personaFromAgentId(agentId) != null
}

const NAMES: Record<RoundtableLang, Record<PersonaId, string>> = {
  en: {
    strategist: 'Strategist',
    skeptic: 'Skeptic',
    creative: 'Creative',
    operator: 'Operator',
    audience: 'Audience advocate',
  },
  'zh-CN': {
    strategist: '战略家',
    skeptic: '怀疑论者',
    creative: '创意者',
    operator: '执行者',
    audience: '受众倡导者',
  },
  'zh-TW': {
    strategist: '戰略家',
    skeptic: '懷疑論者',
    creative: '創意者',
    operator: '執行者',
    audience: '受眾倡導者',
  },
  ja: {
    strategist: '戦略家',
    skeptic: '懐疑派',
    creative: 'クリエイティブ',
    operator: '実行者',
    audience: 'オーディエンス代弁',
  },
  ko: {
    strategist: '전략가',
    skeptic: '회의론자',
    creative: '크리에이티브',
    operator: '실행자',
    audience: '청중 대변',
  },
}

export function councilDisplayName(persona: PersonaId, lang: RoundtableLang): string {
  return NAMES[lang][persona] ?? persona
}
