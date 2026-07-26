/**
 * Subcommand: migrate — migration subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { detectMigrationSources, migrateFromOpenClaw, formatMigrationResult } from './migrate.js';

registerSubcommand({
  name: 'migrate',
  description: 'Migrate from other tools',
  options: [
    { flag: '--detect', description: 'Detect migration sources' },
    { flag: '--from-openclaw', description: 'Migrate from OpenClaw' },
  ],
  handler: async (args) => {
    if (args.includes('--detect') || args.length === 0) {
      const sources = detectMigrationSources();
      console.log('Migration sources:');
      for (const source of sources) {
        const icon = source.found ? '✅' : '❌';
        console.log(`  ${icon} ${source.name}: ${source.path}`);
      }
      return;
    }

    if (args.includes('--from-openclaw')) {
      console.log('Migrating from OpenClaw...\n');
      const result = migrateFromOpenClaw();
      console.log(formatMigrationResult(result));
      return;
    }

    console.log('Usage: migrate [--detect] [--from-openclaw]');
  },
});
