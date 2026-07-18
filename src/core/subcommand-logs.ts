/**
 * Subcommand: logs — logs viewing subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { readLastLogLines, formatLogLines } from './logs-view.js';

registerSubcommand({
  name: 'logs',
  description: 'View logs',
  options: [
    { flag: '--tail', description: 'Show last N lines' },
    { flag: '--level', description: 'Filter by level' },
  ],
  handler: async (args) => {
    const tailIdx = args.indexOf('--tail');
    const limit = tailIdx >= 0 ? parseInt(args[tailIdx + 1]) || 50 : 50;

    const levelIdx = args.indexOf('--level');
    const level = levelIdx >= 0 ? args[levelIdx + 1] : undefined;

    const lines = readLastLogLines(limit, level);
    console.log(formatLogLines(lines));
  },
});
