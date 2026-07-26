/**
 * Kairo — Tool Argument Normalization
 * Normalizes tool arguments when the model sends them in wrong format.
 * E.g., plain string instead of JSON object, missing required fields.
 */

// ─── Tool Field Mappings ───────────────────────────────────

/** Maps tool names to their primary string argument field */
const STRING_ARGUMENT_FIELDS: Record<string, string> = {
  read: 'path',
  write: 'path',
  edit: 'path',
  grep: 'pattern',
  glob: 'pattern',
  exec: 'command',
  bash: 'command',
  search: 'query',
  memory: 'content',
  web_search: 'query',
  web_fetch: 'url',
  ls: 'path',
  hashline: 'path',
  session_search: 'query',
  skill: 'name',
  agent: 'name',
  task_create: 'prompt',
  todo: 'content',
  notebook_edit: 'path',
  file_read: 'path',
  file_write: 'path',
  file_edit: 'path',
};

// ─── Normalization ─────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlankString(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Check if a value looks like a structured object literal (vs bash compound command).
 */
function isLikelyObjectLiteral(value: string): boolean {
  return /^\s*\{\s*['"]?\w+['"]?\s*:/.test(value);
}

/**
 * Normalize tool arguments to a consistent format.
 * Handles common model mistakes:
 * - Plain string instead of JSON object
 * - Missing quotes around keys
 * - Trailing commas
 */
export function normalizeToolArguments(
  toolName: string,
  rawArgs: string | undefined,
): Record<string, unknown> {
  if (rawArgs === undefined) return {};

  // Try JSON parse first
  try {
    const parsed = JSON.parse(rawArgs);
    if (isRecord(parsed)) return parsed;

    // Parsed as non-object (string, number, etc.)
    if (typeof parsed === 'string' && !isBlankString(parsed)) {
      const field = STRING_ARGUMENT_FIELDS[toolName];
      if (field) return { [field]: parsed };
    }

    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    // JSON parse failed — try to recover
  }

  // Try to fix common JSON issues
  let fixed = rawArgs.trim();

  // Remove trailing commas before } or ]
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // Add quotes around unquoted keys
  fixed = fixed.replace(/(\{|,)\s*(\w+)\s*:/g, '$1"$2":');

  try {
    const parsed = JSON.parse(fixed);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Still can't parse — wrap as string argument
  }

  // Last resort: treat the entire string as the primary argument
  const field = STRING_ARGUMENT_FIELDS[toolName];
  if (field && !isBlankString(rawArgs)) {
    return { [field]: rawArgs };
  }

  return {};
}

/**
 * Extract a string argument from normalized tool args.
 */
export function getStringArg(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = args[key];
    if (typeof val === 'string') return val;
  }
  return undefined;
}

/**
 * Flatten structured tool arguments into the flat string format that
 * Kairo's tools expect.
 *
 * Most Kairo tools take a flat string (e.g. `web_search` takes the query
 * string directly, `read` takes the path directly). But when the model
 * emits tool calls as JSON (either via the native API or as bare JSON
 * text), the args arrive as a JSON object string like `{"query":"now"}`.
 *
 * This function detects JSON args and extracts the right field for the
 * tool, falling back to the raw string if parsing fails or the tool
 * isn't in the mapping.
 *
 * Examples:
 *   flattenArgs('web_search', '{"query":"now"}') → 'now'
 *   flattenArgs('read', '{"path":"foo.txt"}')    → 'foo.txt'
 *   flattenArgs('exec', '{"command":"ls -la"}')  → 'ls -la'
 *   flattenArgs('web_search', 'just a query')    → 'just a query'
 *   flattenArgs('write', '{"path":"f.txt","content":"hi"}') → 'f.txt\nhi'
 */
export function flattenArgs(toolName: string, rawArgs: string): string {
  if (!rawArgs || !rawArgs.trim()) return '';

  // Check if args look like JSON (starts with {).
  const trimmed = rawArgs.trim();
  if (!trimmed.startsWith('{')) {
    return trimmed;  // already flat
  }

  // Try to parse as JSON.
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Try single-quote repair.
    try {
      parsed = JSON.parse(trimmed.replace(/'/g, '"'));
    } catch {
      return trimmed;  // can't parse — return as-is
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return trimmed;
  }

  // Handle nested {"tool": "...", "args": {...}} or {"name": "...", "arguments": {...}}
  // — extract the inner args/arguments object.
  const innerArgs = parsed.args || parsed.arguments;
  if (innerArgs && typeof innerArgs === 'object' && !Array.isArray(innerArgs)) {
    parsed = innerArgs as Record<string, unknown>;
  } else if (typeof innerArgs === 'string') {
    return innerArgs;
  }

  // Special-case multi-arg tools.
  if (toolName === 'write' || toolName === 'file_write') {
    const path = String(parsed.path || parsed.file || parsed.filename || '');
    const content = String(parsed.content || parsed.text || '');
    if (path) return `${path}\n${content}`;
  }

  // Special-case edit (old_string + new_string).
  if (toolName === 'edit' || toolName === 'file_edit') {
    const path = String(parsed.path || parsed.file || '');
    const oldStr = String(parsed.old_string || parsed.old || parsed.find || '');
    const newStr = String(parsed.new_string || parsed.new || parsed.replace || '');
    if (path && oldStr) {
      return `${path}\n${oldStr}\n${newStr}`;
    }
  }

  // Special-case web_fetch (url + optional prompt).
  if (toolName === 'web_fetch') {
    const url = String(parsed.url || parsed.uri || parsed.link || '');
    const prompt = String(parsed.prompt || parsed.question || '');
    if (url) return prompt ? `${url} ${prompt}` : url;
  }

  // Generic: extract the primary field.
  const field = STRING_ARGUMENT_FIELDS[toolName];
  if (field && parsed[field] !== undefined) {
    return String(parsed[field]);
  }

  // Try common field names as fallback.
  for (const key of ['query', 'path', 'command', 'content', 'url', 'name', 'prompt', 'text', 'input']) {
    if (parsed[key] !== undefined && typeof parsed[key] === 'string') {
      return String(parsed[key]);
    }
  }

  // Last resort: return the original string.
  return trimmed;
}
