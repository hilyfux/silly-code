/**
 * LocalWorkflowTask — stub for source-mode compatibility.
 * Required by: src/tasks.ts (WORKFLOW_SCRIPTS flag)
 * Required by: src/components/tasks/BackgroundTasksDialog.tsx — killWorkflowTask, skipWorkflowAgent, retryWorkflowAgent
 */
import type { Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'workflow'
  scriptPath: string
}

export const LocalWorkflowTask: Task = {
  type: 'workflow',
  displayName: 'Workflow',
  start: async () => generateTaskId(),
  stop: async () => {},
}

export function killWorkflowTask(
  _taskId: string,
  _getAppState: () => unknown,
  _setAppState: (fn: (s: unknown) => unknown) => void,
): void {}

export function skipWorkflowAgent(
  _taskId: string,
  _getAppState: () => unknown,
  _setAppState: (fn: (s: unknown) => unknown) => void,
): void {}

export function retryWorkflowAgent(
  _taskId: string,
  _getAppState: () => unknown,
  _setAppState: (fn: (s: unknown) => unknown) => void,
): void {}
