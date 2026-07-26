/**
 * Kairo — Prompt Builder
 * System prompt assembly — identity, workspace, skills, context.
 * Ported from Hermes Agent's prompt_builder.py
 *
 * Assembles the system prompt from multiple sources:
 * 1. Base identity (from master system prompt)
 * 2. Workspace context (git, project type)
 * 3. Skills index (available skills)
 * 4. Memory context (learned preferences)
 * 5. Tool descriptions
 * 6. Coding hints
 */

import { SkillLoader, type Skill } from '../skills/loader.js';
import { detectCodingContext, buildCodingContextBlock, getLanguageHints } from './coding-context.js';
import { buildExperiencePrompt } from './self-improving-skills.js';
import { formatMemoriesForContext } from './memory-extract.js';

// ─── Types ──────────────────────────────────────────────────────

export interface PromptBuilderConfig {
  projectDir?: string;
  masterPrompt: string;
  toolList: string;
  alwaysApplySkills: Skill[];
  additionalContext?: string;
  userPreferences?: string;
}

// ─── Builder ────────────────────────────────────────────────────

export function buildSystemPrompt(config: PromptBuilderConfig): string {
  const sections: string[] = [];

  // 1. Master identity prompt
  sections.push(config.masterPrompt);

  // 2. Tool commands format
  sections.push(TOOL_COMMANDS_FORMAT);

  // 3. Available tools
  sections.push(`## Available Tools\n\n${config.toolList}`);

  // 4. Workspace context
  if (config.projectDir) {
    const codingCtx = detectCodingContext(config.projectDir);
    const ctxBlock = buildCodingContextBlock(codingCtx);
    if (ctxBlock) sections.push(ctxBlock);

    const langHints = getLanguageHints(codingCtx.language);
    if (langHints) sections.push(`## Language Hints\n\n${langHints}`);
  }

  // 5. Always-apply skills
  if (config.alwaysApplySkills.length > 0) {
    const skillBlock = config.alwaysApplySkills
      .map(s => `### ${s.name}\n${s.content}`)
      .join('\n\n');
    sections.push(`## Active Skills\n\n${skillBlock}`);
  }

  // 6. Memory context
  const memoryCtx = formatMemoriesForContext(undefined, 5);
  if (memoryCtx) sections.push(memoryCtx);

  // 7. User preferences
  if (config.userPreferences) {
    sections.push(`## User Preferences\n\n${config.userPreferences}`);
  }

  // 8. Additional context
  if (config.additionalContext) {
    sections.push(config.additionalContext);
  }

  return sections.join('\n\n');
}

// ─── Tool Commands Format ───────────────────────────────────────

const TOOL_COMMANDS_FORMAT = `## Tool Commands

ALL tool commands must start with \`!\` and be on their own line:

\`\`\`
!read <path>
!exec <command>
!write <path>
<content>
!edit <path>
<old text>
<new text>
!grep <pattern> [path]
!glob <pattern>
!ls [path]
!git <args>
\`\`\``;

// ─── Skill Index Builder ────────────────────────────────────────

/**
 * Build a compact skill index for the system prompt.
 * Lists available skills by category without loading full content.
 */
export function buildSkillIndex(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const byCategory: Record<string, string[]> = {};
  for (const skill of skills) {
    const cat = skill.frontmatter?.description ? 'general' : 'uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(skill.name);
  }

  const lines: string[] = ['## Available Skills', ''];
  for (const [cat, names] of Object.entries(byCategory)) {
    lines.push(`**${cat}:** ${names.join(', ')}`);
  }
  lines.push('');
  lines.push('Use \`skill <name>\` to load a skill\'s full content.');

  return lines.join('\n');
}

// ─── Context Window Management ──────────────────────────────────

/**
 * Estimate the token count of a prompt.
 * Rough estimate: 1 token ≈ 4 characters.
 */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}

/**
 * Check if the prompt fits within the context window.
 */
export function fitsInContext(prompt: string, maxTokens: number): boolean {
  return estimatePromptTokens(prompt) < maxTokens * 0.8; // 80% threshold
}

/**
 * Truncate the prompt to fit within the context window.
 * Preserves the beginning (identity) and end (recent context).
 */
export function truncatePrompt(prompt: string, maxTokens: number): string {
  const estimated = estimatePromptTokens(prompt);
  if (estimated <= maxTokens) return prompt;

  // Keep first 40% and last 40%
  const charBudget = maxTokens * 4;
  const headSize = Math.floor(charBudget * 0.4);
  const tailSize = Math.floor(charBudget * 0.4);

  const head = prompt.slice(0, headSize);
  const tail = prompt.slice(-tailSize);

  return head + '\n\n... [context truncated] ...\n\n' + tail;
}
