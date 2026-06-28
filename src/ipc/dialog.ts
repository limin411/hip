// Native folder picker. In E2E (and any harness), `window.__hipPickDir` is a seam
// that returns a fixture path, since WebdriverIO can't drive the native OS dialog.
declare global {
  interface Window {
    __hipPickDir?: () => Promise<string | null>
    __hipPickZip?: () => Promise<string | null>
    __hipPickAttachmentFiles?: () => Promise<string[] | null>
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

export async function pickAttachmentFiles(): Promise<string[] | null> {
  if (typeof window !== 'undefined' && window.__hipPickAttachmentFiles) return window.__hipPickAttachmentFiles()
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    multiple: true,
    title: '选择附件',
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: '文本文档', extensions: ['txt', 'md', 'json', 'yaml', 'yml', 'csv', 'xml', 'toml', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'swift', 'kt', 'html', 'css', 'scss', 'sql', 'sh', 'ps1'] },
    ],
  })
  if (result === null) return null
  return Array.isArray(result) ? result : [result]
}

export {}
