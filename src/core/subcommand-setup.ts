/**
 * Subcommand: setup — setup wizard subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { getConfigDir, getConfigPath, loadConfig, saveConfig } from './config.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

registerSubcommand({
  name: 'setup',
  description: 'Run the setup wizard',
  handler: async (args) => {
    console.log('🔧 Kairo Setup Wizard\n');

    const configDir = getConfigDir();
    const configPath = getConfigPath();

    // Create config directory
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
      console.log(`✅ Created: ${configDir}`);
    }

    // Create models.yml template
    const modelsPath = join(configDir, 'models.yml');
    if (!existsSync(modelsPath)) {
      writeFileSync(modelsPath, `# Kairo Provider Configuration
# Add your API keys here

providers:
  nvidia:
    apiKey: "nvapi-..."
  groq:
    apiKey: "gsk-..."
  cerebras:
    apiKey: "csk-..."
`, 'utf-8');
      console.log(`✅ Created: ${modelsPath}`);
      console.log('   Edit this file to add your API keys.');
    } else {
      console.log(`✅ Config exists: ${modelsPath}`);
    }

    console.log('\n🎉 Setup complete!');
    console.log('Edit ~/.kairo/models.yml to add your API keys, then run: kairo');
  },
});
