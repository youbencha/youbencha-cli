# OpenAI Codex CLI Adapter

## Overview

The Codex CLI adapter enables youBencha to evaluate code generation tasks using OpenAI's API. This adapter interfaces with OpenAI's modern models (which succeeded the original Codex API) including GPT-4, GPT-3.5-turbo, and the reasoning-focused o1 models.

## Important Note

OpenAI's original Codex API was deprecated in March 2023. This adapter uses OpenAI's current Chat Completion API with models optimized for code generation tasks. The name "Codex CLI" reflects the code-focused nature of the adapter rather than a specific OpenAI product.

## Prerequisites

### 1. OpenAI API Key

You must have an active OpenAI API key with sufficient credits:

```bash
export OPENAI_API_KEY="sk-..."
```

### 2. Python Environment

The adapter requires Python 3.x with the OpenAI Python SDK:

```bash
# Install the OpenAI Python SDK
pip install openai

# Or using Python 3 explicitly
pip3 install openai
```

### 3. Verify Installation

Check that your environment is ready:

```bash
# Check Python
python3 --version

# Check OpenAI SDK
python3 -c "import openai; print('OpenAI SDK installed')"

# Check API key (returns 401 if key invalid, connection error if key missing)
python3 -c "import openai; client = openai.OpenAI(); print('API key configured')"
```

## Supported Models

The adapter supports the following OpenAI models:

| Model | Best For | Speed | Cost |
|-------|----------|-------|------|
| `gpt-4` | Complex coding tasks, high accuracy | Slow | High |
| `gpt-4-turbo` | Faster GPT-4 with larger context | Medium | Medium-High |
| `gpt-3.5-turbo` | Simple tasks, fast iteration | Fast | Low |
| `o1` | Advanced reasoning, complex problems | Slow | Highest |
| `o1-mini` | Faster reasoning tasks | Medium | High |

## Configuration

### Basic Example

```yaml
name: "Simple Code Generation"
description: "Generate a utility function"

repo: https://github.com/your-org/your-repo.git
branch: main

agent:
  type: codex-cli
  model: gpt-4  # Optional, defaults to gpt-4
  config:
    prompt: |
      Create a new file utils/string_helpers.py with utility functions
      for string manipulation including:
      - capitalize_words()
      - snake_to_camel()
      - camel_to_snake()

evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        file_created: "The utils/string_helpers.py file was created"
        functions_exist: "All three functions are implemented"
        
timeout: 300000  # 5 minutes
```

### Advanced Example with o1

```yaml
name: "Complex Refactoring with Reasoning"
description: "Use o1 model for complex architectural changes"

repo: https://github.com/your-org/your-repo.git
branch: main

agent:
  type: codex-cli
  model: o1  # Advanced reasoning model
  config:
    prompt: |
      Analyze the entire codebase and propose architectural improvements.
      
      Tasks:
      1. Identify code duplication and extract shared logic
      2. Improve error handling patterns
      3. Add comprehensive docstrings
      4. Suggest performance optimizations
      
      Make minimal, surgical changes focused on high-impact improvements.

evaluators:
  - name: git-diff
    config:
      max_changes: 50
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        duplication_reduced: "Code duplication was identified and reduced"
        error_handling_improved: "Error handling patterns were enhanced"
        documentation_added: "Docstrings were added to key functions"
        
timeout: 600000  # 10 minutes for complex reasoning
```

### JSON Configuration

```json
{
  "name": "Code Review Comments",
  "description": "Add code review comments to a PR",
  "repo": "https://github.com/your-org/your-repo.git",
  "branch": "feature-branch",
  "agent": {
    "type": "codex-cli",
    "model": "gpt-3.5-turbo",
    "config": {
      "prompt": "Review the code changes and add inline comments explaining complex logic"
    }
  },
  "evaluators": [
    {
      "name": "git-diff",
      "config": {
        "max_changes": 20
      }
    }
  ],
  "timeout": 180000
}
```

## How It Works

### Execution Flow

1. **Script Generation**: The adapter generates a Python script that:
   - Imports the OpenAI SDK
   - Configures authentication using `OPENAI_API_KEY`
   - Sends a chat completion request with the prompt
   - Captures the response and token usage

2. **API Call**: The script executes, calling OpenAI's API with:
   - System message establishing the coding assistant role
   - User message containing your prompt
   - Model-specific parameters (temperature, max_tokens)

3. **Response Processing**: The adapter:
   - Captures stdout/stderr output
   - Parses token usage and cost estimation
   - Normalizes the response to youBencha Log format
   - Saves detailed logs in the artifacts directory

4. **Cleanup**: Temporary Python scripts are deleted after execution

### Log Structure

The adapter creates several log files in `artifacts/codex-logs/`:

- `terminal-output-{timestamp}.log` - Complete terminal output
- `codex_response_{timestamp}.json` - Detailed API response with usage metrics
- `codex_execution_{timestamp}.py` - Generated Python script (deleted after execution)

### Token Usage and Cost Tracking

The adapter automatically tracks:

- **Prompt tokens**: Input token count
- **Completion tokens**: Generated token count  
- **Total tokens**: Sum of input and output
- **Estimated cost**: Based on current OpenAI pricing

Example output:
```
[INFO] Prompt tokens: 250
[INFO] Completion tokens: 500
[INFO] Total tokens: 750
```

## Comparison with Copilot CLI

| Feature | Codex CLI Adapter | Copilot CLI Adapter |
|---------|-------------------|---------------------|
| **Backend** | OpenAI API directly | GitHub Copilot service |
| **Authentication** | OPENAI_API_KEY | GitHub authentication |
| **Models** | OpenAI models (GPT-4, o1, etc.) | GitHub Copilot models |
| **Tool Use** | No native tool calling | Supports tool calling |
| **Cost** | Pay-per-token via OpenAI | Included with Copilot subscription |
| **Best For** | Direct API access, specific models | Integrated GitHub workflows |

## Troubleshooting

### "OPENAI_API_KEY environment variable not set"

**Solution**: Export your API key before running:
```bash
export OPENAI_API_KEY="sk-your-key-here"
yb run -c testcase.yaml
```

### "OpenAI Python SDK not installed"

**Solution**: Install the SDK:
```bash
pip install openai
# or
pip3 install openai
```

### "API rate limit exceeded"

**Solution**: 
- Check your OpenAI account usage limits
- Reduce request frequency
- Consider using a lower-tier model (e.g., gpt-3.5-turbo instead of gpt-4)

### "Connection error" or "Authentication failed"

**Solutions**:
- Verify API key is valid: Check at https://platform.openai.com/api-keys
- Ensure sufficient credits in your OpenAI account
- Check network connectivity to api.openai.com

### Timeout Issues

For complex tasks, increase the timeout:
```yaml
timeout: 600000  # 10 minutes
```

The o1 models are slower and may require longer timeouts.

## Best Practices

### 1. Model Selection

- Use `gpt-3.5-turbo` for:
  - Simple code generation
  - Fast iteration during development
  - Cost-conscious evaluations

- Use `gpt-4` for:
  - Complex refactoring
  - Production-quality code generation
  - Nuanced understanding required

- Use `o1` for:
  - Architectural decisions
  - Complex problem-solving
  - Multi-step reasoning tasks

### 2. Prompt Engineering

**Be Specific**:
```yaml
# Bad
prompt: "Fix the code"

# Good  
prompt: |
  Fix the bug in calculate_total() function in utils/math.py.
  The bug causes incorrect rounding for negative numbers.
  Preserve existing behavior for positive numbers.
```

**Provide Context**:
```yaml
prompt: |
  Context: This is a REST API server using FastAPI.
  
  Task: Add input validation to the /users endpoint.
  - Validate email format
  - Ensure username is 3-20 characters
  - Return 400 with clear error messages
```

### 3. Cost Management

Monitor costs by:
- Checking token usage in logs
- Using cheaper models for testing
- Setting shorter timeouts to avoid runaway costs
- Using `max_tokens` in prompts for longer responses

### 4. Security

**Never commit API keys**:
```bash
# .gitignore
.env
*.env
```

**Use environment variables**:
```bash
# .env file (gitignored)
OPENAI_API_KEY=sk-...

# Load in terminal
export $(cat .env | xargs)
```

## Examples

See the `examples/` directory for complete working examples:

- `testcase-codex-simple.yaml` - Basic code modification
- `testcase-codex-advanced.yaml` - Complex refactoring with gpt-3.5-turbo
- `testcase-codex-o1.json` - Advanced reasoning with o1 model

## API Reference

### Agent Configuration Schema

```typescript
{
  type: 'codex-cli',          // Required: adapter type
  model?: string,              // Optional: model name (default: 'gpt-4')
  config: {
    prompt: string,            // Required: task description
    // Additional OpenAI parameters could be added here
  }
}
```

### Supported Configuration Options

Currently supported in `config`:
- `prompt` (required): The task description/instruction
- `model` (optional): Specified at agent level, not in config

Future enhancements may include:
- `temperature`: Control randomness (0.0 - 2.0)
- `max_tokens`: Limit response length
- `top_p`: Nucleus sampling parameter

## Contributing

To extend the adapter:

1. **Add new models**: Update the model enum in `src/schemas/testcase.schema.ts`
2. **Add configuration options**: Extend the Python script generation in `buildCodexCommand()`
3. **Improve parsing**: Enhance `parseMessages()` to extract more structured data
4. **Add tests**: Update `tests/unit/codex-cli.test.ts` with new test cases

## Related Documentation

- [Agent Adapters Overview](./adapters.md)
- [Test Case Configuration](./testcase-configuration.md)
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
- [Copilot CLI Adapter](./copilot-cli-adapter.md)
