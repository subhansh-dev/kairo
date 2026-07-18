/**
 * Tool validation — validate tool calls before execution.
 */

export interface ToolValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a tool call.
 */
export function validateToolCall(toolName: string, args: Record<string, unknown>, schema?: Record<string, unknown>): ToolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check tool name
  if (!toolName || toolName.trim().length === 0) {
    errors.push('Tool name is required');
  }

  // Check args is an object
  if (args === null || args === undefined) {
    errors.push('Tool arguments are required');
  } else if (typeof args !== 'object') {
    errors.push('Tool arguments must be an object');
  }

  // Validate against schema if provided
  if (schema && schema.required && Array.isArray(schema.required)) {
    for (const required of schema.required) {
      if (!(required in args)) {
        errors.push(`Missing required argument: ${required}`);
      }
    }
  }

  // Check for common issues
  if (typeof args === 'object' && args !== null) {
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined) {
        warnings.push(`Argument "${key}" is undefined`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Sanitize tool arguments.
 */
export function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
