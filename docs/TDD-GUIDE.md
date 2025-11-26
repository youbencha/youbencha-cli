# Test-Driven Development for AI Agents

A comprehensive guide to applying TDD principles for building, validating, and improving AI coding agents using youBencha.

## Table of Contents

1. [Introduction: A New Paradigm](#introduction-a-new-paradigm)
2. [The Mindset Shift](#the-mindset-shift)
3. [The TDD Cycle for Agents](#the-tdd-cycle-for-agents)
4. [Getting Started](#getting-started)
5. [Writing Effective Assertions](#writing-effective-assertions)
6. [Iterating to Success](#iterating-to-success)
7. [Testing Across Different Contexts](#testing-across-different-contexts)
8. [Regression Testing](#regression-testing)
9. [CI/CD Integration](#cicd-integration)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)
12. [Real-World Examples](#real-world-examples)

---

## Introduction: A New Paradigm

Traditional Test-Driven Development (TDD) revolutionized how we write software. The simple cycle of **Red → Green → Refactor** gave developers confidence that their code works correctly and continues to work as they make changes.

But here's the twist: **AI coding agents are not code**. They are tools that *produce* code. This fundamental difference requires us to rethink what we're testing and how we measure success.

### Traditional TDD vs Agent TDD

| Traditional TDD | Agent TDD |
|-----------------|-----------|
| Tests validate **code behavior** | Tests validate **agent behavior** |
| Assertions check function outputs | Assertions check code quality & task completion |
| Deterministic: same input → same output | Non-deterministic: same prompt → varied outputs |
| Tests run in milliseconds | Evaluations run in seconds to minutes |
| You write the code being tested | The agent writes the code being evaluated |

**youBencha bridges this gap** by providing a framework to apply TDD-like discipline to agent development, giving you reproducible evaluations and objective metrics.

---

## The Mindset Shift

> **The biggest challenge for developers is getting out of the mindset of evaluating code. youBencha helps you evaluate the agent's ability to produce code and perform tasks.**

### What You're Really Testing

When you use youBencha, you're not testing *the code the agent produces*—you're testing:

1. **Task Completion**: Did the agent understand and complete the task?
2. **Quality**: Does the produced code meet quality standards?
3. **Consistency**: Does the agent perform reliably across similar tasks?
4. **Context Awareness**: Does the agent use repository context appropriately?
5. **Instruction Following**: Did the agent follow your specific instructions?

### The "Vibes-Based" Problem

Before youBencha, evaluating AI agents relied on subjective assessment:

- "That looks good" ❌
- "The code seems to work" ❌
- "I think it did what I asked" ❌

These "vibes-based" evaluations don't scale, aren't reproducible, and can't catch regressions.

### The TDD Solution

With youBencha, you get objective, reproducible evaluation:

- "README.md was modified with a greeting" ✅
- "All functions have JSDoc comments (score: 0.85)" ✅
- "Output is 92% similar to expected reference" ✅

---

## The TDD Cycle for Agents

The classic TDD cycle is **Red → Green → Refactor**. For agents, this becomes:

```
┌─────────────────────────────────────────────────────────────┐
│                    TDD for Agents Cycle                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────┐     ┌─────────┐     ┌───────────────────┐     │
│   │  RED    │────▶│  GREEN  │────▶│  IMPROVE CONTEXT  │     │
│   └─────────┘     └─────────┘     └───────────────────┘     │
│       │                                     │               │
│       │                                     │               │
│       └─────────────────────────────────────┘               │
│                                                              │
│   RED: Define assertions, run agent (expect failure)        │
│   GREEN: Improve prompt/instructions until assertions pass  │
│   IMPROVE: Refine agent context, tools, and instructions    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Phase 1: RED (Define Expectations)

Before running your agent, define what success looks like:

```yaml
# testcase.yaml
name: "Add Authentication Middleware"
description: "Agent should add JWT authentication to Express endpoints"

evaluators:
  - name: agentic-judge
    config:
      type: copilot-cli
      assertions:
        middleware_added: "An authentication middleware file exists. Score 1 if true, 0 if false."
        endpoints_protected: "Protected routes check for valid JWT tokens. Score 1 if all protected, 0.5 if partial, 0 if none."
        error_handling: "Invalid tokens return 401 Unauthorized. Score 1 if true, 0 if false."
```

**Key Insight**: Write your assertions *before* running the agent. This forces you to clearly define success criteria.

### Phase 2: GREEN (Make It Pass)

Now run the agent and see what happens:

```bash
yb run -c testcase.yaml
```

If the agent fails (and it likely will on first try):

1. **Improve the prompt**: Be more specific about what you want
2. **Add context**: Provide relevant files or documentation
3. **Give examples**: Show what good output looks like
4. **Constrain scope**: Focus on one task at a time

Iterate until assertions pass.

### Phase 3: IMPROVE (Refine and Expand)

Once passing:

1. **Add more assertions**: Cover edge cases
2. **Test on different codebases**: Verify generalization
3. **Tighten thresholds**: Increase quality standards
4. **Document learnings**: What prompts work best?

---

## Getting Started

### Step 1: Install youBencha

```bash
npm install -g youbencha
```

### Step 2: Find Your First Test Case

Start with something simple and concrete. Good first test cases:

- ✅ "Add a comment to the README"
- ✅ "Fix a typo in documentation"
- ✅ "Add JSDoc to a function"

Bad first test cases:

- ❌ "Refactor the entire codebase"
- ❌ "Add authentication and authorization"
- ❌ "Make the code better"

### Step 3: Create Your Test Case Configuration

```yaml
# my-first-test.yaml
name: "Add README Comment"
description: "Agent should add a helpful comment to the README explaining the project"

repo: https://github.com/octocat/Hello-World.git
branch: master

agent:
  type: copilot-cli
  config:
    prompt: "Add a comment at the top of README.md explaining that this is a test repository for learning Git"

evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      assertions:
        readme_modified: "README.md was modified. Score 1 if true, 0 if false."
        has_comment: "A comment was added (HTML comment or Markdown comment). Score 1 if true, 0 if false."
```

### Step 4: Run and Observe

```bash
yb run -c my-first-test.yaml
```

Watch the output:
- Did the agent complete the task?
- Which assertions passed?
- Which failed?

### Step 5: Iterate

If assertions fail, improve your approach:

```yaml
agent:
  config:
    prompt: |
      Add an HTML comment at the very beginning of README.md with this exact text:
      <!-- This is a test repository used for learning Git basics and experimenting with GitHub features -->
```

Run again:

```bash
yb run -c my-first-test.yaml
```

---

## Writing Effective Assertions

Assertions are the heart of agent TDD. They define what "success" means.

### Anatomy of a Good Assertion

```yaml
assertions:
  assertion_key: "Clear description of what to check. Score 1 if condition met, 0.5 if partial, 0 if not met."
```

**Components:**
1. **Key**: `snake_case` name that appears in reports
2. **Description**: What the evaluator should check
3. **Scoring guidance**: How to quantify the result

### Assertion Patterns

#### Binary Assertions (Yes/No)

```yaml
assertions:
  file_created: "A new file named auth.ts exists. Score 1 if true, 0 if false."
  import_added: "lodash is imported. Score 1 if true, 0 if false."
  tests_pass: "All tests pass when running npm test. Score 1 if true, 0 if false."
```

#### Graded Assertions (Partial Credit)

```yaml
assertions:
  documentation_quality: |
    Functions have documentation:
    - Score 1.0 if all public functions have JSDoc with @param and @returns
    - Score 0.7 if all public functions have JSDoc but missing some annotations
    - Score 0.4 if some functions have documentation
    - Score 0.0 if no documentation added
```

#### Quantitative Assertions

```yaml
assertions:
  test_coverage: "Test coverage meets requirements. Score 1 if >= 80%, 0.5 if >= 60%, 0 if < 60%."
  code_length: "Code is concise. Score 1 if < 100 lines added, 0.5 if < 200 lines, 0 if >= 200 lines."
```

### Common Assertion Categories

#### 1. Task Completion

```yaml
task_completed: "The requested feature was implemented. Score 1 if fully complete, 0.5 if partial, 0 if not attempted."
```

#### 2. Code Quality

```yaml
error_handling: "All new functions have try-catch blocks or explicit error handling. Score 1 if complete, 0 if missing."
no_code_smells: "No obvious code smells (magic numbers, deep nesting, huge functions). Score 1 if clean, 0 if smelly."
```

#### 3. Best Practices

```yaml
follows_style_guide: "Code follows the existing style conventions in the repository. Score 1 if consistent, 0 if inconsistent."
uses_existing_patterns: "New code reuses existing utilities and patterns rather than reinventing. Score 1 if reuses, 0 if duplicates."
```

#### 4. Testing

```yaml
tests_added: "Unit tests were added for new functionality. Score 1 if comprehensive, 0.5 if basic, 0 if none."
tests_pass: "All existing and new tests pass. Score 1 if all pass, 0 if any fail."
```

#### 5. Documentation

```yaml
readme_updated: "README was updated to reflect changes. Score 1 if updated, 0 if not."
inline_comments: "Complex logic has explanatory comments. Score 1 if well-documented, 0 if unclear."
```

### Anti-Patterns

❌ **Too vague:**
```yaml
good_code: "The code is good."  # What does "good" mean?
```

✅ **Specific:**
```yaml
good_code: "Functions are under 30 lines, have single responsibility, and have type annotations. Score 1 if all criteria met, 0.5 if 2/3 met, 0 if fewer."
```

❌ **Unmeasurable:**
```yaml
readable: "Code is readable."  # Subjective
```

✅ **Measurable:**
```yaml
readable: "Variables have descriptive names (not single letters except loop indices). Score 1 if all descriptive, 0 if has unclear names."
```

---

## Iterating to Success

### The Iteration Loop

```
┌─────────────────────────────────────────────────────────────┐
│                      Iteration Loop                          │
└─────────────────────────────────────────────────────────────┘

1. RUN: yb run -c testcase.yaml
         │
         ▼
2. ANALYZE: Check results.json
         │
         ├─── All pass? ──────▶ Done! Add more assertions
         │
         └─── Some fail? ─────▶ Continue to step 3
         
3. DIAGNOSE: Why did it fail?
         │
         ├─── Agent misunderstood? ──▶ Clarify prompt
         ├─── Missing context? ──────▶ Add context/examples
         ├─── Wrong approach? ───────▶ Constrain/guide
         └─── Assertion too strict? ─▶ Adjust expectations

4. ADJUST: Modify testcase.yaml

5. REPEAT: Go to step 1
```

### Example Iteration

**Iteration 1: First attempt**

```yaml
agent:
  config:
    prompt: "Add input validation"
```

Result: ❌ Agent added validation to wrong file

**Iteration 2: Be specific about where**

```yaml
agent:
  config:
    prompt: "Add input validation to src/api/users.ts"
```

Result: ❌ Agent added validation but wrong style

**Iteration 3: Specify validation library**

```yaml
agent:
  config:
    prompt: "Add input validation to src/api/users.ts using Joi library"
```

Result: ⚠️ Partial - validation works but error messages are generic

**Iteration 4: Full specification**

```yaml
agent:
  config:
    prompt: |
      Add input validation to src/api/users.ts:
      - Use Joi library for schema validation
      - Validate POST /users request body (name: string required, email: valid email required)
      - Return 400 Bad Request with detailed error message for validation failures
      - Follow the existing error handling pattern in src/api/errors.ts
```

Result: ✅ All assertions pass!

### What to Adjust

| Symptom | Adjustment |
|---------|------------|
| Agent doesn't understand the task | Clarify prompt with examples |
| Agent uses wrong patterns | Reference existing code in prompt |
| Agent makes unrelated changes | Constrain scope explicitly |
| Agent output is inconsistent | Add more specific instructions |
| Agent misses edge cases | List expected behaviors explicitly |

---

## Testing Across Different Contexts

True agent quality means performing well across varied scenarios. youBencha supports testing across:

### Different Repositories

```yaml
# Test your agent instructions work on multiple repos
# testcase-repo-a.yaml
repo: https://github.com/example/project-a.git
# ... same agent and evaluators

# testcase-repo-b.yaml
repo: https://github.com/example/project-b.git
# ... same agent and evaluators
```

Run both and compare:

```bash
yb run -c testcase-repo-a.yaml
yb run -c testcase-repo-b.yaml
```

### Different Branches

```yaml
# Test against different states of the same repo
# testcase-main.yaml
repo: https://github.com/example/project.git
branch: main

# testcase-develop.yaml
repo: https://github.com/example/project.git
branch: develop

# testcase-legacy.yaml
repo: https://github.com/example/project.git
branch: legacy-v1
```

### Specific Commits

```yaml
# Pin to exact commit for reproducibility
repo: https://github.com/example/project.git
branch: main
commit: abc123def456
```

### Expected Reference Comparison

Compare agent output to a "gold standard":

```yaml
name: "Feature Implementation vs Reference"
description: "Compare agent's implementation against known-good reference"

repo: https://github.com/example/project.git
branch: main
expected_source: branch
expected: feature/reference-implementation

agent:
  type: copilot-cli
  config:
    prompt: "Implement the user profile feature as described in docs/spec.md"

evaluators:
  - name: expected-diff
    config:
      threshold: 0.80  # Must be 80% similar to reference
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      assertions:
        matches_spec: "Implementation matches the specification in docs/spec.md. Score 1 if fully matches, 0.5 if mostly, 0 if doesn't match."
```

### Multi-Context Test Suite

Create a suite of tests that validate agent behavior across contexts:

```
tests/
├── contexts/
│   ├── small-repo.yaml      # Test on small project
│   ├── large-repo.yaml      # Test on enterprise project
│   ├── typescript-repo.yaml # Test on TypeScript project
│   └── python-repo.yaml     # Test on Python project (if multi-lang agent)
└── run-all.sh
```

```bash
#!/bin/bash
# run-all.sh
for config in tests/contexts/*.yaml; do
    echo "Running: $config"
    yb run -c "$config"
done

# Aggregate results
echo "Generating combined report..."
yb report --from ".youbencha-workspace/run-*/artifacts/results.json"
```

---

## Regression Testing

A core TDD principle: **tests protect against regressions**. When you change your agent's prompts, instructions, or configuration, you need to ensure previous capabilities still work.

### Setting Up Baseline

1. **Create comprehensive test cases** that cover key scenarios:

```
regression-suite/
├── add-comment.yaml
├── fix-typo.yaml
├── add-test.yaml
├── refactor-function.yaml
└── add-documentation.yaml
```

2. **Run and establish passing baseline**:

```bash
for config in regression-suite/*.yaml; do
    yb run -c "$config"
done
```

3. **Store results as reference**:

```bash
cp -r .youbencha-workspace/run-*/ regression-baseline/
```

### Running Regression Checks

After modifying agent configuration:

```bash
# Run suite again
for config in regression-suite/*.yaml; do
    yb run -c "$config"
done

# Compare to baseline
./scripts/compare-results.sh
```

### Detecting Regressions

Example comparison script:

```bash
#!/bin/bash
# compare-results.sh

echo "Comparing current results to baseline..."

for baseline in regression-baseline/run-*/artifacts/results.json; do
    test_name=$(basename $(dirname $(dirname $baseline)))
    current=".youbencha-workspace/$test_name/artifacts/results.json"
    
    baseline_status=$(jq -r '.summary.overall_status' "$baseline")
    current_status=$(jq -r '.summary.overall_status' "$current")
    
    if [ "$baseline_status" = "passed" ] && [ "$current_status" != "passed" ]; then
        echo "❌ REGRESSION: $test_name (was passing, now failing)"
    elif [ "$baseline_status" != "passed" ] && [ "$current_status" = "passed" ]; then
        echo "✅ IMPROVEMENT: $test_name (was failing, now passing)"
    fi
done
```

### Using Expected Reference for Regression

```yaml
# Use a previous successful run as reference
name: "Add Auth Feature (Regression Check)"
description: "Ensure agent still produces similar output to baseline"

repo: https://github.com/example/project.git
branch: main
expected_source: path
expected: ./regression-baseline/add-auth/src-modified

evaluators:
  - name: expected-diff
    config:
      threshold: 0.90  # High threshold for regression testing
```

---

## CI/CD Integration

Integrate youBencha into your CI/CD pipeline to catch agent regressions automatically.

### GitHub Actions Example

```yaml
# .github/workflows/agent-evaluation.yml
name: Agent Evaluation

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight

jobs:
  evaluate:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install youBencha
        run: npm install -g youbencha
      
      - name: Install Agent CLI
        run: npm install -g @githubnext/github-copilot-cli
      
      - name: Run Evaluation Suite
        run: |
          for config in tests/agent/*.yaml; do
            echo "Evaluating: $config"
            yb run -c "$config" --delete-workspace
          done
      
      - name: Check Results
        run: |
          failed=0
          for result in .youbencha-workspace/run-*/artifacts/results.json; do
            status=$(jq -r '.summary.overall_status' "$result")
            if [ "$status" != "passed" ]; then
              echo "❌ Failed: $result"
              failed=1
            fi
          done
          exit $failed
      
      - name: Generate Report
        if: always()
        run: yb report --from .youbencha-workspace/run-*/artifacts/results.json --output agent-report.md
      
      - name: Upload Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: agent-evaluation-report
          path: agent-report.md
```

### Slack/Teams Notification

Use post-evaluation hooks:

```yaml
# testcase.yaml
post_evaluation:
  - name: webhook
    config:
      url: ${SLACK_WEBHOOK_URL}
      method: POST
      headers:
        Content-Type: "application/json"
      template: |
        {
          "text": "Agent Evaluation: ${overall_status}",
          "attachments": [
            {
              "color": "${status_color}",
              "fields": [
                {"title": "Passed", "value": "${passed_count}", "short": true},
                {"title": "Failed", "value": "${failed_count}", "short": true}
              ]
            }
          ]
        }
```

### Tracking Results Over Time

Use the database post-evaluator to build trend data:

```yaml
post_evaluation:
  - name: database
    config:
      type: json-file
      output_path: ./agent-history.jsonl
      append: true
```

Then analyze trends:

```bash
# Count passes over time
cat agent-history.jsonl | jq -r '.summary.overall_status' | sort | uniq -c

# Average evaluation duration
cat agent-history.jsonl | jq -r '.execution.duration_ms' | awk '{sum+=$1; count++} END {print sum/count}'
```

---

## Best Practices

### 1. Start Small, Grow Gradually

```
Week 1: 1 simple test case, 2-3 assertions
Week 2: 2-3 test cases, refine assertions
Week 3: Add expected reference comparison
Week 4: Set up CI/CD pipeline
```

### 2. Be Explicit in Prompts

❌ Bad: "Improve the code"
✅ Good: "Add error handling to the fetchUser function in src/api/users.ts. Use try-catch and return null on error."

### 3. Use Graded Assertions

Allow partial credit to track improvement:

```yaml
assertions:
  implementation_quality: |
    Score based on completeness:
    - 1.0: Full implementation with tests and docs
    - 0.8: Full implementation with tests
    - 0.6: Full implementation without tests
    - 0.4: Partial implementation
    - 0.0: Not implemented
```

### 4. Test for Negative Behaviors Too

```yaml
assertions:
  no_breaking_changes: "Existing tests still pass. Score 1 if all pass, 0 if any fail."
  no_unrelated_changes: "Only relevant files were modified. Score 1 if focused, 0 if scattered changes."
  no_secrets_leaked: "No API keys, passwords, or secrets in code. Score 1 if safe, 0 if secrets present."
```

### 5. Document Your Learnings

Keep notes on what works:

```markdown
# Agent Prompt Engineering Notes

## What Works
- Explicit file paths get better results than "find the right file"
- Referencing existing patterns ("follow the style in utils.ts") improves consistency
- Step-by-step instructions work better than single complex prompts

## What Doesn't Work
- Vague instructions like "make it better"
- Multiple unrelated tasks in one prompt
- Assuming the agent knows your conventions
```

### 6. Version Control Your Test Cases

Treat test cases like code:

```bash
git add testcase.yaml
git commit -m "Add validation for auth middleware implementation"
```

### 7. Review Agent Output Manually Sometimes

Automation is great, but periodically review what the agent actually produced:

```bash
# After running evaluation
cd .youbencha-workspace/run-*/src-modified
code .  # Open in VS Code
```

---

## Troubleshooting

### Agent Doesn't Complete Task

**Symptoms:**
- Agent output is empty or minimal
- Agent says "I don't understand"

**Solutions:**
1. Simplify the prompt
2. Provide more context (include relevant files)
3. Break into smaller sub-tasks
4. Add examples of expected output

### Inconsistent Results

**Symptoms:**
- Same test case passes sometimes, fails others
- Metrics vary widely between runs

**Solutions:**
1. Make assertions more tolerant (use ranges)
2. Add more specific instructions
3. Use expected reference with lower threshold
4. Run multiple times and average results

### Assertions Always Pass (Too Lenient)

**Symptoms:**
- Everything passes but output quality is poor
- No regressions detected despite changes

**Solutions:**
1. Tighten assertion criteria
2. Add more specific assertions
3. Raise expected-diff threshold
4. Add quantitative metrics (git-diff assertions)

### Assertions Always Fail (Too Strict)

**Symptoms:**
- Good output still fails assertions
- Minor variations cause failures

**Solutions:**
1. Loosen assertion criteria
2. Use graded scoring instead of binary
3. Lower expected-diff threshold
4. Focus on essential criteria, not stylistic

### Long Evaluation Times

**Symptoms:**
- Evaluations take too long
- CI timeouts

**Solutions:**
1. Reduce assertion count per test case
2. Split into multiple smaller test cases
3. Use `yb eval` for evaluator development - it runs evaluators on existing directories without executing an agent, making it much faster for testing evaluator configurations (see [Run vs Eval Commands](./run-vs-eval.md))
4. Cache repository clones

---

## Real-World Examples

### Example 1: Documentation Quality Gate

**Goal:** Ensure agent-generated code has proper documentation

```yaml
# testcase-documentation.yaml
name: "API Endpoint Documentation"
description: "Agent should add comprehensive documentation to API endpoints"

repo: https://github.com/your-org/api-server.git
branch: main

agent:
  type: copilot-cli
  config:
    prompt: |
      Add JSDoc documentation to all exported functions in src/api/.
      Include:
      - @description explaining what the function does
      - @param for each parameter with type and description
      - @returns describing the return value
      - @throws for any errors that can be thrown
      - @example with usage example

evaluators:
  - name: git-diff
    config:
      assertions:
        max_files_changed: 10
        max_lines_added: 500
  
  - name: agentic-judge
    config:
      type: copilot-cli
      assertions:
        all_exports_documented: |
          Every exported function has JSDoc.
          Score 1 if all documented, 0.5 if > 80%, 0 if <= 80%.
        
        description_present: |
          Every JSDoc has @description or a description line.
          Score 1 if all have descriptions, 0 if any missing.
        
        params_documented: |
          All @param annotations include type and description.
          Score 1 if complete, 0.5 if has @param but incomplete, 0 if missing.
        
        examples_included: |
          At least 50% of functions have @example.
          Score 1 if >= 50%, 0.5 if >= 25%, 0 if < 25%.
```

### Example 2: Security-Focused Refactoring

**Goal:** Agent should add input validation without breaking existing functionality

```yaml
# testcase-security.yaml
name: "Input Validation Addition"
description: "Add input validation to prevent injection attacks"

repo: https://github.com/your-org/web-app.git
branch: main
expected_source: branch
expected: feature/secure-inputs

agent:
  type: copilot-cli
  config:
    prompt: |
      Add input validation to all user-facing endpoints in src/routes/:
      
      1. Validate and sanitize all request body fields
      2. Use the validator library (already installed)
      3. Return 400 Bad Request for invalid input
      4. Log validation failures (use existing logger in src/utils/logger.ts)
      5. DO NOT modify any business logic, only add validation

evaluators:
  - name: expected-diff
    config:
      threshold: 0.75

  - name: git-diff
    config:
      assertions:
        max_files_changed: 8

  - name: agentic-judge
    config:
      type: copilot-cli
      assertions:
        validation_added: |
          All POST/PUT/PATCH endpoints validate request body.
          Score 1 if all endpoints protected, 0.5 if > 50%, 0 if <= 50%.
        
        uses_validator_lib: |
          Uses the 'validator' library for sanitization.
          Score 1 if uses validator, 0 if uses other/nothing.
        
        error_handling: |
          Invalid input returns 400 with descriptive message.
          Score 1 if proper 400 responses, 0 if silent failure or 500.
        
        logging_present: |
          Validation failures are logged using existing logger.
          Score 1 if logged, 0 if not logged.
        
        no_logic_changes: |
          Business logic in endpoint handlers unchanged.
          Score 1 if logic preserved, 0 if logic modified.
        
        tests_pass: |
          All existing tests still pass.
          Score 1 if tests pass, 0 if any test fails.
```

### Example 3: Progressive Difficulty Test Suite

**Goal:** Test agent on progressively harder tasks

```yaml
# Level 1: Simple
# testcase-level1-typo.yaml
name: "Fix Typo (Level 1)"
description: "Simple task - fix obvious typo"
agent:
  config:
    prompt: "Fix the typo 'recieve' -> 'receive' in README.md"
evaluators:
  - name: agentic-judge
    config:
      assertions:
        typo_fixed: "The word 'receive' is spelled correctly. Score 1 if fixed, 0 if not."
```

```yaml
# Level 2: Moderate
# testcase-level2-refactor.yaml
name: "Extract Function (Level 2)"
description: "Moderate task - extract repeated code into function"
agent:
  config:
    prompt: |
      In src/utils.ts, there's code duplicated in lines 10-15 and 30-35.
      Extract this into a reusable function called 'formatUserName'.
evaluators:
  - name: agentic-judge
    config:
      assertions:
        function_created: "Function formatUserName exists. Score 1 if exists, 0 if not."
        duplication_removed: "The duplicated code now calls formatUserName. Score 1 if both locations use it, 0.5 if one, 0 if neither."
```

```yaml
# Level 3: Complex
# testcase-level3-feature.yaml
name: "Add Feature (Level 3)"
description: "Complex task - implement new feature with tests"
agent:
  config:
    prompt: |
      Implement a rate limiting middleware for the Express server:
      - Maximum 100 requests per IP per minute
      - Return 429 Too Many Requests when exceeded
      - Add header X-RateLimit-Remaining with count
      - Store limits in memory (Redis integration later)
      - Add unit tests in tests/rate-limiter.test.ts
evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      assertions:
        middleware_created: "Rate limiting middleware file exists. Score 1/0."
        limit_enforced: "Requests beyond 100/min return 429. Score 1/0."
        header_added: "X-RateLimit-Remaining header present in responses. Score 1/0."
        tests_added: "Unit tests exist for rate limiter. Score 1 if comprehensive, 0.5 if basic, 0 if none."
        tests_pass: "All tests pass. Score 1/0."
```

---

## Conclusion

Test-Driven Development for AI agents is a paradigm shift—but the core principles remain the same:

1. **Define expectations first** (write assertions before running the agent)
2. **Start with failing tests** (expect your agent to need iteration)
3. **Iterate to green** (refine prompts, context, and instructions)
4. **Prevent regressions** (run your test suite regularly)
5. **Improve continuously** (tighten assertions as agent improves)

youBencha provides the framework to make this process reproducible, objective, and scalable. Start small, be specific with your assertions, and build up your test suite over time.

The goal isn't to test *code*—it's to test your *agent's ability to produce quality code*. Once you internalize this mindset shift, you'll find that TDD for agents is just as natural and valuable as TDD for traditional software.

Happy evaluating! 🚀

---

## Additional Resources

- [Getting Started Guide](GETTING-STARTED.md) - Quick start for youBencha
- [Multiple Agentic Judges](multiple-agentic-judges.md) - Using multiple evaluators
- [Post-Evaluation Hooks](post-evaluation.md) - CI/CD and notifications
- [Reusable Evaluators](reusable-evaluators.md) - Sharing evaluator configs
- [Run vs Eval Commands](run-vs-eval.md) - When to use each command
