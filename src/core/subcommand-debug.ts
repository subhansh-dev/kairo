/**
 * Subcommand: debug — debug subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { enableDebug, disableDebug, isDebugEnabled, getDebugInfo } from './debug.js';

registerSubcommand({
  name: 'debug',
  description: 'Debug mode management',
  options: [
    { flag: '--enable', description: 'Enable debug mode' },
    { flag: '--disable', description: 'Disable debug mode' },
    { flag: '--info', description: 'Show debug info' },
  ],
  handler: async (args) => {
    if (args.includes('--enable')) {
      enableDebug();
      console.log('✅ Debug mode enabled');
      return;
    }

    if (args.includes('--disable')) {
      disableDebug();
      console.log('❌ Debug mode disabled');
      return;
    }

    if (args.includes('--info')) {
      console.log(JSON.stringify(getDebugInfo(), null, 2));
      return;
    }

    console.log(`Debug mode: ${isDebugEnabled() ? '✅ Enabled' : '❌ Disabled'}`);
    console.log('Usage: debug [--enable] [--disable] [--info]');
  },
});
