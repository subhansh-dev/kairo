/**
 * Hub permission — permission handling for hub-proxied sessions.
 *
 */

export interface HubPermissionConfig {
  yolo?: boolean;
  autoMode?: boolean;
  defaultMode?: string;
}

/**
 * Resolve permission mode from hub configuration.
 */
export function resolveHubPermissionMode(config: HubPermissionConfig): string {
  if (config.yolo) return 'always_approve';
  if (config.autoMode) return 'auto';
  return config.defaultMode || 'ask';
}
