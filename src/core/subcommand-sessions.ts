/**
 * Subcommand: sessions — sessions management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { listSessions, formatSessions, deleteSession } from './session-persistence.js';

registerSubcommand({
  name: 'sessions',
  description: 'Manage sessions',
  options: [
    { flag: '--list', description: 'List saved sessions' },
    { flag: '--delete', description: 'Delete a session' },
  ],
  handler: async (args) => {
    if (args.includes('--list') || args.length === 0) {
      const sessions = listSessions();
      console.log(formatSessions(sessions));
      return;
    }

    const deleteIdx = args.indexOf('--delete');
    if (deleteIdx >= 0 && args[deleteIdx + 1]) {
      const id = args[deleteIdx + 1];
      if (deleteSession(id)) {
        console.log(`✅ Deleted session: ${id}`);
      } else {
        console.log(`❌ Session not found: ${id}`);
      }
      return;
    }

    console.log('Usage: sessions [--list] [--delete <id>]');
  },
});
