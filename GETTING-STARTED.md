# Getting Started with youBencha

youBencha helps you evaluate AI coding agents objectively. This guide will get you running your first evaluation in under 5 minutes.

## What You'll Need

- **Node.js 20+** - Check with `node --version`
- **Git** - Check with `git --version`
- **An AI coding agent** - Currently GitHub Copilot CLI is supported
  - Install: `npm install -g @githubnext/github-copilot-cli`
  - Verify: `copilot --version`

## Quick Start (3 steps)

### 1. Install youBencha

```bash
npm install -g youbencha
```

### 2. Create a simple evaluation

Create a file called `my-first-suite.yaml`:

```yaml
repo: https://github.com/octocat/Hello-World.git
branch: master

agent:
  type: copilot-cli
  config:
    prompt: "Add a comment explaining what this repo is about"

evaluators:
  - name: git-diff           # Measures what changed
  - name: agentic-judge      # Evaluates quality
    config:
      type: copilot-cli
      agent_name: agentic-judge
      criteria:
        file_was_modified: "README.md was modified"
        comment_is_helpful: "A helpful comment was added"
```

### 3. Run it!

```bash
yb run -c my-first-suite.yaml
```

You'll see:
1. youBencha clones the repository
2. The agent makes changes based on your prompt
3. Evaluators analyze the output
4. Results are saved to `.youbencha-workspace/`

### 4. View the report

```bash
yb report --from .youbencha-workspace/run-*/artifacts/results.json
```

## Understanding the Output

youBencha creates a workspace with:

```
.youbencha-workspace/
└── run-abc123/              # Unique ID for this run
    ├── src-modified/         # What the agent changed
    ├── artifacts/
    │   ├── results.json      # Machine-readable results
    │   ├── report.md         # Human-readable report
    │   └── agent-log.json    # Full agent execution log
    └── .youbencha.lock       # Workspace metadata
```

## What Each Part Does

### Suite Configuration (`suite.yaml`)

```yaml
repo: <git-url>               # Where to get the code
branch: <branch-name>         # Which branch to test

agent:                        # What agent to use
  type: copilot-cli
  config:
    prompt: "Your task..."    # What to ask the agent

evaluators:                   # How to measure success
  - name: git-diff            # Built-in: measures scope
  - name: agentic-judge       # Built-in: evaluates quality
    config:
      criteria:
        metric_name: "What to check..."
```

### Evaluators Explained

**git-diff** - Objective measurements:
- How many files changed?
- How many lines added/removed?
- Change distribution across files

**agentic-judge** - Subjective quality assessment:
- Uses AI to evaluate based on your criteria
- Each criterion becomes a metric in the report
- Useful for checking: code quality, test coverage, documentation

### Comparing to a Reference (Optional)

Want to compare the agent's output to a known-good version?

```yaml
repo: https://github.com/your/repo.git
branch: main                  # Start from main
expected_source: branch       # Compare to another branch
expected: feature/completed   # The "ideal" implementation

evaluators:
  - name: expected-diff       # Measures similarity
    config:
      threshold: 0.85         # Must be 85% similar to pass
```

## Common Tasks

### Workspace cleanup

By default, youBencha keeps the workspace after evaluation so you can inspect what the agent did.

To clean up the workspace after completion:

```bash
yb run -c suite.yaml --delete-workspace
```

### Testing locally

Use a local directory instead of a GitHub repo:

```yaml
repo: file:///path/to/local/repo
```

### Multiple evaluators

Stack as many as you want:

```yaml
evaluators:
  - name: git-diff
  - name: expected-diff
    config:
      threshold: 0.90
  - name: agentic-judge
    config:
      criteria:
        has_tests: "Unit tests were added"
        has_docs: "Documentation was updated"
```

## Tips for Success

### 1. Start Simple
Begin with just `git-diff` and `agentic-judge`. Add more evaluators as you learn.

### 2. Make Criteria Specific
❌ Bad: `"Code is good"`
✅ Good: `"All functions have error handling. Score 1 if complete, 0.5 if partial, 0 if missing"`

### 3. Use Descriptive Metric Names
Keys in `criteria:` become metric names in reports. Use `snake_case` for consistency:
- ✅ `readme_modified`
- ✅ `error_handling_complete`
- ❌ `test1`

### 4. Test Your Prompts
The agent's output quality depends heavily on your prompt. Test and iterate!

### 5. Check Examples
Look at `examples/` directory for working configurations:
- `simple-suite.yaml` - Minimal configuration
- `basic-suite.yaml` - Standard setup
- `expected-ref-suite.yaml` - With reference comparison

## Troubleshooting

### "Agent not found"
Install the agent first:
```bash
npm install -g @githubnext/github-copilot-cli
```

### "Configuration validation failed"
Common YAML issues:
- Use spaces, not tabs for indentation
- Check quote matching
- Validate at https://yaml-online-parser.appspot.com

### "Permission denied"
Run from a directory where you have write permissions, or use:
```bash
sudo npm install -g youbencha
```

### Need Help?
- Check the [README](../README.md) for full documentation
- Review [examples/](../examples/) for working configurations
- File an issue at https://github.com/youbencha/youbencha-cli/issues

## Next Steps

Now that you've run your first evaluation:

1. **Try with your own code** - Point to your repository
2. **Add more criteria** - Define what quality means for your project
3. **Use reference comparisons** - Compare against known-good implementations
4. **Automate in CI** - Run evaluations on every commit

### Advanced: Generate Suites Automatically

Have a successful agent output already? Let youBencha suggest an evaluation suite:

```bash
yb suggest-suite --agent copilot-cli --output-dir ./my-agent-output
```

The agent will interactively help you create a comprehensive evaluation suite based on what changed.

---

**Ready to evaluate?** Run `yb --help` to see all available commands!
