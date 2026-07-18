/**
 * Feishu drive — Feishu/Lark drive integration.
 */

export interface FeishuFile {
  id: string;
  name: string;
  type: 'doc' | 'sheet' | 'drive' | 'folder';
  url: string;
  size?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Format a Feishu file for display.
 */
export function formatFeishuFile(file: FeishuFile): string {
  const typeIcon = { doc: '📄', sheet: '📊', drive: '💾', folder: '📁' };
  const size = file.size ? ` (${formatSize(file.size)})` : '';
  const time = new Date(file.updatedAt).toLocaleString();
  return `${typeIcon[file.type]} ${file.name}${size} — ${time}`;
}

/**
 * Format file size.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Build a Feishu drive list request.
 */
export function buildFeishuDriveRequest(folderToken?: string): Record<string, unknown> {
  return {
    folder_token: folderToken || '',
    page_size: 50,
  };
}
