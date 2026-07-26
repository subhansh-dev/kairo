/**
 * Kairo — Sed Edit Parser
 * Stripped: shellQuote dep — inlined simple tokenizer
 *
 * Parses sed -i 's/pattern/replacement/flags' commands for file-edit rendering.
 */

import { randomBytes } from 'crypto'

export type SedEditInfo = {
  filePath: string
  pattern: string
  replacement: string
  flags: string
  extendedRegex: boolean
}

/** Simple shell tokenizer — splits respecting quotes */
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

function convertBrePatternToJs(pattern: string): string {
  let result = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === '\\') {
      const next = pattern[i + 1]
      if (next === undefined) { result += '\\\\'; continue }
      if (next === '\\') { result += '\\\\' }
      else if ('+?|()'.includes(next)) { result += next }
      else { result += `\\${next}` }
      i++
      continue
    }
    if ('+?|()'.includes(char)) { result += `\\${char}`; continue }
    result += char
  }
  return result
}

export function isSedInPlaceEdit(command: string): boolean {
  return parseSedEditCommand(command) !== null
}

export function parseSedEditCommand(command: string): SedEditInfo | null {
  const trimmed = command.trim()
  const sedMatch = trimmed.match(/^\s*sed\s+/)
  if (!sedMatch) return null

  const withoutSed = trimmed.slice(sedMatch[0].length)
  const args = tokenizeShellArgs(withoutSed)

  let hasInPlaceFlag = false
  let extendedRegex = false
  let expression: string | null = null
  let filePath: string | null = null

  let i = 0
  while (i < args.length) {
    const arg = args[i]!

    if (arg === '-i' || arg === '--in-place') {
      hasInPlaceFlag = true
      i++
      if (i < args.length) {
        const nextArg = args[i]
        if (typeof nextArg === 'string' && !nextArg.startsWith('-') && (nextArg === '' || nextArg.startsWith('.'))) {
          i++
        }
      }
      continue
    }
    if (arg.startsWith('-i')) { hasInPlaceFlag = true; i++; continue }
    if (arg === '-E' || arg === '-r' || arg === '--regexp-extended') { extendedRegex = true; i++; continue }
    if (arg === '-e' || arg === '--expression') {
      if (i + 1 < args.length && typeof args[i + 1] === 'string') {
        if (expression !== null) return null
        expression = args[i + 1]!
        i += 2
        continue
      }
      return null
    }
    if (arg.startsWith('--expression=')) {
      if (expression !== null) return null
      expression = arg.slice('--expression='.length)
      i++
      continue
    }
    if (arg.startsWith('-')) return null

    if (expression === null) { expression = arg }
    else if (filePath === null) { filePath = arg }
    else return null

    i++
  }

  if (!hasInPlaceFlag || !expression || !filePath) return null

  const substMatch = expression.match(/^s\//)
  if (!substMatch) return null

  const rest = expression.slice(2)
  let pattern = ''
  let replacement = ''
  let flags = ''
  let state: 'pattern' | 'replacement' | 'flags' = 'pattern'
  let j = 0

  while (j < rest.length) {
    const char = rest[j]!
    if (char === '\\' && j + 1 < rest.length) {
      if (state === 'pattern') pattern += char + rest[j + 1]
      else if (state === 'replacement') replacement += char + rest[j + 1]
      else flags += char + rest[j + 1]
      j += 2
      continue
    }
    if (char === '/') {
      if (state === 'pattern') state = 'replacement'
      else if (state === 'replacement') state = 'flags'
      else return null
      j++
      continue
    }
    if (state === 'pattern') pattern += char
    else if (state === 'replacement') replacement += char
    else flags += char
    j++
  }

  if (state !== 'flags') return null
  if (!/^[gpimIM1-9]*$/.test(flags)) return null

  return { filePath, pattern, replacement, flags, extendedRegex }
}

export function applySedSubstitution(content: string, sedInfo: SedEditInfo): string {
  let regexFlags = ''
  if (sedInfo.flags.includes('g')) regexFlags += 'g'
  if (sedInfo.flags.includes('i') || sedInfo.flags.includes('I')) regexFlags += 'i'
  if (sedInfo.flags.includes('m') || sedInfo.flags.includes('M')) regexFlags += 'm'

  let jsPattern = sedInfo.pattern.replace(/\\\//g, '/')
  if (!sedInfo.extendedRegex) jsPattern = convertBrePatternToJs(jsPattern)

  const salt = randomBytes(8).toString('hex')
  const ESCAPED_AMP_PLACEHOLDER = `___ESCAPED_AMPERSAND_${salt}___`
  const jsReplacement = sedInfo.replacement
    .replace(/\\\//g, '/')
    .replace(/\\&/g, ESCAPED_AMP_PLACEHOLDER)
    .replace(/&/g, '$$&')
    .replace(new RegExp(ESCAPED_AMP_PLACEHOLDER, 'g'), '&')

  try {
    const regex = new RegExp(jsPattern, regexFlags)
    return content.replace(regex, jsReplacement)
  } catch {
    return content
  }
}
