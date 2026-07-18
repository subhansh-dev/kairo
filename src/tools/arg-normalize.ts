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
