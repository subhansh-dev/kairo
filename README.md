<p align="center">
  <img src="assets/banner.png" alt="Kairo" width="100%">
</p>

<p align="center">
  <strong>Free MoE coding agent. Multi-provider, multi-agent, swarm by default. 345+ modules.</strong>
</p>

<p align="center">
  <a href="https://github.com/subhansh-dev/kairo/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-≥18-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.4-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://github.com/subhansh-dev/kairo"><img src="https://img.shields.io/badge/Modules-345+-blueviolet?style=for-the-badge" alt="Modules"></a>
  <a href="https://github.com/subhansh-dev/kairo"><img src="https://img.shields.io/badge/Tools-40+-orange?style=for-the-badge" alt="Tools"></a>
  <a href="https://github.com/subhansh-dev/kairo"><img src="https://img.shields.io/badge/Agents-11-blue?style=for-the-badge" alt="Agents"></a>
  <a href="https://github.com/subhansh-dev/kairo"><img src="https://img.shields.io/badge/Workflows-15-green?style=for-the-badge" alt="Workflows"></a>
  <a href="https://github.com/subhansh-dev/kairo"><img src="https://img.shields.io/badge/CLI_Commands-30+-yellow?style=for-the-badge" alt="CLI Commands"></a>
  <a href="https://github.com/subhansh-dev/kairo"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge" alt="PRs Welcome"></a>
  <a href="https://github.com/subhansh-dev/kairo/stargazers"><img src="https://img.shields.io/github/stars/subhansh-dev/kairo?style=for-the-badge&logo=github" alt="Stars"></a>
  <a href="https://github.com/subhansh-dev/kairo/network/members"><img src="https://img.shields.io/github/forks/subhansh-dev/kairo?style=for-the-badge&logo=github" alt="Forks"></a>
  <a href="https://github.com/subhansh-dev/kairo/commits"><img src="https://img.shields.io/github/last-commit/subhansh-dev/kairo?style=for-the-badge&logo=github" alt="Last Commit"></a>
  <a href="mailto:me@subhansh.dev"><img src="https://img.shields.io/badge/Contact-me@subhansh.dev-blueviolet?style=for-the-badge" alt="Contact"></a>
</p>

---

so i built this thing. it's a coding agent that runs on free models — nvidia nim, groq, cerebras — and it actually works well. like, *really* well. it decomposes your task into parallel subagents, routes each one to the best model for the job, runs them concurrently, and merges the results.

it started as a weekend project because i wanted to build something that works on free models. turns out if you combine the right free models with proper orchestration, you get something that punches way above its weight.

## Quick Start

```bash
git clone https://github.com/subhansh-dev/kairo.git
cd kairo
npm install
node bin/kairo.js "add auth to the API"
```

that's it. no docker, no python, no 47 dependencies. just node and go.

## what it actually does

```
your prompt → decompose → route → parallel agents → merge → verify
```

1. your prompt gets analyzed for complexity and task type
2. each subtask routes to the best available model (nemotron for code, groq for quick stuff, deepseek for reasoning)
3. independent subtasks run as parallel subagents — at the same time, not one after another
4. results merge with conflict resolution
5. auto-fix runs lint and tests after every edit, feeds errors back to the model

swarm isn't a flag you turn on. it's how kairo thinks.

## the vibe

kairo has personality. when you ask it to fix a bug, it doesn't just silently execute tools — it tells you what it's doing in a way that feels like working with someone, not a script.

```
● Ayy let me squash that bug 🐛

  Thinking for 1.2s, calling grep…
  ✓ Found it (230ms)
  ● Tweaking that for you
  ✓ Edit applied (89ms)
  ● Running it
  ✓ Ran clean (1.1s)

  ✓ Done · nvidia/nemotron-3-ultra · 4.2s
  ✓ read ×3 (800ms) ✓ edit (89ms) ✓ exec (1.1s)
```

conversational status messages, thinking duration indicators, tool call summaries with timing — the tui actually feels alive.

## providers

configure in `~/.kairo/models.yml`:

```yaml
providers:
  nvidia:
    apiKey: "nvapi-..."
  groq:
    apiKey: "gsk-..."
  cerebras:
    apiKey: "csk-..."
```

env vars also work: `NVIDIA_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`

kairo rotates keys automatically, handles rate limits, tracks cooldowns per-key, and fails over to the next provider without you noticing. if one provider goes down mid-request, it switches and retries — you just see the answer.

### supported providers

| provider | models | notes |
|----------|--------|-------|
| nvidia | nemotron-3-ultra-550b, deepseek-r1, llama-3.3 | nvidia nim — best free code models |
| groq | llama-3.3-70b, gemma2-9b | fast inference, great for quick tasks |
| cerebras | llama-3.3-70b | blazing fast, good for simple stuff |

## tools

40+ built-in tools, organized by category:

| category | tools |
|----------|-------|
| **files** | `read` `write` `edit` `ls` `hashline` |
| **search** | `grep` `glob` `session_search` `tool_search` |
| **execution** | `exec` `git` |
| **web** | `web_fetch` `web_search` |
| **planning** | `enter_plan_mode` `write_plan` `exit_plan_mode` |
| **subagents** | `task_create` `task_list` `task_get` `task_update` `task_output` `task_stop` `agent` |
| **memory** | `memory` `todo` `goal` |
| **skills** | `skill` `discover_skills` |
| **quality** | `snip` `review_artifact` `suggest_pr` `proactive` |
| **user** | `ask_user` `send_message` `clarify` |
| **scheduling** | `cron` |
| **other** | `advisor` `mentor` `ctx_inspect` `sleep` `NotebookEdit` |

read tools run in parallel automatically. write tools serialize. that's not a config option — it just happens.

### tool infrastructure

under the hood, kairo has serious tool infrastructure:

- **tool dispatch** — parallel/serial batching, safety gating, path overlap detection
- **tool guardrails** — loop detection, same-tool failure halting, no-progress warnings
- **tool search** — fuzzy matching across tools by name and description
- **tool output limits** — truncation, compaction, error detection
- **tool result storage** — persist and retrieve past tool results
- **tool protection** — block dangerous operations, tier-based approval
- **tool validation** — schema validation, argument sanitization
- **toolset distributions** — pre-built tool sets (minimal, coding, research, full)
- **patch parser** — unified diff parsing and application
- **hashline** — hash-based line tracking for conflict detection

## agents

11 specialized agents, each with its own system prompt, tool access, and preferred model:

| agent | what it does | tools |
|-------|-------------|-------|
| `planner` | creates implementation plans | read-only |
| `coder` | writes and implements code | full access |
| `reviewer` | reviews code for bugs, security, quality | full access |
| `security` | security analysis — injection, auth, secrets | full access |
| `tdd` | test-driven dev: red → green → refactor | full access |
| `explore` | read-only codebase exploration | read-only |
| `backend-architect` | system design, databases, APIs | full access |
| `devops` | ci/cd, docker, kubernetes | full access |
| `debugger` | systematic bug finding | full access |
| `performance` | profiling and optimization | full access |
| `data-engineer` | etl pipelines, data quality | full access |

the coordinator picks which agent handles each turn based on task complexity and what just happened. if the verifier rejects work, it loops back to the worker with feedback. up to 3 iterations before it tells you something's wrong.

### agent infrastructure

- **agent lifecycle** — session/turn tracking, tool calls per turn, provider switches
- **subagent tracker** — real-time spawn/progress/completion tracking, tree building, aggregates
- **agent overlay** — full-screen panel (ctrl+a) with subagent tree, status glyphs, hotness coloring
- **turn context** — per-turn setup, sanitization, budget management
- **turn finalizer** — post-loop cleanup, trajectory save, session persist
- **turn retry state** — one-shot recovery guards for API call attempts
- **agent runtime helpers** — trajectory conversion, message repair, think block stripping

## workflows

chain agents in sequence. each agent's output feeds into the next:

| workflow | pipeline |
|----------|----------|
| `feature` | planner → tdd → coder → reviewer |
| `bugfix` | debugger → coder → reviewer |
| `refactor` | planner → coder → reviewer |
| `fullstack` | planner → backend-architect → coder → tdd → reviewer |
| `security` | security → reviewer |
| `perf` | performance → coder → reviewer |
| `debug` | debugger → reviewer |
| `backend` | backend-architect → coder → reviewer |
| `devops` | devops → reviewer |
| `data` | data-engineer → reviewer |

```bash
kairo /workflow feature "add user settings page"
kairo /workflow bugfix "login returns 500 on empty password"
kairo /workflow fullstack "build a realtime chat with auth"
```

## cli usage

```bash
kairo "prompt"              # normal mode — analyze, route, execute
kairo --swarm "prompt"      # swarm mode — decompose into parallel agents
kairo --smol "prompt"       # fast mode — cheap model, quick answers
kairo --slow "prompt"       # reasoning mode — thinking enabled
kairo --plan "prompt"       # planning mode — just the plan, no code
kairo -m <model> "prompt"   # override model
kairo -p <provider> "prompt" # override provider
kairo -e "prompt"           # one-shot exec mode — no tui, just output
kairo --status              # check which providers are available
kairo --help                # you know what this does
```

### 30+ cli subcommands

```
kairo help                  kairo version              kairo status
kairo doctor                kairo setup                kairo init
kairo model                 kairo config               kairo tools
kairo skills                kairo mcp                  kairo hooks
kairo plugins               kairo sessions             kairo backup
kairo restore               kairo migrate              kairo update
kairo clean                 kairo logs                 kairo diagnose
kairo security              kairo profiles             kairo projects
kairo pair                  kairo gateway              kairo dashboard
kairo debug                 kairo build                kairo test
kairo export                kairo search               kairo context
```

## tui commands

29 slash commands inside the interactive tui:

```
/help           /status         /clear          /model          /think
/tools          /compact        /session        /stats          /doctor
/agents         /workflow       /review         /save           /resume
/sessions       /init           /context        /diff           /export
/skills         /plan           /stuck          /shake          /search
/toolsets       /fork           /diagnostics    /memory         /cache
```

keyboard shortcuts:

| key | action |
|-----|--------|
| `Ctrl+C` | interrupt current work |
| `Ctrl+L` | clear screen |
| `Ctrl+A` | toggle agent overlay |
| `Tab` | autocomplete |
| `↑` `↓` | browse history |

## mcp

connects to any mcp server via stdio json-rpc. auto-discovers from `~/.kairo/mcp-servers.json`:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}
```

tools auto-register as `mcp_<server>_<tool>`. connect any mcp-compatible tool and it just works.

### mcp infrastructure

- **mcp config** — server configuration management (add, remove, toggle)
- **mcp catalog** — built-in catalog of popular MCP servers (filesystem, github, brave-search, memory, sqlite, postgres)
- **mcp security** — security checks for MCP server configurations
- **mcp serve** — MCP server hosting capabilities
- **mcp tool bridge** — bridge between MCP tools and the tool registry

## plugins

extend kairo with custom behavior. plugins live in `~/.kairo/plugins/` and get auto-discovered.

6 hook points:

| hook | when it runs | can it block? |
|------|-------------|---------------|
| `preToolCall` | before every tool call | yes |
| `postToolCall` | after every tool call | no |
| `preResponse` | before sending response | can modify |
| `postResponse` | after final response | observe only |
| `onSessionStart` | session begins | no |
| `onSessionEnd` | session ends | no |

exit code 2 from a hook = block the action. anything else = continue.

### shell hooks bridge

kairo can also run shell scripts as hooks. configure in `~/.kairo/hooks/`:

```json
{
  "event": "pre_tool_call",
  "command": "my-validator.sh",
  "description": "Validate before tool execution"
}
```

the hook receives JSON on stdin and can return JSON on stdout to block or inject context.

## skills

362 skills loaded from `~/.kairo/skills/`. markdown with yaml frontmatter. `always-apply` skills inject into every prompt automatically.

skill sources:
- system prompts (core personality, coding excellence, reasoning, tone)
- engineering patterns (code gen, debugging, testing, security, performance)
- ui components (19 component patterns)
- frontend design (design, animation, color, typography)
- agent orchestration (tool usage, delegation patterns)
- api design, ci/cd, documentation, git workflow, observability
- 282 agency agents (engineering, testing, security, design, product, devops)

### skill infrastructure

- **skill bundles** — aliases that load multiple skills under one slash command
- **skill commands** — slash command integration for skills
- **skill preprocessing** — prepare skills for loading (frontmatter parsing, glob matching)
- **skill provenance** — track where skills came from (builtin, user, imported, generated)
- **skill usage** — track skill usage statistics (most used, recently used)
- **skill guard** — prevent skill-related security issues (prompt injection detection)
- **skill discovery** — scan directories for potential skills
- **skill view** — view skill contents and metadata
- **skill config** — enable/disable skills, set priorities
- **learn prompt** — `/learn` command builds prompts to create new skills from user descriptions

create your own: just drop a `.md` file in `~/.kairo/skills/` with frontmatter:

```markdown
---
name: my-skill
description: does something cool
globs: ["*.ts", "*.js"]
always-apply: false
---

your skill content here
```

## safety

kairo takes safety seriously. not in a corporate-pr way — in a "i don't want to accidentally delete your system files" way.

### core safety

- **file safety** — blocks reads/writes to sensitive paths (`~/.ssh`, `/etc`, etc.)
- **guardrails** — blocks dangerous shell commands (`rm -rf /`, fork bombs, etc.)
- **secret obfuscation** — redacts api keys from context before they hit the model
- **rate limiting** — per-provider tracking with exponential backoff
- **failure loop guard** — stops after 3 repeated tool failures (prevents infinite loops)
- **auto-fix** — runs lint/test after edits, feeds errors back to the model
- **ssrf protection** — blocks requests to internal/private ips
- **bash classifier** — classifies commands as safe-read, write, or dangerous
- **tool approval** — tier-based permissions (read = auto, write = ask, exec = require)

### advanced safety

- **error classification** — smart failover based on error type (auth, rate limit, context overflow, etc.)
- **threat pattern detection** — scan for prompt injection, data exfiltration, role hijack
- **tool guardrails** — loop detection, same-tool failure halting, no-progress warnings
- **url safety** — SSRF prevention, private IP blocking, metadata endpoint blocking
- **path security** — sensitive path detection, write protection for system paths
- **tool protection** — block dangerous operations, tier-based approval
- **ssl guard** — CA bundle verification, TLS configuration checks
- **credential persistence** — sanitize secrets before disk writes
- **secret scope** — profile-scoped credential resolution (no cross-profile leaks)
- **message sanitization** — surrogate stripping, content cleaning
- **redaction** — regex-based secret masking for logs and output
- **security audit** — scan code for hardcoded secrets, injection patterns, SQL injection
- **security advisories** — check for known vulnerabilities
- **verification evidence** — track what the agent actually proved (tests passed, lint clean)

## context management

kairo has sophisticated context management to stay within model limits:

- **context breakdown** — cursor-style usage breakdown (system prompt, tools, skills, conversation)
- **context compression** — automatic summarization when approaching limits
- **context references** — track loaded context files and their sizes
- **subdirectory hints** — discover AGENTS.md/.cursorrules as the agent navigates
- **token estimation** — rough token counting (1 token ≈ 4 chars)
- **bounded response** — safe reading of HTTP error bodies with byte caps and timeouts
- **conversation compression** — reduce conversation history while preserving key info
- **manual compression feedback** — user-facing summaries for compression operations
- **trajectory compressor** — compress conversation trajectories for storage

## personality & ux

the tui isn't just functional — it has personality:

- **conversational tool messages** — "Lemme grab that file", "Got it, writing now", "Ayy let me squash that bug 🐛"
- **thinking duration indicators** — "Thinking for 1.2s, calling grep…"
- **tool call summaries** — "✓ read ×3 (800ms) ✓ edit (89ms) ✓ exec (1.1s)"
- **onboarding hints** — one-time tips the first time you hit a behavior fork
- **reaction detection** — token-free detection of user affection (ily, <3, good bot)
- **i18n support** — internationalization framework for static messages
- **skin engine** — UI theming and customization
- **tips system** — contextual tips on startup

## session management

- **session persistence** — save/load sessions to disk
- **session export** — export to markdown, JSON, HTML, plain text
- **session search** — full-text search across session history
- **session filters** — filter by model, provider, date, message count
- **session recap** — summarize a session (key decisions, files modified, tools used)
- **session fork** — branch a session from any point

## memory system

- **memory extraction** — learn from conversations automatically
- **memory providers** — pluggable memory backends (local, remote, cloud)
- **memory setup** — initialize memory system with default files
- **memory oauth** — OAuth integration for remote memory providers
- **goals** — track user goals and objectives
- **journey** — learning journey tracking (skills, memories, lessons, patterns)

## config & environment

| file | what it does |
|------|-------------|
| `~/.kairo/models.yml` | provider keys and model config |
| `~/.kairo/config.yaml` | main configuration |
| `~/.kairo/mcp-servers.json` | mcp server configs |
| `~/.kairo/plugins/` | custom plugins |
| `~/.kairo/skills/` | custom skills |
| `~/.kairo/hooks/` | shell hooks |
| `~/.kairo/keybindings.yml` | custom keybindings |
| `~/.kairo/skills-config.json` | skill enable/disable |
| `~/.kairo/tools-config.json` | tool enable/disable |
| `~/.kairo/projects.json` | registered projects |
| `~/.kairo/goals.json` | user goals |
| `~/.kairo/enrollment/` | device pairing tokens |
| `~/.kairo/backups/` | configuration backups |
| `~/.kairo/sessions/` | saved sessions |
| `~/.kairo/memories/` | memory files |
| `~/.kairo/logs/` | log files |
| `.kairo/skills/` | project-level skills |

### environment utilities

- **env loader** — load .env files
- **env probe** — detect available tools and capabilities
- **env passthrough** — safe environment for subprocesses
- **config** — get/set config values by key path
- **profiles** — user profile management

## architecture

```
src/
├── core/              345 modules — the brain
│   ├── engine.ts      streaming agent loop with failover
│   ├── router.ts      moe task classifier
│   ├── safety.ts      failure tracking, stuck detection
│   ├── compaction.ts  context compression
│   ├── personality.ts conversational tui messages
│   ├── subagent-tracker.ts  real-time subagent tracking
│   ├── agent-lifecycle.ts   session/turn lifecycle
│   ├── error-classifier.ts  smart error classification
│   ├── tool-guardrails.ts   loop detection
│   ├── threat-patterns.ts   prompt injection detection
│   ├── security-audit.ts    code security scanning
│   ├── credential-pool.ts   multi-key management
│   ├── rate-limit-tracker.ts provider rate limiting
│   ├── think-scrubber.ts    streaming think block removal
│   ├── verification-evidence.ts  proof tracking
│   ├── skill-bundles.ts     multi-skill aliases
│   ├── context-breakdown.ts usage analysis
│   ├── ...            and 330+ more modules
├── agents/            orchestrator with 11 agents and 15 workflows
├── tools/             40+ tools with parallel execution
├── providers/         nvidia, groq, cerebras with failover and key rotation
│   └── dialects/      provider-specific format handling
├── mcp/               mcp client (stdio json-rpc)
├── plugins/           plugin system with 6 hook points
├── skills/            skill loader (362 skills)
├── hooks/             hook manager
├── session/           session management, persistence, forking, search
├── tui/               terminal ui with theme, syntax highlighting, components
│   ├── app.ts         main tui application
│   ├── engine.ts      rendering engine with diff-based updates
│   ├── components.ts  ui components (chat, input, status bar, thinking)
│   ├── agent-overlay.ts subagent tree overlay (ctrl+a)
│   └── syntax.ts      multi-language syntax highlighting
└── utils/             bash parsing, git, diff, tokens, etc.
```

## architecture

## architecture

kairo is built from the ground up to work on free models. the architecture is designed around multi-provider routing, parallel agent execution, and zero-cost inference.

key design decisions:
- tool system with safety classification (read/write/exec tiers)
- hash-anchored file writes for conflict detection
- agent orchestration with workflow pipelines
- dialect system (provider-specific format handling)
- thinking/reasoning effort levels (off → xhigh)
- provider failover with automatic retry
- context compaction strategies

## contributing

want to help? cool. here's how:

```bash
git clone https://github.com/subhansh-dev/kairo.git
cd kairo
npm install
npm run build     # compile typescript
npm test          # run tests
```

standard stuff:
1. fork it
2. create a branch (`git checkout -b my-thing`)
3. make your changes
4. make sure `npm run build` passes
5. open a pr

keep it clean. no ai-generated commit messages that say "feat: implement comprehensive enhancement of the thing". just tell me what you changed and why.

## roadmap

things i want to add (in no particular order):

- [ ] websocket streaming for real-time collab
- [ ] more providers (openrouter, together, fireworks)
- [ ] voice input/output
- [ ] web ui (maybe)
- [ ] better swarm decomposition
- [ ] skill marketplace
- [ ] session recording and playback
- [ ] cost tracking per-session
- [ ] more agents (frontend, mobile, data-science)
- [ ] dingtalk integration
- [ ] qq bot integration
- [ ] feishu/lark integration

if any of these sound interesting to you, open an issue or a pr. or just build it and surprise me.

## license

mit — do whatever you want with it.

## contact

built by [subhansh](https://github.com/subhansh-dev) — a 17-year-old who got tired of paying for coding agents.

📧 me@subhansh.dev
🐙 [github.com/subhansh-dev](https://github.com/subhansh-dev)

if you find a bug, [open an issue](https://github.com/subhansh-dev/kairo/issues). if you want to chat, email me. if you want to sponsor me, i won't say no lol.

---

<p align="center">
  <sub>if this saved you money on api credits, consider starring the repo. it costs nothing and makes my day.</sub>
</p>
