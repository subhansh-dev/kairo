/**
 * Workspace error types.
 *
 */

export enum WorkspaceErrorKind {
  ParentSessionNotFound = 'parent_session_not_found',
  SessionNotFound = 'session_not_found',
  SessionAlreadyExists = 'session_already_exists',
  EmptyAgentId = 'empty_agent_id',
  CannotDropMainSession = 'cannot_drop_main_session',
  Finalize = 'finalize',
  CapabilityWidening = 'capability_widening',
  Unauthorized = 'unauthorized',
  TurnActive = 'turn_active',
  MaxDepthExceeded = 'max_depth_exceeded',
  JoinError = 'join_error',
  InvalidHunkAction = 'invalid_hunk_action',
  HunkActionFailed = 'hunk_action_failed',
  HubError = 'hub_error',
  DeployError = 'deploy_error',
  ShuttingDown = 'shutting_down',
  ToolsetExternallyOwned = 'toolset_externally_owned',
}

export class WorkspaceError extends Error {
  kind: WorkspaceErrorKind;
  details?: any;

  constructor(kind: WorkspaceErrorKind, message: string, details?: any) {
    super(message);
    this.name = 'WorkspaceError';
    this.kind = kind;
    this.details = details;
  }

  static parentSessionNotFound(id: string) {
    return new WorkspaceError(WorkspaceErrorKind.ParentSessionNotFound, `parent session not found: ${id}`);
  }

  static sessionNotFound(id: string) {
    return new WorkspaceError(WorkspaceErrorKind.SessionNotFound, `session not found: ${id}`);
  }

  static sessionAlreadyExists(id: string) {
    return new WorkspaceError(WorkspaceErrorKind.SessionAlreadyExists, `session already exists: ${id}`);
  }

  static emptyAgentId() {
    return new WorkspaceError(WorkspaceErrorKind.EmptyAgentId, 'agent_id must be non-empty');
  }

  static cannotDropMainSession() {
    return new WorkspaceError(WorkspaceErrorKind.CannotDropMainSession, 'the main session cannot be dropped');
  }

  static finalize(msg: string) {
    return new WorkspaceError(WorkspaceErrorKind.Finalize, `toolset finalization failed: ${msg}`);
  }

  static capabilityWidening(parent: string, child: string) {
    return new WorkspaceError(
      WorkspaceErrorKind.CapabilityWidening,
      `capability widening rejected: child ${child} is not a subset of parent ${parent}`,
      { parent, child }
    );
  }

  static unauthorized(caller: string, target: string) {
    return new WorkspaceError(
      WorkspaceErrorKind.Unauthorized,
      `session ${caller} is not authorised to operate on session ${target}`,
      { caller, target }
    );
  }

  static turnActive(sessionId: string) {
    return new WorkspaceError(
      WorkspaceErrorKind.TurnActive,
      `turn active for session ${sessionId}; retry the tool-config update at the turn boundary`
    );
  }

  static maxDepthExceeded(parent: string) {
    return new WorkspaceError(
      WorkspaceErrorKind.MaxDepthExceeded,
      `maximum fork depth exceeded for parent session ${parent}`
    );
  }

  static hubError(msg: string) {
    return new WorkspaceError(WorkspaceErrorKind.HubError, `hub error: ${msg}`);
  }

  static shuttingDown() {
    return new WorkspaceError(WorkspaceErrorKind.ShuttingDown, 'workspace is shutting down; not accepting new sessions');
  }

  static toolsetExternallyOwned(msg: string) {
    return new WorkspaceError(
      WorkspaceErrorKind.ToolsetExternallyOwned,
      `toolset externally owned (local bind), mutation refused: ${msg}`
    );
  }
}

export type WorkspaceResult<T> = T | WorkspaceError;
