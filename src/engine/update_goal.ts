/**
 * Update goal — model-driven goal progress reporting.
 *
 */

export const UPDATE_GOAL_TOOL_NAME = 'update_goal';

export interface UpdateGoalInput {
  completed?: boolean;
  message?: string;
  blockedReason?: string;
}

export enum UpdateGoalAckType {
  Accepted = 'accepted',
  ClassifierAchieved = 'classifier_achieved',
  ClassifierFailOpenAchieved = 'classifier_failopen_achieved',
  ClassifierNotAchieved = 'classifier_not_achieved',
  ClassifierCapReached = 'classifier_cap_reached',
  ClassifierStalled = 'classifier_stalled',
  ClassifierBlocked = 'classifier_blocked',
  CompletedWithoutClassifier = 'completed_without_classifier',
  ClassifierConcurrentInFlight = 'classifier_concurrent_in_flight',
  DeferredToTurnEnd = 'deferred_to_turn_end',
  Rejected = 'rejected',
}

export type UpdateGoalAck =
  | { type: UpdateGoalAckType.Accepted; summary: string }
  | { type: UpdateGoalAckType.ClassifierAchieved; detailsPath: string }
  | { type: UpdateGoalAckType.ClassifierFailOpenAchieved; reason: string }
  | { type: UpdateGoalAckType.ClassifierNotAchieved; detailsPath: string; attempt: number; maxRuns: number }
  | { type: UpdateGoalAckType.ClassifierCapReached; detailsPath: string; attempt: number }
  | { type: UpdateGoalAckType.ClassifierStalled; detailsPath: string; attempt: number }
  | { type: UpdateGoalAckType.ClassifierBlocked; detailsPath: string }
  | { type: UpdateGoalAckType.CompletedWithoutClassifier }
  | { type: UpdateGoalAckType.ClassifierConcurrentInFlight; detailsPath: string; attempt: number; maxRuns: number }
  | { type: UpdateGoalAckType.DeferredToTurnEnd; pendingDepth: number }
  | { type: UpdateGoalAckType.Rejected; reason: RejectReason; detail: string };

export enum RejectReason {
  GoalNotActive = 'goal_not_active',
  GoalAlreadyCompleted = 'goal_already_completed',
  BlockedReasonRequired = 'blocked_reason_required',
  CompletionRequiresClassifier = 'completion_requires_classifier',
}
