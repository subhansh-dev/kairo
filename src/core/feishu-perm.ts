/**
 * Feishu permissions — Feishu/Lark permissions.
 */

export interface FeishuPerm {
  token: string;
  type: 'doc' | 'sheet' | 'drive';
  members: FeishuPermMember[];
}

export interface FeishuPermMember {
  id: string;
  type: 'user' | 'group';
  perm: 'view' | 'edit' | 'full_access';
}

/**
 * Build a Feishu permissions request.
 */
export function buildFeishuPermRequest(token: string, type: string): Record<string, unknown> {
  return { token, type };
}

/**
 * Format Feishu permissions for display.
 */
export function formatFeishuPerms(perm: FeishuPerm): string {
  const permIcon = { view: '👁️', edit: '✏️', full_access: '🔑' };
  const members = perm.members.map(m =>
    `  ${permIcon[m.perm]} ${m.id} (${m.type})`
  ).join('\n');
  return `Permissions for ${perm.token}:\n${members}`;
}
