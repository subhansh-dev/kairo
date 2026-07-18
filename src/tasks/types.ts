/**
 * Kairo — Task Types
 * Adapted to kairo's simpler architecture
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

export interface Task {
  id: string
  subject: string
  description: string
  activeForm?: string
  status: TaskStatus
  owner?: string
  blocks: string[]
  blockedBy: string[]
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  completedAt?: string
  output?: string
}

export interface TaskCreateInput {
  subject: string
  description: string
  activeForm?: string
  metadata?: Record<string, unknown>
}

export interface TaskUpdateInput {
  subject?: string
  description?: string
  activeForm?: string
  status?: TaskStatus
  owner?: string
  addBlocks?: string[]
  addBlockedBy?: string[]
  metadata?: Record<string, unknown>
  output?: string
}

export interface TaskListFilter {
  status?: TaskStatus
  owner?: string
}
