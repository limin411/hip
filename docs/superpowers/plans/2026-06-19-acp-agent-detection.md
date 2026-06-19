# ACP Agent Detection + Wiring Claude Code / Codex / Kimi Code — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect which ACP coding agents are installed, surface install/added status in the provider picker, gate "add" on "installed", and make Claude Code / Codex / Kimi Code real (addable) providers alongside OpenCode.

**Architecture:** A new Rust `which_binaries` command probes PATH (using the same inherited env the sidecar spawns agents with, so detection honestly predicts spawnability). The frontend caches results in a `detectionStore` and computes per-preset `已安装`/`已添加` from pure helpers. The provider picker shows status and only allows adding installed-and-unadded presets, baking the preset's concrete command/args/quirks into the agent config. Adapter agents (Claude Code, Codex) carry their API key in the agent's `env` (user-supplied). OpenCode stops being auto-injected; all four go through the same detect-and-add flow.

**Tech Stack:** Rust (Tauri command), TypeScript/React/Zustand (frontend), vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-06-19-acp-agent-detection-design.md`

**Paid-test safety:** NEVER run bare `yarn test` or `vitest run src` (substring-matches the paid sidecar suites). Run exact file paths only (as written in each task). The full sweep in Task 11 moves `~/.hip/config/auth.json` aside first.

---

## File structure

**Rust**
- Modify `src-tauri/src/lib.rs` — add `is_executable`, `find_on_path`, `which_binaries` command + register in `invoke_handler`; add `#[cfg(test)] mod tests` with a `find_on_path` test.

**Frontend — new files**
- `src/ipc/detect.ts` + `src/ipc/detect.test.ts` — `detectBinaries(names)` wrapper (fail-closed).
- `src/store/detectionStore.ts` + `src/store/detectionStore.test.ts` — cached install map + `refresh()`.

**Frontend — modified**
- `src/lib/acpPresets.ts` + `src/lib/acpPresets.test.ts` — new `AcpPreset` shape, 4 real presets, `acpPresetById`, pure `presetInstalled` / `presetAdded`.
- `src/lib/agentDraft.ts` + `src/lib/agentDraft.test.ts` — `AgentForm` gains `apiKey`/`authEnvVar`/`env`; `buildAgentDraft` emits `env`.
- `src/components/account/AcpProviderPicker.tsx` — rewrite: status badges, install hint, add-gating, refresh.
- `src/components/account/AgentEditor.tsx` — detection refresh on mount, read agents, `pickPreset` sets `authEnvVar`, seed `apiKey`/`authEnvVar`/`env`, API-key field.
- `src/store/agentsStore.ts` + `src/store/agentsStore.test.ts` — drop `withBuiltinOpencode` / `BUILTIN_OPENCODE`.
- `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, `src/i18n/en.ts` — status / apiKey / redetect keys; remove dead `acpPresetAvailable` / `acpPresetComingSoon`.

**Sidecar — comments only**
- `packages/sidecar/src/session/agents/acp-config.ts`, `acp-quirks.ts` — update reserve-point comments (no behavior change; the new providers run on `quirksFor` DEFAULTS).

---

## Slice A — Detection backend + ipc + store

### Task 1: Rust `which_binaries` command

**Files:**
- Modify: `src-tauri/src/lib.rs` (add helpers + command near the other commands, e.g. after `set_agents_config` ~line 114; register in `invoke_handler` ~line 289; add a `#[cfg(test)] mod tests` at end of file)

- [ ] **Step 1: Write the failing test**

Add at the END of `src-tauri/src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    #[test]
    fn find_on_path_detects_executables() {
        let dir = std::env::temp_dir().join(format!("hip-which-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("opencode");
        std::fs::write(&bin, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let names = vec!["opencode".to_string(), "nope".to_string()];
        let got = super::find_on_path(&names, &[PathBuf::from(&dir)]);
        assert_eq!(got.get("opencode"), Some(&true));
        assert_eq!(got.get("nope"), Some(&false));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test find_on_path_detects_executables 2>&1 | tail -20`
Expected: FAIL to compile — `cannot find function find_on_path in module super`.

- [ ] **Step 3: Write minimal implementation**

Add near the other `#[tauri::command]` fns in `src-tauri/src/lib.rs` (e.g. after `set_agents_config`):

```rust
/// True if `p` is a file and (on unix) has any execute bit set.
fn is_executable(p: &std::path::Path) -> bool {
    if !p.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(p) {
            Ok(m) => m.permissions().mode() & 0o111 != 0,
            Err(_) => false,
        }
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// For each name, true iff an executable of that name exists in any of `dirs`.
fn find_on_path(
    names: &[String],
    dirs: &[std::path::PathBuf],
) -> std::collections::HashMap<String, bool> {
    names
        .iter()
        .map(|n| (n.clone(), dirs.iter().any(|d| is_executable(&d.join(n)))))
        .collect()
}

/// Probe PATH for each requested executable. Uses this process's inherited PATH —
/// the SAME env the sidecar (and thus spawned ACP agents) inherits — so a `true`
/// here honestly predicts the agent will be spawnable.
#[tauri::command]
fn which_binaries(names: Vec<String>) -> Result<std::collections::HashMap<String, bool>, String> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let dirs: Vec<std::path::PathBuf> = std::env::split_paths(&path).collect();
    Ok(find_on_path(&names, &dirs))
}
```

- [ ] **Step 4: Register the command**

In the `invoke_handler` macro list (`src-tauri/src/lib.rs` ~line 289), add `which_binaries,` after `set_skills_config` (add a comma after `set_skills_config` first):

```rust
            get_skills_config,
            set_skills_config,
            which_binaries
        ])
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test find_on_path_detects_executables 2>&1 | tail -20`
Expected: PASS (`test result: ok. 1 passed`).

- [ ] **Step 6: Verify the crate still builds**

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: `Finished` (no errors).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(agents): add which_binaries Tauri command for ACP agent detection"
```

---

### Task 2: `detectBinaries` ipc wrapper

**Files:**
- Create: `src/ipc/detect.ts`
- Test: `src/ipc/detect.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ipc/detect.test.ts` (mirrors `src/ipc/agentsConfig.test.ts` style):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

beforeEach(() => invoke.mockReset())

describe('detectBinaries', () => {
  it('passes names through and returns the install map', async () => {
    invoke.mockResolvedValueOnce({ opencode: true, kimi: false })
    const { detectBinaries } = await import('./detect')
    const got = await detectBinaries(['opencode', 'kimi'])
    expect(invoke).toHaveBeenCalledWith('which_binaries', { names: ['opencode', 'kimi'] })
    expect(got).toEqual({ opencode: true, kimi: false })
  })

  it('fails closed (returns {}) when the command errors', async () => {
    invoke.mockRejectedValueOnce(new Error('boom'))
    const { detectBinaries } = await import('./detect')
    expect(await detectBinaries(['opencode'])).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/ipc/detect.test.ts 2>&1 | tail -15`
Expected: FAIL — cannot resolve `./detect`.

- [ ] **Step 3: Write minimal implementation**

Create `src/ipc/detect.ts`:

```ts
import { invoke } from '@tauri-apps/api/core'

/** Probe PATH for each executable name. Fail-closed: on error treat all as not-found
 *  so a detection failure never makes an unrunnable agent look addable. */
export async function detectBinaries(names: string[]): Promise<Record<string, boolean>> {
  try {
    return await invoke<Record<string, boolean>>('which_binaries', { names })
  } catch {
    return {}
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/ipc/detect.test.ts 2>&1 | tail -15`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ipc/detect.ts src/ipc/detect.test.ts
git commit -m "feat(agents): detectBinaries ipc wrapper (fail-closed)"
```

---

### Task 3: `detectionStore`

**Files:**
- Create: `src/store/detectionStore.ts`
- Test: `src/store/detectionStore.test.ts`

Note: this task imports `ACP_PRESETS` from `src/lib/acpPresets.ts`, which still has the OLD shape until Task 4. The fields this task reads (`detectBin`, `legacyBin`) do not exist on the old shape, so write the store now but its `detectNames()` will only return correct names after Task 4. The test mocks `acpPresets`, so it passes independently.

- [ ] **Step 1: Write the failing test**

Create `src/store/detectionStore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const detectBinaries = vi.fn()
vi.mock('@/ipc/detect', () => ({ detectBinaries: (...a: unknown[]) => detectBinaries(...a) }))
vi.mock('@/lib/acpPresets', () => ({
  ACP_PRESETS: [
    { id: 'opencode', detectBin: 'opencode' },
    { id: 'claude-code', detectBin: 'claude-agent-acp', legacyBin: 'claude-code-acp' },
  ],
}))

beforeEach(async () => {
  detectBinaries.mockReset().mockResolvedValue({})
  const { useDetectionStore } = await import('./detectionStore.js')
  useDetectionStore.setState({ installed: {}, checked: false })
})

describe('detectionStore', () => {
  it('refresh() probes the union of preset detect + legacy binaries', async () => {
    detectBinaries.mockResolvedValueOnce({ opencode: true, 'claude-agent-acp': false, 'claude-code-acp': true })
    const { useDetectionStore } = await import('./detectionStore.js')
    await useDetectionStore.getState().refresh()
    expect(detectBinaries).toHaveBeenCalledWith(
      expect.arrayContaining(['opencode', 'claude-agent-acp', 'claude-code-acp']),
    )
    expect(useDetectionStore.getState().installed).toEqual({ opencode: true, 'claude-agent-acp': false, 'claude-code-acp': true })
    expect(useDetectionStore.getState().checked).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/store/detectionStore.test.ts 2>&1 | tail -15`
Expected: FAIL — cannot resolve `./detectionStore`.

- [ ] **Step 3: Write minimal implementation**

Create `src/store/detectionStore.ts`:

```ts
import { create } from 'zustand'
import { detectBinaries } from '@/ipc/detect'
import { ACP_PRESETS } from '@/lib/acpPresets'

/** All executable names worth probing: each preset's primary + legacy detect binary. */
function detectNames(): string[] {
  const s = new Set<string>()
  for (const p of ACP_PRESETS) {
    if (p.detectBin) s.add(p.detectBin)
    if (p.legacyBin) s.add(p.legacyBin)
  }
  return [...s]
}

interface DetectionStore {
  installed: Record<string, boolean>
  checked: boolean
  refresh: () => Promise<void>
}

export const useDetectionStore = create<DetectionStore>((set) => ({
  installed: {},
  checked: false,
  refresh: async () => {
    const installed = await detectBinaries(detectNames())
    set({ installed, checked: true })
  },
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/store/detectionStore.test.ts 2>&1 | tail -15`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/store/detectionStore.ts src/store/detectionStore.test.ts
git commit -m "feat(agents): detectionStore (cached install map + refresh)"
```

---

## Slice B — Preset model + pure helpers + draft

### Task 4: Rewrite `acpPresets.ts` (real presets + status helpers)

**Files:**
- Modify: `src/lib/acpPresets.ts` (full rewrite)
- Test: `src/lib/acpPresets.test.ts` (full rewrite)

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `src/lib/acpPresets.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { ACP_PRESETS, acpPresetById, presetInstalled, presetAdded, type AcpPreset } from './acpPresets'

describe('ACP_PRESETS', () => {
  it('lists the four supported providers with unique ids', () => {
    const ids = ACP_PRESETS.map((p) => p.id)
    expect(new Set(ids)).toEqual(new Set(['opencode', 'kimi-code', 'claude-code', 'codex']))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every preset has detectBin, command, quirks, installCmd; quirks === id', () => {
    for (const p of ACP_PRESETS) {
      expect(p.detectBin).toBeTruthy()
      expect(p.command).toBeTruthy()
      expect(p.installCmd).toBeTruthy()
      expect(p.quirks).toBe(p.id)
    }
  })

  it('adapter presets declare an authEnvVar; native ones do not', () => {
    expect(acpPresetById('claude-code')?.authEnvVar).toBe('ANTHROPIC_API_KEY')
    expect(acpPresetById('codex')?.authEnvVar).toBe('OPENAI_API_KEY')
    expect(acpPresetById('opencode')?.authEnvVar).toBeUndefined()
    expect(acpPresetById('kimi-code')?.authEnvVar).toBeUndefined()
  })

  it('claude-code keeps a legacy bin fallback', () => {
    expect(acpPresetById('claude-code')?.legacyBin).toBe('claude-code-acp')
  })

  it('preserves OpenCode launch args (acp --pure)', () => {
    expect(acpPresetById('opencode')).toMatchObject({ command: 'opencode', args: ['acp', '--pure'] })
  })

  it('looks presets up by id', () => {
    expect(acpPresetById('codex')?.name).toBe('Codex')
    expect(acpPresetById('nope')).toBeUndefined()
  })
})

const mk = (over: Partial<AcpPreset>): AcpPreset => ({
  id: 'x', name: 'X', icon: 'code', detectBin: 'x', command: 'x', args: [], quirks: 'x', installCmd: 'i', ...over,
})

describe('presetInstalled', () => {
  it('true when the primary detect binary is present', () => {
    expect(presetInstalled(mk({ detectBin: 'opencode' }), { opencode: true })).toBe(true)
    expect(presetInstalled(mk({ detectBin: 'opencode' }), { opencode: false })).toBe(false)
    expect(presetInstalled(mk({ detectBin: 'opencode' }), {})).toBe(false)
  })
  it('true when only the legacy binary is present', () => {
    const p = mk({ detectBin: 'claude-agent-acp', legacyBin: 'claude-code-acp' })
    expect(presetInstalled(p, { 'claude-agent-acp': false, 'claude-code-acp': true })).toBe(true)
  })
})

describe('presetAdded', () => {
  it('true when an agent carries this preset id as its quirks', () => {
    const p = mk({ id: 'codex', quirks: 'codex' })
    expect(presetAdded(p, [{ quirks: 'opencode' }, { quirks: 'codex' }])).toBe(true)
    expect(presetAdded(p, [{ quirks: 'opencode' }])).toBe(false)
    expect(presetAdded(p, [{}])).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/acpPresets.test.ts 2>&1 | tail -20`
Expected: FAIL — `presetInstalled`/`presetAdded` not exported; preset fields missing.

- [ ] **Step 3: Verify the install commands before writing them**

Run: `npm view @moonshot-ai/kimi-code version bin 2>&1 | tail; npm view @agentclientprotocol/claude-agent-acp version bin 2>&1 | tail; npm view @zed-industries/codex-acp version bin 2>&1 | tail; npm view opencode-ai version 2>&1 | tail`
Expected: confirms package names + bin fields (`kimi`, `claude-agent-acp`, `codex-acp`). If `opencode-ai` does not resolve, set OpenCode's `installCmd` to `brew install sst/tap/opencode` instead (it is only a copyable hint string; pick whichever resolves).

- [ ] **Step 4: Write the implementation**

Replace the entire contents of `src/lib/acpPresets.ts` with:

```ts
import type { AgentConfig } from '@hip/protocol'

export type AcpPresetIcon = 'code' | 'bot' | 'cpu' | 'rocket'

/** A supported ACP coding-agent provider. All four are real (detect-and-add). */
export interface AcpPreset {
  id: string                  // also the agent's `quirks` value (1:1) used to match 已添加
  name: string                // brand label, not localized
  icon: AcpPresetIcon
  detectBin: string           // primary executable to find on PATH ⇒ 已安装
  legacyBin?: string          // claude-code: pre-rename adapter bin
  command: string             // baked into AgentConfig.command on add
  args: string[]              // baked into AgentConfig.args on add
  quirks: string              // sidecar quirk-profile key (acp-quirks.ts); === id
  authEnvVar?: string         // adapter agents: env var the API key maps to
  installCmd: string          // shown when 未安装 (copyable)
}

export const ACP_PRESETS: AcpPreset[] = [
  {
    id: 'opencode', name: 'OpenCode', icon: 'code',
    detectBin: 'opencode', command: 'opencode', args: ['acp', '--pure'],
    quirks: 'opencode', installCmd: 'npm i -g opencode-ai',
  },
  {
    id: 'kimi-code', name: 'Kimi Code', icon: 'rocket',
    detectBin: 'kimi', command: 'kimi', args: ['acp'],
    quirks: 'kimi-code', installCmd: 'npm i -g @moonshot-ai/kimi-code',
  },
  {
    id: 'claude-code', name: 'Claude Code', icon: 'bot',
    detectBin: 'claude-agent-acp', legacyBin: 'claude-code-acp',
    command: 'claude-agent-acp', args: [],
    quirks: 'claude-code', authEnvVar: 'ANTHROPIC_API_KEY',
    installCmd: 'npm i -g @agentclientprotocol/claude-agent-acp',
  },
  {
    id: 'codex', name: 'Codex', icon: 'cpu',
    detectBin: 'codex-acp', command: 'codex-acp', args: [],
    quirks: 'codex', authEnvVar: 'OPENAI_API_KEY',
    installCmd: 'npm i -g @zed-industries/codex-acp',
  },
]

export function acpPresetById(id: string): AcpPreset | undefined {
  return ACP_PRESETS.find((p) => p.id === id)
}

/** Installed iff the primary (or legacy) detect binary is on PATH. */
export function presetInstalled(preset: AcpPreset, installed: Record<string, boolean>): boolean {
  return installed[preset.detectBin] === true || (preset.legacyBin ? installed[preset.legacyBin] === true : false)
}

/** Added iff some configured agent carries this preset's id as its quirks. */
export function presetAdded(preset: AcpPreset, agents: Pick<AgentConfig, 'quirks'>[]): boolean {
  return agents.some((a) => a.quirks === preset.id)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn vitest run src/lib/acpPresets.test.ts 2>&1 | tail -20`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/acpPresets.ts src/lib/acpPresets.test.ts
git commit -m "feat(agents): real ACP presets (4 providers) + presetInstalled/presetAdded"
```

---

### Task 5: Extend `agentDraft` (API-key → env)

**Files:**
- Modify: `src/lib/agentDraft.ts`
- Test: `src/lib/agentDraft.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/agentDraft.test.ts` (inside the existing file; reuse its `buildAgentDraft` import — add it to the import if missing):

```ts
import { buildAgentDraft, type AgentForm } from './agentDraft'

const acpForm = (over: Partial<AgentForm>): AgentForm => ({
  name: 'Claude', description: '', kind: 'acp', command: 'claude-agent-acp', args: '',
  transport: 'thin', acceptsModelConfig: false, boundModelKey: '', authMode: 'opencode-self',
  quirks: 'claude-code', prompt: '', allowedSkills: [], allowedMcpServers: [], enabled: true,
  apiKey: '', authEnvVar: 'ANTHROPIC_API_KEY', env: undefined, ...over,
})

describe('buildAgentDraft env / apiKey', () => {
  it('writes the api key into env[authEnvVar] when provided', () => {
    const d = buildAgentDraft(acpForm({ apiKey: 'sk-123' }))
    expect(d.env).toEqual({ ANTHROPIC_API_KEY: 'sk-123' })
  })
  it('omits env entirely when the api key is blank and no other env', () => {
    const d = buildAgentDraft(acpForm({ apiKey: '   ' }))
    expect(d.env).toBeUndefined()
  })
  it('preserves other env keys and drops a cleared auth key', () => {
    const d = buildAgentDraft(acpForm({ apiKey: '', env: { ANTHROPIC_API_KEY: 'old', FOO: 'bar' } }))
    expect(d.env).toEqual({ FOO: 'bar' })
  })
  it('native presets (no authEnvVar) never synthesize an auth env', () => {
    const d = buildAgentDraft(acpForm({ quirks: 'opencode', authEnvVar: undefined, apiKey: 'ignored' }))
    expect(d.env).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/lib/agentDraft.test.ts 2>&1 | tail -20`
Expected: FAIL — `AgentForm` has no `apiKey`/`authEnvVar`/`env`; `buildAgentDraft` returns no `env`.

- [ ] **Step 3: Write the implementation**

In `src/lib/agentDraft.ts`, extend the `AgentForm` interface (add the three fields after `enabled` or near `quirks`):

```ts
export interface AgentForm {
  name: string
  description?: string
  kind: AgentConfig['kind']
  command: string
  args: string
  transport: AgentConfig['transport']
  acceptsModelConfig: boolean
  boundModelKey: string
  authMode: AgentAuthMode
  quirks?: string
  // internal-only fields:
  prompt: string
  allowedSkills: string[]
  allowedMcpServers: string[]
  enabled: boolean
  // ACP adapter auth (Claude Code / Codex): the key is stored in the agent's env.
  apiKey: string              // value for authEnvVar; '' ⇒ rely on ambient env
  authEnvVar?: string         // which env var apiKey maps to; undefined ⇒ no key field
  env?: Record<string, string> // existing env to preserve across edits
}
```

In the external (acp + custom) branch of `buildAgentDraft` (the `return { ... }` after the internal branch), compute and include `env`:

```ts
  // Model rollback: external agents (acp + custom) self-manage. We never push a model, so
  // acceptsModelConfig is always false and no boundModel/authMode is emitted (legacy fields stay
  // inert in the type for back-compat with already-saved configs).
  const env0 = { ...(form.env ?? {}) }
  if (form.authEnvVar) {
    const v = form.apiKey.trim()
    if (v) env0[form.authEnvVar] = v
    else delete env0[form.authEnvVar]
  }
  const env = Object.keys(env0).length ? env0 : undefined
  return {
    name: form.name.trim(),
    description: (form.description ?? '').trim() || undefined,
    kind: form.kind,
    command: form.command.trim(),
    args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
    transport: form.transport,
    acceptsModelConfig: false,
    ...(form.quirks ? { quirks: form.quirks } : {}),
    ...(env ? { env } : {}),
    enabled: form.enabled,
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn vitest run src/lib/agentDraft.test.ts 2>&1 | tail -20`
Expected: PASS (existing + 4 new tests).

- [ ] **Step 5: Type-check (existing AgentForm constructors must still satisfy the new required `apiKey`)**

Run: `yarn type-check 2>&1 | tail -8`
Expected: FAIL in `AgentEditor.tsx` (its `useState<AgentForm>` lacks `apiKey`). That is fixed in Task 9 — note it and continue. (If you prefer green-at-every-commit, do Task 9 before committing this; otherwise commit and let Task 9 restore tsc.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/agentDraft.ts src/lib/agentDraft.test.ts
git commit -m "feat(agents): agentDraft carries ACP api key into agent env"
```

---

## Slice C — UI + store cleanup + i18n

### Task 6: Drop the auto-injected built-in OpenCode

**Files:**
- Modify: `src/store/agentsStore.ts`
- Test: `src/store/agentsStore.test.ts`

- [ ] **Step 1: Update the test (remove builtin expectations)**

In `src/store/agentsStore.test.ts`:
- Change the import line `import { withBuiltinOpencode } from './agentsStore'` to `// (withBuiltinOpencode removed — OpenCode is now added via the picker)` and drop the symbol (the store re-imports below via dynamic import; remove the static one).
- In the `load()` test, replace the OpenCode assertion. New body:

```ts
  it('load() hydrates from the IPC config (no auto-injected agents)', async () => {
    getAgentsConfig.mockResolvedValueOnce({ agents: [{ id: 'a', name: 'A', kind: 'custom', command: 'x', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true }] })
    const { useAgentsStore } = await import('./agentsStore.js')
    await useAgentsStore.getState().load()
    const agents = useAgentsStore.getState().agents
    expect(agents.map((a) => a.id)).toEqual(['a'])
    expect(useAgentsStore.getState().loaded).toBe(true)
  })
```

- Delete the entire `describe('built-in opencode agent', () => { ... })` block.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run src/store/agentsStore.test.ts 2>&1 | tail -20`
Expected: FAIL — `withBuiltinOpencode` still referenced / load injects opencode.

- [ ] **Step 3: Write the implementation**

In `src/store/agentsStore.ts`, delete `BUILTIN_OPENCODE` and `withBuiltinOpencode`, and change `load`:

```ts
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { AgentConfig } from '@hip/protocol'
import { getAgentsConfig, setAgentsConfig } from '@/ipc/agentsConfig'

interface AgentsStore {
  agents: AgentConfig[]
  loaded: boolean
  load: () => Promise<void>
  addAgent: (a: Omit<AgentConfig, 'id'>) => Promise<string>
  updateAgent: (id: string, patch: Partial<AgentConfig>) => Promise<void>
  removeAgent: (id: string) => Promise<void>
}

export const useAgentsStore = create<AgentsStore>((set, get) => ({
  agents: [],
  loaded: false,
  load: async () => {
    const cfg = await getAgentsConfig()
    set({ agents: cfg.agents, loaded: true })
  },
  addAgent: async (a) => {
    const id = nanoid()
    const next = [...get().agents, { ...a, id }]
    await setAgentsConfig({ agents: next })
    set({ agents: next })
    return id
  },
  updateAgent: async (id, patch) => {
    const next = get().agents.map((x) => (x.id === id ? { ...x, ...patch } : x))
    await setAgentsConfig({ agents: next })
    set({ agents: next })
  },
  removeAgent: async (id) => {
    const next = get().agents.filter((x) => x.id !== id)
    await setAgentsConfig({ agents: next })
    set({ agents: next })
  },
}))
```

- [ ] **Step 4: Confirm no other consumer of `withBuiltinOpencode`**

Run: `grep -rn "withBuiltinOpencode\|BUILTIN_OPENCODE" src/ --include="*.ts" --include="*.tsx"`
Expected: no matches (other than none). If any non-test file references it, update that file too.

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn vitest run src/store/agentsStore.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/agentsStore.ts src/store/agentsStore.test.ts
git commit -m "feat(agents): drop auto-injected built-in OpenCode (now added via picker)"
```

---

### Task 7: i18n keys

**Files:**
- Modify: `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, `src/i18n/en.ts`

- [ ] **Step 1: Add the new keys (under the `agents:` block, near `acpPickTitle`)**

`src/i18n/zh-CN.ts` — add after `acpPickTitle: '新增 ACP — 选择提供方',`:

```ts
        statusInstalled: '已安装',
        statusNotInstalled: '未安装',
        statusAdded: '已添加',
        acpNotInstalledHint: '未安装。运行以下命令安装：',
        redetect: '重新检测',
        apiKey: 'API Key',
        apiKeyHint: '将写入该智能体的 {{env}} 环境变量；留空则使用系统环境变量。',
```

`src/i18n/zh-TW.ts` — add at the same spot:

```ts
        statusInstalled: '已安裝',
        statusNotInstalled: '未安裝',
        statusAdded: '已新增',
        acpNotInstalledHint: '未安裝。執行以下指令安裝：',
        redetect: '重新偵測',
        apiKey: 'API Key',
        apiKeyHint: '將寫入該智能體的 {{env}} 環境變數；留空則使用系統環境變數。',
```

`src/i18n/en.ts` — add at the same spot:

```ts
        statusInstalled: 'Installed',
        statusNotInstalled: 'Not installed',
        statusAdded: 'Added',
        acpNotInstalledHint: 'Not installed. Run to install:',
        redetect: 'Re-check',
        apiKey: 'API Key',
        apiKeyHint: 'Stored in this agent’s {{env}} env var; leave blank to use your system environment.',
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check 2>&1 | tail -8`
Expected: the only errors (if any) are the pre-existing Task 5 `AgentForm`/`AgentEditor` ones — no NEW i18n errors. (If the i18n object is `as const satisfies Record<...>`, all three locales must have identical keys — this step catches a missed locale.)

- [ ] **Step 3: Commit**

```bash
git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
git commit -m "feat(agents): i18n for ACP install/added status, api key, re-check"
```

---

### Task 8: Rewrite `AcpProviderPicker`

**Files:**
- Modify: `src/components/account/AcpProviderPicker.tsx` (full rewrite)
- Modify: `src/i18n/{zh-CN,zh-TW,en}.ts` (remove now-dead `acpPresetAvailable` / `acpPresetComingSoon`)

No unit test (node test env, no RTL); verified by type-check + build here and GUI states in Task 11. All branching logic lives in the already-tested `presetInstalled` / `presetAdded`.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/components/account/AcpProviderPicker.tsx` with:

```tsx
import { useTranslation } from 'react-i18next'
import { Code, Bot, Cpu, Rocket, CircleCheck, Check, RefreshCw, type LucideIcon } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { ACP_PRESETS, presetInstalled, presetAdded, type AcpPreset, type AcpPresetIcon } from '@/lib/acpPresets'
import { cn } from '@/lib/utils'

const ICONS: Record<AcpPresetIcon, LucideIcon> = { code: Code, bot: Bot, cpu: Cpu, rocket: Rocket }

/** Step 1 of adding a new ACP agent: choose one of the supported provider presets.
 *  Only installed-and-unadded presets are pickable; uninstalled ones show an install hint.
 *  Custom/generic ACP agents are intentionally not offered — only the named providers. */
export function AcpProviderPicker({
  installed,
  agents,
  onPick,
  onRefresh,
}: {
  installed: Record<string, boolean>
  agents: AgentConfig[]
  onPick: (preset: AcpPreset) => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1.5 text-meta text-ink-secondary transition-colors hover:text-ink"
        >
          <RefreshCw size={13} /> {t('settings.agents.redetect')}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {ACP_PRESETS.map((preset) => {
          const Icon = ICONS[preset.icon]
          const inst = presetInstalled(preset, installed)
          const added = presetAdded(preset, agents)
          const pickable = inst && !added
          return (
            <div
              key={preset.id}
              role={pickable ? 'button' : undefined}
              tabIndex={pickable ? 0 : undefined}
              onClick={pickable ? () => onPick(preset) : undefined}
              onKeyDown={pickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(preset) } } : undefined}
              className={cn(
                'rounded-lg border px-3 py-2.5 transition-colors',
                pickable ? 'cursor-pointer border-border hover:border-accent hover:bg-accent-subtle' : 'border-border opacity-80',
              )}
            >
              <div className="flex items-center gap-2">
                <Icon size={18} className={inst ? 'text-accent-strong' : 'text-ink-tertiary'} />
                <span className={cn('text-body font-medium', inst ? 'text-ink' : 'text-ink-secondary')}>{preset.name}</span>
              </div>
              {added ? (
                <div className="mt-1.5 flex items-center gap-1 text-caption text-ink-secondary">
                  <Check size={13} /> {t('settings.agents.statusAdded')}
                </div>
              ) : inst ? (
                <div className="mt-1.5 flex items-center gap-1 text-caption text-success">
                  <CircleCheck size={13} /> {t('settings.agents.statusInstalled')}
                </div>
              ) : (
                <div className="mt-1.5 space-y-1">
                  <div className="text-caption text-ink-tertiary">{t('settings.agents.statusNotInstalled')}</div>
                  <code className="block select-all rounded bg-surface-muted px-1.5 py-1 font-mono text-caption text-ink-secondary">
                    {preset.installCmd}
                  </code>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Remove the now-dead i18n keys**

Delete `acpPresetAvailable` and `acpPresetComingSoon` lines from all three of `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, `src/i18n/en.ts` (they are no longer referenced).

- [ ] **Step 3: Confirm no remaining references**

Run: `grep -rn "acpPresetAvailable\|acpPresetComingSoon\|AcpPresetStatus" src/ --include="*.ts" --include="*.tsx"`
Expected: no matches.

- [ ] **Step 4: Build (defers tsc-green to Task 9 which fixes the AcpProviderPicker call site + AgentForm)**

Run: `yarn type-check 2>&1 | tail -10`
Expected: errors only at the `AcpProviderPicker` call site in `AgentEditor.tsx` (old props) and the Task-5 `AgentForm` — both fixed in Task 9. No other files error.

- [ ] **Step 5: Commit**

```bash
git add src/components/account/AcpProviderPicker.tsx src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
git commit -m "feat(agents): ACP picker shows install/added status, gates add on installed"
```

---

### Task 9: Wire `AgentEditor` (detection, api-key field, baking)

**Files:**
- Modify: `src/components/account/AgentEditor.tsx`

No unit test (no RTL); verified by type-check + build here, GUI in Task 11.

- [ ] **Step 1: Add imports**

In `src/components/account/AgentEditor.tsx`, add to the import block:

```ts
import { useAgentsStore } from '@/store/agentsStore'
import { useDetectionStore } from '@/store/detectionStore'
import { acpPresetById } from '@/lib/acpPresets'
```

(`AcpProviderPicker` and `type AcpPreset` are already imported.)

- [ ] **Step 2: Read agents + detection; refresh detection on mount**

After the existing store hooks (e.g. after `const { skills } = useSkillsStore()`), add:

```ts
  const agents = useAgentsStore((s) => s.agents)
  const installed = useDetectionStore((s) => s.installed)
  const refreshDetection = useDetectionStore((s) => s.refresh)
```

In the existing mount `useEffect`, add the detection refresh:

```ts
  useEffect(() => {
    void useMcpServersStore.getState().load()
    void useSkillsStore.getState().load()
    void refreshDetection()
  }, [refreshDetection])
```

- [ ] **Step 3: Seed the new AgentForm fields**

In the `useState<AgentForm>({ ... })` initializer, add (after `enabled: ...`):

```ts
    apiKey: (() => {
      const ev = initial?.quirks ? acpPresetById(initial.quirks)?.authEnvVar : undefined
      return ev ? (initial?.env?.[ev] ?? '') : ''
    })(),
    authEnvVar: initial?.quirks ? acpPresetById(initial.quirks)?.authEnvVar : undefined,
    env: initial?.env,
```

- [ ] **Step 4: Set `authEnvVar` when a preset is picked**

Replace `pickPreset`:

```ts
  const pickPreset = (preset: AcpPreset) => {
    patch({ command: preset.command, args: preset.args.join(' '), quirks: preset.quirks, authEnvVar: preset.authEnvVar, apiKey: '' })
    setAcpStep('form')
  }
```

- [ ] **Step 5: Pass detection + agents to the picker**

Replace `<AcpProviderPicker onPick={pickPreset} />` with:

```tsx
              <AcpProviderPicker installed={installed} agents={agents} onPick={pickPreset} onRefresh={() => void refreshDetection()} />
```

- [ ] **Step 6: Render the API-key field (ACP adapter presets)**

In the `isAcp` branch, after the quirks `<Field>` (the block guarded by `{isAcp && ( ... quirks ... )}`), add:

```tsx
              {isAcp && form.authEnvVar && (
                <Field label={t('settings.agents.apiKey')}>
                  <input
                    className={cn(inputCls, 'font-mono')}
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => patch({ apiKey: e.target.value })}
                    placeholder={form.authEnvVar}
                  />
                  <div className="mt-1 text-caption text-ink-tertiary">{t('settings.agents.apiKeyHint', { env: form.authEnvVar })}</div>
                </Field>
              )}
```

- [ ] **Step 7: Type-check + build (now green)**

Run: `yarn type-check 2>&1 | tail -8 && yarn build 2>&1 | tail -4`
Expected: tsc clean (`Done`); build `✓ built`.

- [ ] **Step 8: Run the affected frontend suites (exact paths)**

Run: `yarn vitest run src/lib/acpPresets.test.ts src/lib/agentDraft.test.ts src/store/agentsStore.test.ts src/store/detectionStore.test.ts src/ipc/detect.test.ts 2>&1 | tail -15`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/account/AgentEditor.tsx
git commit -m "feat(agents): editor detection refresh, preset-gated add, ACP api-key field"
```

---

## Slice D — Sidecar comments + verification

### Task 10: Update stale sidecar reserve-point comments

**Files:**
- Modify: `packages/sidecar/src/session/agents/acp-config.ts`
- Modify: `packages/sidecar/src/session/agents/acp-quirks.ts`

No behavior change — `buildAcpSpawn` already spawns `agent.command`/`agent.args` verbatim and merges `agent.env`; `quirksFor` already returns safe DEFAULTS for the new providers (no profile entries needed; `defaultModelIsBilled` is vestigial post model-rollback).

- [ ] **Step 1: Update `acp-config.ts` comment**

Replace the comment block inside `buildAcpSpawn` (the `// NOTE: this spawn path is OpenCode-shaped...` lines) with:

```ts
  // All four ACP presets (opencode/kimi-code/claude-code/codex) bake their concrete
  // command/args at add-time (src/lib/acpPresets.ts), so this path spawns them verbatim.
  // agent.env carries any user-supplied API key (claude-code/codex). Self-managed: no
  // model/key injection here.
```

- [ ] **Step 2: Update `acp-quirks.ts` comment**

Replace the `// Reserve point — future ACP providers ...` comment with:

```ts
// OpenCode needs non-default quirks. kimi-code/claude-code/codex run on DEFAULTS today
// (quirksFor returns DEFAULTS for any key without a profile) — add a profile here only
// when real testing shows one is needed. defaultModelIsBilled is vestigial post
// model-rollback; cancelReportsEndTurn is the only quirk consumed at runtime.
```

- [ ] **Step 3: Type-check the sidecar package compiles (tsc covers it)**

Run: `yarn type-check 2>&1 | tail -5`
Expected: `Done` (clean).

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/session/agents/acp-config.ts packages/sidecar/src/session/agents/acp-quirks.ts
git commit -m "docs(agents): update ACP spawn/quirks reserve-point comments"
```

---

### Task 11: Full verification + GUI acceptance

**Files:** none (verification only)

- [ ] **Step 1: Rust tests + build**

Run: `cd src-tauri && cargo test 2>&1 | tail -15 && cargo build 2>&1 | tail -3`
Expected: all Rust tests pass; build `Finished`.

- [ ] **Step 2: Type-check + frontend build**

Run: `yarn type-check 2>&1 | tail -5 && yarn build 2>&1 | tail -4`
Expected: tsc `Done`; build `✓ built`.

- [ ] **Step 3: Full test suite, paid-free**

```bash
mv ~/.hip/config/auth.json ~/.hip/config/auth.json.bak 2>/dev/null || true
yarn test 2>&1 | tail -20
mv ~/.hip/config/auth.json.bak ~/.hip/config/auth.json 2>/dev/null || true
```
Expected: all pass / only the known paid suites skipped. (The trailing `mv` restores auth.json even if tests fail — run it regardless.)

- [ ] **Step 4: GUI acceptance (browser preview, mocked)**

Start the preview (`hip-web-preview`), skip login, open 设置 → 智能体管理 → 添加智能体 → 新增 ACP 智能体. Verify:
- The picker shows four providers with per-provider status (`已安装` / `未安装` + install command / `已添加`).
- A `未安装` card is not clickable and shows its `installCmd`.
- "重新检测" triggers a re-probe.
- Picking an `已安装` + `未添加` provider opens the form; for Claude Code / Codex an "API Key" field appears; for OpenCode / Kimi it does not.
- Saving creates the agent (it then shows `已添加` on return to the picker).

Note: in the browser (no Tauri backend) `which_binaries` is unavailable → detection fails-closed to all `未安装`; that still verifies the `未安装` rendering + install hints + non-clickability. Real install/add/connect verification happens in Step 5.

- [ ] **Step 5: Real-app acceptance (`yarn tauri dev`)**

Manual (user-run): launch `yarn tauri dev`, open the ACP picker, confirm detection matches reality (e.g. with `kimi`/`opencode`/an installed adapter on PATH), add one provider, and confirm it connects on a message. Adapter agents require their API key (field or ambient env).

- [ ] **Step 6: Final review**

Dispatch a code reviewer over `git diff main...HEAD` for this feature's commits (do NOT switch branches). Address any blocking findings.

---

## Self-review

**Spec coverage:**
- Detection mechanism (Rust `which_binaries`, ipc, store, `presetInstalled`) → T1–T3, T4. ✓
- Status model (已安装/未安装/已添加, add gated on installed, no 未安装+已添加) → T4 (`presetInstalled`/`presetAdded`), T8 (picker states). ✓
- Wiring 3 providers (preset metadata, launch, quirks, authEnvVar) → T4. ✓
- 用户自备 keys (env field) → T5 (`buildAgentDraft` env), T9 (api-key field). ✓
- OpenCode unification + migration → T6 (drop builtin; existing opencode preserved via `presetAdded` by quirks). ✓
- Sidecar wiring (no launch logic; quirks DEFAULTS) → T10 (comments). ✓
- i18n → T7, T8. ✓
- Testing → per-task TDD + T11. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/vague steps. The one runtime-verified value (OpenCode `installCmd`) has an explicit verification step (T4 Step 3) with a concrete fallback.

**Type consistency:** `AcpPreset` fields (`detectBin`/`legacyBin`/`command`/`args`/`quirks`/`authEnvVar`/`installCmd`) are used identically in T3 (`detectNames`), T4 (helpers), T8 (picker), T9 (editor). `AgentForm` additions (`apiKey`/`authEnvVar`/`env`) are defined in T5 and consumed in T9. `presetInstalled(preset, installed)` / `presetAdded(preset, agents)` signatures match between T4, T8. `which_binaries` returns `Record<string, boolean>` consumed by T2/T3. Consistent.
