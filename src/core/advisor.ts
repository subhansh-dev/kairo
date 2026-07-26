/**
 * Advisor — advisory agent utilities.
 */

export interface AdvisorRequest {
  topic: string;
  context?: string;
  constraints?: string[];
}

export interface AdvisorResponse {
  recommendation: string;
  reasoning: string;
  confidence: number;
  alternatives?: string[];
}

/**
 * Build an advisor request.
 */
export function buildAdvisorRequest(topic: string, context?: string, constraints?: string[]): AdvisorRequest {
  return { topic, context, constraints };
}

/**
 * Format advisor response for display.
 */
export function formatAdvisorResponse(response: AdvisorResponse): string {
  const lines = [`💡 Recommendation: ${response.recommendation}`];
  lines.push(`   Reasoning: ${response.reasoning}`);
  lines.push(`   Confidence: ${Math.round(response.confidence * 100)}%`);
  if (response.alternatives && response.alternatives.length > 0) {
    lines.push('   Alternatives:');
    response.alternatives.forEach(alt => lines.push(`   • ${alt}`));
  }
  return lines.join('\n');
}

/**
 * Get confidence level description.
 */
export function getConfidenceLevel(confidence: number): string {
  if (confidence >= 0.9) return 'very high';
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.5) return 'moderate';
  if (confidence >= 0.3) return 'low';
  return 'very low';
}
