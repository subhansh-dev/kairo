/**
 * Workspace error types.
 */

export type WorkspaceErrorKind =
  | 'parent_session_not_found'
  | 'session_not_found'
  | 'session_already_exists'
  | 'empty_agent_id'
  | 'cannot_drop_main_session'
  | 'finalize_failed'
  | 'capability_widening'
  | 'unauthorized'
  | 'turn_active'
  | 'max_depth_exceeded'
  | 'join_error'
  | 'invalid_hunk_action'
  | 'hunk_action_failed'
  | 'hub_error'
  | 'shutting_down'
  | 'toolset_externally_owned';

export class WorkspaceError extends Error {
  kind: WorkspaceErrorKind;
  details?: Record<string, unknown>;

  constructor(kind: WorkspaceErrorKind, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'WorkspaceError';
    this.kind = kind;
    this.details = details;
  }

  static sessionNotFound(id: string): WorkspaceError {
    return new WorkspaceError('session_not_found', `session not found: ${id}`);
  }

  static sessionAlreadyExists(id: string): WorkspaceError {
    return new WorkspaceError('session_already_exists', `session already exists: ${id}`);
  }

  static emptyAgentId(): WorkspaceError {
    return new WorkspaceError('empty_agent_id', 'agent_id must be non-empty');
  }

  static cannotDropMainSession(): WorkspaceError {
    return new WorkspaceError('cannot_drop_main_session', 'the main session cannot be dropped');
  }

  static finalizeFailed(reason: string): WorkspaceError {
    return new WorkspaceError('finalize_failed', `toolset finalization failed: ${reason}`);
  }

  static capabilityWidening(parent: string, child: string): WorkspaceError {
    return new WorkspaceError('capability_widening',
      `capability widening rejected: child ${child} is not a subset of parent ${parent}`,
      { parent, child });
  }

  static unauthorized(caller: string, target: string): WorkspaceError {
    return new WorkspaceError('unauthorized',
      `session ${caller} is not authorised to operate on session ${target}`,
      { caller, target });
  }

  static turnActive(sessionId: string): WorkspaceError {
    return new WorkspaceError('turn_active',
      `turn active for session ${sessionId}; retry at turn boundary`);
  }

  static maxDepthExceeded(parent: string): WorkspaceError {
    return new WorkspaceError('max_depth_exceeded',
      `maximum fork depth exceeded for parent session ${parent}`,
      { parent });
  }

  static hubError(message: string): WorkspaceError {
    return new WorkspaceError('hub_error', `hub error: ${message}`);
  }

  static shuttingDown(): WorkspaceError {
    return new WorkspaceError('shutting_down', 'workspace is shutting down');
  }

  static toolsetExternallyOwned(message: string): WorkspaceError {
    return new WorkspaceError('toolset_externally_owned', message);
  }
}

export type WorkspaceResult<T> = { ok: true; value: T } | { ok: false; error: WorkspaceError };
