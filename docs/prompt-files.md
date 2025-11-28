# Loading Prompts from Files

youBencha supports loading prompt content from external files, making it easier to manage large prompts, share prompt templates, and maintain version control for your prompts.

## Overview

Instead of specifying prompts inline in your configuration files, you can reference external prompt files using the `prompt_file` field. This works in two places:

1. **Agent execution** - Load the main agent prompt from a file
2. **Evaluator configuration** - Load evaluation instructions from a file (e.g., for agentic-judge)

## Benefits

- **Easier management** - Edit prompts in dedicated files with proper syntax highlighting
- **Reusability** - Share prompt files across multiple test cases
- **Version control** - Track prompt changes separately from configuration
- **Large prompts** - Avoid cluttering configuration files with lengthy prompts
- **Markdown support** - Use rich formatting in `.md` files for better readability

## Usage

### Agent Prompt from File

Load the agent's main prompt from an external file:

```yaml
agent:
  type: copilot-cli
  config:
    prompt_file: ./prompts/add-readme-comment.md
```

**File: `prompts/add-readme-comment.md`**
```markdown
# Add Welcome Message

Please add a friendly welcome message to the README.md file.

The message should:
- Be welcoming and engaging
- Explain what this repository is about
- Be concise (no more than 3-4 lines)
- Follow markdown formatting best practices
```

### Evaluator Prompt from File

Load evaluation instructions from a file in the agentic-judge evaluator:

```yaml
evaluators:
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      prompt_file: ./prompts/strict-evaluation-instructions.txt
      assertions:
        readme_was_modified: "The README.md file was modified. Score 1 if true, 0 if false."
        message_is_friendly: "A friendly message was added. Score 1 if friendly, 0.5 if neutral, 0 if absent."
```

**File: `prompts/strict-evaluation-instructions.txt`**
```
Do not ask for clarification or additional information.
Use only the files in the repository to evaluate the criteria.
Be strict in your evaluation - only give full scores when requirements are clearly met.
```

## Path Resolution

youBencha supports both relative and absolute paths for prompt files:

### Relative Paths

Relative paths are resolved from the directory containing the configuration file:

```yaml
# In examples/my-test.yaml
agent:
  config:
    prompt_file: ./prompts/my-prompt.md  # Resolves to examples/prompts/my-prompt.md
```

### Absolute Paths

Absolute paths work as expected:

```yaml
agent:
  config:
    prompt_file: /absolute/path/to/prompt.md
```

## Supported File Formats

youBencha can load prompts from any text file format:

- **Markdown (`.md`)** - Recommended for formatted prompts
- **Text (`.txt`)** - Simple plain text prompts
- **Any text format** - Any UTF-8 encoded text file

The file extension doesn't affect how the content is used - it's always loaded as plain text.

## Validation Rules

### Mutual Exclusivity

You **cannot** specify both `prompt` and `prompt_file` in the same configuration:

```yaml
# ❌ Invalid - will fail validation
agent:
  config:
    prompt: "Inline prompt"
    prompt_file: ./prompts/file-prompt.md
```

Choose one approach:

```yaml
# ✅ Valid - inline prompt
agent:
  config:
    prompt: "Inline prompt"

# ✅ Valid - file-based prompt
agent:
  config:
    prompt_file: ./prompts/file-prompt.md
```

### Optional Prompt

Both `prompt` and `prompt_file` are optional. You can omit both if your agent doesn't require a prompt (though this is rare).

## Complete Examples

### Example 1: Agent Execution with Prompt File

**Configuration: `examples/testcase-prompt-file.yaml`**

```yaml
name: "Add README comment using prompt file"
description: "Tests the agent's ability to add a comment to README using a prompt loaded from a file"

repo: https://github.com/youbencha/hello-world.git
branch: main

agent:
  type: copilot-cli
  config:
    prompt_file: ./prompts/add-readme-comment.md

evaluators:
  - name: git-diff
    config:
      max_files_changed: 1
      max_lines_added: 5
```

**Prompt file: `examples/prompts/add-readme-comment.md`**

```markdown
# Add Welcome Message

Please add a friendly welcome message to the README.md file.

The message should:
- Be welcoming and engaging
- Explain what this repository is about
- Be concise (no more than 3-4 lines)
- Follow markdown formatting best practices
```

**Run the test:**

```bash
yb run -c examples/testcase-prompt-file.yaml
```

### Example 2: Evaluator with Prompt File

**Configuration: `examples/testcase-evaluator-prompt-file.yaml`**

```yaml
name: "Add README comment with file-based evaluation instructions"
description: "Tests the agent with evaluation instructions loaded from a file"

repo: https://github.com/youbencha/hello-world.git
branch: main

agent:
  type: copilot-cli
  config:
    prompt: "Add a friendly welcome message to README.md explaining what this repository is about"

evaluators:
  - name: git-diff
    config:
      max_files_changed: 1
      max_lines_added: 5

  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      prompt_file: ./prompts/strict-evaluation-instructions.txt
      assertions:
        readme_was_modified: "The README.md file was modified. Score 1 if true, 0 if false."
        message_is_friendly: "A friendly welcome message was added. Score 1 if friendly, 0.5 if neutral, 0 if absent or unfriendly."
        no_errors: "No syntax errors or broken markdown. Score 1 if valid, 0 if broken."
```

**Prompt file: `examples/prompts/strict-evaluation-instructions.txt`**

```
Do not ask for clarification or additional information.
Use only the files in the repository to evaluate the criteria.
Be strict in your evaluation - only give full scores when requirements are clearly met.
```

**Run the test:**

```bash
yb run -c examples/testcase-evaluator-prompt-file.yaml
```

## Best Practices

### 1. Organize Prompts in a Dedicated Directory

Keep your prompts organized in a `prompts/` directory:

```
my-project/
├── prompts/
│   ├── add-feature.md
│   ├── fix-bug.md
│   └── strict-eval.txt
└── testcases/
    ├── test-1.yaml
    └── test-2.yaml
```

### 2. Use Descriptive File Names

Name your prompt files descriptively:

- ✅ `add-error-handling.md`
- ✅ `strict-evaluation-instructions.txt`
- ❌ `prompt1.md`
- ❌ `test.txt`

### 3. Use Markdown for Complex Prompts

For prompts with structure, use Markdown:

```markdown
# Task: Add Error Handling

## Requirements
- Add try-catch blocks around network calls
- Log errors with descriptive messages
- Return meaningful error responses

## Constraints
- Don't modify existing function signatures
- Keep error messages user-friendly
- Follow project's logging conventions
```

### 4. Version Control Your Prompts

Track changes to prompts in version control just like code:

```bash
git add prompts/
git commit -m "Update evaluation criteria for error handling"
```

### 5. Share Prompts Across Test Cases

Reference the same prompt file from multiple test cases:

```yaml
# testcase-1.yaml
agent:
  config:
    prompt_file: ./prompts/shared-task.md

# testcase-2.yaml
agent:
  config:
    prompt_file: ./prompts/shared-task.md
```

## Troubleshooting

### File Not Found

If you see an error like "Failed to load prompt from file", check:

1. **Path is correct** - Verify the file exists at the specified path
2. **Relative path base** - Remember relative paths are resolved from the config file's directory
3. **File permissions** - Ensure the file is readable

### Schema Validation Error

If you see "Cannot specify both prompt and prompt_file":

- Remove either the `prompt` or `prompt_file` field
- Use only one method per configuration

### Empty Prompt

If the prompt appears empty:

- Check the file encoding (should be UTF-8)
- Verify the file isn't empty
- Look for leading/trailing whitespace (automatically trimmed)

## Related Features

- **[Reusable Evaluators](reusable-evaluators.md)** - Reference evaluator definitions from external files
- **[Custom Instructions](multiple-agentic-judges.md)** - Use the legacy `instructions-file` approach (deprecated in favor of `prompt_file`)

## Migration from `instructions-file`

The agentic-judge evaluator previously used an `instructions-file` field. While this still works, `prompt_file` is now the preferred approach for consistency:

```yaml
# Old approach (still works)
evaluators:
  - name: agentic-judge
    config:
      instructions-file: ./template.md
      assertions: {...}

# New approach (recommended)
evaluators:
  - name: agentic-judge
    config:
      prompt_file: ./instructions.txt
      assertions: {...}
```

The key difference: `prompt_file` loads the content and prepends it to assertions, while `instructions-file` uses a template with `{{ASSERTIONS}}` placeholder.
