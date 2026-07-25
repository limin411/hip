import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkItemStore } from '@/store/workItemStore'
import {
  __resetWorkItemViewStoreForTests,
  useWorkItemViewStore,
} from '@/store/workItemViewStore'

describe('workItemViewStore.requestCreate', () => {
  beforeEach(() => {
    __resetWorkItemViewStoreForTests()
    useWorkItemStore.setState({ filterId: 'all' })
  })

  it('defaults status from active status filter', () => {
    useWorkItemStore.setState({ filterId: 'in_progress' })
    useWorkItemViewStore.getState().requestCreate()
    const modal = useWorkItemViewStore.getState().modal
    expect(modal).toMatchObject({
      mode: 'create',
      defaults: { status: 'in_progress' },
    })
  })

  it('defaults status to todo under all filter', () => {
    useWorkItemStore.setState({ filterId: 'all' })
    useWorkItemViewStore.getState().requestCreate()
    const modal = useWorkItemViewStore.getState().modal
    expect(modal).toMatchObject({
      mode: 'create',
      defaults: { status: 'todo' },
    })
  })

  it('explicit status overrides filter', () => {
    useWorkItemStore.setState({ filterId: 'done' })
    useWorkItemViewStore.getState().requestCreate({ status: 'todo' })
    const modal = useWorkItemViewStore.getState().modal
    expect(modal).toMatchObject({
      mode: 'create',
      defaults: { status: 'todo' },
    })
  })
})
