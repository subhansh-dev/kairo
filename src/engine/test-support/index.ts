/**
 * Test support — utilities for testing.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Create a temporary directory for tests.
 */
export function createTestDir(prefix: string = 'kairo-test'): string {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Clean up a test directory.
 */
export function cleanupTestDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

/**
 * Create a test file with content.
 */
export function createTestFile(dir: string, name: string, content: string = ''): string {
  const filePath = path.join(dir, name);
  const fileDir = path.dirname(filePath);
  if (!fs.existsSync(fileDir)) {
    fs.mkdirSync(fileDir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Read a test file.
 */
export function readTestFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Initialize a test git repository.
 */
export function createTestGitRepo(dir: string): string {
  const { execSync } = require('child_process');
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@kairo.ai"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Kairo Test"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

/**
 * Create a mock conversation for testing.
 */
export function createMockConversation(turnCount: number = 5): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: 'You are a helpful assistant.' },
  ];

  for (let i = 0; i < turnCount; i++) {
    messages.push({ role: 'user', content: `User message ${i + 1}` });
    messages.push({ role: 'assistant', content: `Assistant response ${i + 1}` });
  }

  return messages;
}

/**
 * Sleep for a specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to be true.
 */
export async function waitFor(
  condition: () => boolean,
  timeoutMs: number = 5000,
  intervalMs: number = 50,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}
