import { describe, expect, it } from 'vitest'
import {
  commandFromRunScriptInput,
  isDeferredPanelOpenPath,
  isEphemeralRunScriptPath,
  isWriteLikeTool,
  pathFromToolInput,
  runScriptReferencesPath,
  shouldAutoFollowWrite,
  writeFollowPanelPolicy,
} from './writeFollow'

describe('writeFollow (P1)', () => {
  it('detects write-like tools', () => {
    expect(isWriteLikeTool('write_file')).toBe(true)
    expect(isWriteLikeTool('edit_file')).toBe(true)
    expect(isWriteLikeTool('apply_patch')).toBe(true)
    expect(isWriteLikeTool('read_file')).toBe(false)
    expect(isWriteLikeTool('run_script')).toBe(false)
  })

  it('parses path from write_file input', () => {
    expect(pathFromToolInput('write_file', JSON.stringify({ path: '/src/a.ts' }))).toBe('/src/a.ts')
    expect(pathFromToolInput('edit_file', JSON.stringify({ file_path: 'b.ts' }))).toBe('b.ts')
  })

  it('parses path from apply_patch body', () => {
    const patch = '*** Begin Patch\n*** Update File: packages/foo/bar.ts\n@@\n-a\n+b\n*** End Patch\n'
    expect(pathFromToolInput('apply_patch', patch)).toBe('packages/foo/bar.ts')
  })

  it('gates auto-follow on flags and status', () => {
    expect(
      shouldAutoFollowWrite({
        autoFollow: true,
        followPaused: false,
        isActiveSession: true,
        toolName: 'write_file',
        status: 'finished',
      }),
    ).toBe(true)
    expect(
      shouldAutoFollowWrite({
        autoFollow: true,
        followPaused: true,
        isActiveSession: true,
        toolName: 'write_file',
        status: 'finished',
      }),
    ).toBe(false)
    expect(
      shouldAutoFollowWrite({
        autoFollow: true,
        followPaused: false,
        isActiveSession: true,
        toolName: 'write_file',
        status: 'error',
      }),
    ).toBe(false)
    expect(
      shouldAutoFollowWrite({
        autoFollow: true,
        followPaused: false,
        panelDismissedThisTurn: true,
        isActiveSession: true,
        toolName: 'write_file',
        status: 'finished',
      }),
    ).toBe(false)
    expect(
      shouldAutoFollowWrite({
        autoFollow: true,
        followPaused: false,
        isActiveSession: false,
        toolName: 'write_file',
        status: 'finished',
      }),
    ).toBe(false)
  })

  it('skips auto-follow for ephemeral paths', () => {
    expect(
      shouldAutoFollowWrite({
        autoFollow: true,
        followPaused: false,
        isActiveSession: true,
        toolName: 'write_file',
        status: 'finished',
        path: '/tmp/oneoff.py',
      }),
    ).toBe(false)
    expect(
      shouldAutoFollowWrite({
        autoFollow: true,
        followPaused: false,
        isActiveSession: true,
        toolName: 'write_file',
        status: 'finished',
        path: '/src/index.ts',
      }),
    ).toBe(true)
  })
})

describe('writeFollow path policy', () => {
  it('marks system and project temp paths as ephemeral', () => {
    expect(isEphemeralRunScriptPath('/tmp/foo.py')).toBe(true)
    expect(isEphemeralRunScriptPath('/var/tmp/x.sh')).toBe(true)
    expect(isEphemeralRunScriptPath('/proj/tmp/run.py')).toBe(true)
    expect(isEphemeralRunScriptPath('/proj/scratch/note.md')).toBe(true)
    expect(isEphemeralRunScriptPath('/proj/.hip/tmp/x.py')).toBe(true)
    expect(isEphemeralRunScriptPath('/proj/.hip/cache/a')).toBe(true)
    expect(isEphemeralRunScriptPath('/proj/oneoff/script.py')).toBe(true)
    expect(isEphemeralRunScriptPath('tmp_check.py')).toBe(true)
    expect(isEphemeralRunScriptPath('/src/scratch_util.py')).toBe(true)
    expect(isEphemeralRunScriptPath('/src/foo_tmp.py')).toBe(true)
  })

  it('does not mark durable project source as ephemeral', () => {
    expect(isEphemeralRunScriptPath('/src/index.ts')).toBe(false)
    expect(isEphemeralRunScriptPath('/scripts/deploy.py')).toBe(false)
    expect(isEphemeralRunScriptPath('/lib/utils.sh')).toBe(false)
    expect(isEphemeralRunScriptPath('/README.md')).toBe(false)
  })

  it('defers shell/script extensions but not product source', () => {
    expect(isDeferredPanelOpenPath('/scripts/analyze.py')).toBe(true)
    expect(isDeferredPanelOpenPath('/bin/setup.sh')).toBe(true)
    expect(isDeferredPanelOpenPath('/tools/fix.ps1')).toBe(true)
    expect(isDeferredPanelOpenPath('/src/index.ts')).toBe(false)
    expect(isDeferredPanelOpenPath('/app.tsx')).toBe(false)
    expect(isDeferredPanelOpenPath('/page.html')).toBe(false)
    // ephemeral wins over defer
    expect(isDeferredPanelOpenPath('/tmp/x.py')).toBe(false)
  })

  it('writeFollowPanelPolicy maps skip / defer / immediate', () => {
    expect(writeFollowPanelPolicy('/tmp/x.py')).toBe('skip')
    expect(writeFollowPanelPolicy('/scripts/check.py')).toBe('defer')
    expect(writeFollowPanelPolicy('/src/a.ts')).toBe('immediate')
    expect(writeFollowPanelPolicy('/docs/guide.md')).toBe('immediate')
  })

  it('runScriptReferencesPath matches full path and basename tokens', () => {
    expect(runScriptReferencesPath('python /scripts/check.py', '/scripts/check.py')).toBe(true)
    expect(runScriptReferencesPath('python check.py', '/scripts/check.py')).toBe(true)
    expect(runScriptReferencesPath('bash ./setup.sh --force', '/bin/setup.sh')).toBe(true)
    expect(runScriptReferencesPath('python other.py', '/scripts/check.py')).toBe(false)
    expect(runScriptReferencesPath('echo hello', '/scripts/check.py')).toBe(false)
  })

  it('commandFromRunScriptInput parses command field', () => {
    expect(commandFromRunScriptInput(JSON.stringify({ command: 'python a.py' }))).toBe('python a.py')
    expect(commandFromRunScriptInput(JSON.stringify({ cmd: 'ls' }))).toBe('ls')
    expect(commandFromRunScriptInput('not-json')).toBe('')
  })
})
