import type { ToolDefinition, ToolResult } from './types.js';

export const clarifyTool: ToolDefinition = {
  name: 'clarify',
  description: 'Ask the user questions to gather information, clarify ambiguity, or offer choices.',
  prompt: `Ask the user questions during execution. Supports:
- clarify <question> — open-ended question
- clarify <question>; <option 1> | <option 2> | <option 3> — multiple choice (separate options with |)
- Use JSON for advanced: {"question":"...","options":[{"label":"...","description":"..."}],"multiSelect":true}

Usage notes:
- Users can always provide custom text (not limited to options)
- multiSelect: true allows selecting multiple options
- If recommending an option, make it first with "(Recommended)" in the label
- In plan mode, do NOT ask for plan approval — use exit_plan_mode instead`,
  tier: 'read',
  concurrencySafe: false,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const trimmed = args.trim();
      if (!trimmed) return { output: 'Usage: clarify <question>', success: false };

      // Try JSON format first
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          const question = parsed.question || parsed.header || 'Question';
          const options = parsed.options || [];
          const multiSelect = parsed.multiSelect || false;

          let output = question;
          if (options.length > 0) {
            output += '\n\n' + options.map((o: any, i: number) => {
              const label = typeof o === 'string' ? o : o.label || `Option ${i + 1}`;
              const desc = typeof o === 'object' ? (o.description || '') : '';
              return `  ${i + 1}. ${label}${desc ? ` — ${desc}` : ''}`;
            }).join('\n');
            if (multiSelect) output += '\n\n(Select all that apply)';
          }
          output += '\n\n(You can also provide your own answer)';

          return { output, success: true, metadata: { question, options, multiSelect, format: 'json' } };
        } catch { /* fall through to plain text format */ }
      }

      // Plain text format: question; option1 | option2 | option3
      const pipeParts = trimmed.split('|');
      if (pipeParts.length > 1) {
        const [questionPart, ...optionParts] = pipeParts.map(s => s.trim());
        const question = questionPart.replace(/;$/, '').trim();
        const options = optionParts.filter(Boolean);

        let output = question;
        output += '\n\n' + options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
        output += '\n\n(You can also provide your own answer)';
        return { output, success: true, metadata: { question, options } };
      }

      // Semicolon-separated: question; option1; option2
      const semiParts = trimmed.split(';').map(s => s.trim());
      if (semiParts.length > 2) {
        const question = semiParts[0];
        const options = semiParts.slice(1).filter(Boolean);
        let output = question;
        output += '\n\n' + options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
        output += '\n\n(You can also provide your own answer)';
        return { output, success: true, metadata: { question, options } };
      }

      // Simple open-ended question
      return { output: `Question: ${trimmed}`, success: true, metadata: { question: trimmed } };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
