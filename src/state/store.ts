/**
 * Kairo — State Management (Kairo-native rewrite)
 *
 * Centralized application state with reactive updates.
 */

import { EventEmitter } from 'events'

// ─── Types ───────────────────────────────────────────────────────

export type PermissionMode = 'always' | 'moderate' | 'strict' | 'auto'

export interface AppState {
  /** Current permission mode */
  permissionMode: PermissionMode
  /** Whether we're in a plan */
  inPlan: boolean
  /** Current plan content */
  planContent: string
  /** Active task IDs */
  activeTasks: string[]
  /** Current model */
  currentModel: string
  /** Current provider */
  currentProvider: string
  /** Session ID */
  sessionId: string
  /** Whether auto-compact is enabled */
  autoCompactEnabled: boolean
  /** Custom metadata */
  metadata: Record<string, unknown>
}

const DEFAULT_STATE: AppState = {
  permissionMode: 'moderate',
  inPlan: false,
  planContent: '',
  activeTasks: [],
  currentModel: '',
  currentProvider: '',
  sessionId: '',
  autoCompactEnabled: true,
  metadata: {},
}

// ─── State Store ─────────────────────────────────────────────────

class AppStateStore extends EventEmitter {
  private state: AppState = { ...DEFAULT_STATE }

  get(): AppState {
    return { ...this.state }
  }

  set(updates: Partial<AppState>): void {
    const prev = this.state
    this.state = { ...this.state, ...updates }
    this.emit('change', this.state, prev)
  }

  update(fn: (state: AppState) => Partial<AppState>): void {
    const updates = fn(this.state)
    this.set(updates)
  }

  reset(): void {
    const prev = this.state
    this.state = { ...DEFAULT_STATE }
    this.emit('change', this.state, prev)
  }

  // Selectors
  getPermissionMode(): PermissionMode { return this.state.permissionMode }
  isInPlan(): boolean { return this.state.inPlan }
  getPlanContent(): string { return this.state.planContent }
  getActiveTasks(): string[] { return [...this.state.activeTasks] }
  getCurrentModel(): string { return this.state.currentModel }
  getCurrentProvider(): string { return this.state.currentProvider }
  getSessionId(): string { return this.state.sessionId }

  // Actions
  setPermissionMode(mode: PermissionMode): void { this.set({ permissionMode: mode }) }
  enterPlan(content: string): void { this.set({ inPlan: true, planContent: content }) }
  exitPlan(): void { this.set({ inPlan: false, planContent: '' }) }
  addTask(taskId: string): void { this.set({ activeTasks: [...this.state.activeTasks, taskId] }) }
  removeTask(taskId: string): void { this.set({ activeTasks: this.state.activeTasks.filter(id => id !== taskId) }) }
}

// Singleton
export const appState = new AppStateStore()

// ─── Convenience Exports ─────────────────────────────────────────

export function getAppState(): AppState { return appState.get() }
export function setAppState(updates: Partial<AppState>): void { appState.set(updates) }
export function onAppStateChange(fn: (state: AppState, prev: AppState) => void): void { appState.on('change', fn) }
