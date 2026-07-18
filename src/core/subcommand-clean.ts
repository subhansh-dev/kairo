/**
 * Subcommand: clean — clean subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { clearOldLogs } from './logs.js';
import { cleanupResults } from './tool-result-storage.js';
import { cleanupPairingCodes } from './pairing.js';

registerSubcommand({
  name: 'clean',
  description: 'Clean up temporary files and old data',
  options: [
    { flag: '--logs', description: 'Clean old logs' },
    { flag: '--results', description: 'Clean old tool results' },
    { flag: '--all', description: 'Clean everything' },
  ],
  handler: async (args) => {
    if (args.includes('--all') || args.length === 0) {
      const logs = clearOldLogs(7);
      const results = cleanupResults(100);
      const pairing = cleanupPairingCodes();
      console.log(`Cleaned: ${logs} log files, ${results} tool results, ${pairing} pairing codes`);
      return;
    }

    if (args.includes('--logs')) {
      const cleaned = clearOldLogs(7);
      console.log(`Cleaned ${cleaned} old log files`);
    }

    if (args.includes('--results')) {
      cleanupResults(100);
      console.log('Cleaned old tool results');
    }
  },
});
