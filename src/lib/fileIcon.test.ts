import { describe, it, expect } from 'vitest'
import { fileIconForName } from './fileIcon'

describe('fileIconForName', () => {
  it('maps common source extensions to distinct colors', () => {
    const ts = fileIconForName('src/main.ts')
    const js = fileIconForName('lib/app.js')
    const py = fileIconForName('script.py')
    const rs = fileIconForName('lib.rs')
    expect(ts.className).toMatch(/sky/)
    expect(js.className).toMatch(/amber/)
    expect(py.className).toMatch(/blue/)
    expect(rs.className).toMatch(/orange/)
    expect(ts.className).not.toBe(js.className)
  })

  it('uses basename specials over extension', () => {
    const pkg = fileIconForName('/repo/package.json')
    const plain = fileIconForName('/repo/data.json')
    expect(pkg.className).toMatch(/red/)
    expect(plain.className).toMatch(/yellow/)
    expect(pkg.className).not.toBe(plain.className)
  })

  it('recognizes Dockerfile without extension', () => {
    const d = fileIconForName('Dockerfile')
    expect(d.className).toMatch(/sky/)
  })

  it('matches compound tails like d.ts and test.tsx', () => {
    const dts = fileIconForName('types/index.d.ts')
    const test = fileIconForName('Foo.test.tsx')
    expect(dts.className).toMatch(/sky/)
    expect(test.className).toMatch(/cyan/)
  })

  it('handles image / archive / shell families', () => {
    expect(fileIconForName('logo.png').className).toMatch(/fuchsia/)
    expect(fileIconForName('dist.zip').className).toMatch(/amber/)
    expect(fileIconForName('run.sh').className).toMatch(/emerald/)
  })

  it('falls back for unknown extensions', () => {
    const u = fileIconForName('mystery.xyzzy')
    expect(u.className).toBe('text-ink-tertiary')
  })

  it('accepts bare names and empty input safely', () => {
    expect(fileIconForName('').className).toBe('text-ink-tertiary')
    expect(fileIconForName('README.md').className).toMatch(/slate/)
  })
})
