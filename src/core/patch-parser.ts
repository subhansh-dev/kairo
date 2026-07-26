/**
 * Patch parser — parse and apply code patches.
 */

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface ParsedPatch {
  hunks: PatchHunk[];
  oldFile: string;
  newFile: string;
}

/**
 * Parse a unified diff patch.
 */
export function parsePatch(patch: string): ParsedPatch {
  const lines = patch.split('\n');
  const hunks: PatchHunk[] = [];
  let currentHunk: PatchHunk | null = null;
  let oldFile = '';
  let newFile = '';

  for (const line of lines) {
    // Parse file headers
    if (line.startsWith('--- ')) {
      oldFile = line.slice(4).split('\t')[0];
      continue;
    }
    if (line.startsWith('+++ ')) {
      newFile = line.slice(4).split('\t')[0];
      continue;
    }

    // Parse hunk headers
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      currentHunk = {
        oldStart: parseInt(hunkMatch[1]),
        oldLines: parseInt(hunkMatch[2] || '1'),
        newStart: parseInt(hunkMatch[3]),
        newLines: parseInt(hunkMatch[4] || '1'),
        lines: [],
      };
      hunks.push(currentHunk);
      continue;
    }

    // Collect hunk lines
    if (currentHunk) {
      currentHunk.lines.push(line);
    }
  }

  return { hunks, oldFile, newFile };
}

/**
 * Apply a patch to text.
 */
export function applyPatch(text: string, patch: string): { success: boolean; result: string; error?: string } {
  const parsed = parsePatch(patch);
  const lines = text.split('\n');
  let offset = 0;

  for (const hunk of parsed.hunks) {
    const startLine = hunk.oldStart - 1 + offset;

    // Verify context lines match
    let match = true;
    let lineIdx = startLine;
    for (const hunkLine of hunk.lines) {
      if (hunkLine.startsWith(' ')) {
        if (lineIdx >= lines.length || lines[lineIdx] !== hunkLine.slice(1)) {
          match = false;
          break;
        }
        lineIdx++;
      } else if (hunkLine.startsWith('-')) {
        if (lineIdx >= lines.length || lines[lineIdx] !== hunkLine.slice(1)) {
          match = false;
          break;
        }
        lineIdx++;
      }
    }

    if (!match) {
      return { success: false, result: text, error: 'Patch context mismatch' };
    }

    // Apply hunk
    const newLines: string[] = [];
    let oldIdx = startLine;
    for (const hunkLine of hunk.lines) {
      if (hunkLine.startsWith(' ')) {
        newLines.push(lines[oldIdx]);
        oldIdx++;
      } else if (hunkLine.startsWith('-')) {
        oldIdx++; // Remove line
      } else if (hunkLine.startsWith('+')) {
        newLines.push(hunkLine.slice(1)); // Add line
      }
    }

    lines.splice(startLine, oldIdx - startLine, ...newLines);
    offset += newLines.length - (oldIdx - startLine);
  }

  return { success: true, result: lines.join('\n') };
}

/**
 * Validate a patch format.
 */
export function validatePatch(patch: string): { valid: boolean; error?: string } {
  const parsed = parsePatch(patch);
  if (parsed.hunks.length === 0) {
    return { valid: false, error: 'No hunks found in patch' };
  }
  return { valid: true };
}
