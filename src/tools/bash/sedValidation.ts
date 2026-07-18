/**
 * Kairo — Sed Validation
 * Stripped: Tool.js, shellQuote.js, bash/commands.js deps — inlined implementations
 *
 * Dual-allowlist/denylist system for sed commands.
 */

import type { ToolPermissionContext } from '../../core/permissions/types.js'
import type { PermissionResult } from '../../core/permissions/types.js'

/** Simple shell tokenizer */
function tokenizeShellArgs(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '\\') { current += ch + (i < input.length - 1 ? input[++i] : ''); continue }
    if (inSingle) { if (ch === "'") { inSingle = false; continue } current += ch; continue }
    if (inDouble) { if (ch === '"') { inDouble = false; continue } current += ch; continue }
    if (ch === "'") { inSingle = true; continue }
    if (ch === '"') { inDouble = true; continue }
    if (ch === ' ' || ch === '\t') { if (current) { tokens.push(current); current = '' } continue }
    current += ch
  }
  if (current) tokens.push(current)
  return tokens
}

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
      parts.push(current.trim()); current = ''
      if (ch === '|' && next === '|') i++
      if (ch === '&' && next === '&') i++
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts.filter(Boolean)
}

function validateFlagsAgainstAllowlist(flags: string[], allowedFlags: string[]): boolean {
  for (const flag of flags) {
    if (flag.startsWith('-') && !flag.startsWith('--') && flag.length > 2) {
      for (let i = 1; i < flag.length; i++) {
        if (!allowedFlags.includes('-' + flag[i])) return false
      }
    } else {
      if (!allowedFlags.includes(flag)) return false
    }
  }
  return true
}

export function isLinePrintingCommand(command: string, expressions: string[]): boolean {
  const sedMatch = command.match(/^\s*sed\s+/)
  if (!sedMatch) return false
  const withoutSed = command.slice(sedMatch[0].length)
  const parsed = tokenizeShellArgs(withoutSed)

  const flags: string[] = []
  for (const arg of parsed) {
    if (arg.startsWith('-') && arg !== '--') flags.push(arg)
  }

  const allowedFlags = ['-n', '--quiet', '--silent', '-E', '--regexp-extended', '-r', '-z', '--zero-terminated', '--posix']
  if (!validateFlagsAgainstAllowlist(flags, allowedFlags)) return false

  let hasNFlag = false
  for (const flag of flags) {
    if (flag === '-n' || flag === '--quiet' || flag === '--silent') { hasNFlag = true; break }
    if (flag.startsWith('-') && !flag.startsWith('--') && flag.includes('n')) { hasNFlag = true; break }
  }
  if (!hasNFlag) return false
  if (expressions.length === 0) return false

  for (const expr of expressions) {
    const commands = expr.split(';')
    for (const cmd of commands) {
      if (!isPrintCommand(cmd.trim())) return false
    }
  }
  return true
}

export function isPrintCommand(cmd: string): boolean {
  if (!cmd) return false
  return /^(?:\d+|\d+,\d+)?p$/.test(cmd)
}

function isSubstitutionCommand(
  command: string,
  expressions: string[],
  hasFileArguments: boolean,
  options?: { allowFileWrites?: boolean },
): boolean {
  const allowFileWrites = options?.allowFileWrites ?? false
  if (!allowFileWrites && hasFileArguments) return false

  const sedMatch = command.match(/^\s*sed\s+/)
  if (!sedMatch) return false
  const withoutSed = command.slice(sedMatch[0].length)
  const parsed = tokenizeShellArgs(withoutSed)

  const flags: string[] = []
  for (const arg of parsed) {
    if (arg.startsWith('-') && arg !== '--') flags.push(arg)
  }

  const allowedFlags = ['-E', '--regexp-extended', '-r', '--posix']
  if (allowFileWrites) { allowedFlags.push('-i', '--in-place') }
  if (!validateFlagsAgainstAllowlist(flags, allowedFlags)) return false
  if (expressions.length !== 1) return false

  const expr = expressions[0]!.trim()
  if (!expr.startsWith('s')) return false

  const substitutionMatch = expr.match(/^s\/(.*?)$/)
  if (!substitutionMatch) return false

  const rest = substitutionMatch[1]!
  let delimiterCount = 0
  let lastDelimiterPos = -1
  let i = 0
  while (i < rest.length) {
    if (rest[i] === '\\') { i += 2; continue }
    if (rest[i] === '/') { delimiterCount++; lastDelimiterPos = i }
    i++
  }
  if (delimiterCount !== 2) return false

  const exprFlags = rest.slice(lastDelimiterPos + 1)
  if (!/^[gpimIM]*[1-9]?[gpimIM]*$/.test(exprFlags)) return false
  return true
}

export function sedCommandIsAllowedByAllowlist(command: string, options?: { allowFileWrites?: boolean }): boolean {
  const allowFileWrites = options?.allowFileWrites ?? false
  let expressions: string[]
  try { expressions = extractSedExpressions(command) } catch { return false }

  const hasFileArguments = hasFileArgs(command)
  let isPattern1 = false
  let isPattern2 = false

  if (allowFileWrites) {
    isPattern2 = isSubstitutionCommand(command, expressions, hasFileArguments, { allowFileWrites: true })
  } else {
    isPattern1 = isLinePrintingCommand(command, expressions)
    isPattern2 = isSubstitutionCommand(command, expressions, hasFileArguments)
  }

  if (!isPattern1 && !isPattern2) return false
  for (const expr of expressions) {
    if (isPattern2 && expr.includes(';')) return false
  }
  for (const expr of expressions) {
    if (containsDangerousOperations(expr)) return false
  }
  return true
}

export function hasFileArgs(command: string): boolean {
  const sedMatch = command.match(/^\s*sed\s+/)
  if (!sedMatch) return false
  const withoutSed = command.slice(sedMatch[0].length)
  const parsed = tokenizeShellArgs(withoutSed)

  let argCount = 0
  let hasEFlag = false
  for (let i = 0; i < parsed.length; i++) {
    const arg = parsed[i]
    if ((arg === '-e' || arg === '--expression') && i + 1 < parsed.length) { hasEFlag = true; i++; continue }
    if (arg.startsWith('--expression=')) { hasEFlag = true; continue }
    if (arg.startsWith('-')) continue
    argCount++
    if (hasEFlag) return true
    if (argCount > 1) return true
  }
  return false
}

export function extractSedExpressions(command: string): string[] {
  const expressions: string[] = []
  const sedMatch = command.match(/^\s*sed\s+/)
  if (!sedMatch) return expressions
  const withoutSed = command.slice(sedMatch[0].length)

  if (/-e[wWe]/.test(withoutSed) || /-w[eE]/.test(withoutSed)) {
    throw new Error('Dangerous flag combination detected')
  }

  const parsed = tokenizeShellArgs(withoutSed)
  let foundEFlag = false
  let foundExpression = false

  for (let i = 0; i < parsed.length; i++) {
    const arg = parsed[i]
    if ((arg === '-e' || arg === '--expression') && i + 1 < parsed.length) {
      foundEFlag = true; expressions.push(parsed[i + 1]); i++; continue
    }
    if (arg.startsWith('--expression=')) { foundEFlag = true; expressions.push(arg.slice('--expression='.length)); continue }
    if (arg.startsWith('-e=')) { foundEFlag = true; expressions.push(arg.slice('-e='.length)); continue }
    if (arg.startsWith('-')) continue
    if (!foundEFlag && !foundExpression) { expressions.push(arg); foundExpression = true; continue }
    break
  }
  return expressions
}

function containsDangerousOperations(expression: string): boolean {
  const cmd = expression.trim()
  if (!cmd) return false
  if (/[^\x01-\x7F]/.test(cmd)) return true
  if (cmd.includes('{') || cmd.includes('}')) return true
  if (cmd.includes('\n')) return true
  const hashIndex = cmd.indexOf('#')
  if (hashIndex !== -1 && !(hashIndex > 0 && cmd[hashIndex - 1] === 's')) return true
  if (/^!/.test(cmd) || /[/\d$]!/.test(cmd)) return true
  if (/\d\s*~\s*\d|,\s*~\s*\d|\$\s*~\s*\d/.test(cmd)) return true
  if (/^,/.test(cmd)) return true
  if (/,\s*[+-]/.test(cmd)) return true
  if (/s\\/.test(cmd) || /\\[|#%@]/.test(cmd)) return true
  if (/\\\/.*[wW]/.test(cmd)) return true
  if (/\/[^/]*\s+[wWeE]/.test(cmd)) return true
  if (/^s\//.test(cmd) && !/^s\/[^/]*\/[^/]*\/[^/]*$/.test(cmd)) return true
  if (/^s./.test(cmd) && /[wWeE]$/.test(cmd)) {
    if (!/^s([^\\\n]).*?\1.*?\1[^wWeE]*$/.test(cmd)) return true
  }
  if (/^[wW]\s*\S+/.test(cmd) || /^\d+\s*[wW]\s*\S+/.test(cmd) || /^\$\s*[wW]\s*\S+/.test(cmd)) return true
  if (/^e/.test(cmd) || /^\d+\s*e/.test(cmd) || /^\$\s*e/.test(cmd)) return true
  const substitutionMatch = cmd.match(/s([^\\\n]).*?\1.*?\1(.*?)$/)
  if (substitutionMatch) {
    const flags = substitutionMatch[2] || ''
    if (flags.includes('w') || flags.includes('W') || flags.includes('e') || flags.includes('E')) return true
  }
  return false
}

export function checkSedConstraints(
  input: { command: string },
  toolPermissionContext: ToolPermissionContext,
): PermissionResult {
  const commands = splitCommand(input.command)
  for (const cmd of commands) {
    const trimmed = cmd.trim()
    const baseCmd = trimmed.split(/\s+/)[0]
    if (baseCmd !== 'sed') continue
    const allowFileWrites = toolPermissionContext.mode === 'acceptEdits'
    if (!sedCommandIsAllowedByAllowlist(trimmed, { allowFileWrites })) {
      return {
        behavior: 'ask',
        message: 'sed command requires approval (contains potentially dangerous operations)',
        decisionReason: { type: 'other', reason: 'sed command contains operations that require explicit approval' },
      }
    }
  }
  return { behavior: 'passthrough', message: 'No dangerous sed operations detected' }
}
