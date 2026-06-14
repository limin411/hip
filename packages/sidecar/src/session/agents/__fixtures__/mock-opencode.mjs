#!/usr/bin/env node
// Test stand-in for `opencode run`. Echoes a deterministic reply derived from
// the message plus which flags it saw, so the bridge can be tested through
// hip's LoopAgentProvider without a real (paid) LLM call.
const args = process.argv.slice(2)
const cont = args.includes('-c') || args.includes('--continue')
const pure = args.includes('--pure')
const mi = args.findIndex((a) => a === '-m' || a === '--model')
const model = mi >= 0 ? args[mi + 1] : ''
const message = args[args.length - 1] ?? ''
process.stdout.write(
  `reply to: ${message}${cont ? ' [continue]' : ''}${pure ? ' [pure]' : ''}${model ? ` [model=${model}]` : ''}`,
)
