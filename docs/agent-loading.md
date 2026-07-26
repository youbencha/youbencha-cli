# Named-agent loading

youBencha stages named-agent definitions in each isolated workspace before the
main agent or an `agentic-judge` runs:

| Adapter            | Project source    | Workspace destination | CLI selection    |
| ------------------ | ----------------- | --------------------- | ---------------- |
| GitHub Copilot CLI | `.github/agents/` | `.github/agents/`     | `--agent <name>` |
| Claude Code        | `.claude/agents/` | `.claude/agents/`     | `--agent <name>` |

The adapter passes the configured `agent_name` through the CLI's native
`--agent` option. It does not prepend instructions to or otherwise rewrite the
task prompt.

Claude agent names must begin with a lowercase letter, contain only lowercase
letters, digits, and hyphens, and be no more than 64 characters. The Claude
adapter verifies `.claude/agents/<name>.md` exists in the workspace before
starting the CLI, so a missing or invalid named agent fails with an actionable
error.

See [Agent name configuration](agent-name-configuration.md) for examples.
