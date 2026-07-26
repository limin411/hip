import type { PersonaId, RoundtableEvent, RoundtableLang } from './types.js'
import { personaLabel } from './prompts.js'

/** Convert a roundtable event into a markdown chunk for the user transcript. */
export function renderEventMarkdown(ev: RoundtableEvent, lang: RoundtableLang): string {
  switch (ev.kind) {
    case 'roundtable.normal_reply':
      return ev.content.trim() + '\n'
    case 'roundtable.route':
      if (!ev.convene) return ''
      return langHeading(lang, 'convene', ev.reason)
    case 'roundtable.plan':
      return renderPlan(ev, lang)
    case 'roundtable.round_open':
      return `\n## ${roundTitle(lang, ev.round)} — ${ev.focus}\n\n`
    case 'roundtable.speech':
      return `**${personaLabel(ev.speaker as PersonaId, lang)}:** ${ev.content.trim()}\n\n`
    case 'roundtable.stage':
      return renderStage(ev, lang)
    case 'roundtable.decide':
      return renderDecide(ev, lang)
    case 'roundtable.done':
    case 'roundtable.aborted':
      return ''
    default:
      return ''
  }
}

function renderPlan(
  ev: Extract<RoundtableEvent, { kind: 'roundtable.plan' }>,
  lang: RoundtableLang,
): string {
  const title =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '## 会议规划'
      : lang === 'ja'
        ? '## 会議計画'
        : lang === 'ko'
          ? '## 회의 계획'
          : '## Meeting plan'
  const roundsLabel =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '计划回合数'
      : lang === 'ja'
        ? '予定ラウンド'
        : lang === 'ko'
          ? '예정 라운드'
          : 'Rounds planned'
  const why =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '为何'
      : lang === 'ja'
        ? '理由'
        : lang === 'ko'
          ? '이유'
          : 'Why'
  const agenda =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '议程'
      : lang === 'ja'
        ? 'アジェンダ'
        : lang === 'ko'
          ? '안건'
          : 'Agenda'
  const castLabel =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '本场席位'
      : lang === 'ja'
        ? 'キャスト'
        : lang === 'ko'
          ? '캐스트'
          : 'Cast'
  const lines = ev.agenda.map((a, i) => `${i + 1}. ${a}`).join('\n')
  let body = `${title}\n- ${roundsLabel}: ${ev.rounds}\n- ${why}: ${ev.rationale}\n- ${agenda}:\n${lines}\n`
  if (ev.cast?.length) {
    const castLines = ev.cast.map((s) => `- **${s.title}** (\`${s.id}\`): ${s.lens}`).join('\n')
    body += `- ${castLabel}:\n${castLines}\n`
  }
  return body
}

function renderStage(
  ev: Extract<RoundtableEvent, { kind: 'roundtable.stage' }>,
  lang: RoundtableLang,
): string {
  const h =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '### 阶段性结论（hip）'
      : lang === 'ja'
        ? '### 段階結論 (hip)'
        : lang === 'ko'
          ? '### 단계 결론 (hip)'
          : '### Stage conclusion (hip)'
  const agreed =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '已共识'
      : lang === 'ja'
        ? '合意'
        : lang === 'ko'
          ? '합의'
          : 'Agreed'
  const open =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '仍开放'
      : lang === 'ja'
        ? '未決'
        : lang === 'ko'
          ? '미결'
          : 'Open'
  const next =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '下一焦点'
      : lang === 'ja'
        ? '次の焦点'
        : lang === 'ko'
          ? '다음 초점'
          : 'Next focus'
  const bullets = (xs: string[]) =>
    xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- —'
  let body = `${h}\n- **${agreed}:**\n${bullets(ev.agreed)}\n- **${open}:**\n${bullets(ev.open)}\n`
  if (ev.earlyExit) {
    const reason = ev.earlyExitReason ?? 'early close'
    body +=
      lang === 'zh-CN' || lang === 'zh-TW'
        ? `- **提前结束:** ${reason}\n`
        : `- **Early exit:** ${reason}\n`
  } else if (ev.nextFocus) {
    body += `- **${next}:** ${ev.nextFocus}\n`
  }
  return body + '\n'
}

function renderDecide(
  ev: Extract<RoundtableEvent, { kind: 'roundtable.decide' }>,
  lang: RoundtableLang,
): string {
  const v =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '## 核心结论（hip）'
      : lang === 'ja'
        ? '## 核心結論 (hip)'
        : lang === 'ko'
          ? '## 핵심 결론 (hip)'
          : '## Core verdict (hip)'
  const d =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '## 决策（hip）'
      : lang === 'ja'
        ? '## 決定 (hip)'
        : lang === 'ko'
          ? '## 결정 (hip)'
          : '## Decision (hip)'
  const t =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '## 关键取舍'
      : lang === 'ja'
        ? '## 主なトレードオフ'
        : lang === 'ko'
          ? '## 핵심 트레이드오프'
          : '## Key tradeoffs'
  const r =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '## 残留分歧'
      : lang === 'ja'
        ? '## 残る対立'
        : lang === 'ko'
          ? '## 잔여 이견'
          : '## Residual disagreements'
  const n =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '## 后续步骤'
      : lang === 'ja'
        ? '## 次のステップ'
        : lang === 'ko'
          ? '## 다음 단계'
          : '## Next steps'
  const residual = ev.residual.length
    ? ev.residual.map((x) => `- ${x}`).join('\n')
    : '- —'
  const steps = ev.nextSteps.length
    ? ev.nextSteps.map((x, i) => `${i + 1}. ${x}`).join('\n')
    : '1. —'
  const tradeoffs =
    ev.keyTradeoffs?.length
      ? `\n${t}\n${ev.keyTradeoffs.map((x) => `- ${x}`).join('\n')}\n`
      : ''
  const conf =
    ev.confidence
      ? lang === 'zh-CN' || lang === 'zh-TW'
        ? `\n*置信度: ${ev.confidence}*\n`
        : `\n*Confidence: ${ev.confidence}*\n`
      : ''
  const verdict = (ev.verdict || '').trim() || ev.decision.trim().split('\n')[0] || ''
  return `\n${v}\n${verdict}\n${conf}\n${d}\n${ev.decision.trim()}\n${tradeoffs}\n${r}\n${residual}\n\n${n}\n${steps}\n`
}

function roundTitle(lang: RoundtableLang, round: number): string {
  if (lang === 'zh-CN' || lang === 'zh-TW') return `第 ${round} 轮`
  if (lang === 'ja') return `ラウンド ${round}`
  if (lang === 'ko') return `라운드 ${round}`
  return `Round ${round}`
}

function langHeading(lang: RoundtableLang, _kind: 'convene', reason?: string): string {
  const line =
    lang === 'zh-CN' || lang === 'zh-TW'
      ? '正在召开圆桌会议…'
      : lang === 'ja'
        ? '円卓会議を開催します…'
        : lang === 'ko'
          ? '원탁 회의를 시작합니다…'
          : 'Convening the roundtable…'
  return reason ? `*${line}* (${reason})\n\n` : `*${line}*\n\n`
}
