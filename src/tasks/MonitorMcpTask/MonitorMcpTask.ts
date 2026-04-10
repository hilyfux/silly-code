/**
 * MonitorMcpTask — stub for source-mode compatibility.
 * Required by: src/tasks.ts (MONITOR_TOOL flag)
 * Required by: src/tools/AgentTool/runAgent.ts — killMonitorMcpTasksForAgent
 * Required by: src/components/tasks/BackgroundTasksDialog.tsx — killMonitorMcp
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

export function killMonitorMcpTasksForAgent(
  _agentId: string,
  _getAppState: () => unknown,
  _setAppState: (fn: (s: unknown) => unknown) => void,
): void {}

export function killMonitorMcp(
  _taskId: string,
  _getAppState: () => unknown,
  _setAppState: (fn: (s: unknown) => unknown) => void,
): void {}
