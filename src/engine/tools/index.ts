/**
 * Tool implementations — bash, read_file, search_replace, grep, list_dir, web_fetch, web_search.
 * Core tools that make Kairo a functional coding agent.
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createToolIdentity, type ToolKind, type ToolNamespace } from '../taxonomy.js';

// ─── Common Types ──────────────────────────────────────────

export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolOutput {
  content: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCallContext {
  workspaceRoot: string;
  sessionId: string;
  cwd: string;
  env: Record<string, string>;
  timeout?: number;
}

// ─── Bash Tool ─────────────────────────────────────────────

export interface BashInput {
  command: string;
  timeout?: number;
  isBackground?: boolean;
  description?: string;
}

export interface BashOutput extends ToolOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  signal?: string;
}

const DEFAULT_BASH_TIMEOUT = 120_000;
const MAX_BASH_OUTPUT = 100_000;

/**
 * Execute a bash command.
 */
export async function executeBash(
  input: BashInput,
  ctx: ToolCallContext,
): Promise<BashOutput> {
  const timeout = input.timeout ?? DEFAULT_BASH_TIMEOUT;
  const start = Date.now();

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', input.command], {
      cwd: ctx.cwd,
      env: { ...process.env, ...ctx.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;

    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (stdout.length + chunk.length > MAX_BASH_OUTPUT) {
        stdout += chunk.slice(0, MAX_BASH_OUTPUT - stdout.length);
        truncated = true;
      } else {
        stdout += chunk;
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (stderr.length + chunk.length > MAX_BASH_OUTPUT) {
        stderr += chunk.slice(0, MAX_BASH_OUTPUT - stderr.length);
      } else {
        stderr += chunk;
      }
    });

    proc.on('close', (code, signal) => {
      const durationMs = Date.now() - start;
      const exitCode = code ?? 1;
      const output = stdout || stderr;

      resolve({
        content: `exit: ${exitCode}${signal ? ` (signal: ${signal})` : ''}\n${output}`,
        exitCode,
        stdout,
        stderr,
        durationMs,
        truncated,
        signal: signal ?? undefined,
      });
    });

    proc.on('error', (err) => {
      resolve({
        content: `Error: ${err.message}`,
        error: err.message,
        exitCode: 1,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        truncated: false,
      });
    });
  });
}

// ─── Read File Tool ────────────────────────────────────────

export interface ReadFileInput {
  path: string;
  offset?: number;
  limit?: number;
}

/**
 * Read a file with optional line range and LINE_NUMBER→LINE_CONTENT format.
 */
export function readFile(
  input: ReadFileInput,
  ctx: ToolCallContext,
): ToolOutput {
  const filePath = path.resolve(ctx.cwd, input.path);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const offset = Math.max(0, (input.offset ?? 1) - 1);
    const limit = input.limit ?? Math.min(lines.length, 1000);
    const selectedLines = lines.slice(offset, offset + limit);

    // Use → format for compatibility with search_replace tool
    const numbered = selectedLines
      .map((line, i) => `${offset + i + 1}→${line}`)
      .join('\n');

    return {
      content: numbered,
      metadata: {
        totalLines: lines.length,
        startLine: offset + 1,
        endLine: Math.min(offset + limit, lines.length),
        truncated: offset + limit < lines.length,
      },
    };
  } catch (err: any) {
    return {
      content: `Error reading file: ${err.message}`,
      error: err.message,
    };
  }
}

// ─── Search/Replace Tool (Edit) ────────────────────────────

export interface SearchReplaceInput {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/**
 * Search and replace in a file.
 */
export function searchReplace(
  input: SearchReplaceInput,
  ctx: ToolCallContext,
): ToolOutput {
  const filePath = path.resolve(ctx.cwd, input.path);

  try {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // File doesn't exist — create it with new_string
      if (!input.old_string) {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, input.new_string, 'utf-8');
        return { content: `Created file: ${input.path}` };
      }
      return { content: `File not found: ${input.path}`, error: 'File not found' };
    }

    if (!content.includes(input.old_string)) {
      return {
        content: `Old string not found in ${input.path}`,
        error: 'Search string not found',
      };
    }

    let newContent: string;
    if (input.replace_all) {
      newContent = content.split(input.old_string).join(input.new_string);
    } else {
      newContent = content.replace(input.old_string, input.new_string);
    }

    fs.writeFileSync(filePath, newContent, 'utf-8');

    const occurrences = content.split(input.old_string).length - 1;
    return {
      content: `Replaced ${occurrences} occurrence${occurrences > 1 ? 's' : ''} in ${input.path}`,
      metadata: { occurrences },
    };
  } catch (err: any) {
    return {
      content: `Error editing file: ${err.message}`,
      error: err.message,
    };
  }
}

// ─── Grep Tool ─────────────────────────────────────────────

export interface GrepInput {
  pattern: string;
  path?: string;
  include?: string;
  case_sensitive?: boolean;
  whole_word?: boolean;
  max_results?: number;
  context_lines?: number;
  output_mode?: 'content' | 'files_with_matches' | 'count';
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
  before?: string[];
  after?: string[];
}

function findRgPath(): string | null {
  try {
    execSync('which rg', { stdio: 'pipe', timeout: 2000 });
    return 'rg';
  } catch { /* */ }
  try {
    execSync('where rg', { stdio: 'pipe', timeout: 2000 });
    return 'rg';
  } catch { /* */ }
  return null;
}

/**
 * Search file contents using ripgrep when available, fallback to Node.js regex.
 */
export function grep(
  input: GrepInput,
  ctx: ToolCallContext,
): ToolOutput {
  const rgPath = findRgPath();
  if (rgPath) return grepWithRg(input, ctx, rgPath);
  return grepWithNode(input, ctx);
}

function grepWithRg(input: GrepInput, ctx: ToolCallContext, rgPath: string): ToolOutput {
  const searchPath = input.path ? path.resolve(ctx.cwd, input.path) : ctx.cwd;
  const args: string[] = ['--no-heading', '--line-number', '--color=never'];

  if (!input.case_sensitive) args.push('-i');
  if (input.whole_word) args.push('-w');
  if (input.include) args.push('-g', input.include);
  if (input.context_lines) args.push('-C', String(input.context_lines));

  const maxResults = input.max_results ?? 200;
  args.push('--max-count', String(maxResults));

  if (input.output_mode === 'files_with_matches') args.push('-l');
  else if (input.output_mode === 'count') args.push('-c');

  args.push(input.pattern);
  args.push(searchPath);

  try {
    const output = execSync(`${rgPath} ${args.join(' ')}`, {
      cwd: ctx.cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();

    return { content: output || 'No matches found', metadata: { via: 'ripgrep' } };
  } catch (err: any) {
    if (err.status === 1) return { content: 'No matches found', metadata: { matchCount: 0 } };
    return { content: `grep error: ${err.message}`, error: err.message };
  }
}

function grepWithNode(input: GrepInput, ctx: ToolCallContext): ToolOutput {
  const searchPath = input.path ? path.resolve(ctx.cwd, input.path) : ctx.cwd;
  const flags = input.case_sensitive ? 'g' : 'gi';
  const regex = new RegExp(input.pattern, flags);
  const matches: GrepMatch[] = [];
  const maxResults = input.max_results ?? 200;
  const contextLines = input.context_lines ?? 0;

  function searchDir(dir: string) {
    if (matches.length >= maxResults) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (matches.length >= maxResults) return;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'target') {
            searchDir(fullPath);
          }
        } else if (entry.isFile()) {
          if (input.include && !entry.name.match(new RegExp(input.include))) continue;
          if (!/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|css|html|json|yaml|yml|toml|md|txt|sh)$/i.test(entry.name)) continue;
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= maxResults) return;
              regex.lastIndex = 0;
              if (regex.test(lines[i])) {
                const match: GrepMatch = {
                  file: path.relative(ctx.cwd, fullPath),
                  line: i + 1,
                  content: lines[i].trim(),
                };
                if (contextLines > 0) {
                  match.before = lines.slice(Math.max(0, i - contextLines), i);
                  match.after = lines.slice(i + 1, i + 1 + contextLines);
                }
                matches.push(match);
              }
            }
          } catch { /* */ }
        }
      }
    } catch { /* */ }
  }

  searchDir(searchPath);

  if (input.output_mode === 'files_with_matches') {
    const files = [...new Set(matches.map(m => m.file))];
    return { content: files.join('\n') || 'No matches found', metadata: { matchCount: files.length } };
  }

  const output = matches.map(m => {
    let line = `${m.file}:${m.line}: ${m.content}`;
    if (m.before?.length) line = m.before.map(b => `  ${b}`).join('\n') + '\n' + line;
    if (m.after?.length) line += '\n' + m.after.map(a => `  ${a}`).join('\n');
    return line;
  }).join('\n');

  return { content: output || 'No matches found', metadata: { matchCount: matches.length } };
}

// ─── List Directory Tool ───────────────────────────────────

export interface ListDirInput {
  path?: string;
  max_depth?: number;
  show_hidden?: boolean;
}

const DEFAULT_MAX_OUTPUT_CHARS = 10_000;
const MAX_SEED_ITEMS = 100_000;

interface DirAccum {
  totalFiles: number;
  byExt: Map<string, number>;
}

function addExt(accum: DirAccum, ext: string) {
  accum.totalFiles++;
  accum.byExt.set(ext, (accum.byExt.get(ext) || 0) + 1);
}

function toSummary(accum: DirAccum, topN: number = 3): string {
  if (accum.byExt.size === 0) return '';
  const items = Array.from(accum.byExt.entries()).sort((a, b) => b[1] - a[1]);
  const parts: string[] = [];
  let topSum = 0;
  for (const [ext, count] of items.slice(0, topN)) {
    topSum += count;
    parts.push(ext === 'no-ext' ? `${count} *no-ext` : `${count} *.${ext}`);
  }
  const ellipsis = topSum < accum.totalFiles ? ', ...' : '';
  return ` [${accum.totalFiles} files in subtree: ${parts.join(', ')}${ellipsis}]`;
}

/**
 * List directory contents with BFS expansion and char budget.
 */
export function listDir(
  input: ListDirInput,
  ctx: ToolCallContext,
): ToolOutput {
  const dirPath = input.path ? path.resolve(ctx.cwd, input.path) : ctx.cwd;
  const maxDepth = input.max_depth ?? 2;
  const charBudget = DEFAULT_MAX_OUTPUT_CHARS;
  const accum: DirAccum = { totalFiles: 0, byExt: new Map() };

  interface QueueItem { dirPath: string; depth: number; prefix: string; isLast: boolean; }

  const lines: string[] = [];
  let totalChars = 0;
  let truncated = false;

  function addLine(line: string) {
    if (totalChars + line.length + 1 > charBudget) { truncated = true; return false; }
    lines.push(line);
    totalChars += line.length + 1;
    return true;
  }

  // Seed depth-1 children
  const queue: QueueItem[] = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted.slice(0, MAX_SEED_ITEMS)) {
      if (!input.show_hidden && entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === '.git') continue;
      queue.push({ dirPath: path.join(dirPath, entry.name), depth: 0, prefix: '', isLast: false });
    }
  } catch {
    return { content: `Error: ${dirPath} is not a valid directory`, error: 'Invalid directory' };
  }

  // BFS expansion
  for (const item of queue) {
    if (truncated) break;
    const relPath = path.relative(dirPath, item.dirPath);

    try {
      const stat = fs.statSync(item.dirPath);
      if (stat.isDirectory()) {
        if (!addLine(`${item.prefix}${relPath}/`)) break;
        if (item.depth < maxDepth) {
          const children = fs.readdirSync(item.dirPath, { withFileTypes: true });
          for (const child of children.sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
            return a.name.localeCompare(b.name);
          })) {
            if (!input.show_hidden && child.name.startsWith('.')) continue;
            if (child.name === 'node_modules' || child.name === 'target' || child.name === '.git') continue;
            queue.push({ dirPath: path.join(item.dirPath, child.name), depth: item.depth + 1, prefix: item.prefix + '  ', isLast: false });
          }
        }
      } else {
        const ext = path.extname(relPath) || 'no-ext';
        addExt(accum, ext);
        addLine(`${item.prefix}${relPath} (${formatSize(stat.size)})`);
      }
    } catch { /* */ }
  }

  const summary = toSummary(accum);
  const notice = truncated ? '\n    ...\n\n    Note: this directory is too large to list fully. Try list_dir on a narrower path, or use grep / bash.' : '';

  return {
    content: (lines.join('\n') + summary + notice) || '[empty directory]',
    metadata: { path: dirPath, truncated, totalFiles: accum.totalFiles },
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── Web Fetch Tool ────────────────────────────────────────

export interface WebFetchInput {
  url: string;
}

function stripHtmlTags(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<h1[^>]*>/gi, '# ');
  text = text.replace(/<h2[^>]*>/gi, '## ');
  text = text.replace(/<h3[^>]*>/gi, '### ');
  text = text.replace(/<h4[^>]*>/gi, '#### ');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.split('\n').map(l => l.trimEnd()).join('\n');
  return text.trim();
}

/**
 * Fetch URL content with SSRF protection and HTML-to-markdown conversion.
 */
export async function webFetch(
  input: WebFetchInput,
  _ctx: ToolCallContext,
): Promise<ToolOutput> {
  try {
    const url = new URL(input.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { content: 'Only HTTP/HTTPS URLs are supported', error: 'Invalid protocol' };
    }

    // SSRF check — block private/link-local IPs
    const { checkSsrf } = await import('../ssrf.js');
    await checkSsrf(url.toString());

    // Upgrade HTTP to HTTPS
    const fetchUrl = url.protocol === 'http:' ? url.toString().replace('http://', 'https://') : url.toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Kairo/0.3.0',
        'Accept': 'text/markdown, text/html, text/plain, */*',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { content: `HTTP ${response.status}: ${response.statusText}`, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    let text = await response.text();

    // Convert HTML to markdown if needed
    if (contentType.includes('text/html')) {
      text = stripHtmlTags(text);
    }

    // Truncate to reasonable length
    const truncated = text.length > 50000 ? text.slice(0, 50000) + '\n\n[truncated]' : text;

    return {
      content: truncated,
      metadata: { status: response.status, contentType, truncated: text.length > 50000 },
    };
  } catch (err: any) {
    return { content: `Fetch error: ${err.message}`, error: err.message };
  }
}

// ─── Web Search Tool ───────────────────────────────────────

export interface WebSearchInput {
  query: string;
  allowed_domains?: string[];
}

/**
 * Web search (stub — needs API key for real implementation).
 */
export async function webSearch(
  input: WebSearchInput,
  _ctx: ToolCallContext,
): Promise<ToolOutput> {
  return {
    content: `Web search for "${input.query}" — requires API key configuration. Use web_fetch for direct URL access.`,
    metadata: { query: input.query },
  };
}

// ─── Tool Registry ─────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  kind: ToolKind;
  namespace: ToolNamespace;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: ToolInput, ctx: ToolCallContext) => Promise<ToolOutput> | ToolOutput;
}

/**
 * Create the default tool registry with all built-in tools.
 */
export function createBuiltinTools(): ToolDefinition[] {
  return [
    {
      name: 'bash',
      kind: 'execute',
      namespace: 'kairo',
      description: 'Execute a bash/shell command',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to run' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' },
          isBackground: { type: 'boolean', description: 'Run in background' },
        },
        required: ['command'],
      },
      handler: (input, ctx) => executeBash(input as unknown as BashInput, ctx),
    },
    {
      name: 'read_file',
      kind: 'read',
      namespace: 'kairo',
      description: 'Read file contents with optional line range',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          offset: { type: 'number', description: 'Start line (1-indexed)' },
          limit: { type: 'number', description: 'Number of lines to read' },
        },
        required: ['path'],
      },
      handler: (input, ctx) => readFile(input as unknown as ReadFileInput, ctx),
    },
    {
      name: 'search_replace',
      kind: 'edit',
      namespace: 'kairo',
      description: 'Search and replace text in a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          old_string: { type: 'string', description: 'Text to find' },
          new_string: { type: 'string', description: 'Replacement text' },
          replace_all: { type: 'boolean', description: 'Replace all occurrences' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
      handler: (input, ctx) => searchReplace(input as unknown as SearchReplaceInput, ctx),
    },
    {
      name: 'grep',
      kind: 'search',
      namespace: 'kairo',
      description: 'Search file contents by regex pattern (uses ripgrep when available)',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern' },
          path: { type: 'string', description: 'Directory or file to search' },
          include: { type: 'string', description: 'File pattern filter' },
          case_sensitive: { type: 'boolean' },
          context_lines: { type: 'number', description: 'Lines of context before/after' },
          output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] },
          max_results: { type: 'number' },
        },
        required: ['pattern'],
      },
      handler: (input, ctx) => grep(input as unknown as GrepInput, ctx),
    },
    {
      name: 'list_dir',
      kind: 'list',
      namespace: 'kairo',
      description: 'List directory contents',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' },
          max_depth: { type: 'number', description: 'Max depth (default 2)' },
          show_hidden: { type: 'boolean' },
        },
      },
      handler: (input, ctx) => listDir(input as ListDirInput, ctx),
    },
    {
      name: 'web_fetch',
      kind: 'web_fetch',
      namespace: 'kairo',
      description: 'Fetch content from a URL',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
        },
        required: ['url'],
      },
      handler: (input, ctx) => webFetch(input as unknown as WebFetchInput, ctx),
    },
    {
      name: 'web_search',
      kind: 'web_search',
      namespace: 'kairo',
      description: 'Search the web',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          allowed_domains: { type: 'array', items: { type: 'string' } },
        },
        required: ['query'],
      },
      handler: (input, ctx) => webSearch(input as unknown as WebSearchInput, ctx),
    },
  ];
}
