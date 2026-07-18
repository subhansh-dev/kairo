/**
 * Subcommand: insights — insights subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'insights',
  description: 'Show session insights and analytics',
  options: [
    { flag: '--days', description: 'Number of days to analyze' },
  ],
  handler: async (args) => {
    const daysIdx = args.indexOf('--days');
    const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) || 7 : 7;

    console.log(`Insights (last ${days} days):`);
    console.log('  No data available yet.');
    console.log('  Insights are generated from session history.');
  },
});
