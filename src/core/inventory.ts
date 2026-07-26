/**
 * Inventory — inventory management for tools and resources.
 */

export interface InventoryItem {
  id: string;
  name: string;
  type: 'tool' | 'skill' | 'agent' | 'workflow';
  description: string;
  version?: string;
  enabled: boolean;
}

// Inventory registry
const inventory = new Map<string, InventoryItem>();

/**
 * Register an inventory item.
 */
export function registerItem(item: InventoryItem): void {
  inventory.set(item.id, item);
}

/**
 * Get an item by ID.
 */
export function getItem(id: string): InventoryItem | undefined {
  return inventory.get(id);
}

/**
 * Get all items.
 */
export function getAllItems(): InventoryItem[] {
  return [...inventory.values()];
}

/**
 * Get items by type.
 */
export function getItemsByType(type: InventoryItem['type']): InventoryItem[] {
  return [...inventory.values()].filter(i => i.type === type);
}

/**
 * Enable/disable an item.
 */
export function toggleItem(id: string, enabled: boolean): boolean {
  const item = inventory.get(id);
  if (!item) return false;
  item.enabled = enabled;
  return true;
}

/**
 * Format inventory for display.
 */
export function formatInventory(): string {
  const items = getAllItems();
  if (items.length === 0) return 'Inventory empty.';

  const byType = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const existing = byType.get(item.type) || [];
    existing.push(item);
    byType.set(item.type, existing);
  }

  const lines: string[] = [];
  for (const [type, typeItems] of byType) {
    lines.push(`\n${type.toUpperCase()} (${typeItems.length}):`);
    for (const item of typeItems) {
      const icon = item.enabled ? '✅' : '⏸️';
      lines.push(`  ${icon} ${item.name} — ${item.description}`);
    }
  }

  return lines.join('\n');
}
