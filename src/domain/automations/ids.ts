import { nanoid } from 'nanoid'

/** Automation ids: `auto_` + nanoid alphabet. */
export const AUTOMATION_ID_RE = /^auto_[A-Za-z0-9_-]+$/

/** Run ids: `arun_` + nanoid alphabet. */
export const AUTOMATION_RUN_ID_RE = /^arun_[A-Za-z0-9_-]+$/

export function isAutomationId(id: string): boolean {
  return AUTOMATION_ID_RE.test(id)
}

export function isAutomationRunId(id: string): boolean {
  return AUTOMATION_RUN_ID_RE.test(id)
}

export function mintAutomationId(): string {
  return `auto_${nanoid()}`
}

export function mintAutomationRunId(): string {
  return `arun_${nanoid()}`
}
