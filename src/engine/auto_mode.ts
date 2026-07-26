/**
 * Auto permission mode: LLM classifier with safe fast-paths.
 *
 * Classifies tool authorization requests into Allow/Block/Unavailable.
 * Safe fast-paths bypass the classifier for known-safe operations.
 */

export type ClassifierVerdict = 'allow' | 'block' | 'unavailable';

export type ClassifierMessageRole = 'system' | 'user';

export type ClassifierPromptType =
  | 'full'
  | 'no_user_tool_prefix'
  | 'bare_instructions'
  | 'just_command';

export interface ClassifierMessage {
  role: ClassifierMessageRole;
  text: string;
}

export type ClassifierTurn =
  | { kind: 'user_text'; text: string }
  | { kind: 'assistant_tool_use'; tool: string; args: string }
  | { kind: 'permission_decision'; tool: string; args: string; approved: boolean };

/**
 * Render a classifier turn to text.
 */
function renderTurn(turn: ClassifierTurn): string {
  switch (turn.kind) {
    case 'user_text':
      return `User: ${turn.text}`;
    case 'assistant_tool_use':
      return `${turn.tool} ${turn.args}`;
    case 'permission_decision':
      if (turn.approved) {
        return `The user was asked before running ${turn.tool} ${turn.args} and approved it; it has run once.`;
      }
      return `The user was asked about running ${turn.tool} ${turn.args} and declined it.`;
  }
}

/**
 * Safe commands that can be auto-approved without classifier.
 */
const SAFE_COMMANDS = new Set([
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'date', 'whoami',
  'which', 'where', 'find', 'file', 'stat', 'du', 'df',
  'git status', 'git log', 'git diff', 'git show', 'git branch',
  'node --version', 'npm --version', 'python --version',
]);

/**
 * Dangerous commands that should always prompt.
 */
const DANGEROUS_COMMANDS = new Set([
  'rm -rf', 'mkfs', 'dd if=', ':(){ :|:& };:',
  'chmod -R 777', 'curl | sh', 'wget | sh',
]);

/**
 * Fast-path classifier: check if a command is known-safe or known-dangerous.
 */
export function fastPathClassify(command: string): ClassifierVerdict | null {
  const trimmed = command.trim().toLowerCase();

  // Check dangerous first (higher priority)
  for (const dangerous of DANGEROUS_COMMANDS) {
    if (trimmed.includes(dangerous)) return 'block';
  }

  // Check safe commands
  for (const safe of SAFE_COMMANDS) {
    if (trimmed === safe || trimmed.startsWith(safe + ' ')) {
      return 'allow';
    }
  }

  return null; // Needs classifier
}

/**
 * Build classifier messages from context.
 */
export function buildClassifierMessages(
  promptType: ClassifierPromptType,
  transcript: ClassifierTurn[],
  command: string,
  agentsMd?: string,
): ClassifierMessage[] {
  const messages: ClassifierMessage[] = [];

  const systemPrompt = `You are a security classifier for a coding agent.
Analyze the proposed command and respond with a JSON object:
{"verdict": "allow" | "block", "reason": "brief explanation"}

Rules:
- Allow: read-only operations, safe builds, tests, git operations
- Block: destructive operations, network access to untrusted hosts, privilege escalation
- Be conservative: when in doubt, block`;

  messages.push({ role: 'system', text: systemPrompt });

  if (promptType === 'full' && agentsMd) {
    messages.push({ role: 'user', text: `Project context:\n${agentsMd}` });
  }

  if (promptType !== 'just_command' && promptType !== 'bare_instructions') {
    const transcriptText = transcript.map(renderTurn).join('\n');
    if (transcriptText) {
      messages.push({ role: 'user', text: `Conversation:\n${transcriptText}` });
    }
  }

  messages.push({ role: 'user', text: `Classify this command: ${command}` });

  return messages;
}

/**
 * Parse classifier response.
 */
export function parseClassifierResponse(response: string): ClassifierVerdict {
  try {
    const parsed = JSON.parse(response);
    if (parsed.verdict === 'allow') return 'allow';
    if (parsed.verdict === 'block') return 'block';
    return 'unavailable';
  } catch {
    // Try to extract verdict from text
    const lower = response.toLowerCase();
    if (lower.includes('"allow"') || lower.includes('verdict: allow')) return 'allow';
    if (lower.includes('"block"') || lower.includes('verdict: block')) return 'block';
    return 'unavailable';
  }
}
