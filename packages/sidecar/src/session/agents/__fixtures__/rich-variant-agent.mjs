let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.type !== 'user') continue
    const out = (s) => process.stdout.write(JSON.stringify(s) + '\n')
    out({ type: 'reasoning', delta: 'thinking…' })
    out({ type: 'tool_start', id: 't2', name: 'risky', input: {} })
    out({ type: 'tool_end', id: 't2', output: 'boom', ok: false })
    out({ type: 'done' })
  }
})
