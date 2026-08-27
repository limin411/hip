/**
 * 路径工具函数
 * 用于终端文件面板的路径导航功能
 */

/**
 * 获取父目录路径
 * @param path 当前路径
 * @returns 父目录路径
 */
export function getParentPath(path: string): string {
  if (!path || path === '/') return '/'
  const normalized = path.replace(/\/+$/, '')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return normalized.slice(0, lastSlash)
}

/**
 * 标准化路径
 * @param path 输入路径
 * @param basePath 基础路径（用于相对路径）
 * @returns 标准化后的路径
 */
export function normalizePath(path: string, basePath?: string): string {
  // 处理特殊路径
  if (path === '~') {
    // 这里应该从环境变量或配置获取家目录
    // 暂时返回一个默认值
    return '/home/user'
  }
  if (path === '.') {
    return basePath || '/'
  }
  if (path === '..') {
    return basePath ? getParentPath(basePath) : '/'
  }
  
  // 标准化路径分隔符
  let normalized = path.replace(/\\/g, '/')
  
  // 处理相对路径
  if (!normalized.startsWith('/')) {
    normalized = basePath ? `${basePath}/${normalized}` : `/${normalized}`
  }
  
  // 解析 . 和 ..
  const parts = normalized.split('/').filter(Boolean)
  const resolved: string[] = []
  
  for (const part of parts) {
    if (part === '.') {
      continue
    }
    if (part === '..') {
      resolved.pop()
    } else {
      resolved.push(part)
    }
  }
  
  return '/' + resolved.join('/')
}

/**
 * 分割路径为面包屑片段
 * @param path 完整路径
 * @returns 面包屑片段数组
 */
export function splitPath(path: string): Array<{ name: string; path: string }> {
  if (!path || path === '/') return []
  
  const parts = path.split('/').filter(Boolean)
  return parts.map((part, index) => ({
    name: part,
    path: '/' + parts.slice(0, index + 1).join('/')
  }))
}

/**
 * 检查路径是否为根目录
 * @param path 路径
 * @returns 是否为根目录
 */
export function isRootPath(path: string): boolean {
  return !path || path === '/'
}

/**
 * 获取路径深度
 * @param path 路径
 * @returns 路径深度（根目录为 0）
 */
export function getPathDepth(path: string): number {
  if (!path || path === '/') return 0
  return path.split('/').filter(Boolean).length
}

/**
 * 获取路径的显示名称
 * @param path 路径
 * @returns 显示名称
 */
export function getPathDisplayName(path: string): string {
  if (!path || path === '/') return '/'
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || '/'
}

/**
 * 检查路径是否有效
 * @param path 路径
 * @returns 是否有效
 */
export function isValidPath(path: string): boolean {
  if (!path) return false
  // 检查是否包含非法字符
  const invalidChars = /[<>:"|?*]/
  return !invalidChars.test(path)
}

/**
 * 合并路径
 * @param base 基础路径
 * @param relative 相对路径
 * @returns 合并后的路径
 */
export function joinPaths(base: string, relative: string): string {
  if (!base) return relative
  if (!relative) return base
  
  const normalizedBase = base.replace(/\/+$/, '')
  const normalizedRelative = relative.replace(/^\/+/, '')
  
  return `${normalizedBase}/${normalizedRelative}`
}

/**
 * 获取路径的目录部分
 * @param path 文件路径
 * @returns 目录路径
 */
export function getDirectoryPath(path: string): string {
  if (!path) return '/'
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return path.slice(0, lastSlash)
}

/**
 * 获取路径的文件名部分
 * @param path 文件路径
 * @returns 文件名
 */
export function getFileName(path: string): string {
  if (!path) return ''
  const parts = path.split('/')
  return parts[parts.length - 1] || ''
}

/**
 * 检查路径是否以指定前缀开头
 * @param path 路径
 * @param prefix 前缀
 * @returns 是否以指定前缀开头
 */
export function pathStartsWith(path: string, prefix: string): boolean {
  if (!path || !prefix) return false
  const normalizedPath = path.replace(/\/+$/, '')
  const normalizedPrefix = prefix.replace(/\/+$/, '')
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(normalizedPrefix + '/')
}

/**
 * 获取相对路径
 * @param from 起始路径
 * @param to 目标路径
 * @returns 相对路径
 */
export function getRelativePath(from: string, to: string): string {
  if (!from || !to) return to
  
  const fromParts = from.split('/').filter(Boolean)
  const toParts = to.split('/').filter(Boolean)
  
  // 找到共同前缀
  let commonLength = 0
  const minLength = Math.min(fromParts.length, toParts.length)
  
  for (let i = 0; i < minLength; i++) {
    if (fromParts[i] === toParts[i]) {
      commonLength++
    } else {
      break
    }
  }
  
  // 构建相对路径
  const upCount = fromParts.length - commonLength
  const downParts = toParts.slice(commonLength)
  
  const relativeParts: string[] = []
  for (let i = 0; i < upCount; i++) {
    relativeParts.push('..')
  }
  relativeParts.push(...downParts)
  
  return relativeParts.join('/') || '.'
}
