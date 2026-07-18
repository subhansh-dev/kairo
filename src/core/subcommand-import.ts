/**
 * Subcommand: import — import subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'import',
  description: 'Import data from other tools',
  options: [
    { flag: '--from', description: 'Source tool to import from' },
  ],
  handler: async (args) => {
    const fromIdx = args.indexOf('--from');
    const from = fromIdx >= 0 ? args[fromIdx + 1] : null;

    if (!from) {
      console.log('Usage: import --from <tool>');
      console.log('Supported sources: kairo, custom');
      return;
    }

    console.log(`Importing from ${from}...`);
    console.log('Use `migrate --from-openclaw` for OpenClaw migration.');
  },
});
