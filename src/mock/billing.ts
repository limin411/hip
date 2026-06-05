export interface MockPlan {
  name: string
  price: string
  period: string
  features: string[]
  current: boolean
}

export interface MockUsage {
  label: string
  used: number
  limit: number
  unit: string
}

export interface MockUsageHistory {
  month: string
  tokens: number
  requests: number
}

export const mockPlans: MockPlan[] = [
  {
    name: 'Pro',
    price: '¥98',
    period: '/ 月',
    features: ['无限会话', '优先响应', '并行 agent 支持', 'Git diff 渲染', '自定义模型接入'],
    current: true,
  },
  {
    name: 'Team',
    price: '¥298',
    period: '/ 月',
    features: ['Pro 全部功能', '5 人协作', '团队知识库', 'API 访问权限', '专属支持'],
    current: false,
  },
]

export const mockUsage: MockUsage[] = [
  { label: '本月 Token', used: 124_800, limit: 500_000, unit: '' },
  { label: '本月请求', used: 342, limit: 2000, unit: '' },
  { label: '并行 Agent', used: 3, limit: 5, unit: '' },
]

export const mockUsageHistory: MockUsageHistory[] = [
  { month: '2026-01', tokens: 89_000, requests: 210 },
  { month: '2026-02', tokens: 102_000, requests: 265 },
  { month: '2026-03', tokens: 156_000, requests: 380 },
  { month: '2026-04', tokens: 134_000, requests: 310 },
  { month: '2026-05', tokens: 198_000, requests: 450 },
  { month: '2026-06', tokens: 124_800, requests: 342 },
]
