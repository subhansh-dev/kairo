import { exec, type ChildProcess } from 'child_process';
import { join, resolve as pathResolve } from 'path';
import { homedir } from 'os';
import { existsSync, statSync } from 'fs';
import type { ToolDefinition, ToolResult } from './types.js';

// ─── Safety Classification ──────────────────────────────────────

const SAFE_READ = [
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'pwd', 'echo',
  'which', 'whoami', 'date', 'env', 'printenv', 'tree', 'file', 'stat',
  'du', 'df', 'ps', 'uname', 'hostname', 'id', 'groups',
  'dir', 'type', 'more', 'cmp', 'diff', 'less',
];

const WRITE = [
  'rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'truncate',
  'shred', 'ln', 'mkfifo', 'mknod',
  'git add', 'git commit', 'git push', 'git reset', 'git checkout -b',
  'npm install', 'npm i', 'npm uninstall', 'yarn', 'pnpm', 'pip install',
  'pip3 install', 'cargo build', 'cargo install', 'make', 'cmake', 'docker', 'kubectl',
  'apt-get install', 'apt install', 'yum install', 'dnf install',
  'brew install', 'winget install', 'choco install', 'scoop install',
  'cargo publish', 'npm publish', 'gem push', 'twine upload',
  'write', 'fsutil', 'icacls', 'attrib',
];

const DESTRUCTIVE_PREFIXES = [
  'mkfs', 'fdisk', 'parted', 'mkswap',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'systemctl stop', 'systemctl disable', 'systemctl mask',
  'kill -9', 'pkill -9',
];

const WRAPPERS = [
  'timeout', 'sudo', 'nohup', 'nice', 'ionice', 'chrt', 'stdbuf',
  'setsid', 'taskset', 'env',
];

// ─── Default Settings ───────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 50_000;

interface BashClassification {
  safe: boolean;
  readOnly: boolean;
  destructive: boolean;
  reason: string;
}

function stripWrappers(cmd: string): string {
  let t = cmd.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of WRAPPERS) {
      if (t.startsWith(w + ' ') || t.startsWith(w + '\t')) {
        t = t.slice(w.length).trimStart();
        changed = true;
        break;
      }
    }
    if (changed) continue;
    if (/^-/.test(t)) {
      t = t.replace(/^-[a-zA-Z]+\s+\S+\s+/, '').trimStart();
      changed = true;
      continue;
    }
    if (/^\d+[smhd]?\s/.test(t)) {
      t = t.replace(/^[\d.]+[smhd]?\s+/, '').trimStart();
      changed = true;
      continue;
    }
  }
  return t;
}

function splitCompound(cmd: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    const next = i < cmd.length - 1 ? cmd[i + 1] : '';

    if (ch === '\\') { current += ch + (i < cmd.length - 1 ? cmd[++i] : ''); continue; }

    if (inSingle) {
      if (ch === "'") inSingle = false;
      current += ch;
      continue;
    }

    if (inDouble) {
      if (ch === '"' && cmd[i - 1] !== '\\') inDouble = false;
      current += ch;
      continue;
    }

    if (ch === "'") { inSingle = true; current += ch; continue; }
    if (ch === '"') { inDouble = true; current += ch; continue; }

    if (ch === '$' && next === '(') {
      let sub = 1;
      current += '$(';
      i++;
      while (i < cmd.length - 1 && sub > 0) {
        i++;
        if (cmd[i] === '(') sub++;
        if (cmd[i] === ')') sub--;
        current += cmd[i];
      }
      continue;
    }

    if (ch === '`') {
      current += ch;
      i++;
      while (i < cmd.length && cmd[i] !== '`') { current += cmd[i]; i++; }
      if (i < cmd.length) current += cmd[i];
      continue;
    }

    if ((ch === '&' && next === '&') || (ch === '|' && next === '|') || ch === ';' || (ch === '|')) {
      parts.push(current.trim());
      current = '';
      if (ch === '|' && next === '|') i++;
      if (ch === '&' && next === '&') i++;
      continue;
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

function extractSubstitutions(cmd: string): string[] {
  const subs: string[] = [];
  let m;
  const re1 = /\$\(([^)]+)\)/g;
  while ((m = re1.exec(cmd)) !== null) subs.push(m[1]);
  const re2 = /`([^`]+)`/g;
  while ((m = re2.exec(cmd)) !== null) subs.push(m[1]);
  return subs;
}

function checkDangerousFlags(cmd: string): string | null {
  const lower = cmd.toLowerCase();

  const rmRf = lower.match(/\brm\s+-[a-z]*rf[a-z]*\s+/);
  if (rmRf) {
    const arg = cmd.slice(rmRf.index! + rmRf[0].length).trim();
    if (arg === '/' || arg === '/*' || arg.startsWith('/ ') || arg.startsWith('~') || arg === '*' || arg === '.') {
      return 'rm -rf targeting root/home';
    }
  }

  const rmVar = lower.match(/\brm\s+-[a-z]*rf[a-z]*\s+\$\{?\w+}?\s*\/?\s*$/);
  if (rmVar) return 'rm -rf with variable (dangerous if empty)';

  if (/\bchmod\s+-?R?\s*777(\s|$)/.test(lower)) return 'chmod 777 world-writable';
  if (/\bchmod\s+-?R?\s*000(\s|$)/.test(lower)) return 'chmod 000 locks all access';

  if (lower.includes('dd ')) {
    if (/\bdd\b.*\bif=\/dev\/(zero|urandom)\b/.test(lower) && /\bof=\//.test(lower)) return 'dd overwriting system path';
    if (/\bdd\b.*\bif=\/dev\/(zero|urandom)\b/.test(lower) && !/\bof=/.test(lower)) return 'dd with no of= (writes to stdout — pipe risk)';
  }

  if (/\bIFS\s*=/.test(lower)) return 'IFS manipulation';
  if (/\bPATH\s*=/.test(lower)) return 'PATH manipulation';
  if (/\.\s+\/dev\/stdin/.test(lower) || /source\s+\/dev\/stdin/.test(lower)) return 'source from stdin';

  const redirectTarget = lower.match(/(?:\d?[&>]+)\s*(\/\S+)/);
  if (redirectTarget) {
    const tgt = redirectTarget[1];
    if (/^\/(dev|proc|sys|etc|boot|usr|bin|sbin|lib|lib64|windows|system32)\//.test(tgt)) return `redirect targeting system path: ${tgt}`;
  }

  return null;
}

function detectObfuscation(cmd: string): string | null {
  const homoglyphs = cmd.match(/[\u0430-\u044F\u0450-\u045F\u0400-\u042F]/g);
  if (homoglyphs) return 'Unicode homoglyphs detected';
  const fullwidth = cmd.match(/[\uFF01-\uFF5E]/g);
  if (fullwidth) return 'Fullwidth characters detected';
  return null;
}

function classifyBash(cmd: string): BashClassification {
  const t = cmd.trim();
  if (!t) return { safe: false, readOnly: false, destructive: false, reason: 'Empty command' };

  const obf = detectObfuscation(t);
  if (obf) return { safe: false, readOnly: false, destructive: false, reason: obf };

  const rawParts = splitCompound(t);
  const subs = extractSubstitutions(t);

  const allCommands: string[] = [];
  for (const part of rawParts) {
    allCommands.push(stripWrappers(part));
  }
  allCommands.push(...subs);

  let hasDestructive = false;
  let hasWrite = false;
  let hasRead = true;
  const reasons: string[] = [];

  for (const part of allCommands) {
    const dangerFlag = checkDangerousFlags(part);
    if (dangerFlag) {
      hasDestructive = true;
      reasons.push(dangerFlag);
      continue;
    }

    const firstWord = part.split(/\s+/)[0];
    const firstTwo = part.split(/\s+/).slice(0, 2).join(' ');

    let matchedDestructive = false;
    for (const d of DESTRUCTIVE_PREFIXES) {
      if (part.startsWith(d) || firstTwo === d) {
        hasDestructive = true;
        reasons.push(`Destructive: ${d}`);
        matchedDestructive = true;
        break;
      }
    }
    if (matchedDestructive) continue;

    if (/\brm\s+-[a-z]*rf[a-z]*\s+\//.test(part)) {
      hasDestructive = true;
      reasons.push('rm -rf /');
      continue;
    }
    if (/:\(\)\{/.test(part)) {
      hasDestructive = true;
      reasons.push('Fork bomb');
      continue;
    }

    let matchedWrite = false;
    for (const w of WRITE) {
      if (part.startsWith(w) || part.startsWith(w + ' ') || firstTwo === w) {
        hasWrite = true;
        reasons.push(`Write: ${w}`);
        matchedWrite = true;
        break;
      }
    }
    if (matchedWrite) continue;

    if (/>>/.test(part)) {
      hasWrite = true;
      reasons.push('Output append');
      continue;
    }
    if (/[^<]>[^>]/.test(part) && !/>\s*\d+/.test(part)) {
      hasWrite = true;
      reasons.push('Output redirect');
      continue;
    }

    let matchedRead = false;
    for (const r of SAFE_READ) {
      if (part.startsWith(r) || part.startsWith(r + ' ') || firstTwo === r) {
        reasons.push(`Read: ${r}`);
        matchedRead = true;
        break;
      }
    }
    if (matchedRead) continue;

    hasWrite = true;
    hasRead = false;
    reasons.push(`Unknown: ${firstWord}`);
  }

  const heredocMatch = t.match(/<<\s*(\w+|'\w+')\s*\n?([\s\S]*?)\n\s*\1/);
  if (heredocMatch) {
    const innerClass = classifyBash(heredocMatch[2]);
    if (innerClass.destructive) return innerClass;
    if (!innerClass.readOnly) hasWrite = true;
  }

  if (hasDestructive) {
    return { safe: false, readOnly: false, destructive: true, reason: reasons.join('; ') };
  }

  if (hasWrite) {
    return { safe: true, readOnly: false, destructive: false, reason: reasons.join('; ') || 'Write' };
  }

  return { safe: true, readOnly: hasRead, destructive: false, reason: reasons.join('; ') || 'Read' };
}

// ─── Bash Session State ───────────────────────

interface BashSessionState {
  cwd: string;
  env: Record<string, string>;
  lastExitCode: number;
}

let bashSession: BashSessionState = {
  cwd: process.cwd(),
  env: { ...process.env } as Record<string, string>,
  lastExitCode: 0,
};

function updateSessionCwd(command: string): void {
  // Match: cd, cd <path>, cd "path with spaces", cd 'path', cd -, cd ~
  const cdMatch = command.match(/^\s*cd\s*$/)
    || command.match(/^\s*cd\s+"([^"]+)"/)
    || command.match(/^\s*cd\s+'([^']+)'/)
    || command.match(/^\s*cd\s+(\S+)/);
  if (cdMatch) {
    try {
      // cd with no args → home; cd - → OLDPWD (fallback to current)
      let target = cdMatch[1] ?? '';
      if (!target || target === '~') {
        target = homedir();
      } else if (target === '-') {
        target = bashSession.env.OLDPWD || bashSession.cwd;
      } else if (target.startsWith('~/') || target.startsWith('~\\')) {
        target = join(homedir(), target.slice(2));
      }
      const resolved = target.startsWith('/') || /^[A-Za-z]:\\/.test(target)
        ? target
        : pathResolve(bashSession.cwd, target);
      if (existsSync(resolved) && statSync(resolved).isDirectory()) {
        bashSession.env.OLDPWD = bashSession.cwd;
        bashSession.cwd = resolved;
      }
    } catch {}
  }
}

function getShellType(): string {
  return process.platform === 'win32'
    ? process.env.COMSPEC || 'cmd.exe'
    : process.env.SHELL || '/bin/bash';
}

function truncateOutput(output: string, maxLen: number = MAX_OUTPUT_LENGTH): string {
  if (output.length <= maxLen) return output;
  return output.slice(0, maxLen) + `\n... [output truncated at ${maxLen} characters]`;
}

export const bashTool: ToolDefinition = {
  name: 'exec',
  description: 'Execute shell command. Safety classified (read/write/destructive).',
  prompt: `Execute a shell command. Returns stdout/stderr and exit code.
Commands are safety-classified:
- Read-only commands (ls, cat, grep, etc.) are auto-approved
- Write commands (rm, mv, git commit, etc.) may require approval
- Destructive commands (rm -rf /, fork bombs) are blocked

Usage: exec <command>
Example: exec ls -la src/`,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
    },
    required: ['command'],
  },
  tier: 'exec',
  concurrencySafe: false,
  readOnly: false,
  destructive: false,

  checkPermissions: (args: string) => {
    // Parse args: support `exec --timeout 60000 --workdir /path cmd`
    const parsed = parseExecArgs(args);
    const classification = classifyBash(parsed.command);
    if (classification.destructive) {
      return { allowed: false, reason: `Blocked: ${classification.reason}` };
    }
    return { allowed: true };
  },

  execute: async (args: string, signal?: AbortSignal): Promise<ToolResult> => {
    try {
      const parsed = parseExecArgs(args);
      const classification = classifyBash(parsed.command);

      const shell = getShellType();
      const timeout = parsed.timeout || DEFAULT_TIMEOUT_MS;
      const cwd = parsed.workdir || bashSession.cwd;

      // Track cd changes
      updateSessionCwd(parsed.command);

      const startTime = Date.now();

      const { stdout, stderr, exitCode, duration } = await new Promise<{ stdout: string; stderr: string; exitCode: number; duration: number }>((resolve, reject) => {
        const child = exec(parsed.command, {
          shell,
          cwd,
          timeout,
          maxBuffer: MAX_OUTPUT_LENGTH,
          env: { ...bashSession.env },
          windowsHide: true,
          encoding: 'buffer' as any,
        }, (error, stdout, stderr) => {
          const dur = Date.now() - startTime;
          const out = Buffer.isBuffer(stdout) ? stdout.toString('utf-8') : String(stdout || '');
          const err = Buffer.isBuffer(stderr) ? stderr.toString('utf-8') : String(stderr || '');
          if (error) {
            resolve({ stdout: out, stderr: err, exitCode: (error as any).status ?? 1, duration: dur });
          } else {
            resolve({ stdout: out, stderr: err, exitCode: 0, duration: dur });
          }
        });
        // Wire up AbortSignal for cancellation
        if (signal) {
          const abortHandler = () => { child.kill('SIGTERM'); };
          signal.addEventListener('abort', abortHandler, { once: true });
          // Clean up listener when exec completes to prevent memory leak
          child.on('close', () => {
            signal.removeEventListener('abort', abortHandler);
          });
        }
      });

      bashSession.lastExitCode = exitCode;
      if (exitCode !== 0) {
        const combined = (stdout + '\n' + stderr).trim();
        return {
          output: `Exit ${exitCode} (${duration}ms):\n${truncateOutput(combined)}`,
          success: false,
          metadata: { exitCode, duration, classification: classification.reason, readOnly: classification.readOnly, cwd },
        };
      }

      const output = stdout.trim();
      const truncated = truncateOutput(output);

      return {
        output: truncated || '(no output)',
        success: true,
        metadata: { exitCode: 0, classification: classification.reason, readOnly: classification.readOnly, duration, cwd },
      };
    } catch (e: any) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};

// ─── Exec Args Parser ────────────────────────────────────────────

interface ExecArgs {
  command: string;
  timeout?: number;
  workdir?: string;
}

function expandTilde(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return join(homedir(), p.slice(2));
  }
  if (p === '~') return homedir();
  return p;
}

function parseExecArgs(args: string): ExecArgs {
  let remaining = args.trim();
  let timeout: number | undefined;
  let workdir: string | undefined;

  while (remaining) {
    const timeoutMatch = remaining.match(/^--timeout\s+(\d+)\s*/);
    if (timeoutMatch) {
      timeout = parseInt(timeoutMatch[1]);
      remaining = remaining.slice(timeoutMatch[0].length);
      continue;
    }

    const workdirMatch = remaining.match(/^--workdir\s+(\S+)\s*/);
    if (workdirMatch) {
      workdir = expandTilde(workdirMatch[1].replace(/^["']|["']$/g, ''));
      remaining = remaining.slice(workdirMatch[0].length);
      continue;
    }

    break;
  }

  return { command: remaining, timeout, workdir };
}

// ─── Shell Session Access ───────────────────────────────────────

export function getBashSession(): BashSessionState {
  return { ...bashSession };
}

export function setBashSessionCwd(cwd: string): void {
  bashSession.cwd = cwd;
}

export { classifyBash, truncateOutput };
