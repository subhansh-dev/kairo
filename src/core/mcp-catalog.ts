/**
 * MCP catalog — MCP server discovery and catalog.
 */

export interface MCPCatalogEntry {
  name: string;
  description: string;
  command: string;
  args: string[];
  category: string;
  installCommand?: string;
  homepage?: string;
}

// Built-in MCP server catalog
const CATALOG: MCPCatalogEntry[] = [
  {
    name: 'filesystem',
    description: 'File system operations (read, write, list, search)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    category: 'core',
  },
  {
    name: 'github',
    description: 'GitHub API integration (repos, issues, PRs)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    category: 'development',
  },
  {
    name: 'brave-search',
    description: 'Web search via Brave Search API',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    category: 'search',
  },
  {
    name: 'memory',
    description: 'Persistent memory/knowledge graph',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    category: 'core',
  },
  {
    name: 'sqlite',
    description: 'SQLite database operations',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    category: 'database',
  },
  {
    name: 'postgres',
    description: 'PostgreSQL database operations',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    category: 'database',
  },
];

/**
 * Get the MCP catalog.
 */
export function getMCPCatalog(): MCPCatalogEntry[] {
  return [...CATALOG];
}

/**
 * Search the MCP catalog.
 */
export function searchMCPCatalog(query: string): MCPCatalogEntry[] {
  const lower = query.toLowerCase();
  return CATALOG.filter(e =>
    e.name.includes(lower) || e.description.toLowerCase().includes(lower) || e.category.includes(lower)
  );
}

/**
 * Get catalog entry by name.
 */
export function getCatalogEntry(name: string): MCPCatalogEntry | undefined {
  return CATALOG.find(e => e.name === name);
}

/**
 * Format catalog for display.
 */
export function formatMCPCatalog(): string {
  return CATALOG.map(e =>
    `• ${e.name} (${e.category}): ${e.description}`
  ).join('\n');
}
