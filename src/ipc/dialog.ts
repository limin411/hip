// Native folder picker. In E2E (and any harness), `window.__hipPickDir` is a seam
// that returns a fixture path, since WebdriverIO can't drive the native OS dialog.
declare global {
  interface Window {
    __hipPickDir?: () => Promise<string | null>
    __hipPickZip?: () => Promise<string | null>
  }
}

export async function pickDirectory(): Promise<string | null> {
  if (typeof window !== 'undefined' && window.__hipPickDir) return window.__hipPickDir()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ directory: true, multiple: false, title: '选择项目文件夹' })
  return typeof result === 'string' ? result : null
}

export async function pickZipFile(): Promise<string | null> {
  if (typeof window !== 'undefined' && window.__hipPickZip) return window.__hipPickZip()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    multiple: false,
    title: '选择 skill 压缩包',
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  })
  return typeof result === 'string' ? result : null
}

export {}
