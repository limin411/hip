import { create } from 'zustand'
import {
  defaultStatusFromFilter,
  localTodayYmd,
  type WorkItemStatus,
} from '@/domain/work-items'
import { useWorkItemStore } from '@/store/workItemStore'

export type CreateDefaults = {
  startOn: string
  endOn: string
  status?: WorkItemStatus
}

export type WorkItemModalSession =
  | { mode: 'closed' }
  | { mode: 'create'; defaults: CreateDefaults }
  | { mode: 'edit'; itemId: string }

export type WorkItemViewMode = 'calendar' | 'list'

type WorkItemViewStore = {
  modal: WorkItemModalSession
  viewMode: WorkItemViewMode
  /** 0-based month index */
  calendarCursor: { year: number; monthIndex: number }
  /** List-mode keyboard highlight only */
  highlightId: string | null
  /** 1-based page index for list view pagination */
  listPage: number

  requestCreate: (defaults?: Partial<CreateDefaults>) => void
  requestEdit: (itemId: string) => void
  closeModal: () => void
  setViewMode: (mode: WorkItemViewMode) => void
  setCalendarCursor: (year: number, monthIndex: number) => void
  shiftCalendarMonth: (delta: number) => void
  setHighlightId: (id: string | null) => void
  setListPage: (page: number) => void
  /** Reset modal + highlight when leaving tasks view */
  leaveWorkItems: () => void
}

function nowCursor(): { year: number; monthIndex: number } {
  const d = new Date()
  return { year: d.getFullYear(), monthIndex: d.getMonth() }
}

export const useWorkItemViewStore = create<WorkItemViewStore>((set, get) => ({
  modal: { mode: 'closed' },
  viewMode: 'calendar',
  calendarCursor: nowCursor(),
  highlightId: null,
  listPage: 1,

  requestCreate: (defaults) => {
    const today = localTodayYmd()
    // Prefer explicit status; otherwise inherit the active sidebar filter category.
    const status =
      defaults?.status ??
      defaultStatusFromFilter(useWorkItemStore.getState().filterId)
    set({
      modal: {
        mode: 'create',
        defaults: {
          startOn: defaults?.startOn ?? today,
          endOn: defaults?.endOn ?? defaults?.startOn ?? today,
          status,
        },
      },
    })
  },

  requestEdit: (itemId) => {
    set({ modal: { mode: 'edit', itemId }, highlightId: itemId })
  },

  closeModal: () => set({ modal: { mode: 'closed' } }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setCalendarCursor: (year, monthIndex) => set({ calendarCursor: { year, monthIndex } }),

  shiftCalendarMonth: (delta) => {
    const { year, monthIndex } = get().calendarCursor
    const d = new Date(year, monthIndex + delta, 1)
    set({ calendarCursor: { year: d.getFullYear(), monthIndex: d.getMonth() } })
  },

  setHighlightId: (id) => set({ highlightId: id }),

  setListPage: (page) => set({ listPage: Math.max(1, Math.floor(page)) }),

  leaveWorkItems: () => {
    set({ modal: { mode: 'closed' }, highlightId: null, listPage: 1 })
  },
}))

export function __resetWorkItemViewStoreForTests(): void {
  useWorkItemViewStore.setState({
    modal: { mode: 'closed' },
    viewMode: 'calendar',
    calendarCursor: nowCursor(),
    highlightId: null,
    listPage: 1,
  })
}
