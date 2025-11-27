# Configuration Schema Contract

**Schema**: Claude Code agent configuration within suite YAML/JSON  
**Validation**: Zod schema in adapter or schemas directory

## Schema Definition

### YAML Format

```yaml
agent:
  type: claude-code
  agent_name: my-custom-agent  # Optional: custom agent/subagent
  model: claude-sonnet-4-5-20250929  # Optional: specific model
  config:
    # Required: Exactly one of prompt or prompt_file
    prompt: "Your task description here"
    # OR
    prompt_file: ./prompts/coding-task.md
    
    # Optional: Advanced features
    append_system_prompt: "You are an expert TypeScript developer"
    permission_mode: auto  # auto | plan | ask
    allowed_tools:
      - Read
      - Write
      - Execute
    system_prompt: "Custom system prompt override"
    max_tokens: 4096
    temperature: 0.0
```

### JSON Format

```json
{
  "agent": {
    "type": "claude-code",
    "agent_name": "my-custom-agent",
    "model": "claude-sonnet-4-5-20250929",
    "config": {
      "prompt": "Your task description here",
      "append_system_prompt": "You are an expert TypeScript developer",
      "permission_mode": "auto",
      "allowed_tools": ["Read", "Write", "Execute"],
      "max_tokens": 4096,
      "temperature": 0.0
    }
  }
}
```

---

## Field Specifications

### `agent.type`
- **Type**: `string`
- **Required**: Yes
- **Value**: Must be `"claude-code"` (exact match)
- **Description**: Identifies Claude Code adapter

### `agent.agent_name`
- **Type**: `string`
- **Required**: No
- **Pattern**: `^[\w\-]+$` (alphanumeric, hyphens, underscores)
- **Max Length**: 100 characters
- **Description**: Custom Claude Code agent or subagent name
- **Example**: `"code-reviewer"`, `"bug-fixer"`, `"documentation-writer"`

### `agent.model`
- **Type**: `string`
- **Required**: No
- **Pattern**: `^claude-[\w\-\.]+$`
- **Description**: Specific Claude model to use
- **Examples**: 
  - `"claude-sonnet-4-5-20250929"`
  - `"claude-opus-3-5"`
  - `"claude-haiku-3-5"`
- **Default**: Claude Code CLI default (typically latest Sonnet)

### `agent.config.prompt`
- **Type**: `string`
- **Required**: One of `prompt` or `prompt_file` required
- **Min Length**: 1 character
- **Max Length**: 1,000,000 characters
- **Description**: Inline prompt text passed to Claude Code
- **Mutually Exclusive**: Cannot use with `prompt_file`
- **Example**: 
  ```yaml
  prompt: |
    Add comprehensive error handling to all API endpoints.
    Ensure proper logging for debugging.
  ```

### `agent.config.prompt_file`
- **Type**: `string`
- **Required**: One of `prompt` or `prompt_file` required
- **Pattern**: Must not start with `/` or contain `..`
- **Max Length**: 500 characters
- **Description**: Relative path to prompt file (from workspace root)
- **Mutually Exclusive**: Cannot use with `prompt`
- **File Requirement**: File must exist and be readable
- **Example**: `"./prompts/add-feature-x.md"`

### `agent.config.append_system_prompt`
- **Type**: `string`
- **Required**: No
- **Max Length**: 10,000 characters
- **Description**: Additional system prompt appended to default
- **Use Case**: Add domain-specific instructions without replacing entire system prompt

### `agent.config.permission_mode`
- **Type**: `string` (enum)
- **Required**: No
- **Values**: `"auto"` | `"plan"` | `"ask"`
- **Default**: `"auto"`
- **Description**: How Claude Code handles tool execution permissions
  - `auto`: Execute all tools automatically
  - `plan`: Show execution plan, require approval
  - `ask`: Ask before each tool execution
- **Recommendation**: Use `"auto"` for non-interactive evaluation

### `agent.config.allowed_tools`
- **Type**: `string[]`
- **Required**: No
- **Pattern**: Each element matches `^[\w\-]+$`
- **Description**: Allowlist of tool names Claude Code may use
- **Example**: `["Read", "Write", "ListDirectory"]`
- **Default**: All tools allowed

### `agent.config.system_prompt`
- **Type**: `string`
- **Required**: No
- **Max Length**: 50,000 characters
- **Description**: Complete replacement of default system prompt
- **Warning**: Overriding system prompt may affect agent capabilities
- **Use Case**: Highly specialized tasks requiring custom instructions

### `agent.config.max_tokens`
- **Type**: `integer`
- **Required**: No
- **Min**: 1
- **Max**: 200,000
- **Description**: Maximum response length in tokens
- **Default**: Model-specific default (typically 4096)

### `agent.config.temperature`
- **Type**: `number` (float)
- **Required**: No
- **Min**: 0.0
- **Max**: 1.0
- **Description**: Sampling temperature for response generation
- **Default**: 0.0 (deterministic)
- **Recommendation**: Use 0.0 for reproducible evaluations

---

## Validation Rules

### VR-1: Mutual Exclusivity
```
(prompt XOR prompt_file) = true
```
Exactly one of `prompt` or `prompt_file` must be provided, not both, not neither.

### VR-2: File Existence
```
IF prompt_file IS PROVIDED
THEN file_exists(resolve_path(workspace_root, prompt_file)) = true
```

### VR-3: Path Safety
```
prompt_file NOT CONTAINS '..'
AND prompt_file NOT STARTS WITH '/'
AND prompt_file NOT STARTS WITH '\'
```

### VR-4: Model Format
```
IF model IS PROVIDED
THEN model MATCHES /^claude-[\w\-\.]+$/
```

### VR-5: Enum Validation
```
IF permission_mode IS PROVIDED
THEN permission_mode IN ['auto', 'plan', 'ask']
```

---

## Error Messages

### Missing Prompt
```
Config validation error: One of 'prompt' or 'prompt_file' is required for claude-code agent
```

### Both Prompt Fields
```
Config validation error: 'prompt' and 'prompt_file' are mutually exclusive. Provide only one.
```

### Invalid Prompt File Path
```
Config validation error: prompt_file './../../etc/passwd' contains path traversal. Use relative paths within workspace.
```

### File Not Found
```
Config validation error: prompt_file './prompts/missing.md' does not exist. Available files: [list]
```

### Invalid Model Format
```
Config validation error: model 'gpt-4' is not a valid Claude model. Expected format: claude-<variant>-<version>
```

### Invalid Permission Mode
```
Config validation error: permission_mode 'manual' is invalid. Allowed values: auto, plan, ask
```

---

## Example Configurations

### Minimal (Inline Prompt)
```yaml
agent:
  type: claude-code
  config:
    prompt: "Add tests for user authentication module"
```

### With Prompt File
```yaml
agent:
  type: claude-code
  config:
    prompt_file: ./prompts/refactor-auth.md
    permission_mode: auto
```

### Full Configuration
```yaml
agent:
  type: claude-code
  agent_name: security-reviewer
  model: claude-sonnet-4-5-20250929
  config:
    prompt_file: ./prompts/security-audit.md
    append_system_prompt: |
      Focus on OWASP Top 10 vulnerabilities.
      Provide severity ratings for each finding.
    permission_mode: auto
    allowed_tools:
      - Read
      - ListDirectory
    max_tokens: 8192
    temperature: 0.0
```

### Model Selection
```yaml
agent:
  type: claude-code
  model: claude-opus-3-5  # Use most capable model
  config:
    prompt: "Implement complex algorithm optimization"
    max_tokens: 16384
```

---

## Schema Test Cases

### Valid Configurations (Must Pass)

```yaml
# TC-1: Minimal inline prompt
agent: { type: claude-code, config: { prompt: "Test" } }

# TC-2: Prompt file
agent: { type: claude-code, config: { prompt_file: "./prompts/task.md" } }

# TC-3: With model
agent: { type: claude-code, model: "claude-sonnet-4", config: { prompt: "Test" } }

# TC-4: Full options
agent:
  type: claude-code
  agent_name: reviewer
  model: claude-sonnet-4-5-20250929
  config:
    prompt: "Review code"
    permission_mode: auto
    max_tokens: 4096
    temperature: 0.0
```

### Invalid Configurations (Must Fail)

```yaml
# TC-5: Missing prompt (FAIL)
agent: { type: claude-code, config: {} }

# TC-6: Both prompt fields (FAIL)
agent: { type: claude-code, config: { prompt: "A", prompt_file: "B" } }

# TC-7: Path traversal (FAIL)
agent: { type: claude-code, config: { prompt_file: "../../../etc/passwd" } }

# TC-8: Invalid model (FAIL)
agent: { type: claude-code, model: "gpt-4", config: { prompt: "Test" } }

# TC-9: Invalid permission mode (FAIL)
agent: { type: claude-code, config: { prompt: "Test", permission_mode: "manual" } }

# TC-10: Negative max_tokens (FAIL)
agent: { type: claude-code, config: { prompt: "Test", max_tokens: -100 } }

# TC-11: Temperature out of range (FAIL)
agent: { type: claude-code, config: { prompt: "Test", temperature: 1.5 } }
```

---

## Backward Compatibility

This configuration schema is **additive** and maintains compatibility with:
- Existing `agent.type` pattern (follows copilot-cli precedent)
- Standard `agent.config` structure
- youBencha Log schema (no changes required)

---

**Configuration Schema Contract Complete**
