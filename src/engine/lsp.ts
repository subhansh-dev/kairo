/**
 * LSP tool — Language Server Protocol integration.
 *
 */

export interface LspServer {
  name: string;
  command: string;
  args?: string[];
  filePatterns?: string[];
}

export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

export interface LspDefinition {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LspReference {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

/**
 * Detect available LSP servers for a project.
 */
export function detectLspServers(projectRoot: string): LspServer[] {
  const servers: LspServer[] = [];

  // TypeScript/JavaScript
  servers.push({
    name: 'typescript-language-server',
    command: 'typescript-language-server',
    args: ['--stdio'],
    filePatterns: ['*.ts', '*.tsx', '*.js', '*.jsx'],
  });

  // Python
  servers.push({
    name: 'pylsp',
    command: 'pylsp',
    filePatterns: ['*.py'],
  });

  // Rust
  servers.push({
    name: 'rust-analyzer',
    command: 'rust-analyzer',
    filePatterns: ['*.rs'],
  });

  // Go
  servers.push({
    name: 'gopls',
    command: 'gopls',
    filePatterns: ['*.go'],
  });

  return servers;
}
