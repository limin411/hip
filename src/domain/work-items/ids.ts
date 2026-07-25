import { nanoid } from 'nanoid'

/** System Inbox list id — always present in catalog. */
export const INBOX_LIST_ID = 'wl_inbox'

/** Item ids: `wi_` + nanoid alphabet. */
export const WORK_ITEM_ID_RE = /^wi_[A-Za-z0-9_-]+$/

/** List ids: `wl_` + nanoid alphabet (includes `wl_inbox`). */
export const WORK_LIST_ID_RE = /^wl_[A-Za-z0-9_-]+$/

export function isWorkItemId(id: string): boolean {
  return WORK_ITEM_ID_RE.test(id)
}

export function isWorkListId(id: string): boolean {
  return WORK_LIST_ID_RE.test(id)
}

export function mintWorkItemId(): string {
  return `wi_${nanoid()}`
}

export function mintWorkListId(): string {
  return `wl_${nanoid()}`
}
