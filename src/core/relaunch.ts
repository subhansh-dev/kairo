/**
 * Relaunch — process relaunch utilities.
 */

import { execSync } from 'child_process';

/**
 * Check if the process should be relaunched.
 */
export function shouldRelaunch(): boolean {
  return process.env.KAIRO_RELAUNCH === '1';
}

/**
 * Relaunch the current process.
 */
export function relaunch(): void {
  const args = process.argv.slice(1);
  const command = process.argv[0];

  try {
    execSync(`${command} ${args.join(' ')}`, {
      stdio: 'inherit',
      env: { ...process.env, KAIRO_RELAUNCH: '0' },
    });
    process.exit(0);
  } catch (err: any) {
    process.exit(err.status || 1);
  }
}

/**
 * Schedule a relaunch after the current operation completes.
 */
export function scheduleRelaunch(): void {
  process.env.KAIRO_RELAUNCH = '1';
}

/**
 * Get the restart command.
 */
export function getRestartCommand(): string {
  return `${process.argv[0]} ${process.argv.slice(1).join(' ')}`;
}
