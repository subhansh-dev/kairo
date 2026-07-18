/**
 * Subcommand: serve — serve subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'serve',
  description: 'Start a local server',
  options: [
    { flag: '--port', description: 'Port to listen on' },
  ],
  handler: async (args) => {
    const portIdx = args.indexOf('--port');
    const port = portIdx >= 0 ? parseInt(args[portIdx + 1]) || 3000 : 3000;

    console.log(`Starting server on port ${port}...`);
    console.log('⚠️  Server mode not yet implemented in Kairo');
    console.log('Use the gateway command for messaging integration.');
  },
});
