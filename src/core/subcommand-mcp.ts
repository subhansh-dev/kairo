/**
 * Subcommand: mcp — MCP management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { loadMCPConfig, addMCPServer, removeMCPServer, toggleMCPServer, formatMCPConfig } from './mcp-config.js';
import { formatMCPCatalog, searchMCPCatalog } from './mcp-catalog.js';

registerSubcommand({
  name: 'mcp',
  description: 'Manage MCP servers',
  options: [
    { flag: '--list', description: 'List configured MCP servers' },
    { flag: '--catalog', description: 'Browse MCP server catalog' },
    { flag: '--add', description: 'Add an MCP server' },
    { flag: '--remove', description: 'Remove an MCP server' },
  ],
  handler: async (args) => {
    if (args.includes('--list') || args.length === 0) {
      console.log(formatMCPConfig());
      return;
    }

    if (args.includes('--catalog')) {
      const query = args.filter(a => !a.startsWith('--')).join(' ');
      if (query) {
        const results = searchMCPCatalog(query);
        console.log(results.length > 0 ? results.map(r => `• ${r.name}: ${r.description}`).join('\n') : 'No results found.');
      } else {
        console.log(formatMCPCatalog());
      }
      return;
    }

    if (args.includes('--add')) {
      const name = args[args.indexOf('--add') + 1];
      const command = args[args.indexOf('--add') + 2];
      if (name && command) {
        addMCPServer(name, command);
        console.log(`✅ Added MCP server: ${name}`);
      } else {
        console.log('Usage: mcp --add <name> <command>');
      }
      return;
    }

    if (args.includes('--remove')) {
      const name = args[args.indexOf('--remove') + 1];
      if (name) {
        if (removeMCPServer(name)) {
          console.log(`✅ Removed MCP server: ${name}`);
        } else {
          console.log(`❌ MCP server not found: ${name}`);
        }
      } else {
        console.log('Usage: mcp --remove <name>');
      }
      return;
    }

    console.log('Usage: mcp [--list] [--catalog] [--add <name> <cmd>] [--remove <name>]');
  },
});
