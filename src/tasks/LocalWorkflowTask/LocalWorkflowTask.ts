/**
 * LocalWorkflowTask — stub for source-mode compatibility.
 * Required by: src/tasks.ts (WORKFLOW_SCRIPTS flag)
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
