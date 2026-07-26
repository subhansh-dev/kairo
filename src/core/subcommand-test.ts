/**
 * Subcommand: test — test subcommand.
 */

import { registerSubcommand } from './subcommands.js';

registerSubcommand({
  name: 'test',
  description: 'Run tests',
  handler: async (args) => {
    console.log('Running tests...');
    console.log('Use `npm test` to run the test suite.');
    console.log('Use `npm run build` to compile TypeScript.');
  },
});
