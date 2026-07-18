/**
 * Kairo — Hashline Edit Tool
 * Enables precise edits using line-number-anchored patches with context matching
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { ToolDefinition, ToolResult } from './types.js';
import { contentHash, resolvePath } from '../utils/hash.js';
import { checkWriteSafety } from '../core/file-safety.js';

enum HashlineOp {
  Insert = 'insert',
  Delete = 'delete',
  Replace = 'replace',
}

interface HashlinePatch {
  op: HashlineOp;
  anchorStart: number;
  anchorEnd: number;
  contextLines: string[];
  newLines: string[];
}

// ─── Hashline Parser ──────────────────────────────────────

const HASHLINE_RE = /^@(\d+)(?:[,.](\d+))?\s*(insert|delete|replace)\s*$/im;
const CONTEXT_RE = /^\s*\|(.+)/;

function parseHashlinePatch(input: string): { patches: HashlinePatch[]; error?: string } {
  const patches: HashlinePatch[] = [];
  const lines = input.split('\n');
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) { i++; continue; }

    // Try to match hashline header
    const headerMatch = trimmed.match(HASHLINE_RE);
    if (!headerMatch) { i++; continue; }

    const anchorStart = parseInt(headerMatch[1]);
    const anchorEnd = headerMatch[2] ? parseInt(headerMatch[2]) : anchorStart;
    const op = headerMatch[3] as HashlineOp;
    i++;

    // Collect context lines (prefixed with |)
    const contextLines: string[] = [];
    while (i < lines.length) {
      const ctx = lines[i].match(CONTEXT_RE);
      if (ctx) {
        contextLines.push(ctx[1]);
        i++;
      } else break;
    }

    // For insert/replace, collect new content (non-prefixed lines until next header or end)
    const newLines: string[] = [];
    if (op === 'insert' || op === 'replace') {
      while (i < lines.length) {
        const nextLine = lines[i].trim();
        if (nextLine && HASHLINE_RE.test(nextLine)) break;
        newLines.push(lines[i]);
        i++;
      }
    }

    patches.push({ op, anchorStart, anchorEnd, contextLines, newLines });
  }

  return { patches };
}

// ─── Patch Applier ────────────────────────────────────────

function applyPatches(content: string, patches: HashlinePatch[]): { result: string; applied: number } {
  let lines = content.split('\n');
  let applied = 0;

  // Sort patches in reverse order (bottom-up) to preserve line numbers
  const sorted = [...patches].sort((a, b) => b.anchorStart - a.anchorStart);

  for (const patch of sorted) {
    const startIdx = patch.anchorStart - 1;
    const endIdx = Math.min(patch.anchorEnd, lines.length);

    if (startIdx < 0 || startIdx >= lines.length) continue;

    // Verify context lines match
    let contextMatch = true;
    for (let j = 0; j < patch.contextLines.length; j++) {
      const ctxLine = startIdx + j;
      if (ctxLine >= lines.length || lines[ctxLine] !== patch.contextLines[j]) {
        contextMatch = false;
        break;
      }
    }

    if (!contextMatch) continue;

    switch (patch.op) {
      case 'delete':
        lines.splice(startIdx, endIdx - startIdx + 1);
        applied++;
        break;

      case 'insert':
        lines.splice(startIdx, 0, ...patch.newLines);
        applied++;
        break;

      case 'replace':
        lines.splice(startIdx, endIdx - startIdx + 1, ...patch.newLines);
        applied++;
        break;
    }
  }

  return { result: lines.join('\n'), applied };
}

// ─── Tool Definition ──────────────────────────────────────

export const hashlineTool: ToolDefinition = {
  name: 'hashline',
  description: 'Line-anchored patch editing. Usage: hashline <path>\\n@<line> <op>\\n|<context>\\n<new_content>',
  prompt: `Line-anchored patch editing tool. Enables precise edits using line-number-anchored patches.

Format:
  hashline <path>
  @<start_line>[.<end_line>] <op>
  |<context_line_1>
  |<context_line_2>
  <new_line_1>
  <new_line_2>

Operations:
  delete — remove lines @start-end
  insert — insert new content after line @start
  replace — replace lines @start-end with new content

Context lines (prefixed with |) are verified before applying.
If context doesn't match, the patch is skipped.

Multiple patches can be specified in one call.
Patches are applied bottom-up to preserve line numbers.`,
  tier: 'write',
  concurrencySafe: false,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const nlIdx = args.indexOf('\n');
      if (nlIdx === -1) return { output: 'Usage: hashline <path>\\n@<line> <op>\\n|<context>\\n<content>', success: false };

      const rawPath = args.slice(0, nlIdx).trim();
      const path = resolvePath(rawPath);
      const patchContent = args.slice(nlIdx + 1);

      const safety = checkWriteSafety(path);
      if (!safety.allowed) {
        return { output: `Safety blocked: ${safety.reason}`, success: false };
      }

      if (!existsSync(path)) return { output: `Error: File not found: ${path}`, success: false };

      const { patches, error } = parseHashlinePatch(patchContent);
      if (error) return { output: `Parse error: ${error}`, success: false };
      if (patches.length === 0) return { output: 'No valid patches found.', success: false };

      const content = readFileSync(path, 'utf-8');
      const { result, applied } = applyPatches(content, patches);

      if (applied === 0) return { output: 'No patches applied — context mismatch or invalid line numbers.', success: false };

      writeFileSync(path, result, 'utf-8');
      const newHash = contentHash(result);

      return {
        output: `Applied ${applied}/${patches.length} patches to ${path} [hash:${newHash}]`,
        success: true,
        metadata: { path, hash: newHash, patches: patches.length, applied },
      };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
