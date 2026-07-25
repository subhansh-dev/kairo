/**
 * Kairo — Tool Types
 */

// ─── Tool Result ────────────────────────────────────────────────

export interface ToolResult {
  output: string;
  success: boolean;
  metadata?: Record<string, unknown>;
  /** Whether this result is safe to elide from context after consumption */
  useless?: boolean;
}

// ─── Permission System ────────────────────────

export type ToolTier = 'read' | 'write' | 'exec';

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
  /** Force prompt even in auto-approve modes */
  override?: boolean;
}

export type PermissionChecker = (args: string) => PermissionDecision;

// ─── Tool Schema for Structured Calls ───────────────────────────

export interface ToolParameterProperty {
  type: string;
  description: string;
  default?: unknown;
  enum?: string[];
  required?: boolean;
}

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

// ─── Tool Definition ────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  /** Full prompt shown to the model */
  prompt?: string;
  /** Parameter schema for structured tool calling */
  parameters?: ToolParameterSchema;
  /** Capability tier for permission system */
  tier: ToolTier;
  /** Whether multiple instances can run concurrently */
  concurrencySafe: boolean;
  /** Whether tool only reads (never modifies) */
  readOnly: boolean;
  /** Whether tool is potentially destructive */
  destructive: boolean;
  /** Custom permission checker */
  checkPermissions?: PermissionChecker;
  /** Execute the tool */
  execute: (args: string, signal?: AbortSignal) => Promise<ToolResult>;
  /** Format result for display */
  formatResult?: (result: ToolResult) => string;
  /** Cooldown in ms between calls (-1 = not concurrent, 0 = no cooldown) */
  cooldownMs?: number;
  /** Max output length in characters */
  maxOutputLength?: number;
}

// ─── Tool Registry ──────────────────────────────────────────────

export interface ToolRegistry {
  get(name: string): ToolDefinition | undefined;
  getAll(): ToolDefinition[];
  getNames(): string[];
  getForPrompt(): string;
  execute(name: string, args: string, signal?: AbortSignal): Promise<ToolResult>;
  /** Search tools by name or description */
  search?(query: string): ToolDefinition[];
  /** Get tools by tier */
  getByTier?(tier: 'read' | 'write' | 'exec'): ToolDefinition[];
  /** Get read-only tools */
  getReadOnly?(): ToolDefinition[];
}

// ─── Tool Call Extraction ─────────────────────

export interface ExtractedToolCall {
  name: string;
  args: string;
  raw: string;
}

/**
 * Extract tool calls from model output.
 * Line-based: each line starting with `!tool_name` starts a new call.
 * Subsequent non-! lines are appended as args (multi-line content for write).
 * Also extracts from ```code blocks (```bash → exec, ``` containing !tool → tool calls).
 * Also extracts <tool_call>{json}</tool_call> XML blocks (Hermes/Nemotron dialect).
 */
export function extractToolCalls(text: string): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];

  // ── Pass 0: extract <tool_call>{json}</tool_call> XML blocks ──
  // This handles models (Nemotron, Hermes, etc.) that emit tool calls as
  // XML tags containing JSON. We parse the JSON and convert to the same
  // ExtractedToolCall format as the line-based parser.
  const xmlToolCallRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  let xmlMatch: RegExpExecArray | null;
  while ((xmlMatch = xmlToolCallRegex.exec(text)) !== null) {
    const jsonStr = xmlMatch[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed.name === 'string') {
        let argsStr: string;
        if (parsed.arguments && typeof parsed.arguments === 'object') {
          argsStr = JSON.stringify(parsed.arguments);
        } else if (parsed.arguments && typeof parsed.arguments === 'string') {
          argsStr = parsed.arguments;
        } else if (parsed.args && typeof parsed.args === 'object') {
          argsStr = JSON.stringify(parsed.args);
        } else if (parsed.args && typeof parsed.args === 'string') {
          argsStr = parsed.args;
        } else {
          argsStr = '{}';
        }
        calls.push({
          name: parsed.name.toLowerCase(),
          args: argsStr,
          raw: jsonStr,
        });
      }
    } catch {
      // JSON parse failed — try Python-literal eval fallback (single quotes).
      try {
        const repaired = jsonStr.replace(/'/g, '"');
        const parsed = JSON.parse(repaired);
        if (parsed && typeof parsed.name === 'string') {
          let argsStr: string;
          if (parsed.arguments && typeof parsed.arguments === 'object') {
            argsStr = JSON.stringify(parsed.arguments);
          } else if (parsed.arguments && typeof parsed.arguments === 'string') {
            argsStr = parsed.arguments;
          } else {
            argsStr = '{}';
          }
          calls.push({
            name: parsed.name.toLowerCase(),
            args: argsStr,
            raw: jsonStr,
          });
        }
      } catch {
        // Still failed — skip this block.
      }
    }
  }

  // Also handle bare JSON objects with "name" and "arguments" fields
  // (some models emit them without XML wrapping).
  if (calls.length === 0) {
    const bareJsonRegex = /\{"name"\s*:\s*"([a-zA-Z_][a-zA-Z0-9_-]*)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\}/g;
    let bareMatch: RegExpExecArray | null;
    while ((bareMatch = bareJsonRegex.exec(text)) !== null) {
      const toolName = bareMatch[1].toLowerCase();
      const argsJson = bareMatch[2];
      calls.push({
        name: toolName,
        args: argsJson,
        raw: bareMatch[0],
      });
    }
  }

  const lines = text.split('\n');

  // First pass: strip code blocks and collect all lines as flat text
  const flatLines: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```\w*$/.test(trimmed)) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
        codeBlockLines = [];
      } else {
        // End of code block — flush collected lines as single exec call
        const isShellBlock = codeBlockLang === 'bash' || codeBlockLang === 'sh' || codeBlockLang === 'shell' || codeBlockLang === 'zsh';
        if (isShellBlock && codeBlockLines.length > 0) {
          const shellContent = codeBlockLines.join('\n');
          if (shellContent.trim()) flatLines.push(`!exec ${shellContent}`);
        } else if (codeBlockLines.length > 0) {
          for (const cl of codeBlockLines) {
            if (cl.trim().startsWith('!')) flatLines.push(cl);
          }
        }
        inCodeBlock = false;
        codeBlockLang = '';
        codeBlockLines = [];
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockLines.push(line);
    } else {
      flatLines.push(line);
    }
  }

  // Second pass: line-by-line tool extraction
  let currentCall: { name: string; args: string[]; raw: string[] } | null = null;

  function flushCall() {
    if (currentCall) {
      calls.push({ name: currentCall.name, args: currentCall.args.join('\n').trim(), raw: currentCall.raw.join('\n') });
      currentCall = null;
    }
  }

  for (const line of flatLines) {
    const trimmed = line.trim();
    const bangMatch = trimmed.match(/^!([a-zA-Z_][a-zA-Z0-9_-]*)\s*(.*)$/);
    if (bangMatch) {
      flushCall();
      currentCall = { name: bangMatch[1].toLowerCase(), args: [bangMatch[2]], raw: [line] };
    } else if (currentCall) {
      if (trimmed) {
        currentCall.args.push(line);
        currentCall.raw.push(line);
      } else {
        currentCall.args.push('');
        currentCall.raw.push(line);
      }
    }
  }
  flushCall();

  return calls;
}

// ─── Tool Cooldown Tracker ────────────────────

const toolLastCall = new Map<string, number>();

export function checkToolCooldown(tool: ToolDefinition): number | null {
  if (!tool.cooldownMs || tool.cooldownMs <= 0) return null;
  const lastCall = toolLastCall.get(tool.name);
  if (!lastCall) return null;
  const elapsed = Date.now() - lastCall;
  if (elapsed < tool.cooldownMs) {
    return tool.cooldownMs - elapsed;
  }
  return null;
}

export function recordToolCall(tool: ToolDefinition): void {
  if (tool.cooldownMs && tool.cooldownMs > 0) {
    toolLastCall.set(tool.name, Date.now());
  }
}
