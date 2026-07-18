/**
 * Journey — learning journey tracking.
 */

export interface JourneyNode {
  id: string;
  type: 'skill' | 'memory' | 'lesson' | 'pattern';
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  connections: string[]; // IDs of related nodes
}

// Journey graph
const nodes = new Map<string, JourneyNode>();

/**
 * Add a journey node.
 */
export function addJourneyNode(node: Omit<JourneyNode, 'id' | 'createdAt' | 'connections'>): JourneyNode {
  const fullNode: JourneyNode = {
    ...node,
    id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
    connections: [],
  };
  nodes.set(fullNode.id, fullNode);
  return fullNode;
}

/**
 * Connect two journey nodes.
 */
export function connectNodes(fromId: string, toId: string): boolean {
  const from = nodes.get(fromId);
  const to = nodes.get(toId);
  if (!from || !to) return false;
  if (!from.connections.includes(toId)) from.connections.push(toId);
  if (!to.connections.includes(fromId)) to.connections.push(fromId);
  return true;
}

/**
 * Get a journey node by ID.
 */
export function getJourneyNode(id: string): JourneyNode | undefined {
  return nodes.get(id);
}

/**
 * Get all journey nodes.
 */
export function getAllJourneyNodes(): JourneyNode[] {
  return [...nodes.values()];
}

/**
 * Search journey nodes by query.
 */
export function searchJourney(query: string): JourneyNode[] {
  const lower = query.toLowerCase();
  return [...nodes.values()].filter(n =>
    n.title.toLowerCase().includes(lower) ||
    n.content.toLowerCase().includes(lower) ||
    n.tags.some(t => t.toLowerCase().includes(lower))
  );
}

/**
 * Get related nodes for a given node.
 */
export function getRelatedNodes(nodeId: string): JourneyNode[] {
  const node = nodes.get(nodeId);
  if (!node) return [];
  return node.connections.map(id => nodes.get(id)).filter(Boolean) as JourneyNode[];
}

/**
 * Format journey for display.
 */
export function formatJourney(): string {
  const allNodes = getAllJourneyNodes();
  if (allNodes.length === 0) return 'No journey entries yet.';

  const typeIcon = { skill: '📚', memory: '🧠', lesson: '💡', pattern: '🔄' };
  return allNodes.map(n =>
    `${typeIcon[n.type] || '•'} ${n.title} [${n.tags.join(', ')}]`
  ).join('\n');
}
