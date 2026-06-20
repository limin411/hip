export interface ShouldPlanOptions {
  forcePlan?: boolean
  disablePlan?: boolean
}

const MULTI_STEP_KEYWORDS = [
  'first',
  'then',
  'next',
  'finally',
  'step',
  'steps',
  'todo',
  'plan',
  '首先',
  '然后',
  '接着',
  '最后',
  '步骤',
]

const FILE_INTENT_KEYWORDS = [
  'create',
  'write',
  'edit',
  'modify',
  'update',
  'add',
  'delete',
  'remove',
  'refactor',
  'implement',
  '创建',
  '写入',
  '编辑',
  '修改',
  '更新',
  '添加',
  '删除',
  '重构',
  '实现',
]

export function shouldPlan(userMessage: string, options: ShouldPlanOptions = {}): boolean {
  if (options.disablePlan) {
    return false
  }
  if (options.forcePlan) {
    return true
  }

  const normalized = userMessage.trim().toLowerCase()
  if (normalized.length > 200) {
    return true
  }

  const hasMultiStepKeyword = MULTI_STEP_KEYWORDS.some((keyword) => normalized.includes(keyword))
  if (hasMultiStepKeyword) {
    return true
  }

  const hasFileIntent = FILE_INTENT_KEYWORDS.some((keyword) => normalized.includes(keyword))
  if (hasFileIntent) {
    const pathLikeMatches = normalized.match(/(?:[\w\-]+\/)+[\w\-]+(?:\.[\w\-]+)?/g) ?? []
    const distinctPaths = new Set(pathLikeMatches)
    if (distinctPaths.size >= 2) {
      return true
    }
  }

  return false
}
