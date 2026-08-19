export const STARTER_TESTCASE = `# youBencha Test Case Configuration
# Learn more: https://github.com/youbencha/youbencha-cli

# Test case metadata
name: "Welcome Message Addition"
description: "Tests the agent's ability to add a friendly welcome message to the README file"

# Repository to evaluate
repo: https://github.com/youbencha/hello-world.git
branch: main

# Optional: Compare against a reference implementation
# expected_source: branch
# expected: feature/completed-implementation

# Agent configuration
agent:
  type: copilot-cli  # Supported: copilot-cli, claude-code, or codex-cli
  config:
    prompt: |
      Add a friendly welcome message to the README file.
      Keep it short and welcoming.

# Evaluators - how to measure quality
evaluators:
  # Measures scope: files changed, lines added/removed
  - name: git-diff
  
  # Optional: Compares output to reference implementation
  # - name: expected-diff
  #   config:
  #     threshold: 0.85  # 85% similarity required to pass
  
  # Uses AI to evaluate quality based on your assertions
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      
      # Define success assertions (keys become metric names)
      assertions:
        readme_modified: "The README.md file was modified. Score 1 if true, 0 if false."
        message_is_friendly: "A friendly welcome message was added. Score 1 if friendly and clear, 0.5 if present but unclear, 0 if absent."
        no_markdown_errors: "The markdown is valid with no syntax errors. Score 1 if valid, 0 if broken."

# Next steps:
# 1. Update the repo and prompt for your use case
# 2. Customize the evaluation assertions
# 3. Run: yb run -c testcase.yaml
# 4. View results: yb report --from .youbencha-workspace/run-*/artifacts/results.json
`;

export const MINIMAL_EVAL = `# Minimal offline youBencha Evaluation
# Evaluates uncommitted changes in the current Git working tree. It does not
# clone a repository, run an agent, use an AI judge, or require a paid model.
name: "Current Working Tree"
description: "Objective Git diff checks for the current repository"
directory: "."
evaluators:
  - name: git-diff
    config:
      assertions:
        max_files_changed: 10
        max_total_changes: 500

# Next steps:
# 1. Make an uncommitted change in this Git repository
# 2. Run: yb doctor
# 3. Run: yb eval -c eval.yaml
`;
