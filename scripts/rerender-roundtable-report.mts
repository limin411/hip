/**
 * Rebuild HTML reports for a scratch session from supervisor markdown + optional agent_runs.
 * Usage: yarn tsx scripts/rerender-roundtable-report.mts [sessionId]
 *
 * Expects /tmp/rt-sup.json, /tmp/rt-user.json, /tmp/rt-runs.json (sqlite3 -json dumps).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildRoundtableReportBundle } from '../packages/sidecar/src/session/roundtable/report.ts'
import { pickReportSpeechContent } from '../packages/sidecar/src/session/roundtable/report-prose.ts'
import { parseSpeechEnvelope } from '../packages/sidecar/src/session/roundtable/speech-schema.ts'
import { edgesFromEnvelope, dedupeEdges } from '../packages/sidecar/src/session/roundtable/edges.ts'
import type {
  PersonaId,
  RoundtableEdgeResult,
  SpeechRecord,
} from '../packages/sidecar/src/session/roundtable/types.ts'

const PERSONA_LABEL_TO_ID: Record<string, PersonaId> = {
  战略家: 'strategist',
  怀疑论者: 'skeptic',
  创意者: 'creative',
  执行者: 'operator',
  受众倡导者: 'audience',
  Strategist: 'strategist',
  Skeptic: 'skeptic',
  Creative: 'creative',
  Operator: 'operator',
  Audience: 'audience',
  'Audience advocate': 'audience',
}

function parseSupervisorMarkdown(md: string): {
  agenda: string[]
  rationale: string
  rounds: Array<{
    round: number
    focus: string
    speeches: SpeechRecord[]
    stage: { round: number; agreed: string[]; open: string[] }
  }>
  decision?: { decision: string; residual: string[]; nextSteps: string[] }
} {
  const text = md.replace(/\r\n/g, '\n')

  let rationale = ''
  const why = text.match(/-\s*为何:\s*(.+)/)
  if (why) rationale = why[1]!.trim()

  const agenda: string[] = []
  const agendaBlock = text.match(/-\s*议程:\s*\n((?:\d+\..+\n?)+)/)
  if (agendaBlock) {
    for (const line of agendaBlock[1]!.split('\n')) {
      const m = line.match(/^\d+\.\s*(.+)/)
      if (m) agenda.push(m[1]!.trim())
    }
  }

  const rounds: Array<{
    round: number
    focus: string
    speeches: SpeechRecord[]
    stage: { round: number; agreed: string[]; open: string[] }
  }> = []

  const roundRe =
    /##\s*第\s*(\d+)\s*轮\s*[—–-]\s*([^\n]+)\n([\s\S]*?)(?=\n##\s*第\s*\d+\s*轮|\n##\s*决策|\n##\s*残留|\n##\s*后续|$)/g
  let rm: RegExpExecArray | null
  while ((rm = roundRe.exec(text)) !== null) {
    const round = Number(rm[1])
    const focus = rm[2]!.trim()
    const body = rm[3] || ''
    const speeches: SpeechRecord[] = []

    // **战略家:** content  (until next **role:** or ### or ##)
    const speechRe =
      /\*\*(战略家|怀疑论者|创意者|执行者|受众倡导者|Strategist|Skeptic|Creative|Operator|Audience(?: advocate)?):\*\*\s*([\s\S]*?)(?=\n\*\*(?:战略家|怀疑论者|创意者|执行者|受众倡导者|Strategist|Skeptic|Creative|Operator|Audience)|(?:\n###|\n##\s)|$)/g
    let sm: RegExpExecArray | null
    while ((sm = speechRe.exec(body)) !== null) {
      const id = PERSONA_LABEL_TO_ID[sm[1]!.trim()]
      if (!id) continue
      speeches.push({ speaker: id, content: sm[2]!.trim() })
    }

    const agreed: string[] = []
    const open: string[] = []
    const agreedM = body.match(/\*\*已共识:\*\*\s*\n((?:[-*]\s+.+\n?)+)/)
    if (agreedM) {
      for (const line of agreedM[1]!.split('\n')) {
        const m = line.match(/^[-*]\s+(.+)/)
        if (m) agreed.push(m[1]!.trim())
      }
    }
    const openM = body.match(/\*\*仍开放:\*\*\s*\n((?:[-*]\s+.+\n?)+)/)
    if (openM) {
      for (const line of openM[1]!.split('\n')) {
        const m = line.match(/^[-*]\s+(.+)/)
        if (m) open.push(m[1]!.trim())
      }
    }

    rounds.push({
      round,
      focus,
      speeches,
      stage: { round, agreed, open },
    })
  }

  let decision = ''
  const decM = text.match(
    /##\s*决策（hip）\s*\n([\s\S]*?)(?=\n##\s*残留|\n##\s*后续|\n\*\*圆桌报告|$)/,
  )
  if (decM) decision = decM[1]!.trim()

  const residual: string[] = []
  const resM = text.match(/##\s*残留分歧\s*\n((?:[-*]\s+.+\n?)+)/)
  if (resM) {
    for (const line of resM[1]!.split('\n')) {
      const m = line.match(/^[-*]\s+(.+)/)
      if (m) residual.push(m[1]!.trim())
    }
  }
  const nextSteps: string[] = []
  const nextM = text.match(/##\s*后续步骤\s*\n((?:[-*\d.]+\s+.+\n?)+)/)
  if (nextM) {
    for (const line of nextM[1]!.split('\n')) {
      const m = line.match(/^[-*\d.]+\s+(.+)/)
      if (m) nextSteps.push(m[1]!.trim())
    }
  }

  return {
    agenda,
    rationale,
    rounds,
    decision: decision
      ? { decision, residual, nextSteps }
      : undefined,
  }
}

async function main() {
  const sessionId = process.argv[2] || 'Fi2tHa2y7PaLxvfE92ZdY'
  const cwd = path.join(process.env.HOME!, '.hip/scratch', sessionId)
  const runs = JSON.parse(await fs.readFile('/tmp/rt-runs.json', 'utf8')) as Array<{
    agent_id: string
    output: string
  }>
  const user = JSON.parse(await fs.readFile('/tmp/rt-user.json', 'utf8')) as Array<{ content: string }>
  const sup = JSON.parse(await fs.readFile('/tmp/rt-sup.json', 'utf8')) as Array<{ output: string }>

  let issue = (user[0]?.content || '').replace(/<!--[\s\S]*?-->/g, '').trim()
  const lines = issue.split('\n')
  const bodyStart = lines.findIndex((l) => l.includes('高度自主') || l.includes('法律主体'))
  if (bodyStart > 0) issue = lines.slice(bodyStart).join('\n').trim()
  issue = issue.slice(0, 2500) || '高度自主智能体法律主体议题'

  const parsed = parseSupervisorMarkdown(sup[0]?.output || '')
  // Enrich with full agent_run prose when available (last speech per seat — used only if markdown speech is short)
  const lastBySeat = new Map<PersonaId, string>()
  for (const r of runs) {
    const persona = r.agent_id.replace('roundtable:', '') as PersonaId
    lastBySeat.set(persona, r.output || '')
  }

  const allEdges: RoundtableEdgeResult[] = []
  for (const r of parsed.rounds) {
    for (const sp of r.speeches) {
      // Prefer longer agent raw if this is the last round speech for that seat
      const raw = lastBySeat.get(sp.speaker)
      if (raw && raw.length > sp.content.length * 1.3) {
        const env = parseSpeechEnvelope(raw)
        const content = pickReportSpeechContent(raw, env.prose)
        if (content.length > sp.content.length) sp.content = content
        allEdges.push(...edgesFromEnvelope(r.round, sp.speaker, env))
      } else {
        const env = parseSpeechEnvelope(sp.content)
        allEdges.push(...edgesFromEnvelope(r.round, sp.speaker, env))
      }
    }
  }

  // Also harvest edges from all agent runs (may duplicate; dedupe later)
  for (const r of runs) {
    const persona = r.agent_id.replace('roundtable:', '') as PersonaId
    const env = parseSpeechEnvelope(r.output || '')
    // Unknown round → attach to last round
    const round = parsed.rounds.length || 1
    allEdges.push(...edgesFromEnvelope(round, persona, env))
  }

  const edges = dedupeEdges(allEdges)
  const bundle = buildRoundtableReportBundle({
    issue,
    language: 'zh-CN',
    agenda: parsed.agenda.length
      ? parsed.agenda
      : ['界定现实与场景', '权衡价值与代价', '设计治理路径'],
    rationale: parsed.rationale || '法律/伦理/治理多维权衡',
    rounds: parsed.rounds,
    decision: parsed.decision,
    edges,
    generatedAt: new Date().toISOString(),
  })

  for (const f of bundle) {
    const p = path.join(cwd, f.filename)
    await fs.writeFile(p, f.html, 'utf8')
    console.log('wrote', f.filename, f.html.length)
  }
  const main = bundle[0]!.html
  console.log({
    rounds: parsed.rounds.length,
    speeches: parsed.rounds.reduce((n, r) => n + r.speeches.length, 0),
    edges: edges.length,
    debate: (main.match(/debate-diagram/g) || []).length,
    storyline: main.includes('class="storyline"'),
    strong: (main.match(/<strong>/g) || []).length,
    ul: (main.match(/prose-ul/g) || []).length,
    bareMarker: main.includes('id="m-rebut"'),
    fold: (main.match(/prose-fold/g) || []).length,
    decisionCards: (main.match(/decision-card/g) || []).length,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
