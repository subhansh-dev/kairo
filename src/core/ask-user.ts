/**
 * Ask user — interactive user input utilities.
 */

export interface AskUserRequest {
  question: string;
  type?: 'text' | 'confirm' | 'select' | 'multiselect';
  options?: string[];
  default?: string;
  required?: boolean;
}

export interface AskUserResponse {
  answer: string;
  confirmed?: boolean;
  selected?: number[];
}

/**
 * Build an ask user request.
 */
export function buildAskUserRequest(question: string, opts: Partial<AskUserRequest> = {}): AskUserRequest {
  return {
    question,
    type: opts.type || 'text',
    options: opts.options,
    default: opts.default,
    required: opts.required ?? true,
  };
}

/**
 * Format an ask user request for display.
 */
export function formatAskUserRequest(req: AskUserRequest): string {
  const lines = [`💬 ${req.question}`];

  if (req.type === 'confirm') {
    lines.push(`   ${req.default === 'yes' ? '[Y/n]' : '[y/N]'}`);
  } else if (req.options && req.options.length > 0) {
    req.options.forEach((opt, i) => lines.push(`   ${i + 1}. ${opt}`));
  } else if (req.default) {
    lines.push(`   Default: ${req.default}`);
  }

  return lines.join('\n');
}

/**
 * Parse an ask user response.
 */
export function parseAskUserResponse(input: string, req: AskUserRequest): AskUserResponse {
  if (req.type === 'confirm') {
    const lower = input.toLowerCase().trim();
    const confirmed = lower === 'y' || lower === 'yes' || lower === 'true' || lower === '1';
    return { answer: input, confirmed };
  }

  if (req.type === 'select' && req.options) {
    const num = parseInt(input);
    if (!isNaN(num) && num >= 1 && num <= req.options.length) {
      return { answer: req.options[num - 1], selected: [num - 1] };
    }
  }

  if (req.type === 'multiselect' && req.options) {
    const nums = input.split(/[,\s]+/).map(s => parseInt(s)).filter(n => !isNaN(n));
    const valid = nums.filter(n => n >= 1 && n <= req.options!.length);
    return {
      answer: valid.map(n => req.options![n - 1]).join(', '),
      selected: valid.map(n => n - 1),
    };
  }

  return { answer: input || req.default || '' };
}
