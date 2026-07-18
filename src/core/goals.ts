/**
 * Goals — track user goals and objectives.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Goal {
  id: string;
  title: string;
  description?: string;
  status: 'active' | 'completed' | 'abandoned';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  tasks: GoalTask[];
}

export interface GoalTask {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
}

const GOALS_FILE = join(homedir(), '.kairo', 'goals.json');

/**
 * Load goals from disk.
 */
function loadGoals(): Goal[] {
  try {
    if (existsSync(GOALS_FILE)) {
      return JSON.parse(readFileSync(GOALS_FILE, 'utf-8'));
    }
  } catch { /* ok */ }
  return [];
}

/**
 * Save goals to disk.
 */
function saveGoals(goals: Goal[]): void {
  try {
    const dir = join(homedir(), '.kairo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(GOALS_FILE, JSON.stringify(goals, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Create a new goal.
 */
export function createGoal(title: string, description?: string): Goal {
  const goals = loadGoals();
  const goal: Goal = {
    id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    description,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tasks: [],
  };
  goals.push(goal);
  saveGoals(goals);
  return goal;
}

/**
 * Get all goals.
 */
export function getGoals(status?: Goal['status']): Goal[] {
  const goals = loadGoals();
  if (status) return goals.filter(g => g.status === status);
  return goals;
}

/**
 * Update a goal's status.
 */
export function updateGoalStatus(id: string, status: Goal['status']): boolean {
  const goals = loadGoals();
  const goal = goals.find(g => g.id === id);
  if (!goal) return false;
  goal.status = status;
  goal.updatedAt = Date.now();
  if (status === 'completed') goal.completedAt = Date.now();
  saveGoals(goals);
  return true;
}

/**
 * Add a task to a goal.
 */
export function addGoalTask(goalId: string, title: string): GoalTask | null {
  const goals = loadGoals();
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return null;
  const task: GoalTask = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title,
    completed: false,
    createdAt: Date.now(),
  };
  goal.tasks.push(task);
  goal.updatedAt = Date.now();
  saveGoals(goals);
  return task;
}

/**
 * Complete a task in a goal.
 */
export function completeGoalTask(goalId: string, taskId: string): boolean {
  const goals = loadGoals();
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return false;
  const task = goal.tasks.find(t => t.id === taskId);
  if (!task) return false;
  task.completed = true;
  goal.updatedAt = Date.now();
  saveGoals(goals);
  return true;
}

/**
 * Format goals for display.
 */
export function formatGoals(goals: Goal[]): string {
  if (goals.length === 0) return 'No goals set.';

  return goals.map(g => {
    const status = g.status === 'completed' ? '✅' : g.status === 'abandoned' ? '❌' : '🎯';
    const tasks = g.tasks.map(t => `  ${t.completed ? '☑' : '☐'} ${t.title}`).join('\n');
    return `${status} ${g.title}${g.description ? `\n  ${g.description}` : ''}${tasks ? '\n' + tasks : ''}`;
  }).join('\n\n');
}
