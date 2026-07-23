/**
 * Kairo — Tool Call Guardrails (DEPRECATED — re-export wrapper)
 *
 * All functionality has been merged into `guardrails.ts`.
 * This file exists solely for backward compatibility with imports
 * that reference `tool-guardrails.js`.
 *
 * DO NOT add new functionality here — use `guardrails.ts` instead.
 */

export {
  IDEMPOTENT_TOOL_NAMES,
  MUTATING_TOOL_NAMES,
  GuardrailConfig as ToolCallGuardrailConfig,
  GuardrailState,
  GuardrailController as ToolCallGuardrailController,
  ToolCallSignature,
  ToolGuardrailDecision,
  GuardrailAction,
  canonicalToolArgs,
  hashToolArgs,
  createSignature,
  classifyToolFailure,
  assessCommandThreat,
  THREAT_PATTERNS,
  ThreatAssessment,
  FailureClass,
  // Note: GuardrailController.resetForTurn() is available as an alias on the class
  // (it calls reset() internally). No separate export needed since it's a method.
} from './guardrails.js';
