/**
 * Kairo — Dangerous Shell Patterns
 *
 * Pattern lists for dangerous shell-tool allow-rule prefixes.
 * An allow rule like `Bash(python:*)` lets the model run arbitrary code
 * via that interpreter, bypassing security checks.
 */

/**
 * Cross-platform code-execution entry points present on both Unix and Windows.
 */
export const CROSS_PLATFORM_CODE_EXEC = [
  // Interpreters
  'python',
  'python3',
  'python2',
  'node',
  'deno',
  'tsx',
  'ruby',
  'perl',
  'php',
  'lua',
  // Package runners
  'npx',
  'bunx',
  'npm run',
  'yarn run',
  'pnpm run',
  'bun run',
  // Shells
  'bash',
  'sh',
  // Remote arbitrary-command wrapper
  'ssh',
] as const

export const DANGEROUS_BASH_PATTERNS: readonly string[] = [
  ...CROSS_PLATFORM_CODE_EXEC,
  'zsh',
  'fish',
  'eval',
  'exec',
  'env',
  'xargs',
  'sudo',
  // Network/exfil tools
  'curl',
  'wget',
  // Git can execute arbitrary code via hooks/sshCommand
  'git',
  // Cloud resource writes
  'kubectl',
  'aws',
  'gcloud',
  'gsutil',
]
