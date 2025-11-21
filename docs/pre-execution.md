# Pre-Execution Hooks

Pre-execution hooks allow you to run custom scripts or commands **after workspace setup but before agent execution**. This enables powerful workflows for code preprocessing, environment setup, and test scenario preparation.

## Overview

Pre-execution hooks are executed in the following order:

1. **Workspace Setup** - Repository is cloned to isolated workspace
2. **Pre-Execution Hooks** ← *Run here*
3. **Agent Execution** - Agent modifies code
4. **Evaluators** - Evaluate agent's changes
5. **Post-Evaluation** - Export/process results

## Use Cases

### Environment Variable Injection
Inject API keys, secrets, or configuration before agent execution:

```yaml
pre_execution:
  - name: script
    config:
      command: bash
      args:
        - "-c"
        - |
          cat > ${WORKSPACE_DIR}/.env << 'EOF'
          API_KEY=${API_KEY}
          DATABASE_URL=${DATABASE_URL}
          EOF
      env:
        API_KEY: "test-key-12345"
        DATABASE_URL: "postgresql://localhost:5432/test"
```

### Search and Replace
Replace placeholders or tokens in source code:

```yaml
pre_execution:
  - name: script
    config:
      command: bash
      args:
        - "-c"
        - |
          find ${WORKSPACE_DIR} -name "*.js" -type f \
            -exec sed -i 's/PLACEHOLDER_API_KEY/actual-key-123/g' {} +
```

### Code Generation
Generate boilerplate, types, or interfaces:

```yaml
pre_execution:
  - name: script
    config:
      command: npm
      args:
        - "run"
        - "codegen"
      working_dir: ${WORKSPACE_DIR}
      timeout_ms: 60000
```

### File Setup
Copy configuration files or create directory structures:

```yaml
pre_execution:
  - name: script
    config:
      command: bash
      args:
        - "-c"
        - |
          mkdir -p ${WORKSPACE_DIR}/config
          cp ./test-fixtures/config.json ${WORKSPACE_DIR}/config/
          cp ./test-fixtures/secrets.yaml ${WORKSPACE_DIR}/config/
```

### Mock Data Setup
Create test data or initialize databases:

```yaml
pre_execution:
  - name: script
    config:
      command: ./scripts/seed-test-data.sh
      args:
        - "${WORKSPACE_DIR}"
      env:
        DB_NAME: "test_db"
        SEED_COUNT: "100"
      timeout_ms: 30000
```

## Configuration

### Basic Structure

```yaml
pre_execution:
  - name: script
    config:
      command: string           # Command to execute
      args: string[]            # Optional command arguments
      env: object               # Optional environment variables
      working_dir: string       # Optional working directory
      timeout_ms: number        # Optional timeout (default: 30000ms)
```

### Available Environment Variables

Pre-execution scripts automatically receive these environment variables:

- `WORKSPACE_DIR`: Path to workspace where agent will work
- `REPO_DIR`: Path to repository (same as WORKSPACE_DIR)
- `ARTIFACTS_DIR`: Path to artifacts directory
- `TEST_CASE_NAME`: Name of the test case
- `REPO_URL`: Repository URL being tested
- `BRANCH`: Branch being tested

### Variable Substitution

Use `${VARIABLE}` syntax in `args` to substitute environment variables:

```yaml
pre_execution:
  - name: script
    config:
      command: echo
      args:
        - "Workspace: ${WORKSPACE_DIR}"
        - "Test: ${TEST_CASE_NAME}"
```

## Error Handling

### Failed Pre-Execution
If a pre-execution script fails (non-zero exit code), the entire evaluation fails and the agent is **not executed**. This prevents the agent from working in an incorrectly configured environment.

```yaml
# This will fail the evaluation if setup fails
pre_execution:
  - name: script
    config:
      command: ./critical-setup.sh
```

### Timeouts
Scripts have a default timeout of 30 seconds. Increase for longer operations:

```yaml
pre_execution:
  - name: script
    config:
      command: npm install
      working_dir: ${WORKSPACE_DIR}
      timeout_ms: 120000  # 2 minutes
```

## Security Considerations

### Trusted Sources Only
Pre-execution scripts run with shell access (`shell: true`) to support shell features like pipes, redirects, and command chaining. **Commands must ONLY come from trusted configuration files, NEVER from untrusted user input.**

youBencha security model:
- Configuration files are from your repository or trusted sources
- Commands are defined in version-controlled YAML/JSON files
- Scripts cannot be injected from external/untrusted sources

**Never** accept pre-execution commands from:
- User input (web forms, API requests, etc.)
- Untrusted external sources
- Dynamically generated content from untrusted sources

### Environment Variable Security
Pre-execution scripts receive a **controlled set** of environment variables, not the entire `process.env`:

**Automatically provided (safe):**
- `WORKSPACE_DIR`, `REPO_DIR`, `ARTIFACTS_DIR`
- `TEST_CASE_NAME`, `REPO_URL`, `BRANCH`
- `PATH`, `HOME`, `USER` (system variables)

**User-provided variables:**
- Only variables explicitly defined in `env:` config
- Use environment variable references (e.g., `${API_KEY}`) to avoid hardcoding secrets

```yaml
# Good: Reference from environment
pre_execution:
  - name: script
    config:
      command: ./setup.sh
      env:
        API_KEY: "${API_KEY}"  # Reads from process.env.API_KEY

# Bad: Hardcoded secret
pre_execution:
  - name: script
    config:
      command: ./setup.sh
      env:
        API_KEY: "hardcoded-secret-123"  # Don't do this!
```

## Examples

### Complete Example: Authentication Setup

```yaml
name: "Add authentication with pre-configured environment"
description: "Test authentication implementation with pre-injected config"

repo: https://github.com/example/api-server.git
branch: main

# Pre-execution: Setup environment and config files
pre_execution:
  - name: script
    config:
      command: bash
      args:
        - "-c"
        - |
          # Create config directory
          mkdir -p ${WORKSPACE_DIR}/config
          
          # Generate JWT secret
          JWT_SECRET=$(openssl rand -base64 32)
          
          # Create auth config
          cat > ${WORKSPACE_DIR}/config/auth.json << EOF
          {
            "jwtSecret": "$JWT_SECRET",
            "tokenExpiry": "1h",
            "issuer": "youbencha-test"
          }
          EOF
          
          echo "Configuration created successfully"
      timeout_ms: 10000

# Agent: Implement authentication using the config
agent:
  type: copilot-cli
  config:
    prompt: |
      Add JWT authentication middleware that:
      1. Reads config from config/auth.json
      2. Validates JWT tokens
      3. Returns 401 for invalid tokens

evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        reads_config: "Middleware reads from config/auth.json"
        validates_tokens: "Middleware validates JWT tokens"
```

### Multiple Pre-Execution Steps

Pre-execution hooks run **in sequence** (not parallel):

```yaml
pre_execution:
  # Step 1: Install dependencies
  - name: script
    config:
      command: npm install
      working_dir: ${WORKSPACE_DIR}
      timeout_ms: 120000

  # Step 2: Generate code
  - name: script
    config:
      command: npm run codegen
      working_dir: ${WORKSPACE_DIR}
      timeout_ms: 60000

  # Step 3: Setup environment
  - name: script
    config:
      command: ./scripts/setup-env.sh
      args:
        - "${WORKSPACE_DIR}"
      env:
        ENV: "test"
```

### Workspace Isolation
All pre-execution hooks run in an isolated workspace directory:
- Cannot access your main repository working directory
- Cannot access other users' workspaces  
- Cannot access system directories outside the workspace
- All file operations are scoped to the workspace

This isolation protects your system even if a pre-execution script is compromised.

## Comparison with Post-Evaluation

| Feature | Pre-Execution | Post-Evaluation |
|---------|--------------|-----------------|
| **When** | Before agent execution | After evaluation completes |
| **Purpose** | Setup, preprocessing | Results export, analysis |
| **Failure Impact** | Stops agent execution | Does not fail evaluation |
| **Execution** | Sequential (ordered) | Parallel (unordered) |
| **Use Cases** | Environment setup, code generation | Webhooks, reports, exports |

## Best Practices

1. **Keep Scripts Fast**: Pre-execution delays agent execution. Keep scripts under 30 seconds when possible.

2. **Fail Fast**: If a pre-execution is critical, let it fail quickly rather than timeout.

3. **Use Working Directory**: Set `working_dir` to `${WORKSPACE_DIR}` to ensure scripts run in the correct location.

4. **Log Output**: Use `echo` statements to provide visibility into what pre-execution is doing.

5. **Test Scripts Independently**: Test your pre-execution scripts outside youBencha first to ensure they work correctly.

6. **Document Requirements**: Comment your scripts to explain what they do and why they're needed.

## Troubleshooting

### Script Not Found
```
Error: Pre-execution failed: command not found
```
- Ensure the script path is correct relative to where you run `yb`
- Check that the script has execute permissions (`chmod +x`)
- Use absolute paths or `${WORKSPACE_DIR}` relative paths

### Timeout Errors
```
Error: Script timed out after 30000ms
```
- Increase `timeout_ms` for longer operations
- Check if script is waiting for input (use non-interactive mode)
- Add logging to identify where script hangs

### Environment Variables Not Substituted
```
Error: No such file or directory: ${WORKSPACE_DIR}/file.txt
```
- Use `${VARIABLE}` syntax in `args` array, not in `command`
- Ensure variable is available in the pre-execution context

## See Also

- [Post-Evaluation Guide](./post-evaluation.md)
- [Example Scripts](../examples/scripts/)
- [Test Case Configuration](./test-case-configuration.md)
