const RS = '\x1e'
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf(RS)) >= 0) {
    const req = buf.slice(0, i).replace(/^\n+|\n+$/g, '')
    buf = buf.slice(i + 1)
    if (!req) continue
    const model = process.env.HIP_MODEL ? ` [model=${process.env.HIP_MODEL}]` : ''
    process.stdout.write(`echo: ${req}${model}` + RS)
  }
})
