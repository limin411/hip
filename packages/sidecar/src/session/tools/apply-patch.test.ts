import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { buildFileTools } from './file.js'

describe('apply_patch + edit_file (P2)', () => {
  let dir: string
  let tools: ReturnType<typeof buildFileTools>

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hip-patch-'))
    tools = buildFileTools(async (p) => path.join(dir, p.replace(/^\//, '')), dir, [], false, dir)
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('apply_patch adds a file', async () => {
    const patch = `*** Begin Patch
*** Add File: hello.txt
+hello world
*** End Patch`
    const out = await tools.applyPatch.invoke({ patch })
    expect(out).toContain('added')
    const body = await fs.readFile(path.join(dir, 'hello.txt'), 'utf8')
    expect(body).toContain('hello world')
  })

  it('apply_patch updates a file with context lines', async () => {
    await fs.writeFile(path.join(dir, 'a.ts'), 'const x = 1\nconst y = 2\n', 'utf8')
    const patch = `*** Begin Patch
*** Update File: a.ts
 const x = 1
-const y = 2
+const y = 3
*** End Patch`
    const out = await tools.applyPatch.invoke({ patch })
    expect(out).toContain('updated')
    expect(await fs.readFile(path.join(dir, 'a.ts'), 'utf8')).toContain('const y = 3')
  })

  it('edit_file rejects non-unique oldString without replaceAll', async () => {
    await fs.writeFile(path.join(dir, 'b.ts'), 'aa\naa\n', 'utf8')
    const out = await tools.editFile.invoke({ path: 'b.ts', oldString: 'aa', newString: 'bb' })
    expect(String(out)).toMatch(/multiple locations/i)
  })

  it('edit_file multi edits array', async () => {
    await fs.writeFile(path.join(dir, 'c.ts'), 'one\ntwo\n', 'utf8')
    const out = await tools.editFile.invoke({
      path: 'c.ts',
      edits: [
        { oldString: 'one', newString: '1' },
        { oldString: 'two', newString: '2' },
      ],
    })
    expect(String(out)).toContain('edited')
    expect(await fs.readFile(path.join(dir, 'c.ts'), 'utf8')).toBe('1\n2\n')
  })
})
