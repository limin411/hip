import { MAX_STEPS } from './loop-control.js'

export interface Activity {
  readonly id: string
  readonly description: string
  readonly startedAt: number
  stepsRemaining: number
  readonly totalStepsAllowed: number
}

export class ActivityTracker implements Activity {
  readonly id: string
  readonly description: string
  readonly startedAt: number
  stepsRemaining: number
  readonly totalStepsAllowed: number

  constructor(id: string, description: string, totalStepsAllowed: number = MAX_STEPS) {
    this.id = id
    this.description = description
    this.startedAt = Date.now()
    this.totalStepsAllowed = totalStepsAllowed
    this.stepsRemaining = totalStepsAllowed
  }

  consume(steps: number): void {
    this.stepsRemaining = Math.max(0, this.stepsRemaining - steps)
  }

  extend(steps: number): void {
    this.stepsRemaining += steps
  }
}
