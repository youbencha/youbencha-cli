# Agent Name Configuration

## Overview

youBencha supports custom agent names for both GitHub Copilot CLI definitions
in `.github/agents/` and Claude Code definitions in `.claude/agents/`. Named
agents work during the coding run and an `agentic-judge` evaluation.

## Features

### 1. Named Agent for Coding Run

Specify an agent name in the `agent` section of your test case configuration:

```yaml
agent:
  type: copilot-cli
  agent_name: my-custom-agent # Agent name from .github/agents/
  config:
    prompt: 'Your task description here'
```

When an agent name is specified:

- The `.github/agents/` directory is automatically copied to the workspace before execution
- The agent is invoked with the `--agent <name>` flag
- Agent-specific instructions and configurations are applied

### 2. Named Agent for Agentic Judge

Use a named agent in the `agentic-judge` evaluator:

```yaml
evaluators:
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: evaluation-agent # Agent name for evaluation
      assertions:
        code_quality: 'Assessment assertions here'
```

## Complete Example

```yaml
name: 'Code Review Test Case'
description: 'Tests code review improvements using a named agent'

repo: https://github.com/youbencha/hello-world.git
branch: main

agent:
  type: copilot-cli
  agent_name: code-reviewer # Named agent for coding
  config:
    prompt: 'Review and improve the code'

evaluators:
  - name: git-diff

  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: code-reviewer # Use same agent for evaluation
      assertions:
        code_quality: 'Code follows best practices. Score 1-10.'
        documentation: 'Code has proper documentation. Score 1-10.'
```

## How It Works

### Automatic File Copying

When a named agent is used, youBencha automatically:

1. **Before Agent Execution**: Copies `.github/agents/` and `.claude/agents/` from your project root to the workspace
2. **During Execution**: Passes the agent name via the CLI's native `--agent` flag; the prompt is not rewritten
3. **For Agentic Judge**: Repeats the process if `agent_name` is specified in evaluator config

This ensures the agent definitions are available in the isolated workspace environment.

### Platform Support

The implementation resolves native executables and npm shims on each platform.
Native binaries use `shell: false`; one reviewed non-interactive runner handles
Windows `.cmd`, `.bat`, and PowerShell shims without concatenating prompt text.

## Benefits

1. **Reusability**: Define agents once, use them across multiple evaluations
2. **Consistency**: Same agent can evaluate the code it produces
3. **Customization**: Tailor agent behavior for specific evaluation scenarios
4. **Isolation**: Agent definitions are copied to isolated workspaces

## Backward Compatibility

The `agent_name` field is optional. Existing configurations without agent names continue to work:

```yaml
agent:
  type: copilot-cli
  config:
    prompt: 'Your prompt here' # Works without agent name
```

## See Also

- [Basic Test Case Example](../examples/testcase-basic.yaml)
- [Named Agent Example](../examples/testcase-named-agent.yaml)
- [Agent Outputs Examples](../examples/agent-outputs/)
