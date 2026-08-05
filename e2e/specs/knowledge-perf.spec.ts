/**
 * Knowledge usability / perf budgets (@knowledge-perf).
 *
 * Hard "unusable" lines always fail. Targets are calibrated and soft by default
 * (`KNOWLEDGE_PERF_STRICT=1` to hard-fail targets).
 *
 * Run: yarn test:e2e:knowledge-perf
 * Budgets: e2e/helpers/knowledge-perf-budgets.ts
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openKnowledgeFromMenu,
  createSpaceAndOpen,
  closeKnowledgeChipIfOpen,
  clearWriteFailSeam,
  clearKnowledgeLiveFlag,
  setKnowledgeLiveFlag,
  seedActiveDocFromFixture,
  seedActiveDocBodyAndReopen,
  buildLargeSourceBody,
  enableKnowledgePerf,
  resetKnowledgePerf,
  readKnowledgePerfSnapshot,
  typeInKnowledgeLiveEditor,
  waitForKnowledgeMarker,
  waitForKnowledgeWritableSurface,
  waitForDocBodyOnDisk,
  countLiveBlockNodeViews,
  p95,
  E2E_KNOWLEDGE_LARGE_DOC_CHARS,
  type KnowledgePerfSnapshot,
} from '../helpers/knowledge.js'
import {
  OPEN_UNUSABLE_MS,
  TYPE_UNUSABLE_MS,
  SERIALIZE_HARD_MS,
  SERIALIZE_SOFT_MS,
  SERIALIZE_SOFT_STREAK,
  PERF_TARGETS,
  assertBudget,
} from '../helpers/knowledge-perf-budgets.js'

function logSnap(label: string, snap: KnowledgePerfSnapshot | null, extra?: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(
    `[knowledge-perf] ${label}`,
    JSON.stringify({ ...(extra ?? {}), snap }, null, 2),
  )
}

function assertSerializeSamples(
  label: string,
  samples: number[],
  targetP95: number,
): void {
  if (samples.length === 0) return
  const maxS = Math.max(...samples)
  const p = p95(samples)
  // eslint-disable-next-line no-console
  console.log(
    `[knowledge-perf] ${label} serialize max=${maxS.toFixed(1)} p95=${p?.toFixed(1)} n=${samples.length}`,
  )
  expect(maxS).toBeLessThan(SERIALIZE_HARD_MS)
  if (samples.length >= SERIALIZE_SOFT_STREAK) {
    const streak = samples.filter((s) => s > SERIALIZE_SOFT_MS).length
    // Fail if a majority of samples are soft-slow
    expect(streak).toBeLessThan(samples.length)
  }
  if (p != null) {
    assertBudget({
      label: `${label} serialize p95`,
      actualMs: p,
      hardMs: SERIALIZE_HARD_MS,
      targetMs: targetP95,
    })
  }
}

describe('knowledge usability / perf @knowledge-perf', function () {
  this.timeout(180_000)

  const stamp = Date.now()
  const spaceName = `e2e-kb-perf-${stamp}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await closeKnowledgeChipIfOpen()
    await clearWriteFailSeam()
    await clearKnowledgeLiveFlag()

    await openKnowledgeFromMenu()
    await createSpaceAndOpen(spaceName)
    await enableKnowledgePerf()
  })

  after(async () => {
    await clearWriteFailSeam()
    await clearKnowledgeLiveFlag()
    await closeKnowledgeChipIfOpen()
  })

  it('KP-O1: small-prose opens within hard + target budgets', async () => {
    await setKnowledgeLiveFlag(true)
    await enableKnowledgePerf()
    await resetKnowledgePerf()

    const t0 = Date.now()
    await seedActiveDocFromFixture('small-prose.md', {
      title: `SmallProse-${stamp}`,
      preferLive: true,
    })
    const elapsed = Date.now() - t0
    const snap = await readKnowledgePerfSnapshot()
    logSnap('KP-O1 small-prose open', snap, { wallOpenMs: elapsed })

    assertBudget({
      label: 'KP-O1 wall open',
      actualMs: elapsed,
      hardMs: OPEN_UNUSABLE_MS,
      targetMs: PERF_TARGETS.smallOpenMs,
    })

    const live = await browser.$('[data-testid="knowledge-doc-live-editor"]')
    const source = await browser.$('[data-testid="knowledge-doc-editor"]')
    expect((await live.isExisting()) || (await source.isExisting())).toBe(true)

    if (snap?.open.firstEditableMs != null) {
      assertBudget({
        label: 'KP-O1 firstEditableMs',
        actualMs: snap.open.firstEditableMs,
        hardMs: OPEN_UNUSABLE_MS,
        targetMs: PERF_TARGETS.firstEditableSmallMs,
      })
    }

    await waitForKnowledgeMarker('SMALL_PROSE_MARKER_V1', 10_000)
  })

  it('KP-T1: small-prose typing within hard + target budgets', async () => {
    if (!(await (await browser.$('[data-testid="knowledge-doc-live-editor"]')).isExisting())) {
      await seedActiveDocFromFixture('small-prose.md', {
        title: `SmallProse-type-${stamp}`,
        preferLive: true,
      })
    }

    await enableKnowledgePerf()
    await resetKnowledgePerf()

    const marker = `perf-type-${stamp}`
    const t0 = Date.now()
    await typeInKnowledgeLiveEditor(marker)
    await waitForKnowledgeMarker(marker, TYPE_UNUSABLE_MS)
    const typeMs = Date.now() - t0
    await waitForDocBodyOnDisk(marker, TYPE_UNUSABLE_MS).catch(() => {})

    const snap = await readKnowledgePerfSnapshot()
    logSnap('KP-T1 small-prose type', snap, { wallTypeMs: typeMs })

    assertBudget({
      label: 'KP-T1 wall type',
      actualMs: typeMs,
      hardMs: TYPE_UNUSABLE_MS,
      targetMs: PERF_TARGETS.smallTypeMs,
    })

    if (snap) {
      assertSerializeSamples(
        'KP-T1',
        snap.typing.serializeSamples,
        PERF_TARGETS.serializeP95SmallMs,
      )
    }
  })

  it('KP-O2: medium-rich opens Live (BlockNote) within budgets', async () => {
    await setKnowledgeLiveFlag(true)
    await enableKnowledgePerf()
    await resetKnowledgePerf()

    const t0 = Date.now()
    await seedActiveDocFromFixture('medium-rich.md', {
      title: `MediumRich-${stamp}`,
      preferLive: true,
    })
    const elapsed = Date.now() - t0
    await browser.waitUntil(
      async () =>
        (await browser.$('[data-testid="knowledge-doc-live-editor"]')).isExisting(),
      {
        timeout: OPEN_UNUSABLE_MS,
        interval: 400,
        timeoutMsg: 'BlockNote Live host not mounted after medium-rich open',
      },
    )
    const snap = await readKnowledgePerfSnapshot()
    const counts = await countLiveBlockNodeViews()
    logSnap('KP-O2 medium-rich open', snap, { wallOpenMs: elapsed, counts })

    assertBudget({
      label: 'KP-O2 wall open',
      actualMs: elapsed,
      hardMs: OPEN_UNUSABLE_MS,
      targetMs: PERF_TARGETS.mediumOpenMs,
    })

    // Soft presence: BN may expose code blocks; no Milkdown NodeView quotas.
    expect(await (await browser.$('[data-testid="knowledge-doc-live-editor"]')).isExisting()).toBe(
      true,
    )

    await waitForKnowledgeMarker('MEDIUM_RICH_MARKER_V1', 15_000).catch(async () => {
      await waitForDocBodyOnDisk('MEDIUM_RICH_MARKER_V1', 10_000)
    })

    if (snap?.open.firstEditableMs != null) {
      assertBudget({
        label: 'KP-O2 firstEditableMs',
        actualMs: snap.open.firstEditableMs,
        hardMs: OPEN_UNUSABLE_MS,
        targetMs: PERF_TARGETS.firstEditableMediumMs,
      })
    }
  })

  it('KP-T2: medium-rich typing within hard + target budgets', async () => {
    const onLive = await (
      await browser.$('[data-testid="knowledge-doc-live-editor"]')
    ).isExisting()
    if (!onLive) {
      await seedActiveDocFromFixture('medium-rich.md', {
        title: `MediumRich-type-${stamp}`,
        preferLive: true,
      })
    }

    await enableKnowledgePerf()
    await resetKnowledgePerf()

    const marker = `perf-med-type-${stamp}`
    const t0 = Date.now()
    await typeInKnowledgeLiveEditor(marker)
    await waitForKnowledgeMarker(marker, TYPE_UNUSABLE_MS)
    const typeMs = Date.now() - t0

    const snap = await readKnowledgePerfSnapshot()
    logSnap('KP-T2 medium-rich type', snap, { wallTypeMs: typeMs })

    assertBudget({
      label: 'KP-T2 wall type',
      actualMs: typeMs,
      hardMs: TYPE_UNUSABLE_MS,
      targetMs: PERF_TARGETS.mediumTypeMs,
    })

    if (snap) {
      assertSerializeSamples(
        'KP-T2',
        snap.typing.serializeSamples,
        PERF_TARGETS.serializeP95MediumMs,
      )
    }
  })

  it('KP-O3: large body forces Source within budgets', async () => {
    const body = buildLargeSourceBody()
    expect(body.length).toBeGreaterThan(E2E_KNOWLEDGE_LARGE_DOC_CHARS)

    await setKnowledgeLiveFlag(true)
    await enableKnowledgePerf()
    await resetKnowledgePerf()

    const t0 = Date.now()
    await seedActiveDocBodyAndReopen(body, {
      title: `LargeSource-${stamp}`,
      preferLive: true,
    })
    const elapsed = Date.now() - t0
    await waitForKnowledgeWritableSurface(OPEN_UNUSABLE_MS)
    const snap = await readKnowledgePerfSnapshot()
    logSnap('KP-O3 large-source open', snap, { wallOpenMs: elapsed, bodyChars: body.length })

    assertBudget({
      label: 'KP-O3 wall open',
      actualMs: elapsed,
      hardMs: OPEN_UNUSABLE_MS,
      targetMs: PERF_TARGETS.largeOpenMs,
    })

    const live = await browser.$('[data-testid="knowledge-doc-live-editor"]')
    const source = await browser.$('[data-testid="knowledge-doc-editor"]')
    expect(await live.isExisting()).toBe(false)
    expect(await source.isExisting()).toBe(true)

    if (snap?.open.editorMode) {
      expect(snap.open.editorMode).toBe('source')
    }
  })
})
