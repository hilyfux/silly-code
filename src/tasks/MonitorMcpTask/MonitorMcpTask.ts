/**
 * MonitorMcpTask — stub for source-mode compatibility.
 * Required by: src/tasks.ts (MONITOR_TOOL flag)
 */
import type { Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'

export type MonitorMcpTaskState = TaskStateBase & {
  type: 'monitor_mcp'
  processId: string
}

export const MonitorMcpTask: Task = {
  type: 'monitor_mcp',
  displayName: 'Monitor',
  start: async () => generateTaskId(),
  stop: async () => {},
}
