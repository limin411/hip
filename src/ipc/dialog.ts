// Native folder picker. In E2E (and any harness), `window.__hipPickDir` is a seam
// that returns a fixture path, since WebdriverIO can't drive the native OS dialog.
declare global {
  interface Window {
    __hipPickDir?: () => Promise<string | null>
  }
}

export async function pickDirectory(): Promise<string | null> {
  if (typeof window !== 'undefined' && window.__hipPickDir) return window.__hipPickDir()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ directory: true, multiple: false, title: '选择项目文件夹' })
  return typeof result === 'string' ? result : null
}

export {}
