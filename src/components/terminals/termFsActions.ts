import { isTermFsNotReadyError, termFsLs } from '@/ipc/termFs'
import { useTerminalFsStore } from '@/store/terminalFsStore'

const RETRY_MS = 200
const MAX_RETRIES = 15

/**
 * List a local dir under the managed terminal launch cwd.
 * Retries briefly while PTY open is still racing the first mount.
 */
export async function loadLocalDir(
  terminalId: string,
  path: string,
  attempt = 0,
): Promise<void> {
  const store = useTerminalFsStore.getState()
  store.setLoading(terminalId, path, true)
  store.setDirError(terminalId, path, null)
  try {
    const result = await termFsLs(terminalId, path)
    if (!store.getSlice(terminalId).rootPath) {
      store.setRootPath(terminalId, result.path)
    }
    store.setEntries(terminalId, result.path, result.entries)
    if (result.path !== path && path) {
      store.setEntries(terminalId, path, result.entries)
    }
    store.setError(terminalId, null)
  } catch (e) {
    if (isTermFsNotReadyError(e) && attempt < MAX_RETRIES) {
      store.setLoading(terminalId, path, false)
      await new Promise((r) => setTimeout(r, RETRY_MS))
      return loadLocalDir(terminalId, path, attempt + 1)
    }
    const msg = e instanceof Error ? e.message : String(e ?? 'Local FS error')
    const slice = store.getSlice(terminalId)
    if (!slice.rootPath || path === slice.rootPath || path === '.' || path === '' || path === './') {
      store.setError(terminalId, msg)
    } else {
      store.setDirError(terminalId, path, msg)
    }
  } finally {
    store.setLoading(terminalId, path, false)
  }
}

export async function refreshLocalDir(terminalId: string, path: string): Promise<void> {
  await loadLocalDir(terminalId, path)
}
