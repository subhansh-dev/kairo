/**
 * Subcommand: profiles — profiles management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { listProfiles, loadProfile, createProfile, deleteProfile } from './profiles.js';

registerSubcommand({
  name: 'profiles',
  description: 'Manage user profiles',
  options: [
    { flag: '--list', description: 'List profiles' },
    { flag: '--create', description: 'Create a profile' },
    { flag: '--delete', description: 'Delete a profile' },
  ],
  handler: async (args) => {
    if (args.includes('--list') || args.length === 0) {
      const profiles = listProfiles();
      if (profiles.length === 0) {
        console.log('No profiles configured.');
      } else {
        console.log('Profiles:');
        for (const name of profiles) {
          console.log(`  • ${name}`);
        }
      }
      return;
    }

    const createIdx = args.indexOf('--create');
    if (createIdx >= 0 && args[createIdx + 1]) {
      const name = args[createIdx + 1];
      createProfile(name);
      console.log(`✅ Created profile: ${name}`);
      return;
    }

    const deleteIdx = args.indexOf('--delete');
    if (deleteIdx >= 0 && args[deleteIdx + 1]) {
      const name = args[deleteIdx + 1];
      if (deleteProfile(name)) {
        console.log(`✅ Deleted profile: ${name}`);
      } else {
        console.log(`❌ Profile not found: ${name}`);
      }
      return;
    }

    console.log('Usage: profiles [--list] [--create <name>] [--delete <name>]');
  },
});
