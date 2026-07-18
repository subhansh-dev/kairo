/**
 * Clarify — clarification request utilities.
 */

export interface ClarifyRequest {
  question: string;
  options?: string[];
  context?: string;
}

export interface ClarifyResponse {
  answer: string;
  selectedIndex?: number;
}

/**
 * Build a clarification request.
 */
export function buildClarifyRequest(question: string, options?: string[], context?: string): ClarifyRequest {
  return { question, options, context };
}

/**
 * Format a clarification request for display.
 */
export function formatClarifyRequest(req: ClarifyRequest): string {
  const lines = [`❓ ${req.question}`];
  if (req.context) lines.push(`   Context: ${req.context}`);
  if (req.options && req.options.length > 0) {
    lines.push('   Options:');
    req.options.forEach((opt, i) => lines.push(`   ${i + 1}. ${opt}`));
  }
  return lines.join('\n');
}

/**
 * Parse a clarification response.
 */
export function parseClarifyResponse(input: string, options?: string[]): ClarifyResponse {
  if (options && options.length > 0) {
    const num = parseInt(input);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      return { answer: options[num - 1], selectedIndex: num - 1 };
    }
    // Try matching by text
    const lower = input.toLowerCase();
    const idx = options.findIndex(o => o.toLowerCase().includes(lower));
    if (idx >= 0) return { answer: options[idx], selectedIndex: idx };
  }
  return { answer: input };
}
