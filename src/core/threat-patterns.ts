/**
 * Threat patterns — detect prompt injection and malicious content.
 */

// Prompt injection patterns
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?prior\s+instructions/i,
  /forget\s+(all\s+)?previous/i,
  /you\s+are\s+now\s+(?:a|an)\s+(?:evil|malicious|hacker)/i,
  /act\s+as\s+if\s+you\s+(?:are|were)/i,
  /pretend\s+you\s+(?:are|were|have\s+no)/i,
  /system\s*prompt\s*(?:override|reset|ignore)/i,
  /\[INST\].*\[\/INST\]/i,  // Llama format injection
  /<\|im_start\|>system/i,  // ChatML injection
  /Human:\s*Assistant:/i,   // Anthropic injection
];

// Data exfiltration patterns
const EXFIL_PATTERNS = [
  /send\s+(?:all\s+)?(?:data|info|secret|key|token)\s+to/i,
  /(?:curl|wget|fetch)\s+.*(?:secret|key|token|password)/i,
  /(?:base64|encode).*\s*(?:curl|wget|fetch)/i,
];

// Role hijack patterns
const HIJACK_PATTERNS = [
  /(?:you\s+are|your\s+(?:new|real)\s+(?:name|identity))\s+(?:is|was)\s+(?!kairo)/i,
  /(?:from\s+now\s+on|starting\s+now|new\s+instructions)\s*[:,]/i,
  /(?:ignore|override|replace)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)/i,
];

export interface ThreatFinding {
  pattern: string;
  category: 'injection' | 'exfiltration' | 'hijack';
  severity: 'low' | 'medium' | 'high';
}

/**
 * Scan content for prompt injection and malicious patterns.
 */
export function scanForThreats(content: string, scope: 'context' | 'tool_result' | 'user_input' = 'user_input'): ThreatFinding[] {
  if (!content) return [];

  const findings: ThreatFinding[] = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        pattern: pattern.source,
        category: 'injection',
        severity: scope === 'context' ? 'medium' : 'high',
      });
    }
  }

  for (const pattern of EXFIL_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        pattern: pattern.source,
        category: 'exfiltration',
        severity: 'high',
      });
    }
  }

  for (const pattern of HIJACK_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        pattern: pattern.source,
        category: 'hijack',
        severity: 'medium',
      });
    }
  }

  return findings;
}

/**
 * Check if content contains threats.
 */
export function hasThreats(content: string): boolean {
  return scanForThreats(content).length > 0;
}

/**
 * Get threat severity (0 = safe, 1 = low, 2 = medium, 3 = high).
 */
export function getThreatLevel(content: string): number {
  const findings = scanForThreats(content);
  if (findings.length === 0) return 0;
  const maxSeverity = findings.reduce((max, f) => {
    const level = f.severity === 'high' ? 3 : f.severity === 'medium' ? 2 : 1;
    return Math.max(max, level);
  }, 0);
  return maxSeverity;
}
