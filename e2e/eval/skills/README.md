# e2e/eval/skills — 技能路由与行为评估

免费回归（`yarn test`，无 LLM）：

- `router.eval.test.ts` — 对 **真实内置技能目录**（`packages/product-content/meta.json` + `ops/meta.json`）跑路由守卫：正样例必须 top-1 命中、负样例弱匹配 < 0.15、技能描述两两无碰撞（≥0.75 相似度报错）。
- `cases-schema.test.ts` — cases/*.json 的 schema 校验。

付费行为评估（longrun gate）：

- `runner.ts` — 对每个 case 的 `evals[]` 创建一次性 git 仓库，经 attach CLI 跑 headless 会话，按 `expectations[]` 判分。入口：`node --import tsx e2e/eval/skills/runner.ts`（需要运行中的 hip app）。

## 添加新内置技能时的约定

1. 在 `packages/product-content/` 建 `meta.json`（或 `ops/meta.json`）。
2. 新增 `cases/<skillId>.json`，格式见 `types.ts`（schemaVersion 1）：
   - `trigger.positive`：应路由到该技能的查询（会被断言 top-1）；
   - `trigger.negative`：不应路由到该技能的查询（会被断言弱匹配）；
   - `evals[]`（可选）：行为样例 `{ id, prompt, expectations[], kind }`。
3. `yarn product:content --check` 会强制第 2 步（`scripts/generate-product-content.mjs` 的 `checkSkillEvalCases`），CI 同路径拦截。

## 已知限制

路由相似度是**词法**的（见 `packages/sidecar/src/session/skills/router.ts` 顶部说明）：中文查询不会命中英文描述。跨语言路由由模型在 system-prompt Skills 清单上自行判断，不在本守卫保证范围。
