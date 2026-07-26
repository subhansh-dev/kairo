/**
 * /learn — build the prompt that turns user-described sources into a reusable skill.
 *
 * The user can point /learn at anything: a directory, an API doc URL, a workflow
 * they just walked through, or pasted notes. This module builds ONE prompt that
 * instructs the agent to gather sources and author a SKILL.md.
 */

const AUTHORING_STANDARDS = `
Follow these skill-authoring standards exactly:

Frontmatter:
- name: lowercase-hyphenated, <=64 chars, no spaces.
- description: ONE sentence, **<=60 characters**, ends with a period. State the
  capability, not the implementation. No marketing words (powerful, comprehensive,
  seamless, advanced, robust). Do NOT repeat the skill name.
- version: 0.1.0
- author: "Kairo"
- globs: file patterns this skill applies to (optional).
- always-apply: false unless it truly should load every session.

Body section order (omit a section only if it genuinely has no content):
1. "# <Human Title>" — 2-3 sentence intro: what it does, what it does NOT do.
2. "## When to Use" — bullet list of concrete trigger phrases.
3. "## Prerequisites" — exact env vars, install steps, credentials.
4. "## How to Run" — the canonical invocation, framed through Kairo tools.
5. "## Quick Reference" — a flat command/endpoint list, no narration.
6. "## Procedure" — numbered steps with copy-paste-exact commands.
7. "## Pitfalls" — known limits, things that look broken but aren't.
8. "## Verification" — a single command/check that proves the skill worked.

Tool framing (this is what makes it a skill, not shell docs):
- Frame running scripts as "invoke through the \`exec\` tool".
- Reference tools by name in backticks: \`exec\`, \`read\`, \`write\`,
  \`edit\`, \`grep\`, \`glob\`, \`web_fetch\`, \`web_search\`.
- Do NOT name shell utilities the agent already has wrapped: say \`read\`
  not cat/head/tail, \`grep\` not rg/find, \`edit\` not sed/awk.
- Third-party CLIs are fine inside a script file, but the prose still frames
  them as "invoke through the \`exec\` tool".

Quality bar:
- Prefer exact commands, endpoint URLs, function signatures that appear VERBATIM
  in the source. NEVER invent flags, paths, or APIs.
- Keep it tight and scannable: ~100 lines for a simple skill, ~200 for complex.
- Don't write a router/index/hub skill that only points at other skills.
- Larger scripts belong in a \`scripts/\` file, referenced from SKILL.md by
  relative path — not inlined.
`;

/**
 * Build the agent prompt for an open-ended /learn request.
 */
export function buildLearnPrompt(userRequest: string): string {
  return `The user wants to create a new skill. Here's what they described:

${userRequest}

Your job:
1. Gather the sources the user named (read files, fetch URLs, review conversation).
2. Author a single SKILL.md that follows the standards below.
3. Save it using the skill management tools.

${AUTHORING_STANDARDS}

Now go gather the sources and create the skill.`;
}

/**
 * Build a prompt for updating an existing skill.
 */
export function buildUpdateSkillPrompt(skillName: string, userRequest: string): string {
  return `The user wants to update the skill "${skillName}". Here's what they described:

${userRequest}

Your job:
1. Read the current SKILL.md for "${skillName}".
2. Understand what needs to change based on the user's request.
3. Update the skill following the standards below.

${AUTHORING_STANDARDS}

Now go update the skill.`;
}

/**
 * Build a prompt for skill discovery from a directory.
 */
export function buildDiscoverSkillsPrompt(directory: string): string {
  return `Scan the directory "${directory}" for potential skills.

Look for:
- README.md files that describe workflows or tools
- Scripts that perform repeatable tasks
- Configuration patterns that could be templated
- Documentation that describes procedures

For each potential skill found:
1. Create a SKILL.md following the standards below.
2. Save it using the skill management tools.

${AUTHORING_STANDARDS}

Now scan the directory and create skills.`;
}
