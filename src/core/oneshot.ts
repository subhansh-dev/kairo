/**
 * Shared one-off LLM requests for non-conversational helpers.
 *
 * A "one-shot" is a single, stateless model call that runs outside any
 * conversation. Used for small generative chores: commit messages, summaries, etc.
 */

export interface OneShotOptions {
  instructions: string;
  userInput: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  provider?: string;
}

export interface OneShotTemplate {
  name: string;
  buildPrompt: (variables: Record<string, unknown>) => { instructions: string; userInput: string };
}

// Built-in templates
const TEMPLATES: Record<string, OneShotTemplate> = {
  commit_message: {
    name: 'commit_message',
    buildPrompt: (vars) => {
      const diff = String(vars.diff || '').slice(0, 12000);
      const recent = String(vars.recent_commits || '').slice(0, 1500);

      const parts = [];
      if (recent.trim()) {
        parts.push(`Recent commit subjects from this repo (match their style/conventions):\n${recent}`);
      }
      parts.push(`Diff to describe:\n${diff || '(no textual diff available)'}`);

      return {
        instructions: `You write git commit messages. Given a diff of staged changes, write ONE concise Conventional Commits message describing what the change does and why.
Rules:
- Subject line: type(scope): summary — imperative mood, lower-case, no trailing period, ≤ 72 characters.
- Types: feat, fix, refactor, perf, docs, test, build, chore, style, ci.
- Add a short body ONLY when the change needs explanation.
- Return ONLY the commit message text — no quotes, no markdown fences.`,
        userInput: parts.join('\n\n'),
      };
    },
  },

  summarize: {
    name: 'summarize',
    buildPrompt: (vars) => ({
      instructions: 'Summarize the following text concisely, capturing the key points.',
      userInput: String(vars.text || '').slice(0, 12000),
    }),
  },

  explain_error: {
    name: 'explain_error',
    buildPrompt: (vars) => ({
      instructions: 'Explain what this error means and suggest how to fix it. Be concise and actionable.',
      userInput: `Error:\n${String(vars.error || '').slice(0, 4000)}\n\nContext:\n${String(vars.context || '').slice(0, 4000)}`,
    }),
  },

  suggest_name: {
    name: 'suggest_name',
    buildPrompt: (vars) => ({
      instructions: 'Suggest a short, descriptive name (2-4 words) for the following code or concept. Return ONLY the name.',
      userInput: String(vars.code || vars.description || '').slice(0, 4000),
    }),
  },
};

/**
 * Get a registered template by name.
 */
export function getTemplate(name: string): OneShotTemplate | null {
  return TEMPLATES[name] || null;
}

/**
 * Register a custom template.
 */
export function registerTemplate(template: OneShotTemplate): void {
  TEMPLATES[template.name] = template;
}

/**
 * List available templates.
 */
export function listTemplates(): string[] {
  return Object.keys(TEMPLATES);
}

/**
 * Truncate text to a limit.
 */
function truncate(text: string, limit: number): string {
  if (!text || text.length <= limit) return text;
  return text.slice(0, limit).trimEnd() + '\n…(truncated)';
}

/**
 * Build a one-shot prompt from options or template.
 */
export function buildOneShotPrompt(
  opts: OneShotOptions | { template: string; variables: Record<string, unknown> },
): OneShotOptions {
  if ('template' in opts) {
    const tmpl = getTemplate(opts.template);
    if (!tmpl) throw new Error(`Unknown template: ${opts.template}`);
    const { instructions, userInput } = tmpl.buildPrompt(opts.variables);
    return { instructions, userInput };
  }
  return opts;
}

/**
 * Format a one-shot result for display.
 */
export function formatOneShotResult(result: string, maxLen = 500): string {
  if (!result) return '(no result)';
  if (result.length <= maxLen) return result;
  return result.slice(0, maxLen).trimEnd() + '…';
}
