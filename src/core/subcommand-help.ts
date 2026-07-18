/**
 * Subcommand: help — help display subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { listSubcommands, formatSubcommands } from './subcommands.js';

registerSubcommand({
  name: 'help',
  description: 'Show help information',
  handler: async (args) => {
    if (args.length > 0) {
      // Show help for specific subcommand
      const cmd = listSubcommands().find(c => c.name === args[0]);
      if (cmd) {
        console.log(`${cmd.name} — ${cmd.description}`);
        if (cmd.options && cmd.options.length > 0) {
          console.log('\nOptions:');
          for (const opt of cmd.options) {
            console.log(`  ${opt.flag.padEnd(20)} ${opt.description}`);
          }
        }
      } else {
        console.log(`Unknown command: ${args[0]}`);
      }
      return;
    }

    console.log('Kairo — Free MoE Coding Agent\n');
    console.log('Commands:');
    console.log(formatSubcommands());
    console.log('\nFor more information, run: kairo <command> --help');
  },
});
