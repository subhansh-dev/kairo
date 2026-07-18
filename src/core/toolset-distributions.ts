/**
 * Toolset distributions — toolset management utilities.
 */

export interface ToolsetDistribution {
  name: string;
  description: string;
  tools: string[];
  category: string;
}

// Pre-defined toolset distributions
const DISTRIBUTIONS: ToolsetDistribution[] = [
  {
    name: 'minimal',
    description: 'Essential tools only',
    tools: ['read', 'write', 'edit', 'exec', 'grep', 'glob'],
    category: 'core',
  },
  {
    name: 'coding',
    description: 'Full coding toolkit',
    tools: ['read', 'write', 'edit', 'exec', 'grep', 'glob', 'ls', 'git', 'web_fetch'],
    category: 'development',
  },
  {
    name: 'research',
    description: 'Research and exploration',
    tools: ['read', 'grep', 'glob', 'ls', 'web_fetch', 'web_search', 'memory'],
    category: 'research',
  },
  {
    name: 'full',
    description: 'All available tools',
    tools: [],  // Empty means all tools
    category: 'advanced',
  },
];

/**
 * Get a toolset distribution by name.
 */
export function getToolsetDistribution(name: string): ToolsetDistribution | undefined {
  return DISTRIBUTIONS.find(d => d.name === name);
}

/**
 * List all toolset distributions.
 */
export function listToolsetDistributions(): ToolsetDistribution[] {
  return [...DISTRIBUTIONS];
}

/**
 * Format toolset distribution for display.
 */
export function formatToolsetDistribution(dist: ToolsetDistribution): string {
  const tools = dist.tools.length > 0 ? dist.tools.join(', ') : 'all tools';
  return `${dist.name} (${dist.category}): ${dist.description}\n  Tools: ${tools}`;
}
