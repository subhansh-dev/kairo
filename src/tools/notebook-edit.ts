import { readFileSync, writeFileSync, existsSync } from 'fs';
import { extname, relative } from 'path';
import type { ToolDefinition, ToolResult } from './types.js';

interface NotebookCell {
  cell_type: string;
  source: string | string[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: unknown[];
  id?: string;
}

interface Notebook {
  cells: NotebookCell[];
  metadata?: { language_info?: { name?: string } };
  nbformat: number;
  nbformat_minor: number;
}

function parseCellId(raw: string): number | undefined {
  const match = raw.match(/^cell[-\s]?(\d+)$/i);
  if (match) return parseInt(match[1], 10);
  return undefined;
}

function findCell(notebook: Notebook, cellId: string): { cell: NotebookCell; index: number } | undefined {
  const idMatch = notebook.cells.findIndex((c, i) => {
    if (c.id && c.id === cellId) return true;
    const idx = parseCellId(cellId);
    return idx !== undefined && idx === i;
  });
  if (idMatch !== -1) return { cell: notebook.cells[idMatch], index: idMatch };
  return undefined;
}

function normalizeSource(source: string | string[]): string {
  if (Array.isArray(source)) return source.join('');
  return source;
}

function setSource(cell: NotebookCell, source: string) {
  cell.source = source.split('\n').map((l, i, a) => i < a.length - 1 ? l + '\n' : l);
  if (cell.source.length === 1 && cell.source[0] === '') cell.source = [];
}

function formatSource(source: string | string[]): string {
  if (Array.isArray(source)) return source.join('');
  return source;
}

function langFromNotebook(notebook: Notebook): string {
  return notebook.metadata?.language_info?.name ?? 'python';
}

export const notebookEditTool: ToolDefinition = {
  name: 'NotebookEdit',
  description: 'Edit Jupyter notebook cells (.ipynb). Usage: NotebookEdit <file> <cell_id> <new_source> [edit_mode] [cell_type]',
  prompt: `Edits a Jupyter notebook (.ipynb) file.

Usage: NotebookEdit <notebook_path> <cell_id> "<new_source>" [edit_mode] [cell_type]

Arguments:
- notebook_path: Path to the .ipynb file
- cell_id: Cell UUID or "cell-N" (0-indexed position)
- new_source: The new source code for the cell (in quotes)
- edit_mode: "replace" (default), "insert", or "delete"
- cell_type: "code" (default) or "markdown"

Examples:
- NotebookEdit notebook.ipynb cell-0 "print('hello')"
- NotebookEdit notebook.ipynb cell-0 "print('new')" replace
- NotebookEdit notebook.ipynb cell-0 "# Markdown cell" replace markdown
- NotebookEdit notebook.ipynb cell-2 "" delete`,
  tier: 'write',
  concurrencySafe: false,
  readOnly: false,
  destructive: true,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      // Parse args: file cell_id "new_source" [edit_mode] [cell_type]
      const parts: string[] = [];
      let current = '';
      let inQuotes = false;
      for (const ch of args) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ' ' && !inQuotes) {
          if (current) { parts.push(current); current = ''; }
        } else {
          current += ch;
        }
      }
      if (current) parts.push(current);

      const filePath = parts[0];
      const cellId = parts[1];
      const newSource = parts[2] ?? '';
      const editMode = (parts[3] || 'replace').toLowerCase();
      const cellType = (parts[4] || 'code').toLowerCase();

      if (!filePath) return { output: 'Usage: NotebookEdit <file> <cell_id> "<new_source>" [edit_mode] [cell_type]', success: false };

      if (extname(filePath).toLowerCase() !== '.ipynb') {
        return { output: `Error: Not a .ipynb file: ${filePath}`, success: false };
      }

      if (!existsSync(filePath)) {
        return { output: `Error: File not found: ${filePath}`, success: false };
      }

      if (!['replace', 'insert', 'delete'].includes(editMode)) {
        return { output: `Error: edit_mode must be replace, insert, or delete (got: ${editMode})`, success: false };
      }

      if (editMode === 'insert' && !['code', 'markdown'].includes(cellType)) {
        return { output: `Error: cell_type required for insert mode (code or markdown)`, success: false };
      }

      const content = readFileSync(filePath, 'utf-8');
      let notebook: Notebook;
      try {
        notebook = JSON.parse(content);
      } catch {
        return { output: `Error: Invalid JSON in notebook file`, success: false };
      }

      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return { output: `Error: Notebook has no cells array`, success: false };
      }

      const language = langFromNotebook(notebook);
      let cellIndex: number;
      let cell: NotebookCell | undefined;

      if (editMode === 'insert') {
        if (!cellId) return { output: `Error: cell_id required for insert`, success: false };
        const found = findCell(notebook, cellId);
        cellIndex = found ? found.index + 1 : (parseCellId(cellId) !== undefined ? parseCellId(cellId)! + 1 : notebook.cells.length);
        if (cellIndex > notebook.cells.length) cellIndex = notebook.cells.length;
      } else {
        const found = cellId ? findCell(notebook, cellId) : undefined;
        if (!found) return { output: `Error: Cell not found: ${cellId}`, success: false };
        cell = found.cell;
        cellIndex = found.index;
      }

      if (editMode === 'delete') {
        notebook.cells.splice(cellIndex, 1);
      } else if (editMode === 'insert') {
        const needsId = (notebook.nbformat > 4) || (notebook.nbformat === 4 && notebook.nbformat_minor >= 5);
        const newCell: NotebookCell = {
          cell_type: cellType,
          source: newSource ? [newSource] : [],
          metadata: {},
        };
        if (needsId) newCell.id = Math.random().toString(36).slice(2, 15);
        if (cellType === 'code') {
          newCell.execution_count = null;
          newCell.outputs = [];
        }
        notebook.cells.splice(cellIndex, 0, newCell);
      } else {
        setSource(cell!, newSource);
        if (cell!.cell_type !== cellType) {
          cell!.cell_type = cellType;
          if (cellType === 'code') {
            cell!.execution_count = null;
            cell!.outputs = [];
          } else {
            delete cell!.execution_count;
            delete cell!.outputs;
          }
        }
        if (cell!.cell_type === 'code') {
          cell!.execution_count = null;
          cell!.outputs = [];
        }
      }

      writeFileSync(filePath, JSON.stringify(notebook, null, 1), 'utf-8');

      const action = editMode === 'delete' ? 'Deleted' : editMode === 'insert' ? 'Inserted' : 'Updated';
      const relPath = relative(process.cwd(), filePath);
      const cellRef = cell?.id ?? cell?.cell_type ?? cellId;

      return {
        output: `${action} cell ${cellIndex} in ${relPath} (type: ${cellType}, lang: ${language})`,
        success: true,
        metadata: { notebook_path: filePath, cell_id: cellId, cell_index: cellIndex, edit_mode: editMode, cell_type: cellType, language },
      };
    } catch (e) {
      return { output: `NotebookEdit error: ${(e as Error).message}`, success: false };
    }
  },
};
