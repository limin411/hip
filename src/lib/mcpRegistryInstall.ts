/**
 * Convert MCP Registry server.json packages/remotes into a hip McpServerConfig draft.
 * Preference: remote HTTP/SSE → npm → pypi → nuget → oci → mcpb.
 */
import type {
  McpRegistryEntry,
  McpRegistryInstallDraft,
  McpRegistryPackage,
  McpRegistryRemote,
  McpRegistrySecretField,
  McpTransport,
} from '@hip/protocol'

function displayName(entry: McpRegistryEntry): string {
  if (entry.title?.trim()) return entry.title.trim()
  const n = entry.name
  const slash = n.lastIndexOf('/')
  if (slash >= 0 && slash < n.length - 1) return n.slice(slash + 1)
  return n
}

function remoteToDraft(
  entry: McpRegistryEntry,
  remote: McpRegistryRemote,
  method: string,
): McpRegistryInstallDraft | null {
  const url = remote.url?.trim()
  if (!url) return null
  const type = (remote.type ?? '').toLowerCase()
  let transport: McpTransport
  if (type === 'sse') transport = 'sse'
  else if (type === 'streamable-http' || type === 'http' || type === '') transport = 'http'
  else return null

  const headers: Record<string, string> = {}
  const requiredSecrets: McpRegistrySecretField[] = []
  for (const h of remote.headers ?? []) {
    const name = h.name?.trim()
    if (!name) continue
    const value = h.value?.trim() ?? ''
    // Template placeholders like "Bearer {token}" → empty for user fill
    const needsFill = !value || /\{[^}]+\}/.test(value) || h.isSecret === true
    headers[name] = needsFill ? '' : value
    if (needsFill) {
      requiredSecrets.push({
        name,
        description: h.description,
        isSecret: h.isSecret !== false,
        target: 'header',
      })
    }
  }

  return {
    name: displayName(entry),
    transport,
    url,
    ...(Object.keys(headers).length ? { headers } : {}),
    enabled: true,
    registryName: entry.name,
    registrySourceId: entry.marketSourceId,
    registryVersion: entry.version,
    requiredSecrets,
    method,
  }
}

function collectEnvSecrets(
  pkg: McpRegistryPackage,
): { env: Record<string, string>; requiredSecrets: McpRegistrySecretField[] } {
  const env: Record<string, string> = {}
  const requiredSecrets: McpRegistrySecretField[] = []
  for (const ev of pkg.environmentVariables ?? []) {
    const name = ev.name?.trim()
    if (!name) continue
    const value = ev.value?.trim() ?? ''
    const needsFill =
      !value || /\{[^}]+\}/.test(value) || ev.isRequired === true || ev.isSecret === true
    env[name] = needsFill ? '' : value
    if (needsFill) {
      requiredSecrets.push({
        name,
        description: ev.description,
        isSecret: ev.isSecret === true || ev.isRequired === true,
        target: 'env',
      })
    }
  }
  return { env, requiredSecrets }
}

function npmDraft(entry: McpRegistryEntry, pkg: McpRegistryPackage): McpRegistryInstallDraft | null {
  const id = pkg.identifier?.trim()
  if (!id) return null
  const version = pkg.version?.trim() || entry.version?.trim()
  const packageSpec = version ? `${id}@${version}` : id
  const { env, requiredSecrets } = collectEnvSecrets(pkg)
  return {
    name: displayName(entry),
    transport: 'stdio',
    command: 'npx',
    args: ['-y', packageSpec],
    ...(Object.keys(env).length ? { env } : {}),
    enabled: true,
    registryName: entry.name,
    registrySourceId: entry.marketSourceId,
    registryVersion: entry.version,
    requiredSecrets,
    method: 'npm',
  }
}

function pypiDraft(entry: McpRegistryEntry, pkg: McpRegistryPackage): McpRegistryInstallDraft | null {
  const id = pkg.identifier?.trim()
  if (!id) return null
  const version = pkg.version?.trim() || entry.version?.trim()
  const packageSpec = version ? `${id}==${version}` : id
  const hint = (pkg.runtimeHint ?? 'uvx').toLowerCase()
  const command = hint === 'pipx' ? 'pipx' : 'uvx'
  const args = command === 'pipx' ? ['run', packageSpec] : [packageSpec]
  const { env, requiredSecrets } = collectEnvSecrets(pkg)
  return {
    name: displayName(entry),
    transport: 'stdio',
    command,
    args,
    ...(Object.keys(env).length ? { env } : {}),
    enabled: true,
    registryName: entry.name,
    registrySourceId: entry.marketSourceId,
    registryVersion: entry.version,
    requiredSecrets,
    method: 'pypi',
  }
}

function nugetDraft(entry: McpRegistryEntry, pkg: McpRegistryPackage): McpRegistryInstallDraft | null {
  const id = pkg.identifier?.trim()
  if (!id) return null
  const version = pkg.version?.trim() || entry.version?.trim()
  const { env, requiredSecrets } = collectEnvSecrets(pkg)
  return {
    name: displayName(entry),
    transport: 'stdio',
    command: 'dnx',
    args: version ? [id, '--version', version] : [id],
    ...(Object.keys(env).length ? { env } : {}),
    enabled: true,
    registryName: entry.name,
    registrySourceId: entry.marketSourceId,
    registryVersion: entry.version,
    requiredSecrets,
    method: 'nuget',
  }
}

/**
 * Build a simple `docker run -i --rm [-e VAR ...] image` for OCI packages.
 * Complex runtimeArguments templates are ignored in favor of env vars.
 */
function ociDraft(entry: McpRegistryEntry, pkg: McpRegistryPackage): McpRegistryInstallDraft | null {
  const image = pkg.identifier?.trim()
  if (!image) return null
  const { env, requiredSecrets } = collectEnvSecrets(pkg)
  const args = ['run', '-i', '--rm']
  for (const key of Object.keys(env)) {
    args.push('-e', key)
  }
  args.push(image)
  return {
    name: displayName(entry),
    transport: 'stdio',
    command: 'docker',
    args,
    ...(Object.keys(env).length ? { env } : {}),
    enabled: true,
    registryName: entry.name,
    registrySourceId: entry.marketSourceId,
    registryVersion: entry.version,
    requiredSecrets,
    method: 'oci',
  }
}

function packageDraft(entry: McpRegistryEntry, pkg: McpRegistryPackage): McpRegistryInstallDraft | null {
  const t = (pkg.registryType ?? '').toLowerCase()
  if (t === 'npm') return npmDraft(entry, pkg)
  if (t === 'pypi') return pypiDraft(entry, pkg)
  if (t === 'nuget') return nugetDraft(entry, pkg)
  if (t === 'oci') return ociDraft(entry, pkg)
  // mcpb not auto-installable in hip yet
  return null
}

/**
 * Pick the best install draft from an entry's remotes + packages.
 * Returns null when nothing can be mapped into a hip transport.
 */
export function buildMcpRegistryInstallDraft(entry: McpRegistryEntry): McpRegistryInstallDraft | null {
  // Prefer remote endpoints (no local runtime required).
  for (const remote of entry.remotes ?? []) {
    const type = (remote.type ?? '').toLowerCase()
    if (type === 'streamable-http' || type === 'http' || type === '') {
      const d = remoteToDraft(entry, remote, 'remote-http')
      if (d) return d
    }
  }
  for (const remote of entry.remotes ?? []) {
    if ((remote.type ?? '').toLowerCase() === 'sse') {
      const d = remoteToDraft(entry, remote, 'remote-sse')
      if (d) return d
    }
  }

  const packages = entry.packages ?? []
  const order = ['npm', 'pypi', 'nuget', 'oci']
  for (const kind of order) {
    for (const pkg of packages) {
      if ((pkg.registryType ?? '').toLowerCase() === kind) {
        const d = packageDraft(entry, pkg)
        if (d) return d
      }
    }
  }
  // Fallback: any package
  for (const pkg of packages) {
    const d = packageDraft(entry, pkg)
    if (d) return d
  }
  return null
}

/** Whether this entry can be one-click installed into hip. */
export function isMcpRegistryEntryInstallable(entry: McpRegistryEntry): boolean {
  if (entry.installBlockedReason) return false
  if (entry.status === 'deleted') return false
  return buildMcpRegistryInstallDraft(entry) != null
}

/** Human method label for UI badges. */
export function mcpRegistryInstallMethod(entry: McpRegistryEntry): string | null {
  return buildMcpRegistryInstallDraft(entry)?.method ?? null
}
