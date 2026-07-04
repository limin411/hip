const VITE_PORT = 1420

export async function isHipViteReady(port: number = VITE_PORT): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}`)
    if (!res.ok) return false
    const body = await res.text()
    // Reject servers from other projects (e.g. a leftover Tauri/Vite app on the
    // same default port). The compiled Tauri binary always loads from this port,
    // so reusing a foreign server would load the wrong frontend.
    return body.includes('<title>hip</title>')
  } catch {
    return false
  }
}

export async function waitForHipVite(port: number = VITE_PORT, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isHipViteReady(port)) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Vite did not become ready on port ${port}`)
}
