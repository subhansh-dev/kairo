/**
 * Kairo — Codebase Graph
 * Symbol/reference tracking for code navigation.
 *
 * Tracks: symbols, references, dependencies across files.
 * Supports: TypeScript, JavaScript, Python, Rust, Go.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// ─── Types ──────────────────────────────────────────────────────

export type SymbolKind = 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'module' | 'constant';

export interface Symbol {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  column: number;
  exported: boolean;
}

export interface SymbolReference {
  symbol: string;
  file: string;
  line: number;
  column: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: 'import' | 'require' | 'call' | 'extend' | 'implement';
}

export interface CodebaseGraph {
  symbols: Map<string, Symbol[]>;
  references: Map<string, SymbolReference[]>;
  dependencies: DependencyEdge[];
}

// ─── Language Patterns ──────────────────────────────────────────

const SYMBOL_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+class\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
    /export\s+type\s+(\w+)/g,
    /export\s+enum\s+(\w+)/g,
    /export\s+const\s+(\w+)/g,
    /export\s+let\s+(\w+)/g,
  ],
  python: [
    /def\s+(\w+)/g,
    /class\s+(\w+)/g,
    /(\w+)\s*=\s*/g,
  ],
  rust: [
    /pub\s+(?:fn|struct|enum|trait|type|const|static)\s+(\w+)/g,
    /fn\s+(\w+)/g,
  ],
  go: [
    /func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/g,
    /type\s+(\w+)\s+struct/g,
    /type\s+(\w+)\s+interface/g,
  ],
};

const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /import\s+.*from\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  python: [
    /(?:from\s+(\S+)\s+)?import\s+(\S+)/g,
  ],
  rust: [
    /use\s+(\w+(?:::\w+)*)/g,
  ],
  go: [
    /import\s+"([^"]+)"/g,
  ],
};

// ─── Graph Builder ──────────────────────────────────────────────

export function buildCodebaseGraph(projectDir: string): CodebaseGraph {
  const graph: CodebaseGraph = {
    symbols: new Map(),
    references: new Map(),
    dependencies: [],
  };

  const files = collectSourceFiles(projectDir);

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const lang = detectLanguage(file);
      if (!lang) continue;

      // Extract symbols
      const symbols = extractSymbols(content, lang, file);
      if (symbols.length > 0) {
        graph.symbols.set(file, symbols);
      }

      // Extract imports/dependencies
      const deps = extractDependencies(content, lang, file);
      graph.dependencies.push(...deps);
    } catch {}
  }

  return graph;
}

// ─── Symbol Extraction ──────────────────────────────────────────

function extractSymbols(content: string, lang: string, file: string): Symbol[] {
  const patterns = SYMBOL_PATTERNS[lang] || [];
  const symbols: Symbol[] = [];
  const lines = content.split('\n');

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const line of lines) {
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const name = match[1];
        if (!name) continue;

        symbols.push({
          name,
          kind: inferSymbolKind(match[0]),
          file,
          line: lines.indexOf(line) + 1,
          column: match.index,
          exported: match[0].includes('export') || match[0].includes('pub'),
        });
      }
    }
  }

  return symbols;
}

function extractDependencies(content: string, lang: string, file: string): DependencyEdge[] {
  const patterns = IMPORT_PATTERNS[lang] || [];
  const deps: DependencyEdge[] = [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const target = match[1] || match[2];
      if (!target) continue;

      deps.push({
        from: file,
        to: target,
        kind: 'import',
      });
    }
  }

  return deps;
}

// ─── Queries ────────────────────────────────────────────────────

export function findSymbol(graph: CodebaseGraph, name: string): Symbol[] {
  const results: Symbol[] = [];
  for (const symbols of graph.symbols.values()) {
    for (const sym of symbols) {
      if (sym.name === name) results.push(sym);
    }
  }
  return results;
}

export function findReferences(graph: CodebaseGraph, symbolName: string): SymbolReference[] {
  return graph.references.get(symbolName) || [];
}

export function symbolsInFile(graph: CodebaseGraph, filePath: string): Symbol[] {
  return graph.symbols.get(filePath) || [];
}

export function dependenciesOfFile(graph: CodebaseGraph, filePath: string): DependencyEdge[] {
  return graph.dependencies.filter(d => d.from === filePath);
}

export function dependentsOfFile(graph: CodebaseGraph, filePath: string): DependencyEdge[] {
  return graph.dependencies.filter(d => d.to === filePath);
}

// ─── Helpers ────────────────────────────────────────────────────

function collectSourceFiles(dir: string, maxDepth: number = 10): string[] {
  const files: string[] = [];
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go']);

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;
    try {
      for (const entry of readdirSync(current)) {
        if (entry.startsWith('.') || entry === 'node_modules' || entry === 'target' || entry === '__pycache__') continue;
        const path = join(current, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
          walk(path, depth + 1);
        } else if (extensions.has(extname(entry))) {
          files.push(path);
        }
      }
    } catch {}
  }

  walk(dir, 0);
  return files;
}

function detectLanguage(file: string): string | null {
  const ext = extname(file).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'typescript', '.jsx': 'typescript',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
  };
  return map[ext] || null;
}

function inferSymbolKind(matchText: string): SymbolKind {
  if (matchText.includes('function') || matchText.includes('def ') || matchText.includes('fn ')) return 'function';
  if (matchText.includes('class')) return 'class';
  if (matchText.includes('interface')) return 'interface';
  if (matchText.includes('type')) return 'type';
  if (matchText.includes('enum')) return 'enum';
  if (matchText.includes('const')) return 'constant';
  if (matchText.includes('let') || matchText.includes('var')) return 'variable';
  return 'variable';
}
