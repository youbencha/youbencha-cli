# Agent Name Configuration

## Overview

youBencha now supports specifying custom agent names in the evaluation suite configuration. This allows you to use named agents (e.g., GitHub Copilot CLI agents defined in `.github/agents/`) during both the coding agent run and the agentic-judge evaluation.

## Features

### 1. Named Agent for Coding Run

Specify an agent name in the `agent` section of your suite configuration:

```yaml
agent:
  type: copilot-cli
  agent_name: my-custom-agent  # Agent name from .github/agents/
  config:
    prompt: "Your task description here"
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
      agent_name: evaluation-agent  # Agent name for evaluation
      assertions:
        code_quality: "Assessment assertions here"
```

## Complete Example

```yaml
repo: https://github.com/octocat/Hello-World.git
branch: master

agent:
  type: copilot-cli
  agent_name: code-reviewer  # Named agent for coding
  config:
    prompt: "Review and improve the code"

evaluators:
  - name: git-diff
  
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: code-reviewer  # Use same agent for evaluation
      assertions:
        code_quality: "Code follows best practices. Score 1-10."
        documentation: "Code has proper documentation. Score 1-10."
```

## How It Works

### Automatic File Copying

When a named agent is used, youBencha automatically:

1. **Before Agent Execution**: Copies `.github/agents/` from your project root to the workspace
2. **During Execution**: Passes the agent name via `--agent` flag to the CLI
3. **For Agentic Judge**: Repeats the process if `agent_name` is specified in evaluator config

This ensures the agent definitions are available in the isolated workspace environment.

### Platform Support

The implementation handles platform-specific command execution:

- **Windows**: Uses PowerShell with proper escaping and the call operator (`&`)
- **Unix/Linux/macOS**: Direct command execution with proper argument passing

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
    prompt: "Your prompt here"  # Works without agent name
```

## See Also

- [Basic Suite Example](../examples/basic-suite.yaml)
- [Named Agent Example](../examples/named-agent-suite.yaml)
- [Agent Outputs Examples](../examples/agent-outputs/)
