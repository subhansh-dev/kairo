/**
 * Kairo — Goal Tracking System (Kairo-native rewrite)
 *
 * Track progress toward long-running goals across sessions.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const GOALS_DIR = join(homedir(), '.kairo', 'goals')

function ensureDir(): void {
  if (!existsSync(GOALS_DIR)) mkdirSync(GOALS_DIR, { recursive: true })
}

// ─── Types ───────────────────────────────────────────────────────

export type GoalStatus = 'active' | 'completed' | 'abandoned' | 'paused'

export interface Goal {
  id: string
  title: string
  description: string
  status: GoalStatus
  createdAt: string
  updatedAt: string
  completedAt?: string
  milestones: Milestone[]
  tags: string[]
  metadata: Record<string, unknown>
}

export interface Milestone {
  id: string
  title: string
  completed: boolean
  completedAt?: string
  notes?: string
}

// ─── Goal Storage ────────────────────────────────────────────────

function getGoalPath(goalId: string): string {
  return join(GOALS_DIR, `${goalId}.json`)
}

export function createGoal(title: string, description: string, tags: string[] = []): Goal {
  ensureDir()
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const now = new Date().toISOString()
  const goal: Goal = {
    id,
    title,
    description,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    milestones: [],
    tags,
    metadata: {},
  }
  writeFileSync(getGoalPath(id), JSON.stringify(goal, null, 2))
  return goal
}

export function loadGoal(goalId: string): Goal | null {
  const path = getGoalPath(goalId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function saveGoal(goal: Goal): void {
  ensureDir()
  goal.updatedAt = new Date().toISOString()
  writeFileSync(getGoalPath(goal.id), JSON.stringify(goal, null, 2))
}

export function listGoals(status?: GoalStatus): Goal[] {
  ensureDir()
  const files = readdirSync(GOALS_DIR).filter((f: string) => f.endsWith('.json'))
  const goals: Goal[] = []

  for (const file of files) {
    try {
      const goal: Goal = JSON.parse(readFileSync(join(GOALS_DIR, file), 'utf-8'))
      if (!status || goal.status === status) goals.push(goal)
    } catch {
      // Skip corrupted files
    }
  }

  return goals.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function updateGoalStatus(goalId: string, status: GoalStatus): Goal | null {
  const goal = loadGoal(goalId)
  if (!goal) return null
  goal.status = status
  if (status === 'completed') goal.completedAt = new Date().toISOString()
  saveGoal(goal)
  return goal
}

export function addMilestone(goalId: string, title: string): Milestone | null {
  const goal = loadGoal(goalId)
  if (!goal) return null
  const milestone: Milestone = {
    id: Date.now().toString(36),
    title,
    completed: false,
  }
  goal.milestones.push(milestone)
  saveGoal(goal)
  return milestone
}

export function completeMilestone(goalId: string, milestoneId: string, notes?: string): boolean {
  const goal = loadGoal(goalId)
  if (!goal) return false
  const milestone = goal.milestones.find(m => m.id === milestoneId)
  if (!milestone) return false
  milestone.completed = true
  milestone.completedAt = new Date().toISOString()
  if (notes) milestone.notes = notes
  saveGoal(goal)
  return true
}

export function formatGoal(goal: Goal): string {
  const lines: string[] = []
  const statusIcon = goal.status === 'completed' ? '✓' : goal.status === 'abandoned' ? '✗' : goal.status === 'paused' ? '⏸' : '●'
  lines.push(`${statusIcon} ${goal.title}`)
  lines.push(`  ${goal.description}`)

  if (goal.milestones.length > 0) {
    const completed = goal.milestones.filter(m => m.completed).length
    lines.push(`  Milestones: ${completed}/${goal.milestones.length}`)
    for (const m of goal.milestones) {
      const icon = m.completed ? '✓' : '○'
      lines.push(`    ${icon} ${m.title}`)
    }
  }

  if (goal.tags.length > 0) {
    lines.push(`  Tags: ${goal.tags.join(', ')}`)
  }

  return lines.join('\n')
}
