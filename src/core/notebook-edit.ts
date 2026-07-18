/**
 * Notebook edit — Jupyter notebook editing utilities.
 */

export interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[];
  outputs?: unknown[];
  metadata?: Record<string, unknown>;
}

export interface Notebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

/**
 * Create a new notebook.
 */
export function createNotebook(): Notebook {
  return {
    cells: [],
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/**
 * Add a cell to a notebook.
 */
export function addCell(notebook: Notebook, cellType: NotebookCell['cell_type'], source: string): void {
  notebook.cells.push({
    cell_type: cellType,
    source: source.split('\n').map((line, i, arr) => i < arr.length - 1 ? line + '\n' : line),
  });
}

/**
 * Edit a cell in a notebook.
 */
export function editCell(notebook: Notebook, cellIndex: number, newSource: string): boolean {
  if (cellIndex < 0 || cellIndex >= notebook.cells.length) return false;
  notebook.cells[cellIndex].source = newSource.split('\n').map((line, i, arr) => i < arr.length - 1 ? line + '\n' : line);
  return true;
}

/**
 * Delete a cell from a notebook.
 */
export function deleteCell(notebook: Notebook, cellIndex: number): boolean {
  if (cellIndex < 0 || cellIndex >= notebook.cells.length) return false;
  notebook.cells.splice(cellIndex, 1);
  return true;
}

/**
 * Serialize a notebook to JSON.
 */
export function serializeNotebook(notebook: Notebook): string {
  return JSON.stringify(notebook, null, 2);
}

/**
 * Parse a notebook from JSON.
 */
export function parseNotebook(json: string): Notebook | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
