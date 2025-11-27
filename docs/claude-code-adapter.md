# Claude Code Adapter

The Claude Code adapter enables youBencha to evaluate Anthropic's Claude Code CLI as an AI coding agent.

## Overview

The Claude Code adapter implements the `AgentAdapter` interface to:
- Execute Claude Code CLI in non-interactive print mode (`-p` flag)
- Capture all output (stdout/stderr) to artifacts
- Normalize execution results to the youBencha Log format
- Support various configuration options (model, agent, prompt files)

## Prerequisites

Before using the Claude Code adapter, ensure you have:

1. **Claude Code CLI installed**: Install via npm:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. **Authentication configured**: Either:
   - Run `claude /login` for interactive authentication, or
   - Set the `ANTHROPIC_API_KEY` environment variable

3. **Verify installation**:
   ```bash
   claude --version
   ```

## Configuration

### Basic Configuration

The simplest test case configuration:

```yaml
name: "Basic Claude Code Evaluation"
description: "Run Claude Code to analyze a repository"

repo: "https://github.com/example/repo.git"
branch: "main"

agent:
  type: claude-code
  config:
    prompt: "Analyze this repository and list the main files"

evaluators:
  - name: git-diff
```

### With Prompt File

Use an external file for the prompt:

```yaml
agent:
  type: claude-code
  config:
    prompt_file: ./prompts/code-review.md  # Relative to workspace
```

> **Note**: `prompt` and `prompt_file` are mutually exclusive.

### With Model Selection

Specify a particular Claude model:

```yaml
agent:
  type: claude-code
  model: claude-sonnet-4
  config:
    prompt: "Review the code for security issues"
```

### With Custom Agent

Use a custom Claude Code agent/subagent:

```yaml
agent:
  type: claude-code
  agent_name: code-reviewer
  config:
    prompt: "Review the code quality"
```

### Full Configuration Example

```yaml
name: "Advanced Claude Code Evaluation"
description: "Comprehensive evaluation with all options"

repo: "https://github.com/example/repo.git"
branch: "main"

agent:
  type: claude-code
  agent_name: security-auditor
  model: claude-sonnet-4
  config:
    prompt_file: ./prompts/security-audit.md
    
    # Optional: Append to system prompt
    append_system_prompt: |
      Focus on OWASP Top 10 vulnerabilities.
      Provide severity ratings for each finding.
    
    # Optional: Permission mode (auto, plan, ask)
    permission_mode: auto
    
    # Optional: Restrict allowed tools
    allowed_tools:
      - Read
      - Write
      - ListDirectory
    
    # Optional: Token limit
    max_tokens: 8192

evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      assertions:
        - description: "Security issues identified"

timeout: 600000  # 10 minutes
```

## Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `type` | string | Yes | Must be `"claude-code"` |
| `agent_name` | string | No | Custom agent/subagent name |
| `model` | string | No | Claude model to use (e.g., `claude-sonnet-4`) |
| `config.prompt` | string | One of prompt/prompt_file | Inline prompt text |
| `config.prompt_file` | string | One of prompt/prompt_file | Path to prompt file |
| `config.append_system_prompt` | string | No | Additional system prompt text |
| `config.permission_mode` | string | No | `auto`, `plan`, or `ask` |
| `config.allowed_tools` | string[] | No | List of allowed tool names |
| `config.max_tokens` | number | No | Maximum response tokens |

## Output Artifacts

The adapter creates the following artifacts:

```
artifacts/
└── claude-code-logs/
    └── terminal-output-2025-11-25T10-30-00-000Z.log
```

The terminal output log contains the complete stdout/stderr from Claude Code execution.

## youBencha Log Structure

The adapter normalizes Claude Code output to the standard youBencha Log format:

```json
{
  "version": "1.0.0",
  "agent": {
    "name": "claude-code",
    "version": "1.2.3",
    "adapter_version": "1.0.0"
  },
  "model": {
    "name": "claude-sonnet-4",
    "provider": "Anthropic",
    "parameters": {}
  },
  "execution": {
    "started_at": "2025-11-25T10:30:00.000Z",
    "completed_at": "2025-11-25T10:31:00.000Z",
    "duration_ms": 60000,
    "exit_code": 0,
    "status": "success"
  },
  "messages": [...],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 500,
    "total_tokens": 600,
    "estimated_cost_usd": 0.0015
  },
  "errors": [],
  "environment": {...}
}
```

## Error Handling

### CLI Not Found

If Claude Code CLI is not installed:
```
Agent not configured or not available - check agent.type in evaluator config and ensure agent is installed
```

**Solution**: Install Claude Code CLI with `npm install -g @anthropic-ai/claude-code`

### Authentication Failed

If authentication is not configured:
```
Claude Code requires authentication. Run "claude /login" or set ANTHROPIC_API_KEY environment variable.
```

**Solution**: Run `claude /login` or set the `ANTHROPIC_API_KEY` environment variable

### Prompt Not Provided

If neither `prompt` nor `prompt_file` is specified:
```
One of "prompt" or "prompt_file" is required in agent config
```

### Invalid Prompt File Path

If `prompt_file` contains path traversal:
```
Invalid prompt_file path "../secret.txt". Path must be relative and not contain path traversal.
```

## Security Considerations

1. **Path Validation**: The adapter rejects absolute paths and path traversal attempts in `prompt_file`
2. **Output Size Limiting**: Output is limited to 10MB to prevent memory issues
3. **Shell Escaping**: Prompts are properly escaped to prevent injection
4. **No Shell Mode**: Commands are executed without shell to prevent shell injection

## Comparison with Copilot CLI Adapter

| Feature | Claude Code | Copilot CLI |
|---------|-------------|-------------|
| Provider | Anthropic | GitHub/OpenAI |
| CLI Flag | `-p` (print) | `-p` (prompt) |
| Agent Selection | `--agents` | `--agent` |
| Model Selection | `--model` | `--model` |
| Output Format | Structured text | Structured text |
| Token Info | Parsed from output | Parsed from output |

## Troubleshooting

### Timeout Issues

If Claude Code takes too long:
- Increase the `timeout` value in your test case config
- Break complex prompts into smaller tasks
- Use a faster model (e.g., claude-haiku)

### Output Truncation

If you see `[OUTPUT TRUNCATED: Exceeded 10MB limit]`:
- The output exceeded the 10MB safety limit
- Consider breaking the task into smaller parts
- Check if the prompt is causing excessive output

### Missing Token Information

Token counts are estimated if not found in output:
- Prompt tokens: ~1 token per 4 characters
- Completion tokens: ~1 token per 8 characters
- These are approximations for reporting purposes
