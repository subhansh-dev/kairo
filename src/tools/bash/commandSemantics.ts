/**
 * Kairo — Command Semantics
 * Stripped: bash/commands.js dep — inlined simple splitCommand
 *
 * Interprets exit codes for commands that use non-zero exits for non-error conditions.
 */

export type CommandSemantic = (
  exitCode: number,
  stdout: string,
  stderr: string,
) => { isError: boolean; message?: string }

const DEFAULT_SEMANTIC: CommandSemantic = (exitCode) => ({
  isError: exitCode !== 0,
  message: exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
})

const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  ['grep', (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? 'No matches found' : undefined,
  })],
  ['rg', (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? 'No matches found' : undefined,
  })],
  ['find', (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? 'Some directories were inaccessible' : undefined,
  })],
  ['diff', (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? 'Files differ' : undefined,
  })],
  ['test', (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? 'Condition is false' : undefined,
  })],
  ['[', (exitCode) => ({
    isError: exitCode >= 2,
    message: exitCode === 1 ? 'Condition is false' : undefined,
  })],
])

/** Split compound commands on &&, ||, ;, | */
function splitCommand(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    const next = i < command.length - 1 ? command[i + 1] : ''

    if (ch === '\\') { current += ch + (i < command.length - 1 ? command[++i] : ''); continue }
    if (inSingle) { if (ch === "'") inSingle = false; current += ch; continue }
    if (inDouble) { if (ch === '"' && command[i - 1] !== '\\') inDouble = false; current += ch; continue }
    if (ch === "'") { inSingle = true; current += ch; continue }
    if (ch === '"') { inDouble = true; current += ch; continue }

    if ((ch === '&' && next === '&') || (ch === '|' && next === '|') || ch === ';' || (ch === '|')) {
      parts.push(current.trim())
      current = ''
      if (ch === '|' && next === '|') i++
      if (ch === '&' && next === '&') i++
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts.filter(Boolean)
}

function extractBaseCommand(command: string): string {
  return command.trim().split(/\s+/)[0] || ''
}

function heuristicallyExtractBaseCommand(command: string): string {
  const segments = splitCommand(command)
  const lastCommand = segments[segments.length - 1] || command
  return extractBaseCommand(lastCommand)
}

export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): { isError: boolean; message?: string } {
  const baseCommand = heuristicallyExtractBaseCommand(command)
  const semantic = COMMAND_SEMANTICS.get(baseCommand) ?? DEFAULT_SEMANTIC
  return semantic(exitCode, stdout, stderr)
}
