/**
 * Subcommand: skills — skills management subcommand.
 */

import { registerSubcommand } from './subcommands.js';
import { discoverAllSkills, formatSkill } from './discover-skills.js';
import { loadSkillsConfig, toggleSkill } from './skills-config.js';

registerSubcommand({
  name: 'skills',
  description: 'Manage skills',
  options: [
    { flag: '--list', description: 'List all skills' },
    { flag: '--enable', description: 'Enable a skill' },
    { flag: '--disable', description: 'Disable a skill' },
  ],
  handler: async (args) => {
    if (args.includes('--list') || args.length === 0) {
      const skills = discoverAllSkills();
      if (skills.length === 0) {
        console.log('No skills found.');
      } else {
        console.log(`Found ${skills.length} skills:\n`);
        for (const skill of skills) {
          console.log(formatSkill(skill));
        }
      }
      return;
    }

    const enableIdx = args.indexOf('--enable');
    if (enableIdx >= 0 && args[enableIdx + 1]) {
      toggleSkill(args[enableIdx + 1], true);
      console.log(`✅ Enabled skill: ${args[enableIdx + 1]}`);
      return;
    }

    const disableIdx = args.indexOf('--disable');
    if (disableIdx >= 0 && args[disableIdx + 1]) {
      toggleSkill(args[disableIdx + 1], false);
      console.log(`❌ Disabled skill: ${args[disableIdx + 1]}`);
      return;
    }

    console.log('Usage: skills [--list] [--enable <name>] [--disable <name>]');
  },
});

