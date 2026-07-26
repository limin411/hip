import { ensureScheduleDates, localTodayYmd } from '@/domain/work-items'
import { useWorkItemViewStore } from '@/store/workItemViewStore'
import type { ContextMenuItemDef, ContextProvider } from '../types'

/** Calendar day / list blank: create with optional date range. */
export const workItemBlankProvider: ContextProvider = (req, ctx) => {
  if (req.kind !== 'workItemBlank') return []
  const today = localTodayYmd()
  const schedule = ensureScheduleDates(
    { startOn: req.payload.startOn ?? null, endOn: req.payload.endOn ?? null },
    today,
  )

  const items: ContextMenuItemDef[] = [
    {
      id: 'workItemBlank.create',
      label: ctx.t('workItems.newItem'),
      group: 'primary',
      run: () => {
        useWorkItemViewStore.getState().requestCreate({
          startOn: schedule.startOn,
          endOn: schedule.endOn,
        })
      },
    },
  ]
  return items
}
