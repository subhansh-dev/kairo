/**
 * Folder trust decision side — "do you trust this folder?".
 *
 */

import { TrustStore, workspaceKey, isUnsafeTrustRoot } from './trust';

export enum TrustOutcome {
  Trusted = 'trusted',
  Untrusted = 'untrusted',
  Prompt = 'prompt',
}

export interface DecideInputs {
  storeTrusted: boolean;
  repoConfigsPresent: boolean;
  isInteractive: boolean;
  keyRecordable: boolean;
}

/**
 * Pure trust-decision precedence. No I/O; unit-tested directly.
 */
export function decide(featureEnabled: boolean, inputs: DecideInputs): TrustOutcome {
  if (!featureEnabled) return TrustOutcome.Trusted;
  if (inputs.storeTrusted) return TrustOutcome.Trusted;
  if (!inputs.keyRecordable) return TrustOutcome.Trusted;
  if (!inputs.repoConfigsPresent) return TrustOutcome.Trusted;
  if (inputs.isInteractive) return TrustOutcome.Prompt;
  return TrustOutcome.Untrusted;
}

/**
 * Gather DecideInputs for a given cwd and key.
 */
export function decideInputs(
  cwd: string,
  key: string,
  store: TrustStore,
  repoConfigsPresent: boolean,
  isInteractive: boolean
): DecideInputs {
  return {
    storeTrusted: store.isTrusted(key),
    repoConfigsPresent,
    isInteractive,
    keyRecordable: !isUnsafeTrustRoot(key),
  };
}

/**
 * Grant folder trust — persists to store and returns the outcome.
 */
export function grantFolderTrust(
  store: TrustStore,
  folderPath: string
): TrustOutcome {
  store.setTrusted(folderPath, true);
  return TrustOutcome.Trusted;
}

/**
 * Check if repo-local code-exec configs are present in the folder.
 */
export async function hasRepoConfigs(cwd: string): Promise<boolean> {
  const fs = require('fs/promises');
  const configPaths = [
    '.mcp.json',
    '.grok/config.toml',
  ];

  for (const configPath of configPaths) {
    try {
      await fs.access(`${cwd}/${configPath}`);
      return true;
    } catch { /* not found */ }
  }

  return false;
}
