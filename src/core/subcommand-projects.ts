/**
 * Subcommand: projects — projects management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { listProjects, registerProject, removeProject, formatProjects } from './projects.js';

registerSubcommand({
  name: 'projects',
  description: 'Manage projects',
  options: [
    { flag: '--list', description: 'List projects' },
    { flag: '--add', description: 'Add a project' },
    { flag: '--remove', description: 'Remove a project' },
  ],
  handler: async (args) => {
    if (args.includes('--list') || args.length === 0) {
      console.log(formatProjects());
      return;
    }

    const addIdx = args.indexOf('--add');
    if (addIdx >= 0 && args[addIdx + 1]) {
      const name = args[addIdx + 1];
      const path = args[addIdx + 2] || process.cwd();
      registerProject(name, path);
      console.log(`✅ Added project: ${name} (${path})`);
      return;
    }

    const removeIdx = args.indexOf('--remove');
    if (removeIdx >= 0 && args[removeIdx + 1]) {
      const id = args[removeIdx + 1];
      if (removeProject(id)) {
        console.log(`✅ Removed project: ${id}`);
      } else {
        console.log(`❌ Project not found: ${id}`);
      }
      return;
    }

    console.log('Usage: projects [--list] [--add <name> [path]] [--remove <id>]');
  },
});
