/**
 * Kairo — Mixture of Agents (MoA)
 * Multiple models advise on a task, one model aggregates.
 * Ported from Hermes Agent's moa_loop.py
 *
 * Pattern: Send the same prompt to N reference models in parallel.
 * Collect their responses. Feed all responses to an aggregator model
 * which produces the final answer.
 *
 * Use cases:
 * - Complex reasoning where multiple perspectives help
 * - Code review where different models catch different bugs
 * - Architecture decisions where you want diverse opinions
 */

import { getRegistry, type Provider } from '../providers/registry.js';
import type { Message } from '../providers/types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface MoAConfig {
  /** Reference models to consult (provider/model format) */
  references: string[];
  /** Aggregator model that synthesizes */
  aggregator: string;
  /** Max tokens per reference response */
  referenceMaxTokens: number;
  /** Tool result budget for reference view (chars) */
  toolResultBudget: number;
  /** Whether to include tool calls in reference view */
  includeToolCalls: boolean;
}

export interface MoAResult {
  /** Final aggregated response */
  content: string;
  /** Individual reference responses */
  references: Array<{
    model: string;
    provider: string;
    content: string;
    tokens: number;
  }>;
  /** Total tokens used */
  totalTokens: number;
}

const DEFAULT_CONFIG: Partial<MoAConfig> = {
  referenceMaxTokens: 2000,
  toolResultBudget: 4000,
  includeToolCalls: true,
};

// ─── MoA Execution ──────────────────────────────────────────────

export async function executeMoA(
  messages: Message[],
  config: Partial<MoAConfig> = {},
): Promise<MoAResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config } as MoAConfig;
  const registry = getRegistry();

  if (!cfg.references || cfg.references.length === 0) {
    throw new Error('MoA requires at least one reference model');
  }
  if (!cfg.aggregator) {
    throw new Error('MoA requires an aggregator model');
  }

  // 1. Fan out to reference models in parallel
  const referenceResults = await Promise.allSettled(
    cfg.references.map(ref => runReference(ref, messages, cfg)),
  );

  const references = referenceResults
    .filter((r): r is PromiseFulfilledResult<MoAResult['references'][0]> => r.status === 'fulfilled')
    .map(r => r.value);

  if (references.length === 0) {
    throw new Error('All reference models failed');
  }

  // 2. Build aggregator prompt with reference responses
  const aggregatorMessages = buildAggregatorPrompt(messages, references, cfg);

  // 3. Run aggregator
  const aggregatorResult = await runAggregator(cfg.aggregator, aggregatorMessages);

  return {
    content: aggregatorResult.content,
    references,
    totalTokens: references.reduce((sum, r) => sum + r.tokens, 0) + aggregatorResult.tokens,
  };
}

// ─── Reference Model ────────────────────────────────────────────

async function runReference(
  modelPath: string,
  messages: Message[],
  config: MoAConfig,
): Promise<MoAResult['references'][0]> {
  const registry = getRegistry();
  const parts = modelPath.split('/');
  const providerName = parts[0];
  const modelName = parts.slice(1).join('/');

  const provider = registry.get(providerName);
  if (!provider) throw new Error(`Provider not found: ${providerName}`);

  // Build reference view — trim tool results to budget
  const refMessages = messages.map(m => {
    const text = typeof m.content === 'string' ? m.content : '';
    if (m.role === 'user' && text.includes('Tool')) {
      return { ...m, content: trimToolResults(text, config.toolResultBudget) };
    }
    return m;
  });

  // Add system prompt for reference role
  const systemPrompt: Message = {
    role: 'system',
    content: `You are an advisory reference model. You do NOT have access to tools. Your job is to analyze the conversation and provide your best thinking to help the acting agent. Be concise and specific. Focus on:
- Potential issues or risks
- Alternative approaches
- Missing edge cases
- Better patterns or techniques

Provide your analysis in a structured format.`,
  };

  const allMessages = [systemPrompt, ...refMessages];

  const events = await provider.chat(allMessages, modelName, {
    maxTokens: config.referenceMaxTokens,
  });

  let content = '';
  let tokens = 0;
  for (const event of events) {
    if (event.type === 'text') content += event.text;
    if (event.type === 'usage' && event.usage) tokens = (event.usage.input || 0) + (event.usage.output || 0);
  }

  return {
    model: modelName,
    provider: providerName,
    content,
    tokens,
  };
}

// ─── Aggregator ─────────────────────────────────────────────────

async function runAggregator(
  modelPath: string,
  messages: Message[],
): Promise<{ content: string; tokens: number }> {
  const registry = getRegistry();
  const parts = modelPath.split('/');
  const providerName = parts[0];
  const modelName = parts.slice(1).join('/');

  const provider = registry.get(providerName);
  if (!provider) throw new Error(`Provider not found: ${providerName}`);

  const events = await provider.chat(messages, modelName, {
    maxTokens: 4000,
  });

  let content = '';
  let tokens = 0;
  for (const event of events) {
    if (event.type === 'text') content += event.text;
    if (event.type === 'usage' && event.usage) tokens = (event.usage.input || 0) + (event.usage.output || 0);
  }

  return { content, tokens };
}

// ─── Prompt Building ────────────────────────────────────────────

function buildAggregatorPrompt(
  originalMessages: Message[],
  references: MoAResult['references'],
  config: MoAConfig,
): Message[] {
  const refBlock = references
    .map(r => `### ${r.provider}/${r.model}\n\n${r.content}`)
    .join('\n\n---\n\n');

  const aggregatorSystem: Message = {
    role: 'system',
    content: `You are the aggregator in a Mixture-of-Agents setup. You have access to the original task and advisory responses from ${references.length} reference models.

Your job:
1. Consider all reference perspectives
2. Identify the best ideas and approaches
3. Synthesize a single, high-quality response
4. If references disagree, explain the tradeoffs and pick the best approach

You have full tool access. Use the reference insights to inform your actions.`,
  };

  // Insert reference responses before the last user message
  const lastUserIdx = originalMessages.length - 1;
  const before = originalMessages.slice(0, lastUserIdx);
  const lastUser = originalMessages[lastUserIdx];

  const refMessage: Message = {
    role: 'user',
    content: `## Reference Model Responses\n\n${refBlock}\n\n---\n\n## Original Task\n\n${lastUser.content}`,
  };

  return [aggregatorSystem, ...before, refMessage];
}

// ─── Helpers ────────────────────────────────────────────────────

function trimToolResults(content: string, budget: number): string {
  if (content.length <= budget) return content;
  const half = Math.floor(budget / 2);
  return content.slice(0, half) + '\n\n... [trimmed] ...\n\n' + content.slice(-half);
}

// ─── Preset Configs ─────────────────────────────────────────────

export const MOA_PRESETS: Record<string, Partial<MoAConfig>> = {
  'code-review': {
    references: ['nvidia/nvidia/nemotron-3-ultra-550b-a55b', 'groq/openai/gpt-oss-20b'],
    aggregator: 'nvidia/nvidia/nemotron-3-ultra-550b-a55b',
    referenceMaxTokens: 1500,
  },
  'architecture': {
    references: ['nvidia/nvidia/nemotron-3-ultra-550b-a55b', 'cerebras/gpt-oss-120b'],
    aggregator: 'nvidia/nvidia/nemotron-3-ultra-550b-a55b',
    referenceMaxTokens: 2000,
  },
  'reasoning': {
    references: ['nvidia/nvidia/nemotron-3-ultra-550b-a55b', 'groq/openai/gpt-oss-120b', 'cerebras/gpt-oss-120b'],
    aggregator: 'nvidia/nvidia/nemotron-3-ultra-550b-a55b',
    referenceMaxTokens: 2500,
  },
};
