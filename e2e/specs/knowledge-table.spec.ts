/**
 * Knowledge table e2e (knowledge-table P0): create → edit → persist → reopen → export.
 * Tags: @knowledge @table @core
 *
 * 桌面端执行（wdio），与既有 knowledge-*.spec.ts 一致。覆盖 spec §8 e2e 清单：
 * 新建表格 → 编辑多单元格 → 保存 → 重开文件数据不丢；导出 CSV 与文件一致。
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openKnowledgeFromMenu,
  createSpaceAndOpen,
  goKnowledgeHome,
  waitForKnowledgeWritableSurface,
  waitForTableCsvOnDisk,
  listTableCsvOnDisk,
  deleteSpaceFromWorkspace,
  installSavePathSeam,
  clearSavePathSeam,
} from '../helpers/knowledge.js'

describe('knowledge table flow @knowledge @table', () => {
  const spaceName = `e2e-kb-table-${Date.now()}`
  const tableName = `e2e-表-${Date.now()}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
  })

  after(async () => {
    await clearSavePathSeam()
  })

  it('creates a table via the browse toolbar dropdown with inline naming', async () => {
    await openKnowledgeFromMenu()
    await createSpaceAndOpen(spaceName)
    await waitForKnowledgeWritableSurface()

    // 新建下拉 → 表格
    await browser.$('[data-testid="browse-new"]').click()
    const menu = await browser.$('[data-testid="browse-new-menu"]')
    await menu.waitForDisplayed()
    await menu.$('button[role="menuitem"]:nth-child(3)').click()
    // 内联命名
    const inline = await browser.$('[data-testid="browse-inline-new"] input')
    await inline.waitForDisplayed()
    await inline.setValue(tableName)
    await browser.keys('Enter')

    // 编辑器打开，默认空表 3×3
    await browser.$('[data-testid="knowledge-table-editor"]').waitForDisplayed()
    const grid = await browser.$('[data-testid="table-grid"]')
    expect(await grid.getAttribute('data-cols')).toBe('3')
    expect(await grid.getAttribute('data-rows')).toBe('3')
    expect(await browser.$('[data-testid="table-editor-title"]').getText()).toContain(tableName)
  })

  it('edits cells with keyboard navigation and persists to tbl_*.csv', async () => {
    // 双击首格输入
    const cell = await browser.$('td[data-cell="0,0"]')
    await cell.doubleClick()
    const input = await browser.$('[data-testid="table-cell-input"]')
    await input.waitForDisplayed()
    await input.setValue('e2e-marker-alpha')
    await browser.keys('Enter')
    // 直接双击第二格编辑（Enter 提交后焦点回网格，Tab 为选区移动）
    await browser.$('td[data-cell="0,1"]').doubleClick()
    const input2 = await browser.$('[data-testid="table-cell-input"]')
    await input2.waitForDisplayed()
    await input2.setValue('e2e-marker-beta')
    await browser.keys('Enter')

    // 防抖保存 → csv 落盘（含 BOM 兼容的 UTF-8 文本）
    const csvPath = await waitForTableCsvOnDisk('e2e-marker-alpha')
    const csv = require('node:fs').readFileSync(csvPath, 'utf8')
    expect(csv).toContain('e2e-marker-alpha')
    expect(csv).toContain('e2e-marker-beta')
    // meta.json 与 csv 同 stem
    expect(require('node:fs').existsSync(csvPath.replace('.csv', '.meta.json'))).toBe(true)
  })

  it('reopens the table and data is intact (reopen-from-disk contract)', async () => {
    await browser.$('[data-testid="table-editor-back"]').click()
    await browser.$('[data-testid="doc-manager-browse"]').waitForDisplayed()
    // 树中打开表格节点
    const row = await browser.$(`[data-testid^="knowledge-tree-doc-"][data-node-kind="table"]`)
    await row.click()
    await browser.$('[data-testid="knowledge-table-editor"]').waitForDisplayed()
    const firstCell = await browser.$('td[data-cell="0,0"]')
    expect(await firstCell.getText()).toContain('e2e-marker-alpha')
    const secondCell = await browser.$('td[data-cell="0,1"]')
    expect(await secondCell.getText()).toContain('e2e-marker-beta')
  })

  it('right rail shows table info and column jump flashes the header (table-right-panel PR-3)', async () => {
    // rail 标题联动
    await browser.$('[data-testid="knowledge-table-info"]').waitForDisplayed()
    expect(await browser.$('[data-testid="panel-title"]').getText()).toContain('表格信息')
    // 列清单（新建表格 3 列）→ 点击第 0 列 → 列头闪烁
    const colRow = await browser.$('[data-testid="table-info-col-0"]')
    await colRow.waitForDisplayed()
    await colRow.click()
    const th = await browser.$('[data-testid="table-grid"] th[data-col="0"]')
    await browser.waitUntil(
      async () => (await th.getAttribute('style')).includes('tbl-sel-strong'),
      { timeout: 5000 },
    )
    // 闪烁结束后恢复
    await browser.waitUntil(
      async () => !(await th.getAttribute('style')).includes('tbl-sel-strong'),
      { timeout: 5000 },
    )
  })

  it('renames the table title inline (tree.json round-trip)', async () => {
    const title = await browser.$('[data-testid="table-editor-title"]')
    await title.doubleClick()
    const input = await browser.$('[data-testid="table-title-input"]')
    await input.waitForDisplayed()
    const renamed = `${tableName}-v2`
    await input.setValue(renamed)
    await browser.keys('Enter')
    await browser.waitUntil(async () => (await title.getText()).includes(renamed), {
      timeout: 5000,
    })
  })

  it('exports CSV with BOM via save seam; export matches on-disk data', async () => {
    const dest = `${process.env.HIP_DATA_DIR ?? '/tmp'}/table-export-${Date.now()}.csv`
    await installSavePathSeam(dest)
    await browser.$('[data-testid="table-export"]').click()
    // 导出完成（seam 写入 dest）
    await browser.waitUntil(
      () => require('node:fs').existsSync(dest),
      { timeout: 10000, interval: 200 },
    )
    const exported = require('node:fs').readFileSync(dest, 'utf8')
    expect(exported.charCodeAt(0)).toBe(0xfeff)
    expect(exported).toContain('e2e-marker-alpha')
    // 与磁盘 csv 一致（BOM 除外）
    const disk = require('node:fs').readFileSync(listTableCsvOnDisk()[0], 'utf8')
    expect(exported.replace(/^\uFEFF/, '')).toBe(disk)
  })

  it('deletes the table space at the end', async () => {
    await goKnowledgeHome()
    await deleteSpaceFromWorkspace()
    expect(await listTableCsvOnDisk()).toHaveLength(0)
  })
})
