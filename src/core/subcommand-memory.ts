/**
 * Subcommand: memory — memory management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { getMemoryDir, isMemoryInitialized, initMemorySystem, formatMemorySetup } from './memory-setup.js';
import { formatMemoryProviders, getAllMemoryProviders } from './memory-providers.js';

registerSubcommand({
  name: 'memory',
  description: 'Manage memory system',
  options: [
    { flag: '--status', description: 'Show memory system status' },
    { flag: '--init', description: 'Initialize memory system' },
    { flag: '--providers', description: 'List memory providers' },
  ],
  handler: async (args) => {
    if (args.includes('--init')) {
      const result = initMemorySystem();
      console.log(formatMemorySetup(result));
      return;
    }

    if (args.includes('--providers')) {
      console.log(formatMemoryProviders());
      return;
    }

    // Default: status
    const initialized = isMemoryInitialized();
    console.log(`Memory system: ${initialized ? '✅ Initialized' : '❌ Not initialized'}`);
    if (initialized) {
      console.log(`Memory directory: ${getMemoryDir()}`);
    } else {
      console.log('Run `memory --init` to initialize.');
    }
  },
});
