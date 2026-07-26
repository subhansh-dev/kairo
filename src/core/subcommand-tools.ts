/**
 * Subcommand: tools — tools management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { loadToolsConfig, toggleTool, formatToolsConfig } from './tools-config.js';

registerSubcommand({
  name: 'tools',
  description: 'Manage tool configuration',
  options: [
    { flag: '--list', description: 'List all tools' },
    { flag: '--enable', description: 'Enable a tool' },
    { flag: '--disable', description: 'Disable a tool' },
  ],
  handler: async (args) => {
    const config = loadToolsConfig();

    if (args.includes('--list') || args.length === 0) {
      const tools = Object.values(config);
      if (tools.length === 0) {
        console.log('No tools configured. All tools are enabled by default.');
      } else {
        console.log(formatToolsConfig(config));
      }
      return;
    }

    const enableIdx = args.indexOf('--enable');
    if (enableIdx >= 0 && args[enableIdx + 1]) {
      toggleTool(args[enableIdx + 1], true);
      console.log(`✅ Enabled: ${args[enableIdx + 1]}`);
      return;
    }

    const disableIdx = args.indexOf('--disable');
    if (disableIdx >= 0 && args[disableIdx + 1]) {
      toggleTool(args[disableIdx + 1], false);
      console.log(`❌ Disabled: ${args[disableIdx + 1]}`);
      return;
    }

    console.log('Usage: tools [--list] [--enable <tool>] [--disable <tool>]');
  },
});

