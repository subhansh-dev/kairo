/**
 * Kairo — Smart Router
 * Uses a fast model (Groq 8b) to classify tasks instead of hardcoded keywords.
 * Falls back to structural heuristics only when the fast model is unavailable.
 */

import { getRegistry, type Provider, type ChatMessage } from '../providers/registry.js';
import { getBestModel } from './learner.js';

// ─── Types ─────────────────────────────────────────────────

export enum TaskType {
  CODE = 'code',
  PLANNING = 'planning',
  SECURITY = 'security',
  QUICK = 'quick',
  GENERAL = 'general',
}

export type ComplexityLevel = 'simple' | 'medium' | 'complex';

export interface TaskProfile {
  taskType: TaskType;
  complexity: ComplexityLevel;
}

export interface ModelRoute {
  taskType: TaskType;
  provider: string;
  model: string;
  thinking: boolean;
  routed: boolean;
}

export interface TeamMember {
  provider: string;
  model: string;
  thinking: boolean;
  role: 'thinker' | 'worker' | 'verifier' | 'fast' | 'strong';
}

export interface ModelTeam {
  members: TeamMember[];
  primary: ModelRoute;
  verify: boolean;
  parallel: boolean;
}

// ─── Model Definitions ─────────────────────────────────────

export const MODELS = {
  fast:       { provider: 'groq',      model: 'gpt-oss-20b',                thinking: false },
  strong:     { provider: 'nvidia',    model: 'nvidia/nemotron-3-ultra-550b-a55b', thinking: false },
  thinker:    { provider: 'nvidia',    model: 'nvidia/nemotron-3-ultra-550b-a55b', thinking: true },
  verifier:   { provider: 'groq',      model: 'gpt-oss-120b',               thinking: false },
  classifier: { provider: 'groq',      model: 'gpt-oss-20b',                thinking: false },
};

/**
 * Coordinator-compatible model definitions.
 * Maps the coordinator's role names (thinker, worker, workerFast, verifier)
 * to the corresponding provider/model configurations.
 */
export const ROUTER_MODELS = {
  thinker:    { provider: 'nvidia',  model: 'nvidia/nemotron-3-ultra-550b-a55b', thinking: true },
  worker:     { provider: 'nvidia',  model: 'nvidia/nemotron-3-ultra-550b-a55b', thinking: false },
  workerFast: { provider: 'groq',    model: 'gpt-oss-20b',                thinking: false },
  verifier:   { provider: 'groq',    model: 'gpt-oss-120b',               thinking: false },
} as const;

// ─── LLM-Based Classification ──────────────────────────────

const CLASSIFIER_PROMPT = `You are a task classifier. Given a user message, classify it into exactly one category and complexity level.

Categories:
- code: Writing, debugging, editing, or reviewing code. Implementing features. Fixing bugs.
- planning: Designing architecture. Creating plans. Analyzing approaches. Making decisions.
- security: Security testing. Vulnerability scanning. Penetration testing. Bug bounty.
- quick: Simple greetings. Factual questions. Short confirmations. Casual chat. (< 20 words, no technical content)
- general: Anything that doesn't fit the above categories.

Complexity:
- simple: Can be answered in 1-2 sentences. No tool use needed. Trivial.
- medium: Requires some thought or tool use. Single-step task.
- complex: Multi-step. Requires planning. Significant tool use. Architectural decisions.

Respond with ONLY a JSON object, no other text:
{"task_type": "<category>", "complexity": "<level>"}

Examples:
User: "yo" → {"task_type": "quick", "complexity": "simple"}
User: "write a hello world in python" → {"task_type": "code", "complexity": "simple"}
User: "refactor the auth module to use JWT" → {"task_type": "code", "complexity": "medium"}
User: "design a microservice architecture for payments" → {"task_type": "planning", "complexity": "complex"}
User: "scan this domain for XSS" → {"task_type": "security", "complexity": "medium"}
User: "what time is it" → {"task_type": "quick", "complexity": "simple"}
User: "explain how React hooks work" → {"task_type": "general", "complexity": "medium"}

User: `;

// ─── Classifier Cache ──────────────────────────────────────

interface ClassifierCache {
  input: string;
  profile: TaskProfile;
  timestamp: number;
}

let _classifierCache: ClassifierCache | null = null;
const CACHE_TTL = 30_000; // 30 seconds

// ─── Smart Classification ───────────────────────────────────

/**
 * Classify a request using a fast LLM. Falls back to structural heuristics.
 */
export async function classify(request: string): Promise<TaskType> {
  // Check cache
  if (_classifierCache && _classifierCache.input === request && Date.now() - _classifierCache.timestamp < CACHE_TTL) {
    return _classifierCache.profile.taskType;
  }

  // Try LLM classification first
  try {
    const registry = getRegistry();
    const resolved = registry.resolve(`${MODELS.classifier.provider}/${MODELS.classifier.model}`);

    if (resolved) {
      const { provider, model } = resolved;
      const messages: ChatMessage[] = [
        { role: 'user', content: CLASSIFIER_PROMPT + request },
      ];

      // 3s timeout — if classifier is slow, fall through to heuristics immediately
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
      const events = await Promise.race([provider.chat(messages, model, {}), timeout]);
      const response = events.filter(e => e.type === 'text').map(e => 'text' in e ? (e as any).text : '').join('');

      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const taskType = validateTaskType(parsed.task_type);
        const complexity = validateComplexity(parsed.complexity);
        _classifierCache = { input: request, profile: { taskType, complexity }, timestamp: Date.now() };
        return taskType;
      }
    }
  } catch {
    // LLM failed — fall through to heuristics instantly
  }

  // Fallback: structural heuristics (no keywords)
  return heuristicClassify(request);
}

/**
 * Classify and return full profile (task type + complexity).
 */
export async function analyzePrompt(request: string): Promise<TaskProfile> {
  // Check cache
  if (_classifierCache && _classifierCache.input === request && Date.now() - _classifierCache.timestamp < CACHE_TTL) {
    return _classifierCache.profile;
  }

  // Try LLM classification
  try {
    const registry = getRegistry();
    const resolved = registry.resolve(`${MODELS.classifier.provider}/${MODELS.classifier.model}`);

    if (resolved) {
      const { provider, model } = resolved;
      const messages: ChatMessage[] = [
        { role: 'user', content: CLASSIFIER_PROMPT + request },
      ];

      const timeout2 = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
      const events = await Promise.race([provider.chat(messages, model, {}), timeout2]);
      const response = events.filter(e => e.type === 'text').map(e => 'text' in e ? (e as any).text : '').join('');
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const profile: TaskProfile = {
          taskType: validateTaskType(parsed.task_type),
          complexity: validateComplexity(parsed.complexity),
        };
        _classifierCache = { input: request, profile, timestamp: Date.now() };
        return profile;
      }
    }
  } catch {
    // Fall through
  }

  return heuristicProfile(request);
}

// ─── Heuristic Fallback (no keywords) ──────────────────────

/**
 * Structural heuristic classification — no hardcoded keywords.
 * Uses message structure, not word matching.
 */
function heuristicClassify(request: string): TaskType {
  const len = request.length;
  const wordCount = request.split(/\s+/).filter(Boolean).length;
  const lower = request.toLowerCase();

  // Very short → quick
  if (wordCount <= 3 && len < 30) return TaskType.QUICK;

  // Has code indicators → code
  if (/[{}();]/.test(request) || /```/.test(request) || /=>|->|\|>/.test(request)) return TaskType.CODE;

  // Security indicators
  if (/\b(security|vulnerability|xss|injection|exploit|hack|penetrat|scan)\b/i.test(request)) return TaskType.SECURITY;

  // Planning indicators
  if (/\b(design|architect|plan|approach|strategy|compare|evaluate|trade.?off)\b/i.test(request) && wordCount > 10) return TaskType.PLANNING;

  // Code action verbs
  if (/\b(implement|fix|debug|refactor|write|create|build|add|update|edit|delete|remove|migrate|fix)\b/i.test(request)) return TaskType.CODE;

  // Has question structure → general or planning
  if (/\?$/.test(request.trim())) {
    return wordCount > 20 ? TaskType.PLANNING : TaskType.GENERAL;
  }

  // Multi-line with technical content → code
  if (request.includes('\n') && wordCount > 15) return TaskType.CODE;

  // Short non-question → general
  if (wordCount < 10) return TaskType.GENERAL;

  return TaskType.GENERAL;
}

function heuristicProfile(request: string): TaskProfile {
  const taskType = heuristicClassify(request);
  const len = request.length;
  const wordCount = request.split(/\s+/).filter(Boolean).length;
  const hasNewline = request.includes('\n');
  const hasCode = /```/.test(request) || /[{}();]/.test(request);

  let complexity: ComplexityLevel;
  if (taskType === TaskType.QUICK || (wordCount <= 5 && len < 50)) {
    complexity = 'simple';
  } else if (len < 200 && !hasNewline && !hasCode && wordCount < 30) {
    complexity = 'medium';
  } else {
    complexity = 'complex';
  }

  return { taskType, complexity };
}

// ─── Validation ─────────────────────────────────────────────

function validateTaskType(value: string): TaskType {
  const valid: Record<string, TaskType> = {
    code: TaskType.CODE,
    planning: TaskType.PLANNING,
    security: TaskType.SECURITY,
    quick: TaskType.QUICK,
    general: TaskType.GENERAL,
  };
  return valid[value?.toLowerCase()] || TaskType.GENERAL;
}

function validateComplexity(value: string): ComplexityLevel {
  const valid: Record<string, ComplexityLevel> = {
    simple: 'simple',
    medium: 'medium',
    complex: 'complex',
  };
  return valid[value?.toLowerCase()] || 'medium';
}

// ─── Team Selection ─────────────────────────────────────────

export function selectTeam(profile: TaskProfile): ModelTeam {
  const { taskType, complexity } = profile;

  // Check learned model selection (Fugu-style)
  const learned = getBestModel(taskType);
  const learnedMember = learned ? { provider: learned.provider, model: learned.model, thinking: false } : null;

  // Simple tasks → fast model, no verification
  if (complexity === 'simple') {
    return {
      members: [{ ...MODELS.fast, role: 'fast' }],
      primary: { taskType, ...MODELS.fast, thinking: false, routed: true },
      verify: false,
      parallel: false,
    };
  }

  // Medium tasks → strong model (or learned best), no verification
  if (complexity === 'medium') {
    const worker = learnedMember ? { ...learnedMember, role: 'worker' as const } : { ...MODELS.strong, role: 'worker' as const };
    return {
      members: [
        { ...MODELS.fast, role: 'fast' },
        worker,
      ],
      primary: { taskType, ...worker, thinking: false, routed: true },
      verify: false,
      parallel: false,
    };
  }

  // Complex tasks → thinker → worker → verifier
  const members: TeamMember[] = [];

  if (taskType === TaskType.CODE) {
    members.push(
      { ...MODELS.thinker, role: 'thinker' },
      { ...MODELS.strong, role: 'worker' },
      { ...MODELS.verifier, role: 'verifier' },
    );
  } else if (taskType === TaskType.PLANNING) {
    members.push(
      { ...MODELS.thinker, role: 'thinker' },
      { ...MODELS.strong, role: 'worker' },
      { ...MODELS.verifier, role: 'verifier' },
    );
  } else if (taskType === TaskType.SECURITY) {
    members.push(
      { ...MODELS.strong, role: 'worker' },
      { ...MODELS.verifier, role: 'verifier' },
    );
  } else {
    members.push(
      { ...MODELS.thinker, role: 'thinker' },
      { ...MODELS.strong, role: 'worker' },
    );
  }

  return {
    members,
    primary: { taskType, ...MODELS.thinker, thinking: true, routed: true },
    verify: true,
    parallel: taskType === TaskType.CODE,
  };
}

// ─── Synchronous Fallback (for callers that can't await) ───

/**
 * Synchronous classification using heuristics only.
 * Used when async classification is not possible.
 */
export function classifySync(request: string): TaskType {
  return heuristicClassify(request);
}

export function analyzePromptSync(request: string): TaskProfile {
  return heuristicProfile(request);
}

export function getRouteSync(request: string): ModelRoute {
  const profile = analyzePromptSync(request);
  const team = selectTeam(profile);
  return { ...team.primary };
}

// ─── Model Selection ────────────────────────────────────────

export function selectModelForRole(
  role: 'thinker' | 'worker' | 'verifier' | 'fast',
  taskType: TaskType,
  turn: number,
  previousFailures?: Record<string, number>,
): TeamMember {
  switch (role) {
    case 'thinker':
      return { ...MODELS.thinker, role: 'thinker' };
    case 'verifier':
      return { ...MODELS.verifier, role: 'verifier' };
    case 'worker':
      // If strong model has failed, use fast model
      if (previousFailures?.[MODELS.strong.model] && previousFailures[MODELS.strong.model] >= 2) {
        return { ...MODELS.fast, role: 'worker' };
      }
      return turn > 2 ? { ...MODELS.fast, role: 'worker' } : { ...MODELS.strong, role: 'worker' };
    case 'fast':
      return { ...MODELS.fast, role: 'fast' };
  }
}

export function getTaskEmoji(taskType: TaskType): string {
  const m: Record<TaskType, string> = {
    [TaskType.CODE]: '\u2699',
    [TaskType.PLANNING]: '\u2605',
    [TaskType.SECURITY]: '\u26a0',
    [TaskType.QUICK]: '\u26a1',
    [TaskType.GENERAL]: '\u25ce',
  };
  return m[taskType];
}
