/**
 * Subcommand: resume — resume session subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { listSessions, loadSession, formatSessions } from './session-persistence.js';

registerSubcommand({
  name: 'resume',
  description: 'Resume a saved session',
  handler: async (args) => {
    if (args.length === 0) {
      const sessions = listSessions(10);
      console.log(formatSessions(sessions));
      console.log('\nUsage: resume <session-id>');
      return;
    }

    const id = args[0];
    const session = loadSession(id);
    if (session) {
      console.log(`Resuming session: ${session.title || session.id}`);
      console.log(`Model: ${session.provider}/${session.model}`);
      console.log(`Messages: ${session.messages.length}`);
      console.log('\nUse /resume in the TUI for interactive resume.');
    } else {
      console.log(`Session not found: ${id}`);
    }
  },
});
