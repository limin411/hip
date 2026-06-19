#!/usr/bin/env node
/**
 * hip-acp-template.mjs — ACP Agent 最小参考实现
 *
 * JSON-RPC 2.0 over stdio，每行一个 JSON 对象（兼容 NDJSON）。
 * 不依赖任何 npm 包，纯 Node.js 内置模块即可运行。
 *
 * 运行: echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | node scripts/hip-acp-template.mjs
 *
 * ── 【用户自定义指南】 ───────────────────────────────────────────
 * 1. 接入 LLM 模型
 *    在 session/prompt 分支中，将 echo 逻辑替换为真实的 LLM API 调用
 *    （OpenAI / Anthropic / 本地模型等），将返回文本通过
 *    notify('session/update', { delta: { text: ... } }) 流式发送。
 *
 * 2. 添加工具支持
 *    在 initialize 返回的 agentCapabilities 中声明 tools 字段，
 *    在 session/update 中发送 tool_call delta，宿主完成工具调用后
 *    会通过又一个 session/prompt 请求返回 tool_result。
 *
 * 3. 权限控制
 *    检查 session/prompt 的 params 中的 allowedSkills / allowedMcpServers
 *    字段，据此过滤可用的工具和 MCP 服务。
 *
 * 4. 读取配置
 *    通过 process.env 读取环境变量（如 process.env.OPENAI_API_KEY），
 *    或通过 fs.readFileSync 读取 ~/.hip/config/auth.json。
 *
 * 5. 生产加固（本模板为最小实现，未包含）
 *    - try/catch 包裹全部逻辑，防止 Agent 崩溃
 *    - 心跳/keepalive：定期发送空通知防止超时
 *    - NDJSON 流式解析：支持跨行的 JSON（当前按行解析）
 * ────────────────────────────────────────────────────────────────
 */

import { createInterface } from 'node:readline';

/** 发送 JSON-RPC 2.0 响应 */
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

/** 发送 JSON-RPC 2.0 通知（无 id 字段） */
function notify(method, params) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

/** 从 ACP prompt 参数中提取文本内容 */
function extractText(params) {
  return params?.prompt?.find((p) => p.type === 'text')?.text ?? '';
}

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; } // 跳过非法行

  // ── initialize：握手，返回协议版本和 Agent 能力 ────────────
  if (req.method === 'initialize') {
    // ★ agentCapabilities: 在此声明你的 Agent 能力
    //    tools: 声明可用工具列表；mcpServers: 声明 MCP 服务
    // ★ authMethods: 声明支持的认证方式（'oauth2'、'api_key' 等）
    respond(req.id, {
      protocolVersion: 1,
      agentCapabilities: { promptCapabilities: { text: true } },
      authMethods: [],
    });
    return;
  }

  // ── session/new：创建新会话 ──────────────────────────────────
  if (req.method === 'session/new') {
    // ★ 在此创建真实会话上下文（数据库连接、内存存储等）
    respond(req.id, { sessionId: 'demo-session-1' });
    return;
  }

  // ── session/prompt：处理用户提示（核心方法） ─────────────────
  if (req.method === 'session/prompt') {
    const text = extractText(req.params);
    // ★ 核心自定义点：将 text 发送给你的 LLM，流式返回 delta
    //
    // 示例（OpenAI 兼容 API）：
    //   const stream = await fetch('https://api.openai.com/v1/chat/completions', {
    //     method: 'POST',
    //     headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    //     body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: text }], stream: true }),
    //   });
    //   for await (const chunk of parseSSE(stream)) { ... }

    // Demo：逐字符回显用户输入（模拟流式输出）
    for (const char of text) {
      notify('session/update', { delta: { text: char } });
    }
    // ★ 如需工具调用，在 endTurn 前发送 tool_call delta：
    //   notify('session/update', { delta: { tool_call: { id: 't1', name: 'read_file', arguments: '{}' } } });
    notify('session/update', { endTurn: true });
    respond(req.id, {});
    return;
  }

  // ── session/close：关闭会话 ───────────────────────────────────
  if (req.method === 'session/close') {
    // ★ 在此清理会话资源（关闭数据库连接、释放内存等）
    respond(req.id, {});
    return;
  }

  // ── session/cancel：取消正在进行的操作 ────────────────────────
  if (req.method === 'session/cancel') {
    // ★ 在此中断正在进行的 LLM 调用（如 AbortController.abort()）
    respond(req.id, {});
    return;
  }

  // 未知方法：返回空成功（宽松处理，生产环境建议返回错误）
  respond(req.id, {});
});
