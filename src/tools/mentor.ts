/**
 * Kairo — Mentor Tool (Kairo-native rewrite)
 *
 * Provide learning guidance and explanations.
 */

import type { ToolDefinition, ToolResult } from './types.js'

export const mentorTool: ToolDefinition = {
  name: 'mentor',
  description: 'Get explanations and learning guidance on programming concepts',
  prompt: `Get explanations and learning guidance.

Usage:
- mentor <concept> — explain a programming concept
- mentor <concept> <language> — explain in context of a language
- mentor explain <code> — explain what code does

Examples:
- mentor "dependency injection" — explain DI
- mentor "async/await" typescript — explain async in TS
- mentor explain "const x = arr?.map(...)" — explain optional chaining`,
  parameters: {
    type: 'object',
    properties: {
      concept: { type: 'string', description: 'Concept to explain' },
      language: { type: 'string', description: 'Programming language context' },
      code: { type: 'string', description: 'Code to explain' },
    },
    required: ['concept'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let concept: string
      let language: string | undefined
      let code: string | undefined

      try {
        const parsed = JSON.parse(args)
        concept = parsed.concept
        language = parsed.language
        code = parsed.code
      } catch {
        const parts = args.trim().split(/\s+/)
        concept = parts[0] || ''
        language = parts[1]
        code = parts.slice(2).join(' ')
      }

      // Built-in explanations
      const explanations: Record<string, string> = {
        'dependency injection': `Dependency Injection (DI) is a design pattern where objects receive their dependencies from external sources rather than creating them internally.

Benefits:
- Easier testing (mock dependencies)
- Loose coupling between components
- More flexible and reusable code

Example:
// Without DI
class UserService {
  private db = new Database(); // Tightly coupled
}

// With DI
class UserService {
  constructor(private db: Database) {} // Injected
}`,
        'async/await': `Async/await is syntactic sugar over Promises that makes asynchronous code look synchronous.

- async: Marks a function as asynchronous (returns Promise)
- await: Pauses execution until Promise resolves

Example:
async function fetchUser(id: string) {
  const response = await fetch(\`/api/users/\${id}\`);
  const user = await response.json();
  return user;
}`,
        'optional chaining': `Optional chaining (?.) safely accesses nested properties without throwing if intermediate values are null/undefined.

Example:
const city = user?.address?.city; // undefined if address is null
const result = arr?.map(x => x * 2); // undefined if arr is null`,
      }

      const explanation = explanations[concept.toLowerCase()]

      if (explanation) {
        return { output: explanation, success: true, metadata: { concept } }
      }

      // Generic explanation
      return {
        output: `Concept: ${concept}${language ? ` (${language})` : ''}\n\nI can explain this concept in detail. What specific aspect would you like to understand?`,
        success: true,
        metadata: { concept, language },
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
