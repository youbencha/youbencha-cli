# youBencha User Journey Maps

This document maps out the key user journeys for youBencha, identifying touchpoints, emotions, pain points, and opportunities at each stage. These journeys are based on research with 5 user personas and represent the most critical workflows.

---

## Journey 1: First-Time Setup and Evaluation

**Primary Persona:** Alex (Junior Engineer)  
**Also Relevant For:** Jordan (Mid-Level), Morgan (Manager evaluating during pilot)

### Journey Overview
**Goal:** Successfully run first evaluation from scratch  
**Duration:** 15-60 minutes (target: < 20 minutes)  
**Success:** Evaluation completes and results are understood  
**Current Success Rate:** ~40% (estimated)

---

### Stage 1: Discovery (2-5 minutes)

**User Actions:**
- Hears about youBencha from colleague, blog post, or GitHub
- Searches "youBencha" or "AI code evaluation tool"
- Lands on GitHub README or website

**Touchpoints:**
- GitHub repository README
- Project website (if exists)
- Search engine results
- Social media mentions

**User Thoughts:**
> "What is this? Will it solve my problem? Is it worth my time?"

**Emotions:** 😐 Curious, Skeptical

**Pain Points:**
- ❌ Name "youBencha" not immediately clear what it does
- ❌ README is long and overwhelming
- ❌ No quick "what is this in 30 seconds" explanation

**Opportunities:**
- ✅ Add TL;DR at top of README: "Auto-evaluate AI-generated code quality"
- ✅ Include animated GIF showing evaluation in action
- ✅ Lead with problem statement: "Are you sure that AI-generated code is safe to merge?"

---

### Stage 2: Understanding (5-10 minutes)

**User Actions:**
- Reads README introduction
- Looks at Quick Start section
- Checks prerequisites (Node.js, GitHub Copilot CLI)
- Reads example configuration

**Touchpoints:**
- README Quick Start
- Example files (basic-suite.yaml)
- Prerequisites section

**User Thoughts:**
> "Do I have everything I need? What's a 'suite'? What are 'evaluators'?"

**Emotions:** 😰 Overwhelmed, Uncertain

**Pain Points:**
- ❌ Prerequisites unclear (do I need Copilot CLI? How do I get it?)
- ❌ Terminology barrier (suite, evaluator, agentic-judge, expected reference)
- ❌ No clear indication of time/effort required
- ❌ Example jumps into complex config immediately

**Opportunities:**
- ✅ Add prerequisite checker: `yb doctor` command that validates setup
- ✅ Provide terminology glossary or hover tooltips in docs
- ✅ Add "estimated time: 5 minutes" to Quick Start
- ✅ Create "simplest possible" example (1 evaluator, no config)

**Current Experience:**
```yaml
# User sees this and thinks "too complex!"
repo: https://github.com/octocat/Hello-World.git
branch: master
agent:
  type: copilot-cli
  config:
    prompt: "Add a comment to README..."
evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      criteria:
        readme_modified: "README.md was modified"
```

**Improved Experience:**
```bash
# User runs this and sees it work
$ yb init --example basic

Created basic-suite.yaml with sensible defaults!
Run your first evaluation: yb run -c basic-suite.yaml

# OR use interactive wizard
$ yb init --interactive

🤖 youBencha Setup Wizard
Let's set up your first evaluation!

What agent are you using?
→ GitHub Copilot CLI
✅ Detected Copilot CLI installed

Where is your code?
→ ./my-project
✅ Found Git repository

What should the agent do?
→ Add error handling to API endpoints

🎉 Created suite.yaml with recommended evaluators!
Run: yb run -c suite.yaml
```

---

### Stage 3: Installation (5-10 minutes)

**User Actions:**
- Installs youBencha via npm
- Checks if Copilot CLI is available
- Troubleshoots any installation issues

**Touchpoints:**
- Terminal / command line
- npm registry
- Error messages

**User Thoughts:**
> "Why isn't this working? Do I have the right version? What do I do now?"

**Emotions:** 😤 Frustrated (if errors), 😊 Relieved (if smooth)

**Pain Points:**
- ❌ No validation that Copilot CLI is installed before trying to run
- ❌ Generic error messages: "spawn git ENOENT"
- ❌ Unclear what Node.js version is needed (>=20?)
- ❌ No guidance on authentication (GitHub CLI)

**Opportunities:**
- ✅ Add setup wizard that checks dependencies
- ✅ Provide helpful error messages with solutions
- ✅ Auto-detect issues: "Copilot CLI not found. Install with: npm install -g @github/copilot-cli"
- ✅ Version check: "Node.js 18 detected. youBencha requires Node.js 20+. Upgrade guide: ..."

**Current Experience:**
```bash
$ npm install -g youbencha
✓ Installed

$ yb run -c suite.yaml
Error: spawn gh ENOENT
    at Process.ChildProcess._handle.onexit (...)
```

**Improved Experience:**
```bash
$ npm install -g youbencha
✓ Installed youbencha v0.2.0

$ yb run -c suite.yaml

⚠️ Setup Check Failed

Missing requirement: GitHub Copilot CLI
  → Install: npm install -g @github/copilot-cli
  → Docs: https://youbencha.dev/docs/setup/copilot-cli

Missing requirement: GitHub authentication
  → Login: gh auth login
  → Docs: https://youbencha.dev/docs/setup/auth

Run 'yb doctor' to check all requirements.
```

---

### Stage 4: Configuration (10-20 minutes)

**User Actions:**
- Creates suite.yaml file
- Fills in repository URL, branch, prompt
- Chooses evaluators (confused about which ones)
- Struggles with YAML syntax (indentation errors)

**Touchpoints:**
- suite.yaml file
- Text editor / IDE
- Example configurations
- Documentation

**User Thoughts:**
> "Which evaluators should I use? What does this threshold mean? Is my YAML valid?"

**Emotions:** 😕 Confused, 😰 Anxious

**Pain Points:**
- ❌ No guidance on which evaluators to use
- ❌ Threshold values (0.80?) have no context
- ❌ YAML syntax errors cause cryptic failures
- ❌ No validation until runtime
- ❌ Field names unclear (expected_source vs expected?)

**Opportunities:**
- ✅ `yb validate` command to check config before running
- ✅ JSON Schema for IDE autocomplete and validation
- ✅ `yb suggest-evaluators` based on use case
- ✅ Templates: `yb init --template api-testing`
- ✅ Inline comments in example configs explaining each field

**Current Experience:**
```yaml
# User guesses at configuration
repo: https://github.com/myuser/myrepo
branch: main
agent:
  type: copilot-cli  # Is this right?
  config:
    prompt: "Add error handling"
evaluators:
  - name: expected-diff  # Do I need this?
    config:
      threshold: 0.80  # Is 0.80 good? Too strict?
```

**Improved Experience:**
```bash
$ yb init --template api-endpoint-testing

Created suite.yaml from template!

# suite.yaml with helpful comments
repo: https://github.com/myuser/myrepo
branch: main

agent:
  type: copilot-cli
  config:
    # What the agent should do
    prompt: "Add input validation and error handling to API endpoints"

evaluators:
  # Track what files changed
  - name: git-diff
  
  # Compare to reference implementation (optional)
  # - name: expected-diff
  #   config:
  #     threshold: 0.80  # 80% similarity required (0.7-0.9 recommended)
  
  # AI-powered code review
  - name: agentic-judge
    config:
      criteria:
        error_handling: "All endpoints have try-catch blocks"
        input_validation: "Inputs are validated before processing"

$ yb validate -c suite.yaml
✅ Configuration is valid
✅ All required fields present
✅ Agent 'copilot-cli' is available
✅ All evaluators exist
ℹ️  Tip: Add 'expected-diff' evaluator if you have a reference implementation
```

---

### Stage 5: Execution (3-10 minutes)

**User Actions:**
- Runs `yb run -c suite.yaml`
- Waits for evaluation to complete
- Watches for progress (or sits in silence)

**Touchpoints:**
- Terminal output
- Progress indicators (or lack thereof)

**User Thoughts:**
> "Is it working? How long will this take? What's happening now?"

**Emotions:** 😰 Anxious (if no feedback), 😊 Reassured (if clear progress)

**Pain Points:**
- ❌ No progress feedback during long operations
- ❌ Unclear how long evaluation will take
- ❌ Silent failures (hangs with no output)
- ❌ Can't tell what stage it's on (cloning? running agent? evaluating?)

**Opportunities:**
- ✅ Real-time progress with spinners and stages
- ✅ Estimated time remaining
- ✅ Stream agent output (with --verbose flag)
- ✅ Clear stage indicators: "1/5 Cloning repository..."

**Current Experience:**
```bash
$ yb run -c suite.yaml

[... 3 minutes of silence ...]

✓ Evaluation complete
```

**Improved Experience:**
```bash
$ yb run -c suite.yaml

🔍 Validating configuration... ✓
📦 Setting up workspace... ✓
🌐 Cloning repository... (15%) [==>    ]
   └─ Cloning https://github.com/user/repo (branch: main)
   └─ ETA: 30 seconds

🤖 Running agent: GitHub Copilot CLI... (45%)
   └─ Executing prompt: "Add error handling"
   └─ Agent is modifying: src/api/users.ts
   └─ ETA: 2 minutes

📊 Running evaluators (parallel)... (78%)
   ✓ git-diff (0.8s)
   ✓ expected-diff (2.1s)
   ⠸ agentic-judge (in progress... 15s)

✅ Evaluation complete! (3m 42s)
   Results: .youbencha-workspace/run-abc123/artifacts/results.json
   Report: yb report --from results.json
```

---

### Stage 6: Understanding Results (5-15 minutes)

**User Actions:**
- Finds results file (where is it?)
- Runs `yb report` to generate readable output
- Reads through evaluation results
- Tries to understand what passed/failed and why

**Touchpoints:**
- results.json file
- Terminal output from `yb report`
- Markdown report file

**User Thoughts:**
> "Did it pass? What does this similarity score mean? What should I do now?"

**Emotions:** 😕 Confused (if unclear), 😊 Confident (if clear action)

**Pain Points:**
- ❌ Results.json is machine-readable, not human-readable
- ❌ Need to run separate command for human report
- ❌ Report is verbose and hard to scan
- ❌ Metrics lack context (is 0.87 similarity good?)
- ❌ No clear "next steps" or recommendations

**Opportunities:**
- ✅ Show summary immediately after evaluation
- ✅ Auto-generate report (don't require separate command)
- ✅ Lead with pass/fail and key takeaways
- ✅ Provide context for metrics ("87% similarity - GOOD")
- ✅ Include recommendations ("Safe to merge" or "Review files with low similarity")

**Current Experience:**
```bash
$ yb run -c suite.yaml
✓ Evaluation complete

$ cat .youbencha-workspace/run-abc/artifacts/results.json
{
  "version": "1.0.0",
  "summary": {
    "overall_status": "passed",
    "total_evaluators": 3,
    "passed": 3
  },
  "evaluators": [
    {
      "evaluator": "expected-diff",
      "metrics": {
        "aggregate_similarity": 0.8734
      }
      ...
    }
  ]
}

# User: "Uhh... what does this mean?"
```

**Improved Experience:**
```bash
$ yb run -c suite.yaml

[... progress indicators ...]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ EVALUATION PASSED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Summary:
  Files changed: 3
  Similarity to expected: 87% (Good! ✓)
  Code quality checks: All passed ✓
  
Evaluator Results:
  ✓ git-diff: 3 files changed, focused changes
  ✓ expected-diff: 87% similar (threshold: 80%)
  ✓ agentic-judge: All criteria met

Next Steps:
  → Code looks good - safe to merge after review
  → Full report: evaluation-report.md
  → Details: .youbencha-workspace/run-abc123/
  
Duration: 3m 42s
Cost: $0.04
```

---

### Stage 7: Taking Action (5-10 minutes)

**User Actions:**
- If passed: Proceeds with confidence to merge
- If failed: Identifies issues, makes fixes, re-runs
- Reviews detailed report for context

**Touchpoints:**
- Markdown report (if generated)
- Code diff (to see what failed)
- Git/GitHub interface

**User Thoughts:**
> "What specifically is wrong? How do I fix this? Should I trust this evaluation?"

**Emotions:** 😊 Confident (if passed), 😤 Determined (if clear fixes needed), 😰 Confused (if vague)

**Pain Points:**
- ❌ Unclear which specific files/lines have issues
- ❌ No specific remediation guidance
- ❌ Can't easily compare this run to previous runs
- ❌ Re-running requires full re-evaluation (slow)

**Opportunities:**
- ✅ File-level breakdown in report
- ✅ Specific recommendations per issue
- ✅ Quick re-run with caching
- ✅ Diff view: "this run vs last run"

---

## Journey Map Summary

### User Emotions Throughout Journey

```
😊 Excited                                                  😊 Confident
    |                                                            ▲
    ├─ Discovery                                               │
    ↓                                                          │
😐 Curious ──→ 😰 Overwhelmed ──→ 😤 Frustrated ──→ 😕 Confused ──→ Results
    |              |                  |              |
    └─ Understanding → Installation → Configuration → Execution
```

**Critical Drop-off Points:**
1. **Understanding stage** - Too complex, terminology barrier
2. **Installation stage** - Prerequisites unclear, errors cryptic
3. **Configuration stage** - Too many options, no guidance
4. **Understanding results** - Metrics without context

### Quick Wins (High Impact, Low Effort)

1. **Interactive setup wizard** (`yb init --interactive`)
2. **Better progress feedback** (spinners, ETAs, stages)
3. **Auto-generate human report** (don't require separate command)
4. **Prerequisite validation** (`yb doctor`)
5. **Improved error messages** (actionable, with solutions)

### Longer-term Improvements

1. **JSON Schema for IDE autocomplete**
2. **Configuration templates**
3. **Evaluator recommendation engine**
4. **Result comparison tool**
5. **Video walkthrough**

---

## Journey 2: Running Regular Evaluations (CI/CD Integration)

**Primary Persona:** Jordan (Mid-Level Engineer)  
**Also Relevant For:** Sam (Senior), Riley (Principal)

### Journey Overview
**Goal:** Integrate youBencha into CI/CD for automatic evaluation on every PR  
**Duration:** 30-90 minutes (setup) + 2-5 minutes per PR  
**Success:** Evaluations run automatically, provide fast feedback, don't block unnecessarily  
**Current Success Rate:** Unknown (not well-documented)

---

### Stage 1: Decision to Integrate (10-20 minutes)

**User Actions:**
- Successfully ran evaluation locally
- Decides to add to CI/CD pipeline
- Researches how to integrate with GitHub Actions / GitLab CI

**Touchpoints:**
- Documentation (CI/CD section)
- Examples directory
- GitHub Actions marketplace (if action exists)

**User Thoughts:**
> "How do I add this to CI? Is there a GitHub Action? Will it slow down my pipeline?"

**Emotions:** 😊 Motivated, 😐 Cautious

**Pain Points:**
- ❌ No clear CI/CD integration guide
- ❌ No official GitHub Action
- ❌ Unclear how to handle authentication (secrets)
- ❌ No performance guidance (caching, parallelization)

**Opportunities:**
- ✅ Publish official GitHub Action
- ✅ Create CI/CD integration guide with examples
- ✅ Provide caching strategies
- ✅ Document secret management

**Current Experience:**
```yaml
# User has to figure this out themselves
- name: Run youBencha
  run: |
    npm install -g youbencha
    yb run -c suite.yaml
    # How do I handle results? Post to PR?
```

**Improved Experience:**
```yaml
# Official GitHub Action
- name: Evaluate AI-generated code
  uses: youbencha/evaluate-action@v1
  with:
    suite: .youbencha/suite.yaml
    post-comment: true
    fail-on-status: failed
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

---

### Stage 2: Initial Setup (20-40 minutes)

**User Actions:**
- Adds youBencha step to CI/CD workflow
- Configures secrets (API keys)
- Tests on a sample PR
- Troubleshoots issues (timeout, wrong config, etc.)

**Touchpoints:**
- CI/CD configuration file
- GitHub/GitLab secrets UI
- CI/CD logs

**User Thoughts:**
> "Why is this failing in CI but working locally? How do I debug this?"

**Emotions:** 😤 Frustrated (if issues), 😊 Satisfied (if smooth)

**Pain Points:**
- ❌ Different behavior in CI vs local (environment differences)
- ❌ Hard to debug (logs are buried)
- ❌ Timeout issues (evaluation takes too long)
- ❌ Credential management unclear

**Opportunities:**
- ✅ CI-specific documentation
- ✅ Debug mode for CI (`yb run --ci --debug`)
- ✅ Timeout configuration guidance
- ✅ CI log formatting (cleaner output)

---

### Stage 3: Ongoing Use (2-5 minutes per PR)

**User Actions:**
- Opens PR with AI-generated code
- CI runs youBencha automatically
- Receives results as PR comment or check
- Makes fixes if needed and pushes again

**Touchpoints:**
- GitHub PR interface
- CI/CD check status
- PR comments

**User Thoughts:**
> "What did youBencha find? Can I merge? Should I wait for human review?"

**Emotions:** 😊 Confident (if passed), 😤 Annoyed (if false positive), 😰 Worried (if failed)

**Pain Points:**
- ❌ False positives block merge unnecessarily
- ❌ Evaluation takes too long (>5 min)
- ❌ No way to override failures with justification
- ❌ Results format not GitHub-friendly

**Opportunities:**
- ✅ Post results as PR comment with clear summary
- ✅ Create GitHub Check with file annotations
- ✅ Allow override with label (skip-youbencha)
- ✅ Performance optimization (< 3 min target)

---

## Journey 3: Agent Comparison and Selection

**Primary Persona:** Riley (Principal Engineer)  
**Also Relevant For:** Sam (Senior), Morgan (VP/CTO)

### Journey Overview
**Goal:** Compare multiple AI agents (Copilot, Claude, Cursor) to choose the best one  
**Duration:** 1-3 hours (setup) + ongoing  
**Success:** Data-driven agent selection decision  
**Current Success Rate:** Not supported (feature gap)

---

### Stage 1: Defining Comparison (20-30 minutes)

**User Actions:**
- Identifies agents to compare
- Defines comparison criteria (quality, speed, cost)
- Creates standardized prompts and test cases

**Touchpoints:**
- Documentation (agent comparison guide - doesn't exist)
- Configuration files

**User Thoughts:**
> "How do I ensure fair comparison? What metrics should I track?"

**Emotions:** 🤔 Thoughtful, 😐 Uncertain

**Pain Points:**
- ❌ No agent comparison feature
- ❌ Have to run multiple evaluations manually
- ❌ No side-by-side comparison view
- ❌ Unclear how to aggregate results

**Opportunities:**
- ✅ Build multi-agent comparison mode
- ✅ Provide benchmark suite templates
- ✅ Auto-generate comparison reports
- ✅ Track agent performance over time

---

### Stage 2: Running Comparison (30-60 minutes)

**User Actions:**
- Runs same evaluation with different agents
- Collects results
- Manually compares metrics

**Current Experience (tedious):**
```bash
$ yb run -c suite-copilot.yaml
$ yb run -c suite-claude.yaml
$ yb run -c suite-cursor.yaml
# Now manually compare results.json files...
```

**Improved Experience:**
```bash
$ yb compare-agents \
    --agents copilot-cli,claude-code,cursor \
    --suite benchmark-suite.yaml \
    --output comparison-report.html

Agent Comparison Report Generated!
  Open: comparison-report.html
  Summary:
    Winner: Claude Code (92% quality, 15% slower)
    Best speed: Copilot CLI (18s avg)
    Best value: Cursor (good balance)
```

---

### Stage 3: Making Decision (20-30 minutes)

**User Actions:**
- Reviews comparison data
- Considers tradeoffs (quality vs speed vs cost)
- Makes recommendation to team
- Documents decision rationale

**User Thoughts:**
> "Which agent is best for our use case? Can we use different agents for different tasks?"

**Emotions:** 😊 Confident (with good data), 😕 Uncertain (without)

**Pain Points:**
- ❌ No guidance on interpreting comparison data
- ❌ Can't segment by task type (bug fix vs feature vs refactor)
- ❌ No cost-benefit analysis tools

**Opportunities:**
- ✅ Provide decision framework
- ✅ Task-specific benchmarks
- ✅ Cost-benefit calculator
- ✅ Agent recommendation engine

---

## Journey 4: Troubleshooting Failures

**Primary Persona:** Sam (Senior Engineer)  
**Also Relevant For:** All personas when things go wrong

### Journey Overview
**Goal:** Understand why evaluation failed and fix the issue  
**Duration:** 10-60 minutes  
**Success:** Identify root cause and resolve issue  
**Current Success Rate:** Low (poor debugging tools)

---

### Stage 1: Failure Detection (1-2 minutes)

**User Actions:**
- Sees evaluation failed
- Reads failure message

**User Thoughts:**
> "What went wrong? Is it a real issue or a false positive?"

**Emotions:** 😰 Concerned

**Pain Points:**
- ❌ Generic error messages
- ❌ Unclear which evaluator failed and why
- ❌ Stack traces without context

**Opportunities:**
- ✅ Clear failure summary with specific evaluator
- ✅ Highlight most important error first
- ✅ Suggest likely causes

---

### Stage 2: Investigation (10-30 minutes)

**User Actions:**
- Reviews detailed logs
- Checks workspace state
- Tries to reproduce locally

**User Thoughts:**
> "Can I see what the agent actually did? What did the evaluator see?"

**Emotions:** 😤 Frustrated

**Pain Points:**
- ❌ Workspace is cleaned up (can't inspect)
- ❌ Logs are incomplete or cryptic
- ❌ Can't replay evaluation to debug

**Opportunities:**
- ✅ `--keep-workspace` flag to preserve state
- ✅ Detailed debug logs
- ✅ Replay capability for single evaluator
- ✅ Snapshot of workspace at failure

---

### Stage 3: Resolution (10-30 minutes)

**User Actions:**
- Makes code changes or config adjustments
- Re-runs evaluation
- Verifies fix worked

**User Thoughts:**
> "How do I know this won't fail again?"

**Emotions:** 😊 Relieved (when fixed)

**Pain Points:**
- ❌ Slow re-evaluation (no caching)
- ❌ No validation before re-running
- ❌ Same error might recur

**Opportunities:**
- ✅ Fast re-run with caching
- ✅ Pre-flight checks
- ✅ Dry-run mode to test fixes

---

## Cross-Journey Insights

### Common Success Factors
1. **Clear progress feedback** - Users want to know what's happening
2. **Contextual help** - Explain metrics and results in plain English
3. **Fast feedback loops** - < 5 minutes is ideal
4. **Actionable errors** - Tell user exactly what to do to fix issues
5. **Visible value** - Show bugs caught, time saved, quality improved

### Common Pain Points
1. **Terminology barriers** - Technical jargon confuses new users
2. **Configuration complexity** - Too many options, unclear which to use
3. **Missing guidance** - Don't know which evaluators or thresholds to choose
4. **Debugging difficulty** - Hard to understand why evaluation failed
5. **Result interpretation** - Metrics without context are meaningless

### Priority Improvements
1. 🔴 **Critical:** Interactive setup wizard, progress feedback, result summary
2. 🟡 **Important:** CI/CD integration, configuration templates, better errors
3. 🟢 **Nice to have:** Agent comparison, trend tracking, advanced debugging

---

**User Journeys Document Complete**  
**Next Steps:** Use journey maps to prioritize features and identify quick wins
