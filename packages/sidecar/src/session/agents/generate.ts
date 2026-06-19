import { randomUUID } from 'node:crypto'
import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { z } from 'zod'
import type { AgentConfig } from '@hip/protocol'
import { resolveApiKey } from '../../config/auth-file.js'
import { getActiveModel, cheapModelFor } from '../../config/providers.js'

const GENERATE_SYSTEM_PROMPT = `You are an agent config generator. Given a description of an AI agent's role, output a single JSON object that conforms to this TypeScript interface:

interface GeneratedAgent {
  name: string               // display name (≤40 chars)
  description?: string       // when-to-use guidance
  prompt: string             // persona system prompt (≤2000 chars, describes role, capabilities, tone, constraints)
  allowedSkills?: string[]   // skill ids this agent may use
  allowedMcpServers?: string[] // MCP server ids this agent may use
  boundModel?: { providerID: string; modelID: string } // optional pinned model
}

Rules:
- name: concise, memorable identifier for this agent role
- prompt: full system prompt; include role, expertise, output style, constraints, and when to delegate
- Only output the JSON object, no markdown fences, no explanation text
- Use valid JSON (double quotes)`

const GeneratedAgentSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  prompt: z.string(),
  allowedSkills: z.array(z.string()).optional(),
  allowedMcpServers: z.array(z.string()).optional(),
  boundModel: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional(),
})

interface GenerateDeps {
  callLLM?: (systemPrompt: string, userDescription: string) => Promise<string>
}

function buildDefaultCallLLM(modelID: string): (systemPrompt: string, userDescription: string) => Promise<string> {
  const { providerID, baseURL } = getActiveModel()
  const apiKey = resolveApiKey(providerID) ?? 'sk-missing'
  const model = new ChatOpenAI({
    model: modelID,
    apiKey,
    configuration: { baseURL },
    maxTokens: 1024,
    temperature: 0.3,
  })
  return async (systemPrompt: string, userDescription: string) => {
    const res = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userDescription)])
    return typeof res.content === 'string' ? res.content : ''
  }
}

function fallbackAgent(description: string): AgentConfig {
  return {
    id: randomUUID(),
    name: '定制智能体',
    description,
    kind: 'internal',
    command: '',
    args: [],
    prompt: `你是一个有用的 AI 智能体。\n\n${description}`,
    enabled: true,
  }
}

/** Call the LLM to generate an AgentConfig from a natural-language description.
 *  Uses a cheap completion model by default. On any parse/validation failure,
 *  falls back to a generic internal agent so the caller always gets a valid config. */
export async function generateAgentConfig(
  description: string,
  model?: string,
  deps?: GenerateDeps,
): Promise<AgentConfig> {
  if (!description.trim()) return fallbackAgent(description)

  const active = getActiveModel()
  const modelID = model ?? cheapModelFor(active.providerID, active.modelID)
  const callLLM = deps?.callLLM ?? buildDefaultCallLLM(modelID)

  let raw: string
  try {
    raw = await callLLM(GENERATE_SYSTEM_PROMPT, description)
  } catch {
    return fallbackAgent(description)
  }

  // Strip common markdown fences
  let json = raw.trim()
  if (json.startsWith('```')) {
    const end = json.indexOf('\n')
    json = json.slice(end + 1).trim()
    if (json.endsWith('```')) json = json.slice(0, -3).trim()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return fallbackAgent(description)
  }

  const result = GeneratedAgentSchema.safeParse(parsed)
  if (!result.success) return fallbackAgent(description)

  const { name, description: agentDesc, prompt, allowedSkills, allowedMcpServers, boundModel } = result.data

  return {
    id: randomUUID(),
    name,
    description: agentDesc ?? description,
    kind: 'internal',
    command: '',
    args: [],
    prompt,
    enabled: true,
    ...(allowedSkills && allowedSkills.length > 0 ? { allowedSkills } : {}),
    ...(allowedMcpServers && allowedMcpServers.length > 0 ? { allowedMcpServers } : {}),
    ...(boundModel ? { boundModel } : {}),
  }
}
