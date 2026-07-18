/**
 * Parse .envrc files and extract environment variables.
 *
 * Two-tier approach:
 * 1. Try `direnv export json` if direnv is installed
 * 2. Fallback to bash subshell with direnv stubs
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DIRENV_STUBS = `
source_up_if_exists() { :; }
source_up() { :; }
source_env_if_exists() {
    if [ -f "$1" ]; then
        . "$1"
    fi
}
source_env() {
    if [ -f "$1" ]; then
        . "$1"
    fi
}
PATH_add() {
    export PATH="$PWD/$1:$PATH"
}
path_add() {
    PATH_add "$@"
}
layout() { :; }
use() { :; }
watch_file() { :; }
`;

/**
 * Load environment variables from .envrc file.
 */
export function loadEnvrc(dir: string): Map<string, string> | null {
  const envrcPath = path.join(dir, '.envrc');
  if (!fs.existsSync(envrcPath)) {
    return null;
  }

  // Try direnv first
  const direnvResult = tryDirenvExport(dir);
  if (direnvResult) return direnvResult;

  // Fallback to bash
  return loadViaBash(dir);
}

function tryDirenvExport(dir: string): Map<string, string> | null {
  try {
    const output = execSync('direnv export json', {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    const json = JSON.parse(output.toString());
    const env = new Map<string, string>();

    for (const [key, value] of Object.entries(json)) {
      if (typeof value === 'string') {
        env.set(key, value);
      }
    }

    return env.size > 0 ? env : null;
  } catch {
    return null;
  }
}

function loadViaBash(dir: string): Map<string, string> | null {
  const envrcPath = path.join(dir, '.envrc');
  const content = fs.readFileSync(envrcPath, 'utf-8');

  const script = `
${DIRENV_STUBS}
${content}
env -0
`;

  try {
    const output = execSync(`bash -c '${script.replace(/'/g, "'\\''")}'`, {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    const env = new Map<string, string>();
    const pairs = output.toString().split('\0').filter(Boolean);

    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.slice(0, eqIdx);
        const value = pair.slice(eqIdx + 1);
        env.set(key, value);
      }
    }

    return env.size > 0 ? env : null;
  } catch {
    return null;
  }
}
