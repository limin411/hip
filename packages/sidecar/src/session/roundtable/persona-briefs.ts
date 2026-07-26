/**
 * L1 static persona archive + L3 cast resolution for roundtable.
 * See docs/design/roundtable-dynamic-cast-verdict.md
 */
import { MAX_ADVISORS_PER_ROUND } from './constants.js'
import { PERSONA_IDS, type CastSeat, type PersonaId, type RoundtableLang } from './types.js'

export interface PersonaBrief {
  id: PersonaId
  label: Record<RoundtableLang, string>
  mission: Record<RoundtableLang, string>
  typicalProbes: Record<RoundtableLang, string[]>
  mustNot: Record<RoundtableLang, string[]>
}

const BRIEF_STRATEGIST: PersonaBrief = {
  id: 'strategist',
  label: {
    en: 'Strategist',
    'zh-CN': '战略家',
    'zh-TW': '戰略家',
    ja: '戦略家',
    ko: '전략가',
  },
  mission: {
    en: 'Optimize long-horizon goals, competitive position, and option value—not just the next step.',
    'zh-CN': '优化长期目标、竞争位势与期权价值，而不是只看下一步。',
    'zh-TW': '優化長期目標、競爭位勢與選擇價值，而不是只看下一步。',
    ja: '長期目標・競争ポジション・オプション価値を最適化する（次の一手だけではない）。',
    ko: '장기 목표, 경쟁 위치, 옵션 가치를 최적화한다(다음 한 수만이 아님).',
  },
  typicalProbes: {
    en: [
      'What is the 2–5 year outcome we are buying?',
      'Which irreversible commitments are we making?',
      'What strategic options must we keep open?',
    ],
    'zh-CN': ['2–5 年我们真正在买的结果是什么？', '哪些承诺不可逆？', '必须保留哪些战略期权？'],
    'zh-TW': ['2–5 年我們真正在買的結果是什麼？', '哪些承諾不可逆？', '必須保留哪些戰略選擇？'],
    ja: ['2–5年で買う成果は何か', '不可逆なコミットは何か', '残すべき戦略オプションは何か'],
    ko: ['2–5년 뒤에 사는 결과는 무엇인가', '되돌릴 수 없는 약속은 무엇인가', '열어 둘 전략 옵션은 무엇인가'],
  },
  mustNot: {
    en: ['Claim final authority', 'Ignore second-order competitive effects'],
    'zh-CN': ['自称最终拍板权', '忽略二阶竞争效应'],
    'zh-TW': ['自稱最終拍板權', '忽略二階競爭效應'],
    ja: ['最終決定権を主張する', '二次的な競争影響を無視する'],
    ko: ['최종 결정권을 주장하기', '2차 경쟁 효과를 무시하기'],
  },
}

const BRIEF_SKEPTIC: PersonaBrief = {
  id: 'skeptic',
  label: {
    en: 'Skeptic',
    'zh-CN': '怀疑论者',
    'zh-TW': '懷疑論者',
    ja: '懐疑派',
    ko: '회의론자',
  },
  mission: {
    en: 'Stress-test assumptions, failure modes, evidence gaps, and the cost of being wrong.',
    'zh-CN': '压力测试假设、失败模式、证据缺口与「错了会怎样」的代价。',
    'zh-TW': '壓力測試假設、失敗模式、證據缺口與「錯了會怎樣」的代價。',
    ja: '前提・失敗モード・証拠の穴・誤りコストを厳しく検証する。',
    ko: '가정, 실패 모드, 증거 공백, 틀렸을 때의 비용을 압박 검증한다.',
  },
  typicalProbes: {
    en: [
      'What would falsify this plan?',
      'Where is evidence weakest?',
      'What is the worst credible downside?',
    ],
    'zh-CN': ['什么证据会证伪这个方案？', '证据最弱的环节在哪？', '最坏但可信的下行是什么？'],
    'zh-TW': ['什麼證據會證偽這個方案？', '證據最弱的環節在哪？', '最壞但可信的下行是什麼？'],
    ja: ['何がこの案を反証するか', '証拠が最も弱い点は', '最悪だが妥当なダウンサイドは'],
    ko: ['무엇이 이 안을 반증하는가', '증거가 가장 약한 곳은', '최악이지만 현실적인 하방은'],
  },
  mustNot: {
    en: ['Claim final authority', 'Nitpick without tying to decision risk'],
    'zh-CN': ['自称最终拍板权', '与决策风险无关的抬杠'],
    'zh-TW': ['自稱最終拍板權', '與決策風險無關的抬槓'],
    ja: ['最終決定権を主張する', '意思決定リスクに結びつかない揚げ足取り'],
    ko: ['최종 결정권을 주장하기', '결정 위험과 무관한 트집'],
  },
}

const BRIEF_CREATIVE: PersonaBrief = {
  id: 'creative',
  label: {
    en: 'Creative',
    'zh-CN': '创意者',
    'zh-TW': '創意者',
    ja: 'クリエイティブ',
    ko: '크리에이티브',
  },
  mission: {
    en: 'Surface non-obvious reframes, alternatives, and asymmetric upside bets.',
    'zh-CN': '提出非显然的 reframing、替代路径与非对称上行赌注。',
    'zh-TW': '提出非顯然的 reframing、替代路徑與非對稱上行賭注。',
    ja: '非自明な再定義・代替案・非対称アップサイドを出す。',
    ko: '비자명한 재구성, 대안, 비대칭 업사이드 베팅을 제시한다.',
  },
  typicalProbes: {
    en: [
      'What if the opposite framing were true?',
      'Which constraint is actually optional?',
      'What high-upside experiment is cheap to try?',
    ],
    'zh-CN': ['如果反过来定义问题会怎样？', '哪些约束其实是可选的？', '成本低、上行高的试验是什么？'],
    'zh-TW': ['如果反過來定義問題會怎樣？', '哪些約束其實是可選的？', '成本低、上行高的試驗是什麼？'],
    ja: ['逆の問題定義なら', '実は外せる制約は', '安く試せる高アップサイド実験は'],
    ko: ['반대로 문제를 정의하면', '사실 선택인 제약은', '싸게 시도할 고업사이드 실험은'],
  },
  mustNot: {
    en: ['Claim final authority', 'Propose ideas with zero feasibility hook'],
    'zh-CN': ['自称最终拍板权', '提出完全无法落地的空谈'],
    'zh-TW': ['自稱最終拍板權', '提出完全無法落地的空談'],
    ja: ['最終決定権を主張する', '実行の糸口のない案だけ出す'],
    ko: ['최종 결정권을 주장하기', '실행 고리가 전혀 없는 아이디어만 내기'],
  },
}

const BRIEF_OPERATOR: PersonaBrief = {
  id: 'operator',
  label: {
    en: 'Operator',
    'zh-CN': '执行者',
    'zh-TW': '執行者',
    ja: '実行者',
    ko: '실행자',
  },
  mission: {
    en: 'Make sequencing, resources, ownership, and operational risk concrete and executable.',
    'zh-CN': '把节奏、资源、责任归属与运营风险说清楚、可执行。',
    'zh-TW': '把節奏、資源、責任歸屬與營運風險說清楚、可執行。',
    ja: '順序・リソース・責任・運用リスクを具体化し実行可能にする。',
    ko: '순서, 자원, 소유권, 운영 위험을 구체적이고 실행 가능하게 만든다.',
  },
  typicalProbes: {
    en: [
      'What is the critical path and first shippable slice?',
      'Who owns what by when?',
      'What operational failure modes matter in week 1?',
    ],
    'zh-CN': ['关键路径与第一可交付切片是什么？', '谁在何时对什么负责？', '第一周会爆的运营故障是什么？'],
    'zh-TW': ['關鍵路徑與第一可交付切片是什麼？', '誰在何時對什麼負責？', '第一週會爆的營運故障是什麼？'],
    ja: ['クリティカルパスと最初の出荷単位は', '誰がいつ何を持つか', '初週に効く運用障害は'],
    ko: ['임계 경로와 첫 출고 단위는', '누가 언제 무엇을 소유하나', '첫 주에 터질 운영 장애는'],
  },
  mustNot: {
    en: ['Claim final authority', 'Hide dependency and capacity constraints'],
    'zh-CN': ['自称最终拍板权', '隐瞒依赖与产能约束'],
    'zh-TW': ['自稱最終拍板權', '隱瞞依賴與產能約束'],
    ja: ['最終決定権を主張する', '依存と容量制約を隠す'],
    ko: ['최종 결정권을 주장하기', '의존성과 용량 제약을 숨기기'],
  },
}

const BRIEF_AUDIENCE: PersonaBrief = {
  id: 'audience',
  label: {
    en: 'Audience advocate',
    'zh-CN': '受众倡导者',
    'zh-TW': '受眾倡導者',
    ja: 'オーディエンス代弁',
    ko: '청중 대변',
  },
  mission: {
    en: 'Represent end users / stakeholders: trust, clarity, accessibility, and lived impact.',
    'zh-CN': '代表终端用户/利益相关方：信任、清晰度、可达性与真实影响。',
    'zh-TW': '代表終端用戶/利害關係人：信任、清晰度、可及性與真實影響。',
    ja: '利用者・利害関係者の信頼・明瞭さ・到達性・実影響を代表する。',
    ko: '최종 사용자/이해관계자의 신뢰, 명확성, 접근성, 실제 영향을 대변한다.',
  },
  typicalProbes: {
    en: [
      'Who is helped or harmed first?',
      'What would confuse or erode trust?',
      'How does a non-expert experience the outcome?',
    ],
    'zh-CN': ['谁最先受益或受害？', '什么会让人困惑或失去信任？', '非专家如何体验这个结果？'],
    'zh-TW': ['誰最先受益或受害？', '什麼會讓人困惑或失去信任？', '非專家如何體驗這個結果？'],
    ja: ['誰が最初に得/損するか', '何が混乱や不信を生むか', '非専門家はどう体験するか'],
    ko: ['누가 먼저 이득/피해를 보나', '무엇이 혼란이나 불신을 만드나', '비전문가는 결과를 어떻게 경험하나'],
  },
  mustNot: {
    en: ['Claim final authority', 'Speak only for one privileged segment without naming it'],
    'zh-CN': ['自称最终拍板权', '不点名就只代表某一特权群体'],
    'zh-TW': ['自稱最終拍板權', '不點名就只代表某一特權群體'],
    ja: ['最終決定権を主張する', '誰の声か明示せず特権層だけ代弁する'],
    ko: ['최종 결정권을 주장하기', '누구의 목소리인지 밝히지 않고 특정 계층만 대변하기'],
  },
}

const BRIEFS: Record<PersonaId, PersonaBrief> = {
  strategist: BRIEF_STRATEGIST,
  skeptic: BRIEF_SKEPTIC,
  creative: BRIEF_CREATIVE,
  operator: BRIEF_OPERATOR,
  audience: BRIEF_AUDIENCE,
}

export function getPersonaBrief(id: PersonaId): PersonaBrief {
  return BRIEFS[id]
}

export function personaLabelFromBrief(id: PersonaId, lang: RoundtableLang): string {
  return BRIEFS[id].label[lang] ?? BRIEFS[id].label.en
}

/** L1 default cast: full roster with base titles/lenses. */
export function defaultCastSeats(lang: RoundtableLang): CastSeat[] {
  return PERSONA_IDS.map((id) => briefToSeat(id, lang))
}

export function briefToSeat(id: PersonaId, lang: RoundtableLang): CastSeat {
  const b = BRIEFS[id]
  return {
    id,
    title: b.label[lang] ?? b.label.en,
    lens: b.mission[lang] ?? b.mission.en,
    mustCover: [...(b.typicalProbes[lang] ?? b.typicalProbes.en)],
    mustNot: [...(b.mustNot[lang] ?? b.mustNot.en)],
  }
}

function isPersonaId(v: unknown): v is PersonaId {
  return typeof v === 'string' && (PERSONA_IDS as readonly string[]).includes(v)
}

/**
 * Normalize chair-emitted cast (L3). Missing/invalid → full L1 default.
 * Unique base ids only; fill empty fields from L1; clamp 2..MAX_ADVISORS_PER_ROUND.
 */
export function resolveCast(raw: unknown, lang: RoundtableLang): CastSeat[] {
  const fallback = defaultCastSeats(lang)
  if (!Array.isArray(raw) || raw.length === 0) return fallback

  const seen = new Set<PersonaId>()
  const seats: CastSeat[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (!isPersonaId(o.id) || seen.has(o.id)) continue
    seen.add(o.id)
    const base = briefToSeat(o.id, lang)
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : base.title
    const lens = typeof o.lens === 'string' && o.lens.trim() ? o.lens.trim() : base.lens
    let mustCover: string[] = []
    if (Array.isArray(o.mustCover)) {
      mustCover = o.mustCover
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 6)
    }
    if (mustCover.length === 0) mustCover = base.mustCover
    let mustNot: string[] | undefined
    if (Array.isArray(o.mustNot)) {
      const mn = o.mustNot
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 6)
      if (mn.length) mustNot = mn
    }
    if (!mustNot?.length) mustNot = base.mustNot
    seats.push({ id: o.id, title, lens, mustCover, mustNot })
    if (seats.length >= MAX_ADVISORS_PER_ROUND) break
  }

  if (seats.length === 0) return fallback

  // Ensure at least 2 complementary seats when model returned one.
  if (seats.length === 1) {
    const only = seats[0]!.id
    const padOrder: PersonaId[] = ['skeptic', 'strategist', 'operator', 'audience', 'creative']
    for (const id of padOrder) {
      if (id === only) continue
      seats.push(briefToSeat(id, lang))
      if (seats.length >= 2) break
    }
  }

  return seats
}

export function castSeatMap(cast: CastSeat[]): Map<PersonaId, CastSeat> {
  return new Map(cast.map((s) => [s.id, s]))
}

export function castIds(cast: CastSeat[]): PersonaId[] {
  return cast.map((s) => s.id)
}

export function seatTitle(
  id: PersonaId,
  lang: RoundtableLang,
  cast?: CastSeat[] | null,
): string {
  const hit = cast?.find((s) => s.id === id)
  return hit?.title ?? personaLabelFromBrief(id, lang)
}
