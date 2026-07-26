/**
 * Kairo — Todo Tool
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ToolDefinition, ToolResult } from './types.js';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
}

const TODO_FILE = join(homedir(), '.kairo', 'todo.json');

function loadTodos(): TodoItem[] {
  if (!existsSync(TODO_FILE)) return [];
  try { return JSON.parse(readFileSync(TODO_FILE, 'utf-8')); } catch { return []; }
}

function saveTodos(todos: TodoItem[]) {
  const dir = join(homedir(), '.kairo');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2));
}

export const todoTool: ToolDefinition = {
  name: 'todo',
  description: 'Manage task list. Usage: todo add|list|done|clear <text>',
  prompt: `Manage a task checklist for tracking progress.

Usage:
- todo list — show all tasks
- todo add <text> — add a new task
- todo done <id> — mark task as complete
- todo clear — clear completed tasks
- todo reset — clear all tasks`,
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'list', 'done', 'clear', 'reset'], description: 'Action to perform' },
      text: { type: 'string', description: 'Task text (for add) or task ID (for done)' },
    },
    required: ['action'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const parts = args.split(/\s+/);
      const action = parts[0]?.toLowerCase();
      const text = parts.slice(1).join(' ');

      const todos = loadTodos();

      switch (action) {
        case 'add':
        case 'new': {
          if (!text) return { output: 'Usage: todo add <text>', success: false };
          const item: TodoItem = {
            id: Date.now().toString(36),
            text,
            done: false,
            createdAt: new Date().toISOString(),
          };
          todos.push(item);
          saveTodos(todos);
          return { output: `Added: [${item.id}] ${text}`, success: true };
        }

        case 'list':
        case 'ls': {
          if (todos.length === 0) return { output: 'No tasks.', success: true };
          const pending = todos.filter(t => !t.done);
          const done = todos.filter(t => t.done);
          let out = '';
          if (pending.length > 0) {
            out += 'Pending:\n' + pending.map(t => `  [ ] ${t.id} — ${t.text}`).join('\n');
          }
          if (done.length > 0) {
            if (out) out += '\n';
            out += 'Done:\n' + done.map(t => `  [x] ${t.id} — ${t.text}`).join('\n');
          }
          return { output: out, success: true };
        }

        case 'done':
        case 'check': {
          const item = todos.find(t => t.id === text);
          if (!item) return { output: `Task not found: ${text}`, success: false };
          item.done = true;
          item.completedAt = new Date().toISOString();
          saveTodos(todos);
          return { output: `Done: ${item.text}`, success: true };
        }

        case 'clear': {
          const remaining = todos.filter(t => !t.done);
          saveTodos(remaining);
          return { output: `Cleared ${todos.length - remaining.length} completed tasks.`, success: true };
        }

        case 'reset': {
          saveTodos([]);
          return { output: 'All tasks cleared.', success: true };
        }

        default:
          return { output: 'Usage: todo add|list|done|clear|reset [text]', success: false };
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
