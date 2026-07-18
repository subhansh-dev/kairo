/**
 * Mentor — mentoring and guidance utilities.
 */

export interface MentorGuidance {
  topic: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  guidance: string;
  examples?: string[];
  resources?: string[];
}

/**
 * Build mentor guidance for a topic.
 */
export function buildMentorGuidance(topic: string, level: MentorGuidance['level'], guidance: string, examples?: string[], resources?: string[]): MentorGuidance {
  return { topic, level, guidance, examples, resources };
}

/**
 * Format mentor guidance for display.
 */
export function formatMentorGuidance(guidance: MentorGuidance): string {
  const levelIcon = { beginner: '🌱', intermediate: '🌿', advanced: '🌳' };
  const lines = [`${levelIcon[guidance.level]} ${guidance.topic} (${guidance.level})`];
  lines.push('');
  lines.push(guidance.guidance);

  if (guidance.examples && guidance.examples.length > 0) {
    lines.push('');
    lines.push('Examples:');
    guidance.examples.forEach(ex => lines.push(`  • ${ex}`));
  }

  if (guidance.resources && guidance.resources.length > 0) {
    lines.push('');
    lines.push('Resources:');
    guidance.resources.forEach(r => lines.push(`  • ${r}`));
  }

  return lines.join('\n');
}

/**
 * Get level-appropriate explanation depth.
 */
export function getExplanationDepth(level: MentorGuidance['level']): string {
  const depths = {
    beginner: 'Explain with simple analogies and step-by-step instructions',
    intermediate: 'Provide context and trade-offs, assume basic knowledge',
    advanced: 'Be concise, focus on edge cases and optimization',
  };
  return depths[level];
}
