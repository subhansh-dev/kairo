/**
 * Workspace client — HTTP client for workspace API.
 */

import { createHttpClient } from '../http/index.js';

export interface WorkspaceClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
}

/**
 * Create a workspace client.
 */
export function createWorkspaceClient(config: WorkspaceClientConfig) {
  const client = createHttpClient({
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
  });

  return {
    async listProjects(): Promise<WorkspaceProject[]> {
      const res = await client.get<WorkspaceProject[]>('/api/projects');
      return res.data;
    },

    async getProject(id: string): Promise<WorkspaceProject> {
      const res = await client.get<WorkspaceProject>(`/api/projects/${id}`);
      return res.data;
    },

    async createProject(name: string, rootPath: string): Promise<WorkspaceProject> {
      const res = await client.post<WorkspaceProject>('/api/projects', { name, rootPath });
      return res.data;
    },

    async deleteProject(id: string): Promise<void> {
      await client.delete(`/api/projects/${id}`);
    },
  };
}
