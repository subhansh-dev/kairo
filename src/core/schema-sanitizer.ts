/**
 * Schema sanitizer — clean up JSON schemas for tool definitions.
 */

/**
 * Sanitize a JSON schema for use in tool definitions.
 * Removes problematic patterns that some models reject.
 */
export function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...schema };

  // Remove regex patterns in string schemas (some models reject them)
  if (sanitized.type === 'string' && sanitized.pattern) {
    delete sanitized.pattern;
  }

  // Recurse into properties
  if (sanitized.properties && typeof sanitized.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(sanitized.properties as Record<string, unknown>)) {
      props[key] = typeof value === 'object' && value !== null
        ? sanitizeSchema(value as Record<string, unknown>)
        : value;
    }
    sanitized.properties = props;
  }

  // Recurse into items (for array schemas)
  if (sanitized.items && typeof sanitized.items === 'object' && !Array.isArray(sanitized.items)) {
    sanitized.items = sanitizeSchema(sanitized.items as Record<string, unknown>);
  }

  // Remove unsupported keywords
  const unsupported = ['if', 'then', 'else', 'allOf', 'anyOf', 'oneOf', 'not', 'dependentSchemas'];
  for (const key of unsupported) {
    if (key in sanitized) delete sanitized[key];
  }

  return sanitized;
}

/**
 * Validate that a schema is well-formed.
 */
export function validateSchema(schema: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!schema || typeof schema !== 'object') {
    return { valid: false, errors: ['Schema must be an object'] };
  }

  const s = schema as Record<string, unknown>;

  if (s.type && typeof s.type !== 'string') {
    errors.push('type must be a string');
  }

  if (s.properties && typeof s.properties !== 'object') {
    errors.push('properties must be an object');
  }

  if (s.required && !Array.isArray(s.required)) {
    errors.push('required must be an array');
  }

  return { valid: errors.length === 0, errors };
}
