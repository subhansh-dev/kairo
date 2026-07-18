# Kairo — Architecture

## Overview
Free MoE coding agent. Routes tasks to the best available free model.
Built to run on free-tier providers (NVIDIA NIM, Groq, Cerebras) with production-grade features.

## Design Decisions

### Core Architecture
- Tool system with safety classification (read/write/exec tiers)
- Hash-anchored file writes for conflict detection
- Agent orchestration with workflow pipelines
- Hook system (PreToolUse, PostToolUse, SessionStart)
- Skills system with frontmatter parsing
- Session management with context compaction
- Rich TUI with streaming, syntax highlighting, tool cards

### Provider System
- Dialect system (provider-specific format handling)
- Thinking/reasoning effort levels (off → xhigh)
- Provider failover with automatic retry
- Tool approval system (tier-based permissions)
- Context compaction strategies

## Directory Structure
```
kairo/
├── bin/kairo.js              # CLI entry point
├── src/
│   ├── core/
│   │   ├── engine.ts         # Streaming agent loop with failover
│   │   └── router.ts         # MoE task classifier
│   ├── providers/
│   │   ├── types.ts          # Core types (Message, Tool, Dialect, etc.)
│   │   ├── enhanced.ts       # Enhanced provider with dialect support
│   │   ├── registry.ts       # Multi-provider registry with auto-discovery
│   │   └── dialects/
│   │       ├── index.ts      # Dialect factory
│   │       ├── openai.ts     # OpenAI-compatible (NVIDIA, Groq, Cerebras)
│   │       ├── deepseek.ts   # DeepSeek (reasoning_content)
│   │       └── kimi.ts       # Kimi/Moonshot (thinking mode)
│   ├── agents/
│   │   └── orchestrator.ts   # Multi-agent orchestration with workflows
│   ├── tools/
│   │   ├── types.ts          # Tool types, permission tiers, call extraction
│   │   ├── index.ts          # Tool registry
│   │   ├── bash.ts           # Shell with safety classification
│   │   ├── file-read.ts      # Read with hash + fuzzy resolve
│   │   ├── file-write.ts     # Hash-anchored writes
│   │   ├── file-edit.ts      # Find-and-replace
│   │   ├── search.ts         # Grep + glob
│   │   └── memory.ts         # Persistent memory
│   ├── tui/
│   │   ├── app.ts            # Main TUI application
│   │   ├── theme.ts          # Theme (colors, icons)
│   │   └── syntax.ts         # Syntax highlighting
│   ├── skills/
│   │   └── loader.ts         # Skill discovery
│   ├── hooks/
│   │   └── manager.ts        # Lifecycle interceptors
│   ├── session/
│   │   └── manager.ts        # Persistent sessions
│   ├── mcp/
│   │   └── client.ts         # MCP integration
│   ├── cli.ts                # CLI entry
│   ├── tui.ts                # TUI entry
│   └── index.ts              # Public API
├── config/                   # Config templates
├── package.json
├── tsconfig.json
└── README.md
```

## Core Architecture

### Dialect System
```
Provider → Dialect → Format-specific parsing/rendering

NVIDIA NIM ──→ openai dialect ──→ standard OpenAI streaming
Groq ────────→ openai dialect ──→ standard OpenAI streaming
Cerebras ────→ openai dialect ──→ standard OpenAI streaming
DeepSeek ────→ deepseek dialect → reasoning_content field
Kimi ────────→ kimi dialect ────→ thinking blocks
```

### Task Classification → Model Routing
```
Request → classify() → TaskType:
  CODE      → nvidia/deepseek-ai/deepseek-r1
  PLANNING  → nvidia/deepseek-ai/deepseek-r1 (thinking)
  SECURITY  → nvidia/deepseek-ai/deepseek-r1
  QUICK     → groq/llama-3.3-70b-versatile
  GENERAL   → nvidia/deepseek-ai/deepseek-r1
```

### Agent Loop (Generator-based)
```
input → buildSystemPrompt → resolveProvider → stream():
  ├─ text → yield to TUI
  ├─ thinking → yield to TUI (dimmed)
  ├─ tool_call → extractToolCalls → execute → add to messages → loop
  ├─ error → tryFailover → retry with next provider
  └─ done → save session → yield final
```

### Tool Safety
```
Tool Tier System:
  read  → auto-approved (read, grep, glob, ls)
  write → may require approval (write, edit, mkdir, rm)
  exec  → approval required (exec, git push, npm install)

Bash Classification:
  SAFE_READ → auto-approved (ls, cat, grep, git status)
  WRITE → classified (rm, mv, git commit)
  DANGEROUS → blocked (rm -rf /, fork bomb)
```

### Provider Failover
```
Primary provider fails → getFailoverProviders():
  1. Try same model on different provider
  2. Try any model on any provider
  3. Report error if all fail
```

## Agent System

### Agents
| Agent | Purpose | Model | Tools |
|-------|---------|-------|-------|
| planner | Implementation plans | DeepSeek R1 | No |
| coder | Code generation | DeepSeek R1 | Yes |
| reviewer | Code review | DeepSeek R1 | Yes |
| security | Security analysis | DeepSeek R1 | Yes |
| tdd | Test-driven dev | DeepSeek R1 | Yes |
| explore | Codebase exploration | Groq 70b | Read-only |

### Workflows
```
feature:  planner → tdd → coder → reviewer
bugfix:   coder → reviewer
refactor: planner → coder → reviewer
security: security → reviewer
tdd:      tdd → reviewer
```

## Skills System
- Markdown with YAML frontmatter
- Loads from `~/.kairo/skills/`, `.kairo/skills/`, `~/.claude/skills/`
- `always-apply` skills injected into every prompt
- Natural language matching via keywords + globs

## Hooks System
- PreToolUse: Block/modify before tool execution
- PostToolUse: Auto-format, lint after tool execution
- SessionStart: Load context on session begin
- Exit code 2 = block, other errors = continue

## Session Management
- Persistent sessions in `~/.kairo/sessions/`
- Context compaction when token count exceeds threshold
- Token estimation (1 token ≈ 4 chars)

## TUI
- ANSI color theme (pure black, cyan/magenta accents)
- Multi-language syntax highlighting (TS, Python, Bash, SQL, Rust, Go)
- Tool cards with icons and status
- Status bar (provider, model, routing, elapsed time)
- Tab autocomplete for commands and tools
- Ctrl+L clear, Ctrl+C exit
