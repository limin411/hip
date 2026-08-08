/**
 * 模板变量（V2-E1 T4.10）：新建文档时替换 `{{date}}` / `{{title}}`。
 * 无 `{{tags}}`（v2.1 元数据决策）；未知变量原样保留，不报错。
 */

/** Local date as YYYY-MM-DD (local timezone). `now` injectable for tests. */
export function todayStamp(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Replace `{{date}}` and `{{title}}` in a template body.
 * Unknown variables (e.g. `{{tags}}`, `{{foo}}`) are left untouched.
 */
export function expandTemplateVariables(
  body: string,
  opts: { title: string; now?: Date },
): string {
  return body
    .replace(/\{\{\s*date\s*\}\}/g, todayStamp(opts.now))
    .replace(/\{\{\s*title\s*\}\}/g, opts.title)
}
