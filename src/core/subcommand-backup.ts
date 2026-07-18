/**
 * Subcommand: backup — backup management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { createBackup, listBackups, restoreBackup } from './backup.js';

registerSubcommand({
  name: 'backup',
  description: 'Manage backups',
  options: [
    { flag: '--create', description: 'Create a new backup' },
    { flag: '--list', description: 'List available backups' },
    { flag: '--restore', description: 'Restore a backup' },
  ],
  handler: async (args) => {
    if (args.includes('--create')) {
      const description = args.filter(a => !a.startsWith('--')).join(' ') || undefined;
      const backup = createBackup(description);
      if (backup) {
        console.log(`✅ Backup created: ${backup.id}`);
        console.log(`   Files: ${backup.files.join(', ')}`);
      } else {
        console.log('❌ Failed to create backup');
      }
      return;
    }

    if (args.includes('--list') || args.length === 0) {
      const backups = listBackups();
      if (backups.length === 0) {
        console.log('No backups available.');
      } else {
        console.log('Available backups:');
        for (const backup of backups) {
          const time = new Date(backup.createdAt).toLocaleString();
          console.log(`  • ${backup.id} (${time})${backup.description ? ` — ${backup.description}` : ''}`);
        }
      }
      return;
    }

    const restoreIdx = args.indexOf('--restore');
    if (restoreIdx >= 0 && args[restoreIdx + 1]) {
      const id = args[restoreIdx + 1];
      if (restoreBackup(id)) {
        console.log(`✅ Restored backup: ${id}`);
      } else {
        console.log(`❌ Failed to restore backup: ${id}`);
      }
      return;
    }

    console.log('Usage: backup [--create [desc]] [--list] [--restore <id>]');
  },
});
