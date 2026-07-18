/**
 * Kairo — Shell Prefix Extraction (Simplified)
 * Simplified: no LLM-based extraction, just type definitions and basic helpers
 */

export interface CommandPrefixResult {
  prefix: string | null
  commandPrefix?: string | null  // OpenClaude compatibility alias
  method: 'exact' | 'heuristic' | 'llm'
}

export interface CommandSubcommandPrefixResult {
  prefixes: Map<number, string | null>
  commandPrefix?: string | null  // OpenClaude compatibility alias
  subcommandPrefixes?: Map<number, string | null>  // OpenClaude compatibility alias
  method: 'exact' | 'heuristic' | 'llm'
}

type PrefixExtractor = ((command: string) => CommandPrefixResult) & { cache: { clear(): void } }
type SubcommandPrefixExtractor = ((command: string) => CommandSubcommandPrefixResult) & { cache: { clear(): void } }

export function createCommandPrefixExtractor(options: {
  toolName: string
  examples?: Array<{ command: string; prefix: string }>
  policySpec?: unknown
  eventName?: string
  querySource?: string
  preCheck?: (command: string) => { commandPrefix: string } | null
}): PrefixExtractor {
  const cache = new Map<string, CommandPrefixResult>()
  const fn = (command: string): CommandPrefixResult => {
    if (cache.has(command)) return cache.get(command)!
    // Run preCheck if provided
    if (options.preCheck) {
      const preResult = options.preCheck(command)
      if (preResult) {
        const result: CommandPrefixResult = { prefix: preResult.commandPrefix, method: 'exact' }
        cache.set(command, result)
        return result
      }
    }
    const parts = command.trim().split(/\s+/)
    let result: CommandPrefixResult
    if (parts.length >= 2) {
      const p = `${parts[0]} ${parts[1]}`
      result = { prefix: p, commandPrefix: p, method: 'heuristic' }
    } else if (parts.length === 1) {
      result = { prefix: parts[0], commandPrefix: parts[0], method: 'heuristic' }
    } else {
      result = { prefix: null, commandPrefix: null, method: 'exact' }
    }
    cache.set(command, result)
    return result
  }
  return Object.assign(fn, { cache: { clear: () => cache.clear() } })
}

export function createSubcommandPrefixExtractor(
  prefixExtractor: PrefixExtractor,
  splitCommand: (command: string) => string[],
): SubcommandPrefixExtractor {
  const cache = new Map<string, CommandSubcommandPrefixResult>()
  const fn = (command: string): CommandSubcommandPrefixResult => {
    if (cache.has(command)) return cache.get(command)!
    const subcommands = splitCommand(command)
    const prefixes = new Map<number, string | null>()
    for (let i = 0; i < subcommands.length; i++) {
      const result = prefixExtractor(subcommands[i])
      prefixes.set(i, result.prefix)
    }
    const result: CommandSubcommandPrefixResult = { prefixes, subcommandPrefixes: prefixes, method: 'heuristic' }
    cache.set(command, result)
    return result
  }
  return Object.assign(fn, { cache: { clear: () => cache.clear() } })
}
