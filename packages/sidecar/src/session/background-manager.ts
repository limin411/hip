/**
 * Backward-compatible entry: BackgroundManager is TaskRuntime.
 * Implementation lives in task-runtime.ts.
 */
export {
  BackgroundManager,
  BackgroundTaskPersistence,
  TaskRuntime,
  DEFAULT_TASK_CAPS,
  type BackgroundTaskMeta,
  type BackgroundTaskStatus,
  type TaskCaps,
  type TaskRuntimeOpts,
  type SpawnShellOpts,
  type SpawnMonitorOpts,
  type UpsertScheduleOpts,
  type WaitManyResult,
  type TaskInternal,
} from './task-runtime.js'
