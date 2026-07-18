/**
 * Kairo — Coordinator
 * Dynamic role assignment: decides which model plays Thinker/Worker/Verifier per turn
 * and manages the verification loop (approve → done, reject → iterate)
 */

import type { ComplexityLevel, TaskType } from './router.js';
import { getBestModel } from './learner.js';

// ─── Model Definitions ─────────────────────────────────────

const MODELS = {
  thinker:   { provider: 'nvidia',  model: 'nvidia/nemotron-3-ultra-550b-a55b', thinking: true },
  worker:    { provider: 'nvidia',  model: 'nvidia/nemotron-3-ultra-550b-a55b', thinking: false },
  workerFast:{ provider: 'groq',    model: 'gpt-oss-20b',                thinking: false },
  verifier:  { provider: 'groq',    model: 'gpt-oss-120b',               thinking: false },
} as const;

// ─── Types ─────────────────────────────────────────────────

export type CoordinatorRole = 'thinker' | 'worker' | 'verifier';

export interface CoordinatorDecision {
  role: CoordinatorRole;
  provider: string;
  model: string;
  thinking: boolean;
  reasoning: string;
}

export interface TurnContext {
  turn: number;
  taskType: TaskType | string;
  complexity: ComplexityLevel;
  hasToolOutput: boolean;
  lastTurnRole?: CoordinatorRole;
  lastTurnText?: string;
  modelFailures: Record<string, number>;
  verifyRun: boolean;
  verifierIteration: number;
  maxVerifierIterations: number;
}

// ─── Role-Specific Instructions ────────────────────────────

export const ROLE_INSTRUCTIONS: Record<CoordinatorRole, string> = {
  thinker: `You are the Thinker. Your job is to:
- Analyze the problem and decompose it into clear steps
- Create a plan BEFORE any tool use
- Think deeply about approach, edge cases, and trade-offs
- Output your reasoning and plan first, then if needed use tools
- Be thorough — complex problems need careful thought`,

  worker: `You are the Worker. Your job is to:
- Execute the plan: write code, run commands, create files
- Be precise and efficient
- Focus on implementation, not re-analysis
- If something is unclear, check existing files first`,

  verifier: `You are the Verifier. Your job is to:
- Review the work done so far
- Check for correctness, completeness, and edge cases
- Reply EXACTLY in this format:
  APPROVED — if the work is correct and complete
  REJECTED: <reason> — if something needs fixing
- Be specific about what's wrong if rejecting
- Check: does the code compile? Are edge cases handled? Is the logic correct?`,
};

// ─── Coordinator Decision ──────────────────────────────────

export function decideTurn(context: TurnContext): CoordinatorDecision {
  const { turn, complexity, verifyRun, verifierIteration, lastTurnRole, modelFailures, taskType } = context;

  // Simple tasks: always worker, fast model
  if (complexity === 'simple') {
    return {
      role: 'worker',
      ...MODELS.workerFast,
      reasoning: 'Simple task — direct execution with fast model',
    };
  }

  // Learned model selection: check if we have historical data for this task type
  const learned = getBestModel(taskType as string);
  if (learned && turn > 0) {
    // Use learned model if it's different from default and hasn't failed this session
    const learnedKey = `${learned.provider}/${learned.model}`;
    const defaultKey = `${MODELS.worker.provider}/${MODELS.worker.model}`;
    if (learnedKey !== defaultKey && !modelFailures[learned.model]) {
      return {
        role: 'worker',
        provider: learned.provider,
        model: learned.model,
        thinking: false,
        reasoning: `Learned selection: ${learnedKey} has best historical performance for ${taskType}`,
      };
    }
  }

  // Turn 0: Thinker decomposes the problem (complex only)
  if (turn === 0 && complexity === 'complex') {
    return {
      role: 'thinker',
      ...MODELS.thinker,
      reasoning: 'Complex task — thinker decomposes first',
    };
  }

  // Verifier runs on verification turns
  if (verifyRun && verifierIteration < context.maxVerifierIterations) {
    // Run verifier every 3 turns, or after a thinker+worker cycle
    if (lastTurnRole === 'worker' && (turn % 3 === 2 || verifierIteration > 0)) {
      return {
        role: 'verifier',
        ...MODELS.verifier,
        reasoning: `Verification pass #${verifierIteration + 1} — checking work quality`,
      };
    }
  }

  // Worker: pick strongest available model
  const modelKey = modelFailures[MODELS.worker.model] >= 2 ? 'workerFast' : 'worker';
  return {
    role: 'worker',
    ...MODELS[modelKey],
    reasoning: modelKey === 'workerFast'
      ? 'Worker (fast fallback — strong model had failures)'
      : 'Worker — executing tasks',
  };
}

// ─── Verification ──────────────────────────────────────────

export interface VerificationResult {
  approved: boolean;
  feedback: string;
}

const APPROVED_RE = /^APPROVED/i;
const REJECTED_RE = /^REJECTED:\s*(.+)/i;

export function parseVerdict(text: string): VerificationResult {
  const lines = text.trim().split('\n');
  const firstLine = lines[0]?.trim() || '';

  // Check for explicit APPROVED
  if (APPROVED_RE.test(firstLine)) {
    return { approved: true, feedback: firstLine.replace(APPROVED_RE, '').trim() || 'Approved' };
  }

  // Check for explicit REJECTED
  const rejected = firstLine.match(REJECTED_RE);
  if (rejected) {
    return { approved: false, feedback: rejected[1].trim() };
  }

  // Not explicit — check content for implicit approval/rejection
  const fullLower = text.toLowerCase();
  const hasApprovalWords = /looks?\s+(good|correct|right|fine|approved|complete)/i.test(text);
  const hasRejectionWords = /(need|fix|issue|error|wrong|incorrect|problem|missing|should\s+(not|change|add)|doesn't\s+work)/i.test(text);

  if (hasApprovalWords && !hasRejectionWords) {
    return { approved: true, feedback: 'Implicit approval in verifier output' };
  }
  if (hasRejectionWords) {
    return { approved: false, feedback: text.slice(0, 500) };
  }

  // Default: approve if unclear (avoid infinite loops)
  return { approved: true, feedback: 'Approved (no explicit rejection found)' };
}

// ─── Role Prompt Builder ───────────────────────────────────

export function buildRolePrompt(role: CoordinatorRole, verifierIteration?: number): string {
  const base = ROLE_INSTRUCTIONS[role];

  if (role === 'verifier' && verifierIteration && verifierIteration > 0) {
    return `${base}\n\nThis is verification pass #${verifierIteration + 1}. Previous feedback was not addressed. Be thorough.`;
  }

  if (role === 'worker' && verifierIteration && verifierIteration > 0) {
    return `${base}\n\nNote: This is a re-work pass. Previous verifier feedback must be addressed. Read the feedback carefully.`;
  }

  return base;
}
