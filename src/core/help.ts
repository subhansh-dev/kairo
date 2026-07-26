/**
 * Help — help system utilities.
 */

export interface HelpTopic {
  name: string;
  description: string;
  usage: string;
  examples?: string[];
  related?: string[];
}

// Help topics registry
const helpTopics = new Map<string, HelpTopic>();

/**
 * Register a help topic.
 */
export function registerHelpTopic(topic: HelpTopic): void {
  helpTopics.set(topic.name, topic);
}

/**
 * Get help for a topic.
 */
export function getHelp(topicName: string): HelpTopic | undefined {
  return helpTopics.get(topicName);
}

/**
 * List all help topics.
 */
export function listHelpTopics(): HelpTopic[] {
  return [...helpTopics.values()];
}

/**
 * Search help topics.
 */
export function searchHelp(query: string): HelpTopic[] {
  const lower = query.toLowerCase();
  return [...helpTopics.values()].filter(t =>
    t.name.toLowerCase().includes(lower) ||
    t.description.toLowerCase().includes(lower)
  );
}

/**
 * Format help topic for display.
 */
export function formatHelpTopic(topic: HelpTopic): string {
  const lines = [
    `${topic.name} — ${topic.description}`,
    '',
    `Usage: ${topic.usage}`,
  ];

  if (topic.examples && topic.examples.length > 0) {
    lines.push('', 'Examples:');
    topic.examples.forEach(ex => lines.push(`  ${ex}`));
  }

  if (topic.related && topic.related.length > 0) {
    lines.push('', `Related: ${topic.related.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format all help topics for display.
 */
export function formatAllHelp(): string {
  const topics = listHelpTopics();
  if (topics.length === 0) return 'No help topics available.';
  return topics.map(t => `  ${t.name.padEnd(20)} ${t.description}`).join('\n');
}

// Register built-in help topics
registerHelpTopic({
  name: 'help',
  description: 'Show help information',
  usage: '/help [topic]',
  examples: ['/help', '/help model', '/help tools'],
});

registerHelpTopic({
  name: 'model',
  description: 'Switch or view the current model',
  usage: '/model [provider/model]',
  examples: ['/model', '/model nvidia/nemotron-3-ultra-550b-a55b'],
});

registerHelpTopic({
  name: 'tools',
  description: 'List available tools',
  usage: '/tools',
});

registerHelpTopic({
  name: 'agents',
  description: 'List or manage agents',
  usage: '/agents',
});
