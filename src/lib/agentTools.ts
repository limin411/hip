/** Back-compat ONLY: parse a legacy `allowedTools` array and return the serverIds that were granted
 *  via `mcp__<id>__*` wildcards. Used once when seeding the editor / reading an old internal agent
 *  whose `allowedMcpServers` is still undefined. New configs use `allowedMcpServers` directly. */
export function grantedMcpServerIds(names: string[] | undefined): string[] {
  if (!names) return []
  const out: string[] = []
  for (const n of names) {
    const m = /^mcp__(.+)__\*$/.exec(n)
    if (m) out.push(m[1])
  }
  return out
}
