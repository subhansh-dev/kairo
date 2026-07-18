/**
 * Kairo — Task Store
 * File-based task persistence with in-memory cache
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { Task, TaskCreateInput, TaskUpdateInput, TaskListFilter, TaskStatus } from './types.js'

const TASKS_DIR = join(homedir(), '.kairo', 'tasks')

function getTaskListPath(taskListId: string): string {
  return join(TASKS_DIR, `${taskListId}.json`)
}

function ensureDir(): void {
  if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true })
}

function loadTasks(taskListId: string): Map<string, Task> {
  const path = getTaskListPath(taskListId)
  if (!existsSync(path)) return new Map()
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    const map = new Map<string, Task>()
    for (const [id, task] of Object.entries(data)) {
      map.set(id, task as Task)
    }
    return map
  } catch {
    return new Map()
  }
}

function saveTasks(taskListId: string, tasks: Map<string, Task>): void {
  ensureDir()
  const obj: Record<string, Task> = {}
  for (const [id, task] of tasks) {
    obj[id] = task
  }
  writeFileSync(getTaskListPath(taskListId), JSON.stringify(obj, null, 2))
}

// ─── Public API ──────────────────────────────────────────────────

export function createTaskId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function createTask(taskListId: string, input: TaskCreateInput): string {
  const tasks = loadTasks(taskListId)
  const id = createTaskId()
  const now = new Date().toISOString()
  const task: Task = {
    id,
    subject: input.subject,
    description: input.description,
    activeForm: input.activeForm,
    status: 'pending',
    blocks: [],
    blockedBy: [],
    metadata: input.metadata,
    createdAt: now,
    updatedAt: now,
  }
  tasks.set(id, task)
  saveTasks(taskListId, tasks)
  return id
}

export function getTask(taskListId: string, taskId: string): Task | undefined {
  const tasks = loadTasks(taskListId)
  return tasks.get(taskId)
}

export function listTasks(taskListId: string, filter?: TaskListFilter): Task[] {
  const tasks = loadTasks(taskListId)
  let result = Array.from(tasks.values())
  if (filter?.status) result = result.filter(t => t.status === filter.status)
  if (filter?.owner) result = result.filter(t => t.owner === filter.owner)
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function updateTask(taskListId: string, taskId: string, input: TaskUpdateInput): Task | undefined {
  const tasks = loadTasks(taskListId)
  const task = tasks.get(taskId)
  if (!task) return undefined
  const now = new Date().toISOString()
  const updated: Task = {
    ...task,
    subject: input.subject ?? task.subject,
    description: input.description ?? task.description,
    activeForm: input.activeForm ?? task.activeForm,
    status: input.status ?? task.status,
    owner: input.owner ?? task.owner,
    blocks: input.addBlocks ? [...task.blocks, ...input.addBlocks] : task.blocks,
    blockedBy: input.addBlockedBy ? [...task.blockedBy, ...input.addBlockedBy] : task.blockedBy,
    metadata: input.metadata ? { ...task.metadata, ...input.metadata } : task.metadata,
    output: input.output ?? task.output,
    updatedAt: now,
    completedAt: input.status === 'completed' ? now : task.completedAt,
  }
  tasks.set(taskId, updated)
  saveTasks(taskListId, tasks)
  return updated
}

export function deleteTask(taskListId: string, taskId: string): boolean {
  const tasks = loadTasks(taskListId)
  const existed = tasks.has(taskId)
  tasks.delete(taskId)
  if (existed) saveTasks(taskListId, tasks)
  return existed
}

export function getTaskListId(): string {
  return 'default'
}
