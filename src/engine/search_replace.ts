/**
 * Enhanced SearchReplace implementation.
 *
 * Exact string replacement with:
 * - New file creation (empty old_string)
 * - Replace-all mode
 * - Unicode confusable normalization fallback
 * - Edit detail generation with context
 */

import * as fs from 'fs/promises';

const CONTEXT_LINES = 3;

export interface SearchReplaceInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface SearchReplaceEditDetail {
  old_string: string;
  old_line: number;
  new_string: string;
  new_line: number;
  context_before: string;
  context_after: string;
  line_prefix: string;
}

export interface SearchReplaceOutput {
  success: boolean;
  filePath: string;
  replacements: number;
  details: SearchReplaceEditDetail[];
  newContent?: string;
}

function computeLineRange(text: string, startPos: number, insertedText: string) {
  const startLine = text.slice(0, startPos).split('\n').length - 1;
  const linesInInserted = insertedText.split('\n').length;
  return { startLine, endLine: startLine + linesInInserted - 1 };
}

function buildEditDetails(
  newText: string, oldString: string, newString: string,
  positions: number[], contextSize: number
): SearchReplaceEditDetail[] {
  return positions.map(startPos => {
    const totalLines = newText.split('\n');
    const { startLine, endLine } = computeLineRange(newText, startPos, newString);
    const snippetStart = Math.max(0, startLine - contextSize);
    const snippetEnd = Math.min(endLine + contextSize, totalLines.length - 1);

    const lineStart = newText.lastIndexOf('\n', startPos) + 1;
    return {
      old_string: oldString,
      old_line: startLine + 1,
      new_string: newString,
      new_line: startLine + 1,
      context_before: totalLines.slice(snippetStart, startLine).join('\n'),
      context_after: totalLines.slice(endLine + 1, snippetEnd + 1).join('\n'),
      line_prefix: newText.slice(lineStart, startPos),
    };
  });
}

function normalizeConfusables(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2000-\u200B]/g, ' ')
    .replace(/[\u2026]/g, '...')
    .replace(/[\u2028\u2029]/g, '\n');
}

function findAllOccurrences(text: string, search: string): number[] {
  const positions: number[] = [];
  let idx = 0;
  while ((idx = text.indexOf(search, idx)) !== -1) {
    positions.push(idx);
    idx += 1;
  }
  return positions;
}

function replaceAtPositions(
  text: string, positions: number[], oldStr: string, newStr: string
): { newText: string; newPositions: number[] } {
  let newText = '';
  const newPositions: number[] = [];
  let lastEnd = 0;
  for (const pos of positions) {
    newText += text.slice(lastEnd, pos);
    newPositions.push(newText.length);
    newText += newStr;
    lastEnd = pos + oldStr.length;
  }
  newText += text.slice(lastEnd);
  return { newText, newPositions };
}

export async function runSearchReplace(
  input: SearchReplaceInput,
  cwd: string,
  options: { unicodeNormalizedFallback?: boolean; emptyOldStringDoesNotOverride?: boolean } = {}
): Promise<SearchReplaceOutput> {
  const filePath = input.file_path.startsWith('/')
    ? input.file_path
    : `${cwd}/${input.file_path}`;

  const isEmptyOldAllowed = !options.emptyOldStringDoesNotOverride;

  if (!input.old_string && !isEmptyOldAllowed && input.new_string) {
    return { success: false, filePath, replacements: 0, details: [] };
  }

  let originalContent: string;
  try {
    originalContent = await fs.readFile(filePath, 'utf-8');
  } catch {
    if (!input.old_string) {
      await fs.mkdir(filePath.substring(0, filePath.lastIndexOf('/')), { recursive: true });
      await fs.writeFile(filePath, input.new_string);
      return { success: true, filePath, replacements: 1, details: [], newContent: input.new_string };
    }
    throw new Error(`File not found: ${filePath}`);
  }

  if (!input.old_string) {
    await fs.writeFile(filePath, input.new_string);
    return { success: true, filePath, replacements: 1, details: [], newContent: input.new_string };
  }

  let positions = findAllOccurrences(originalContent, input.old_string);
  let usedNormalized = false;

  if (positions.length === 0 && options.unicodeNormalizedFallback) {
    const normalizedText = normalizeConfusables(originalContent);
    const normalizedSearch = normalizeConfusables(input.old_string);
    const normalizedPositions = findAllOccurrences(normalizedText, normalizedSearch);
    if (normalizedPositions.length === 1) {
      const originalStart = normalizedPositions[0];
      positions = [originalStart];
      usedNormalized = true;
    }
  }

  if (positions.length === 0) {
    return { success: false, filePath, replacements: 0, details: [] };
  }

  if (positions.length > 1 && !input.replace_all) {
    return { success: false, filePath, replacements: 0, details: [] };
  }

  const { newText, newPositions } = replaceAtPositions(
    originalContent, positions, input.old_string, input.new_string
  );

  await fs.writeFile(filePath, newText);

  const details = buildEditDetails(newText, input.old_string, input.new_string, newPositions, CONTEXT_LINES);

  return {
    success: true,
    filePath,
    replacements: positions.length,
    details,
    newContent: newText,
  };
}
