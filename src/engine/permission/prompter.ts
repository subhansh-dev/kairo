/**
 * Permission prompter — handles user prompting for permission decisions.
 *
 */

import { PermissionEvent, Decision } from './types';

export interface Prompter {
  prompt(event: PermissionEvent): Promise<Decision>;
}

export interface PromptOutcome {
  decision: Decision;
  eventId: string;
}

/**
 * ACP-based prompter for permission requests.
 */
export class AcpPrompter implements Prompter {
  async prompt(event: PermissionEvent): Promise<Decision> {
    // Simplified: in real implementation, this would send an ACP ext_method
    // to the client/pager and wait for user response
    return { allowed: false, reason: 'not_implemented' };
  }
}

/**
 * Create a prompter based on the environment.
 */
export function createPrompter(type: 'acp' | 'stderr' = 'acp'): Prompter {
  switch (type) {
    case 'acp':
      return new AcpPrompter();
    case 'stderr':
      return new StderrPrompter();
    default:
      return new AcpPrompter();
  }
}

/**
 * Simple stderr-based prompter for testing/CLI.
 */
class StderrPrompter implements Prompter {
  async prompt(event: PermissionEvent): Promise<Decision> {
    // In real implementation, this would write to stderr and read from stdin
    return { allowed: false, reason: 'not_implemented' };
  }
}
