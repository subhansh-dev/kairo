/**
 * Skill provenance — track where skills came from.
 */

export interface SkillProvenance {
  skillName: string;
  source: 'builtin' | 'user' | 'imported' | 'generated' | 'downloaded';
  sourcePath?: string;
  sourceUrl?: string;
  importedAt?: number;
  version?: string;
}

// Skill provenance records
const provenanceRecords = new Map<string, SkillProvenance>();

/**
 * Record skill provenance.
 */
export function recordProvenance(provenance: SkillProvenance): void {
  provenanceRecords.set(provenance.skillName, provenance);
}

/**
 * Get provenance for a skill.
 */
export function getProvenance(skillName: string): SkillProvenance | undefined {
  return provenanceRecords.get(skillName);
}

/**
 * Get all provenance records.
 */
export function getAllProvenance(): SkillProvenance[] {
  return [...provenanceRecords.values()];
}

/**
 * Get provenance by source type.
 */
export function getProvenanceBySource(source: SkillProvenance['source']): SkillProvenance[] {
  return [...provenanceRecords.values()].filter(p => p.source === source);
}

/**
 * Check if a skill is user-created.
 */
export function isUserCreated(skillName: string): boolean {
  const prov = provenanceRecords.get(skillName);
  return prov?.source === 'user' || prov?.source === 'generated';
}

/**
 * Check if a skill is built-in.
 */
export function isBuiltin(skillName: string): boolean {
  const prov = provenanceRecords.get(skillName);
  return prov?.source === 'builtin';
}

/**
 * Format provenance for display.
 */
export function formatProvenance(provenance: SkillProvenance): string {
  const parts = [`${provenance.skillName}: ${provenance.source}`];
  if (provenance.sourcePath) parts.push(`from ${provenance.sourcePath}`);
  if (provenance.version) parts.push(`v${provenance.version}`);
  return parts.join(' ');
}
