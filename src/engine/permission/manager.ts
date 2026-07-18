/**
 * Permission manager — handles permission requests, grants, and denials.
 *
 */

import { EventEmitter } from 'events';
import {
  Decision,
  AccessKind,
  PermissionEvent,
  PermissionMode,
  ClientType,
  EditPolicy,
  PromptPolicy,
} from './types';
import { CompiledPolicy, evaluatePolicy } from './policy';
import type { AccessKind as PolicyAccessKind } from '../permission.js';

export interface PermissionHandle extends EventEmitter {
  request(event: PermissionEvent): Promise<Decision>;
  grant(eventId: string): void;
  deny(eventId: string): void;
  setMode(mode: PermissionMode): void;
  getMode(): PermissionMode;
  isInFlight(): boolean;
}

export interface PermissionManagerOptions {
  mode: PermissionMode;
  policy: CompiledPolicy;
  yolo?: boolean;
  autoMode?: boolean;
  onDecision?: (event: PermissionEvent, decision: Decision) => void;
}

export class PermissionManager extends EventEmitter implements PermissionHandle {
  private mode: PermissionMode;
  private policy: CompiledPolicy;
  private yolo: boolean;
  private autoMode: boolean;
  private inFlightCount = 0;
  private pendingRequests: Map<string, {
    event: PermissionEvent;
    resolve: (decision: Decision) => void;
  }> = new Map();

  constructor(options: PermissionManagerOptions) {
    super();
    this.mode = options.mode;
    this.policy = options.policy;
    this.yolo = options.yolo ?? false;
    this.autoMode = options.autoMode ?? false;
  }

  async request(event: PermissionEvent): Promise<Decision> {
    this.inFlightCount++;

    try {
      // Yolo mode — allow everything
      if (this.yolo) {
        return { allowed: true, reason: 'yolo' };
      }

      // Evaluate policy
      const policyDecision = evaluatePolicy(this.policy, event.accessKind as unknown as PolicyAccessKind);
      if (policyDecision) {
        // Convert policy Decision to our Decision type
        if (policyDecision.type === 'policy_deny') {
          return { allowed: false, reason: policyDecision.reason || 'policy_deny' };
        }
        if (policyDecision.type === 'ask') {
          return { allowed: false, reason: 'policy_ask' };
        }
        if (policyDecision.type === 'allow') {
          return { allowed: true, reason: 'policy_allow' };
        }
      }

      // Auto mode — use LLM classifier (simplified here)
      if (this.autoMode && this.mode === PermissionMode.Auto) {
        return { allowed: true, reason: 'auto' };
      }

      // Prompt mode — ask user
      if (this.mode === PermissionMode.Ask || this.mode === PermissionMode.Default) {
        return this.promptUser(event);
      }

      // Always approve
      return { allowed: true, reason: 'always_approve' };
    } finally {
      this.inFlightCount--;
    }
  }

  grant(eventId: string): void {
    const pending = this.pendingRequests.get(eventId);
    if (pending) {
      pending.resolve({ allowed: true, reason: 'user_grant' });
      this.pendingRequests.delete(eventId);
    }
  }

  deny(eventId: string): void {
    const pending = this.pendingRequests.get(eventId);
    if (pending) {
      pending.resolve({ allowed: false, reason: 'user_deny' });
      this.pendingRequests.delete(eventId);
    }
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  isInFlight(): boolean {
    return this.inFlightCount > 0;
  }

  private promptUser(event: PermissionEvent): Promise<Decision> {
    return new Promise((resolve) => {
      const eventId = event.id || `evt-${Date.now()}`;
      this.pendingRequests.set(eventId, { event, resolve });
      this.emit('prompt', { eventId, event });
    });
  }
}

/**
 * Create a permission manager with default settings.
 */
export function createPermissionManager(
  options: PermissionManagerOptions
): PermissionHandle {
  return new PermissionManager(options);
}
