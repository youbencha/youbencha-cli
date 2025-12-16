# youBencha Configuration

youBencha supports configuration files that allow you to customize default behavior and set up environment variables for your test cases.

## Configuration File Locations

youBencha looks for configuration files in two locations, with the following priority:

1. **Project-level**: `.youbencharc` (or `.youbencharc.yaml`, `.youbencharc.yml`, `.youbencharc.json`) in your current directory
2. **User-level**: `~/.youbencharc` (or `~/.youbencharc.yaml`, etc.) in your home directory

**Priority order**: CLI flags > project config > user config > defaults

## Creating Configuration Files

### Initialize a Configuration File

```bash
# Create project-level config in current directory
yb config init

# Create user-level config in home directory
yb config init --global

# Overwrite existing config
yb config init --force
```

This creates a commented configuration file with all available options.

## Configuration Options

### workspace_dir

Default workspace directory for evaluation runs.

```yaml
workspace_dir: .youbencha-workspace
```

- Can be absolute path or relative to project root
- Default: `.youbencha-workspace`
- Used by: `yb run` command

### output_dir

Default output directory for eval-only runs.

```yaml
output_dir: .youbencha-eval
```

- Can be absolute path or relative to project root
- Default: `.youbencha-eval`
- Used by: `yb eval` command

### timeout_ms

Default timeout for operations in milliseconds.

```yaml
timeout_ms: 300000  # 5 minutes
```

- Default: `300000` (5 minutes)
- Applies to git operations and other long-running tasks

### log_level

Default log level for CLI output.

```yaml
log_level: info
```

- Options: `debug`, `info`, `warn`, `error`
- Default: `info`

### keep_workspace

Whether to keep workspace after evaluation by default.

```yaml
keep_workspace: true
```

- Default: `true`
- Can be overridden by `--delete-workspace` flag in `yb run`

### variables

Environment variables for substitution in configuration files.

```yaml
variables:
  PROJECT_NAME: my-project
  REPO_BASE: https://github.com/myorg
  DEFAULT_BRANCH: main
```

These variables can be referenced in test case configurations using `${VAR_NAME}` syntax.

**Example test case using variables:**

```yaml
name: "Example Test"
description: "Testing ${PROJECT_NAME}"

repo: ${REPO_BASE}/hello-world.git
branch: ${DEFAULT_BRANCH}

agent:
  type: copilot-cli
  config:
    prompt: "Add documentation for ${PROJECT_NAME}"
```

### agent

Default agent configuration.

```yaml
agent:
  timeout_ms: 600000  # 10 minutes
  model: gpt-4o       # Default model for agents that support it
```

- `timeout_ms`: Default timeout for agent execution
- `model`: Default model for agents that support model selection

### evaluators

Default evaluator configuration.

```yaml
evaluators:
  max_concurrent: 4
```

- `max_concurrent`: Maximum number of evaluators to run in parallel
- Default: `4`

## Managing Configuration

### View Current Configuration

```bash
# Show all configuration settings
yb config list

# Get a specific setting
yb config get workspace_dir

# Get nested settings
yb config get agent.timeout_ms
```

### Set Configuration Values

```bash
# Set a value in project-level config
yb config set workspace_dir /tmp/workspace

# Set a value in user-level config
yb config set workspace_dir /tmp/workspace --global

# Set nested values
yb config set agent.timeout_ms 900000
yb config set evaluators.max_concurrent 8

# Values are automatically converted to appropriate types
yb config set keep_workspace false    # boolean
yb config set timeout_ms 300000       # number
yb config set workspace_dir /tmp/ws   # string
```

### Remove Configuration Values

```bash
# Remove a setting from project-level config
yb config unset workspace_dir

# Remove from user-level config
yb config unset workspace_dir --global
```

## Complete Configuration Example

```yaml
# youBencha Configuration File
workspace_dir: .youbencha-workspace
output_dir: .youbencha-eval
timeout_ms: 300000
log_level: info
keep_workspace: true

variables:
  PROJECT_NAME: my-project
  REPO_BASE: https://github.com/myorg
  DEFAULT_BRANCH: main
  JIRA_PREFIX: PROJ

agent:
  timeout_ms: 600000
  model: gpt-4o

evaluators:
  max_concurrent: 4
```

## Variable Substitution

Variables defined in the `variables` section can be used in your test case configurations:

**Configuration (.youbencharc):**
```yaml
variables:
  ORG: myorg
  REPO: myrepo
  BRANCH: develop
```

**Test Case (testcase.yaml):**
```yaml
name: "Test ${REPO}"
description: "Testing ${ORG}/${REPO} on ${BRANCH}"

repo: https://github.com/${ORG}/${REPO}.git
branch: ${BRANCH}

agent:
  type: copilot-cli
  config:
    prompt: "Fix the bug in ${REPO} module"
```

## Best Practices

### Project-Level vs User-Level

- **User-level config** (`~/.youbencharc`): Use for personal preferences like default workspace location, log level, and commonly used variables
- **Project-level config** (`.youbencharc`): Use for project-specific settings like repository URLs, branch names, and project variables

### Committing Configuration Files

- **Commit** project-level `.youbencharc` files to version control if they contain project-specific settings that benefit the whole team
- **Don't commit** user-level configs or configs with sensitive information
- Add `.youbencharc` to `.gitignore` if it contains sensitive data

### Variable Naming

- Use UPPER_CASE for variable names for clarity
- Keep variable names descriptive: `REPO_BASE` instead of `RB`
- Document variables in comments within the config file

## Troubleshooting

### Configuration Not Being Applied

1. Check which config file is active:
   ```bash
   yb config list
   ```
   This shows the active config file path.

2. Verify the configuration file syntax:
   ```bash
   # YAML files can be validated with online tools
   cat .youbencharc | head -20
   ```

3. Check for typos in setting names (they must match exactly)

### Variables Not Substituting

1. Verify variables are defined correctly:
   ```bash
   yb config get variables
   ```

2. Check variable syntax in test case (must use `${VAR_NAME}`)

3. Ensure variable names match exactly (case-sensitive)

### Priority Conflicts

Remember the priority order:
1. CLI flags (highest)
2. Project-level config
3. User-level config
4. Default values (lowest)

If a setting isn't taking effect, check if it's overridden at a higher priority level.
