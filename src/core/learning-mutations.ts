/**
 * Learning mutations — user-initiated edit/delete for learned skills and memories.
 *
 * Maps node IDs back to their on-disk home and performs mutations.
 * Deleting a skill archives it; deleting a memory rewrites its file.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

export type NodeKind = 'memory' | 'skill';

export interface NodeDetail {
  ok: boolean;
  message?: string;
  content?: string;
  kind?: NodeKind;
  path?: string;
}

/**
 * Parse a node ID to determine its kind.
 */
export function parseNodeKind(nodeId: string): NodeKind {
  return nodeId.startsWith('memory:') ? 'memory' : 'skill';
}

/**
 * Parse a memory node ID into source and index.
 * Format: "memory:<source>:<index>" where source is "memory" or "profile".
 */
export function parseMemoryId(nodeId: string): { source: string; index: number } {
  const parts = nodeId.split(':');
  if (parts.length !== 3 || parts[0] !== 'memory') {
    throw new Error(`bad memory node id: ${nodeId}`);
  }
  const source = parts[1];
  if (source !== 'memory' && source !== 'profile') {
    throw new Error(`bad memory node id: ${nodeId}`);
  }
  const index = parseInt(parts[2], 10);
  if (isNaN(index)) {
    throw new Error(`bad memory node id: ${nodeId}`);
  }
  return { source, index };
}

/**
 * Get the memories directory path.
 */
function memoriesDir(): string {
  return join(homedir(), '.kairo', 'memories');
}

/**
 * Get the skills directory path.
 */
function skillsDir(): string {
  return join(homedir(), '.kairo', 'skills');
}

/**
 * Get the memory file path for a source.
 */
function memoryFilePath(source: string): string {
  const files: Record<string, string> = {
    memory: 'MEMORY.md',
    profile: 'USER.md',
  };
  return join(memoriesDir(), files[source] || 'MEMORY.md');
}

/**
 * Read memory entries from a file (§-delimited).
 */
function readMemoryEntries(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  return content.split('\n§\n').filter(Boolean);
}

/**
 * Get current content for a node (for edit prefill).
 */
export function nodeDetail(nodeId: string): NodeDetail {
  try {
    const kind = parseNodeKind(nodeId);
    if (kind === 'memory') {
      const { source, index } = parseMemoryId(nodeId);
      const filePath = memoryFilePath(source);
      const entries = readMemoryEntries(filePath);
      if (index < 0 || index >= entries.length) {
        return { ok: false, message: `memory index ${index} out of range` };
      }
      return {
        ok: true,
        kind: 'memory',
        content: entries[index].trim(),
        path: filePath,
      };
    } else {
      // Skill
      const skillPath = join(skillsDir(), nodeId, 'SKILL.md');
      if (!existsSync(skillPath)) {
        return { ok: false, message: `skill "${nodeId}" not found` };
      }
      return {
        ok: true,
        kind: 'skill',
        content: readFileSync(skillPath, 'utf-8'),
        path: skillPath,
      };
    }
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

/**
 * Delete a node (archives skills, removes memories).
 */
export function deleteNode(nodeId: string): NodeDetail {
  try {
    const kind = parseNodeKind(nodeId);
    if (kind === 'memory') {
      const { source, index } = parseMemoryId(nodeId);
      const filePath = memoryFilePath(source);
      const entries = readMemoryEntries(filePath);
      if (index < 0 || index >= entries.length) {
        return { ok: false, message: `memory index ${index} out of range` };
      }
      entries.splice(index, 1);
      writeFileSync(filePath, entries.join('\n§\n') + '\n', 'utf-8');
      return { ok: true, message: `memory deleted` };
    } else {
      // Archive skill
      const skillPath = join(skillsDir(), nodeId, 'SKILL.md');
      if (!existsSync(skillPath)) {
        return { ok: false, message: `skill "${nodeId}" not found` };
      }
      const archiveDir = join(skillsDir(), '.archive');
      if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });
      const archivePath = join(archiveDir, `${nodeId}-${Date.now()}.md`);
      renameSync(skillPath, archivePath);
      return { ok: true, message: `skill archived to ${archivePath}` };
    }
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}

/**
 * Edit a node's content.
 */
export function editNode(nodeId: string, newContent: string): NodeDetail {
  try {
    const detail = nodeDetail(nodeId);
    if (!detail.ok || !detail.path) return detail;

    const kind = parseNodeKind(nodeId);
    if (kind === 'memory') {
      const { source, index } = parseMemoryId(nodeId);
      const entries = readMemoryEntries(detail.path);
      if (index < 0 || index >= entries.length) {
        return { ok: false, message: `memory index ${index} out of range` };
      }
      entries[index] = newContent;
      writeFileSync(detail.path, entries.join('\n§\n') + '\n', 'utf-8');
      return { ok: true, message: `memory updated` };
    } else {
      writeFileSync(detail.path, newContent, 'utf-8');
      return { ok: true, message: `skill updated` };
    }
  } catch (err: any) {
    return { ok: false, message: err.message };
  }
}
