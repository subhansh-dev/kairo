/**
 * Announcements — in-app announcement system.
 */

export interface Announcement {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'update' | 'maintenance';
  priority: number;
  createdAt: Date;
  expiresAt?: Date;
  dismissed: boolean;
  link?: string;
}

/**
 * Create an announcement.
 */
export function createAnnouncement(
  title: string,
  body: string,
  type: Announcement['type'] = 'info',
  priority: number = 0,
): Announcement {
  return {
    id: crypto.randomUUID(),
    title,
    body,
    type,
    priority,
    createdAt: new Date(),
    dismissed: false,
  };
}

/**
 * Check if an announcement is still active.
 */
export function isActive(announcement: Announcement): boolean {
  if (announcement.dismissed) return false;
  if (announcement.expiresAt && new Date() > announcement.expiresAt) return false;
  return true;
}

/**
 * Filter active announcements.
 */
export function activeAnnouncements(announcements: Announcement[]): Announcement[] {
  return announcements
    .filter(isActive)
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Dismiss an announcement.
 */
export function dismissAnnouncement(announcements: Announcement[], id: string): Announcement[] {
  return announcements.map(a =>
    a.id === id ? { ...a, dismissed: true } : a,
  );
}
