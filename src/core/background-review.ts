/**
 * Kairo — Background Review
 * Fork the agent to review work in the background.
 * Ported from Hermes Agent's background_review.py
 *
 * After a turn completes, spawn a background reviewer that:
 * 1. Checks if the work is correct
 * 2. Suggests improvements
 * 3. Updates the learning graph
 * 4. Creates skills from successful patterns
 */

import { getRegistry } from '../providers/registry.js';
import type { Message } from '../providers/types.js';
import { recordSuccess, recordFailure, extractLearnings } from './self-improving-skills.js';
import { recordPattern, recordSkillCreation } from './learning-graph.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ReviewResult {
  approved: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
  learnings: Array<{ type: 'success' | 'failure' | 'pattern'; description: string }>;
}

export interface ReviewConfig {
  enabled: boolean;
  model: string;
  maxTokens: number;
  autoCreateSkills: boolean;
}

const DEFAULT_CONFIG: ReviewConfig = {
  enabled: true,
  model: 'groq/openai/gpt-oss-20b',
  maxTokens: 1000,
  autoCreateSkills: false,
};

// ─── Background Review ──────────────────────────────────────────

export async function reviewInBackground(
  taskDescription: string,
  agentOutput: string,
  toolCalls: Array<{ name: string; args: string; result: string }>,
  config: Partial<ReviewConfig> = {},
): Promise<ReviewResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.enabled) {
    return { approved: true, confidence: 0.5, issues: [], suggestions: [], learnings: [] };
  }

  const registry = getRegistry();
  const parts = cfg.model.split('/');
  const provider = registry.get(parts[0]);
  if (!provider) return { approved: true, confidence: 0.5, issues: [], suggestions: [], learnings: [] };

  const modelName = parts.slice(1).join('/');

  // Build review prompt
  const reviewPrompt = buildReviewPrompt(taskDescription, agentOutput, toolCalls);

  try {
    const events = await provider.chat(
      [
        { role: 'system', content: REVIEW_SYSTEM_PROMPT },
        { role: 'user', content: reviewPrompt },
      ],
      modelName,
      { maxTokens: cfg.maxTokens },
    );

    let response = '';
    for (const event of events) {
      if (event.type === 'text') response += event.text;
    }

    const result = parseReviewResponse(response);

    // Update learning graph based on review
    if (result.approved) {
      recordSuccess('auto', taskDescription.slice(0, 200), result.suggestions[0] || 'Task completed successfully');
    } else if (result.issues.length > 0) {
      recordFailure('auto', taskDescription.slice(0, 200), result.issues[0]);
    }

    // Extract patterns
    for (const learning of result.learnings) {
      if (learning.type === 'pattern') {
        recordPattern(learning.description, learning.description, taskDescription.slice(0, 100));
      }
    }

    return result;
  } catch {
    return { approved: true, confidence: 0.3, issues: [], suggestions: [], learnings: [] };
  }
}

// ─── System Prompt ──────────────────────────────────────────────

const REVIEW_SYSTEM_PROMPT = `You are a code reviewer. Analyze the agent's work and respond in this exact JSON format:

{
  "approved": true/false,
  "confidence": 0.0-1.0,
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["suggestion 1", "suggestion 2"],
  "learnings": [
    {"type": "success", "description": "what worked well"},
    {"type": "failure", "description": "what failed"},
    {"type": "pattern", "description": "reusable pattern discovered"}
  ]
}

Be strict but fair. Focus on:
- Correctness: Does the code work?
- Completeness: Are edge cases handled?
- Style: Does it match the codebase?
- Tests: Are changes tested?`;

// ─── Prompt Building ────────────────────────────────────────────

function buildReviewPrompt(
  task: string,
  output: string,
  toolCalls: Array<{ name: string; args: string; result: string }>,
): string {
  const toolSummary = toolCalls
    .map(tc => `  ${tc.name}: ${tc.args.slice(0, 100)} → ${tc.result.slice(0, 200)}`)
    .join('\n');

  return `## Task
${task}

## Agent Output
${output.slice(0, 3000)}

## Tool Calls
${toolSummary}

## Review
Analyze the above work. Respond with the JSON review format.`;
}

// ─── Response Parsing ───────────────────────────────────────────

function parseReviewResponse(response: string): ReviewResult {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        approved: parsed.approved ?? true,
        confidence: parsed.confidence ?? 0.5,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        learnings: Array.isArray(parsed.learnings) ? parsed.learnings : [],
      };
    }
  } catch {}

  // Fallback: parse heuristically
  const approved = !response.toLowerCase().includes('fail') && !response.toLowerCase().includes('issue');
  return {
    approved,
    confidence: 0.4,
    issues: approved ? [] : ['Review could not be parsed'],
    suggestions: [],
    learnings: [],
  };
}

// ─── Skill Creation from Review ─────────────────────────────────

export function createSkillFromReview(
  taskDescription: string,
  review: ReviewResult,
): void {
  if (!review.approved || review.confidence < 0.7) return;

  // Extract a skill name from the task
  const skillName = taskDescription
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  if (skillName.length < 5) return;

  // Create skill from successful patterns
  const patterns = review.learnings
    .filter(l => l.type === 'success' || l.type === 'pattern')
    .map(l => l.description);

  if (patterns.length > 0) {
    recordSkillCreation(skillName, taskDescription.slice(0, 200), []);
  }
}
