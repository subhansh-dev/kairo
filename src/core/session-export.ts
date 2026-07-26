/**
 * Session export — export sessions to various formats.
 */

export interface ExportOptions {
  format?: 'markdown' | 'json' | 'html' | 'text';
  includeMetadata?: boolean;
  includeToolCalls?: boolean;
  includeTimestamps?: boolean;
}

export interface SessionData {
  id: string;
  title?: string;
  model: string;
  provider: string;
  messages: Array<{ role: string; content: string; timestamp?: number }>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Export a session to markdown format.
 */
export function exportToMarkdown(session: SessionData, opts: ExportOptions = {}): string {
  const lines: string[] = [];

  if (opts.includeMetadata !== false) {
    lines.push(`# Session: ${session.title || session.id}`);
    lines.push(`Model: ${session.provider}/${session.model}`);
    lines.push(`Created: ${new Date(session.createdAt).toLocaleString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  for (const msg of session.messages) {
    if (msg.role === 'system') continue;
    const role = msg.role === 'user' ? '**You**' : '**Kairo**';
    const timestamp = opts.includeTimestamps && msg.timestamp
      ? ` _${new Date(msg.timestamp).toLocaleTimeString()}_`
      : '';
    lines.push(`### ${role}${timestamp}`);
    lines.push('');
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Export a session to JSON format.
 */
export function exportToJson(session: SessionData, opts: ExportOptions = {}): string {
  const data: any = {
    id: session.id,
    title: session.title,
    model: session.model,
    provider: session.provider,
    messages: session.messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role,
      content: m.content,
      ...(opts.includeTimestamps && m.timestamp ? { timestamp: m.timestamp } : {}),
    })),
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Export a session to plain text format.
 */
export function exportToText(session: SessionData): string {
  return session.messages
    .filter(m => m.role !== 'system')
    .map(m => `[${m.role.toUpperCase()}]\n${m.content}`)
    .join('\n\n---\n\n');
}

/**
 * Get a filename for an export.
 */
export function getExportFilename(session: SessionData, format: string): string {
  const title = (session.title || session.id).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
  const ext = format === 'json' ? 'json' : format === 'html' ? 'html' : format === 'markdown' ? 'md' : 'txt';
  return `kairo-export-${title}.${ext}`;
}
