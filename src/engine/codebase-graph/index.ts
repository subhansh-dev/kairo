/**
 * Codebase graph — AST-based code structure analysis.
 * Provides dependency graphs, symbol indexing, and cross-reference lookup.
 */

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'module' | 'method' | 'property';

export interface Symbol {
  id: string;
  name: string;
  kind: SymbolKind;
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  documentation?: string;
  modifiers: string[];
  parentSymbolId?: string;
}

export interface SymbolReference {
  symbolId: string;
  filePath: string;
  line: number;
  column: number;
  kind: 'definition' | 'reference' | 'import' | 're-export';
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: 'import' | 'require' | 'type-reference' | 'inheritance' | 'implementation';
  filePath: string;
  line: number;
}

export interface CodebaseGraph {
  symbols: Map<string, Symbol>;
  references: Map<string, SymbolReference[]>;
  dependencies: DependencyEdge[];
  filePaths: string[];
  lastUpdated: Date;
}

/**
 * Create a fresh codebase graph.
 */
export function createGraph(): CodebaseGraph {
  return {
    symbols: new Map(),
    references: new Map(),
    dependencies: [],
    filePaths: [],
    lastUpdated: new Date(),
  };
}

/**
 * Add a symbol to the graph.
 */
export function addSymbol(graph: CodebaseGraph, symbol: Symbol): void {
  graph.symbols.set(symbol.id, symbol);
}

/**
 * Add a reference to the graph.
 */
export function addReference(graph: CodebaseGraph, ref: SymbolReference): void {
  const existing = graph.references.get(ref.symbolId) ?? [];
  existing.push(ref);
  graph.references.set(ref.symbolId, existing);
}

/**
 * Add a dependency edge.
 */
export function addDependency(graph: CodebaseGraph, edge: DependencyEdge): void {
  graph.dependencies.push(edge);
}

/**
 * Find all symbols in a file.
 */
export function symbolsInFile(graph: CodebaseGraph, filePath: string): Symbol[] {
  const result: Symbol[] = [];
  for (const sym of graph.symbols.values()) {
    if (sym.filePath === filePath) result.push(sym);
  }
  return result;
}

/**
 * Find all references to a symbol.
 */
export function findReferences(graph: CodebaseGraph, symbolId: string): SymbolReference[] {
  return graph.references.get(symbolId) ?? [];
}

/**
 * Find all dependencies of a file.
 */
export function dependenciesOfFile(graph: CodebaseGraph, filePath: string): DependencyEdge[] {
  return graph.dependencies.filter(e => e.from === filePath);
}

/**
 * Find all dependents of a file (files that import it).
 */
export function dependentsOfFile(graph: CodebaseGraph, filePath: string): DependencyEdge[] {
  return graph.dependencies.filter(e => e.to === filePath);
}

/**
 * Find symbols by name (fuzzy match).
 */
export function findSymbolsByName(graph: CodebaseGraph, name: string): Symbol[] {
  const q = name.toLowerCase();
  const result: Symbol[] = [];
  for (const sym of graph.symbols.values()) {
    if (sym.name.toLowerCase().includes(q)) result.push(sym);
  }
  return result;
}

/**
 * Find symbols by kind.
 */
export function findSymbolsByKind(graph: CodebaseGraph, kind: SymbolKind): Symbol[] {
  return [...graph.symbols.values()].filter(s => s.kind === kind);
}

/**
 * Compute transitive dependencies (all reachable files).
 */
export function transitiveDependencies(
  graph: CodebaseGraph,
  filePath: string,
  maxDepth: number = 10,
): Set<string> {
  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [{ path: filePath, depth: 0 }];

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    if (visited.has(path) || depth > maxDepth) continue;
    visited.add(path);

    const deps = dependenciesOfFile(graph, path);
    for (const dep of deps) {
      if (!visited.has(dep.to)) {
        queue.push({ path: dep.to, depth: depth + 1 });
      }
    }
  }

  visited.delete(filePath);
  return visited;
}

/**
 * Compute impact set (all files that would be affected by a change).
 */
export function impactSet(
  graph: CodebaseGraph,
  filePath: string,
  maxDepth: number = 5,
): Set<string> {
  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [{ path: filePath, depth: 0 }];

  while (queue.length > 0) {
    const { path, depth } = queue.shift()!;
    if (visited.has(path) || depth > maxDepth) continue;
    visited.add(path);

    const deps = dependentsOfFile(graph, path);
    for (const dep of deps) {
      if (!visited.has(dep.from)) {
        queue.push({ path: dep.from, depth: depth + 1 });
      }
    }
  }

  visited.delete(filePath);
  return visited;
}

/**
 * Get graph statistics.
 */
export function graphStats(graph: CodebaseGraph): {
  symbolCount: number;
  referenceCount: number;
  dependencyCount: number;
  fileCount: number;
  symbolsByKind: Record<SymbolKind, number>;
} {
  const symbolsByKind: Record<string, number> = {};
  for (const sym of graph.symbols.values()) {
    symbolsByKind[sym.kind] = (symbolsByKind[sym.kind] ?? 0) + 1;
  }

  let referenceCount = 0;
  for (const refs of graph.references.values()) {
    referenceCount += refs.length;
  }

  return {
    symbolCount: graph.symbols.size,
    referenceCount,
    dependencyCount: graph.dependencies.length,
    fileCount: graph.filePaths.length,
    symbolsByKind: symbolsByKind as Record<SymbolKind, number>,
  };
}
