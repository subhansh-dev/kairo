/**
 * Subcommand: init — initialization subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { getConfigDir, getConfigPath } from './config.js';
import { initMemorySystem, formatMemorySetup } from './memory-setup.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

registerSubcommand({
  name: 'init',
  description: 'Initialize Kairo configuration',
  handler: async (args) => {
    const configDir = getConfigDir();
    const configPath = getConfigPath();

    console.log('Initializing Kairo...\n');

    // Create config directory
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
      console.log(`✅ Created config directory: ${configDir}`);
    } else {
      console.log(`✅ Config directory exists: ${configDir}`);
    }

    // Create default config if it doesn't exist
    if (!existsSync(configPath)) {
      writeFileSync(configPath, `# Kairo Configuration
# See docs for all options

# model: nvidia/nemotron-3-ultra-550b-a55b
# provider: nvidia
`, 'utf-8');
      console.log(`✅ Created config file: ${configPath}`);
    } else {
      console.log(`✅ Config file exists: ${configPath}`);
    }

    // Initialize memory system
    const memResult = initMemorySystem();
    console.log('\nMemory system:');
    console.log(formatMemorySetup(memResult));

    console.log('\n🎉 Initialization complete!');
    console.log('Edit ~/.kairo/models.yml to add your API keys.');
  },
});
