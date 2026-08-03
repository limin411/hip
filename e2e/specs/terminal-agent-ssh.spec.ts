import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { openPanelTabDropdown } from '../helpers/panel.js'

const HOST_ID = 'hst_SNVjrGvzZ3oNUCToV5GNb'
const EXPECTED_HOSTNAME = 'iZwz97e2o2s2r1lt9515lkZ'

/**
 * Real-device SSH test for the terminal agent panel (spec v2.6 P0–P2):
 * connect the only saved SSH host, open the Agent tab, run one approved
 * terminal_exec turn, and one sftp_read turn.
 *
 * Prerequisites:
 * - E2E_DATA_DIR staged with config/terminal-hosts.json (the real catalog)
 * - staged auth.json contains hip.ssh.<hostId>.password (harness copies it)
 * - real LLM key available (harness stages ~/.hip/config/auth.json)
 */
describe('terminal agent over real SSH @terminal-ssh', function () {
  this.timeout(240000)

  it('connects the SSH host and opens the Agent tab', async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()

    const terminalsNav = await browser.$('[data-testid="sidebar-nav-terminals"]')
    await terminalsNav.waitForExist({ timeout: 20000 })
    await terminalsNav.click()

    // HostLibrary landing with the real saved host.
    const ungrouped = await browser.$('[data-testid="host-group-select-ungrouped"]')
    await ungrouped.waitForExist({ timeout: 10000 })
    await ungrouped.click()
    const hostRow = await browser.$(`[data-testid="host-row-${HOST_ID}"]`)
    await hostRow.waitForExist({ timeout: 20000 })
    const connect = await browser.$(`[data-testid="host-connect-${HOST_ID}"]`)
    await connect.waitForExist({ timeout: 10000 })
    await connect.click()

    // A managed terminal row appears and the right rail opens (files tab default).
    // NOTE: P2 may have restored older disconnected records, so match the row
    // that actually reaches connected rather than the first row in the list.
    const managedRow = await browser.$('[data-testid^="sidebar-managed-terminal-tm_"]')
    await managedRow.waitForExist({ timeout: 30000 })
    const rightPanel = await browser.$('[data-testid="terminal-right-panel"]')
    await rightPanel.waitForExist({ timeout: 30000 })
    const mainSession = await browser.$('[data-testid="managed-terminal-session"]')
    await mainSession.waitForExist({ timeout: 30000 })

    await browser.waitUntil(
      async () => {
        const rows = await browser.$$('[data-testid^="sidebar-managed-terminal-tm_"]')
        for (const row of rows) {
          const text = (await row.getText()).toLowerCase()
          if (text.includes('connected') || text.includes('已连接')) return true
        }
        return false
      },
      {
        timeout: 60000,
        interval: 1000,
        timeoutMsg: 'SSH did not reach connected state',
      },
    )

    // Switch the right rail to the Agent tab via the titlebar Tab▾.
    const tabTrigger = await browser.$('[data-testid="panel-tab-trigger"]')
    await tabTrigger.waitForExist({ timeout: 10000 })
    await openPanelTabDropdown()
    const agentTab = await browser.$('[data-testid="panel-tab-agent"]')
    await agentTab.waitForExist({ timeout: 10000 })
    await browser.execute((el: HTMLElement) => el.click(), agentTab)

    const agentPanel = await browser.$('[data-testid="terminal-agent-panel"]')
    await agentPanel.waitForExist({ timeout: 15000 })
  })

  it('runs df -h through the shared PTY with approval (terminal_exec)', async () => {
    const start = await browser.$('[data-testid="terminal-agent-start"]')
    await start.waitForExist({ timeout: 15000 })
    await start.click()

    const input = await browser.$('[data-testid="terminal-composer-input"]')
    await input.waitForExist({ timeout: 15000 })
    await input.click()
    await browser.keys('用 terminal_exec 运行 df -h，然后只回答根分区（挂载点 /）的使用率。')
    await browser.keys('Enter')

    // The user message must land in the transcript (proves the WS send fired).
    await browser.waitUntil(
      async () => {
        const rows = await browser.$$('[data-testid="terminal-msg-user"]')
        return rows.length > 0
      },
      { timeout: 15000, interval: 500, timeoutMsg: 'user message did not appear in transcript' },
    )

    // HITL approval card (session-scoped) appears when the model calls terminal_exec.
    const permissionCard = await browser.$('[data-testid="terminal-permission-card"]')
    await permissionCard.waitForExist({
      timeout: 120000,
      interval: 1000,
    })
    const approve = await browser.$('[data-testid="terminal-permission-allow_once"]')
    await approve.waitForExist({ timeout: 10000 })
    await approve.click()

    // The UI bridge marks the per-tm flight; wait for it to clear.
    const flight = await browser.$('[data-testid="terminal-exec-flight"]')
    await browser.waitUntil(
      async () => !(await flight.isExisting()),
      {
        timeout: 120000,
        interval: 500,
        timeoutMsg: 'terminal-exec flight did not settle',
      },
    )

    // The terminal_exec tool card renders collapsed by default; expand it first,
    // then the captured df output must be visible.
    await browser.waitUntil(
      async () => {
        const card = await browser.$(
          '[data-testid="terminal-tool-card"][data-tool="terminal_exec"]',
        )
        return card.isExisting()
      },
      {
        timeout: 60000,
        interval: 1000,
        timeoutMsg: 'terminal_exec tool card did not appear',
      },
    )
    const execCard = await browser.$(
      '[data-testid="terminal-tool-card"][data-tool="terminal_exec"]',
    )
    await browser.execute((el: HTMLElement) => el.click(), execCard)
    await browser.waitUntil(
      async () => (await execCard.getAttribute('data-expanded')) === 'true',
      { timeout: 10000, interval: 200, timeoutMsg: 'terminal_exec card did not expand' },
    )
    await browser.waitUntil(
      async () => (await execCard.getText()).includes('Filesystem'),
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'expanded terminal_exec card lacks df output',
      },
    )

    // Assistant reply lands in the session-scoped message list.
    const assistant = await browser.$('[data-testid="terminal-msg-assistant"]')
    await browser.waitUntil(
      async () => {
        if (!(await assistant.isExisting())) return false
        const text = (await assistant.getText()).toLowerCase()
        return text.includes('%') || text.includes('使用率') || text.includes('55')
      },
      {
        timeout: 120000,
        interval: 1000,
        timeoutMsg: 'assistant did not answer with the root partition usage',
      },
    )

    // The conversation appears in the sidebar session tree under the SSH row.
    const childRow = await browser.$('[data-testid^="sidebar-terminal-session-"]')
    await childRow.waitForExist({ timeout: 15000 })
  })

  it('reads a remote file via sftp_read (no approval)', async () => {
    const input = await browser.$('[data-testid="terminal-composer-input"]')
    await input.waitForExist({ timeout: 15000 })
    await input.click()
    await browser.keys(
      `用 sftp_read 读取远程文件 /etc/hostname，然后告诉我内容（应为 ${EXPECTED_HOSTNAME}）。`,
    )
    await browser.keys('Enter')

    await browser.waitUntil(
      async () => {
        const assistant = await browser.$('[data-testid="terminal-msg-assistant"]')
        if (!(await assistant.isExisting())) return false
        return (await assistant.getText()).includes(EXPECTED_HOSTNAME)
      },
      {
        timeout: 150000,
        interval: 1000,
        timeoutMsg: 'assistant did not return the remote hostname via sftp_read',
      },
    )
  })
})
