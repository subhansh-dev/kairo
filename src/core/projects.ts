/**
 * Projects — project management utilities.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  tags: string[];
  createdAt: number;
  lastAccessedAt: number;
}

const PROJECTS_FILE = join(homedir(), '.kairo', 'projects.json');

/**
 * Load projects from disk.
 */
function loadProjects(): Project[] {
  try {
    if (existsSync(PROJECTS_FILE)) {
      return JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
    }
  } catch { /* ok */ }
  return [];
}

/**
 * Save projects to disk.
 */
function saveProjects(projects: Project[]): void {
  try {
    const dir = join(homedir(), '.kairo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Register a project.
 */
export function registerProject(name: string, path: string, description?: string, tags: string[] = []): Project {
  const projects = loadProjects();
  const project: Project = {
    id: `proj_${Date.now()}`,
    name,
    path,
    description,
    tags,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  };
  projects.push(project);
  saveProjects(projects);
  return project;
}

/**
 * List all projects.
 */
export function listProjects(): Project[] {
  return loadProjects();
}

/**
 * Get a project by ID.
 */
export function getProject(id: string): Project | undefined {
  return loadProjects().find(p => p.id === id);
}

/**
 * Remove a project.
 */
export function removeProject(id: string): boolean {
  const projects = loadProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return false;
  projects.splice(idx, 1);
  saveProjects(projects);
  return true;
}

/**
 * Format projects for display.
 */
export function formatProjects(): string {
  const projects = listProjects();
  if (projects.length === 0) return 'No registered projects.';
  return projects.map(p =>
    `• ${p.name} (${p.path})${p.tags.length ? ` [${p.tags.join(', ')}]` : ''}`
  ).join('\n');
}
