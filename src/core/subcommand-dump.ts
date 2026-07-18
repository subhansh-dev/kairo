/**
 * Subcommand: dump — dump configuration subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { loadConfig, getConfigPath } from './config.js';
import { loadMCPConfig } from './mcp-config.js';
import { loadSkillsConfig } from './skills-config.js';
import { loadToolsConfig } from './tools-config.js';

registerSubcommand({
  name: 'dump',
  description: 'Dump configuration for debugging',
  handler: async (args) => {
    console.log('=== Kairo Configuration Dump ===\n');

    console.log('Config path:', getConfigPath());
    console.log('\nMain config:');
    console.log(JSON.stringify(loadConfig(), null, 2));

    console.log('\nMCP servers:');
    console.log(JSON.stringify(loadMCPConfig(), null, 2));

    console.log('\nSkills config:');
    console.log(JSON.stringify(loadSkillsConfig(), null, 2));

    console.log('\nTools config:');
    console.log(JSON.stringify(loadToolsConfig(), null, 2));
  },
});
