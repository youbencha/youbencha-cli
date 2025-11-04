# 📄 Product Requirements Document  
## FACE — *Framework for Agentic Coding Evaluation*  
**Version:** 0.9 (Draft)  
**Owner:** TBD  
**Status:** In Review  
**Target Users:** AI engineers, LLM agent developers, platform/tooling teams, OSS contributors  

---

## 1. Problem Statement

Agentic coding workflows (e.g., GitHub Copilot CLI, Claude Code, autonomous coding agents) are rapidly becoming normalized in software development. However:

| Current State | Problem |
|---------------|---------|
| Output quality varies wildly across agents, prompts, tools, and models. | There is no standardized, measurable way to compare agents. |
| Teams manually review agent-generated code, heavily relying on “vibes.” | No repeatable evaluation, regression, or benchmarking exists. |
| Small prompt or model tweaks may break previously successful behavior. | No regression tracking across time or across versions. |
| Vendors claim performance, but no reproducible cross-agent benchmarks exist. | No open standard for agent comparison or log normalization. |

**Therefore:** Teams need a reproducible, agent-agnostic framework to *run*, *evaluate*, *compare*, and *regress-test* coding agents objectively.

---

## 2. Solution Overview

FACE is a **Node-based CLI framework** that evaluates agentic coding tools by:

✅ Running the agent in an isolated workspace  
✅ Collecting uniform logs and artifacts  
✅ Running pluggable evaluators (diff, agentic judging, etc.)  
✅ Outputting structured results (JSON + reports)  
✅ Supporting regression via golden datasets  
✅ Supporting multiple agents, models, prompts, and configurations  

FACE borrows mental models from **traditional software testing**:

| Software Testing | FACE Equivalent |
|------------------|-----------------|
| Test Suite | Evaluation Suite |
| Test Case | Evaluator |
| Assertions | Evaluation Results |
| CI Regression Tests | Golden Dataset Regression Runs |

---

## 3. Goals & Success Metrics

### Primary Goals
| Goal | Success Metric |
|------|---------------|
| Provide repeatable and comparable evaluation of coding agents | 90% of evaluation runs are reproducible within variance bounds |
| Normalize logs across agents | FACE Log Spec adopted by ≥3 agent ecosystems |
| Enable regression testing for prompts, models, tools | At least 1 live OSS repo uses FACE for regression in CI |
| Allow pluggable evaluators | ≥5 built-in evaluators + plugin API shipped in MVP |
| Enable multi-agent benchmarking | CLI can compare ≥3 agents in one suite |

### Non-Goals (initially)
❌ Evaluate natural-language agents (non-coding)  
❌ Live IDE plugins  
❌ Cloud service or dashboard (later roadmap)  

---

## 4. User Personas

### 👤 AI Engineer / LLM Architect
> “I need to know if changing a model, prompt, or agent improves output, not just feels better.”

Needs:
- Cross-agent comparison
- Version-controlled evaluation artifacts
- Regression guardrails in CI

### 👤 CTO / Platform Owner
> “I need to track ROI: cost, reliability, build success, failure rate, etc.”

Needs:
- Cost/time/tokens tracked
- Trend reports over weeks/months
- Ability to justify vendor choice

### 👤 OSS Maintainer / Contributor
> “I want to add support for my coding agent tool.”

Needs:
- Clear adapter API
- Log spec to map to
- Plugin distribution model

---

## 5. Functional Requirements

### 5.1 CLI Commands

| Command | Description |
|---------|-------------|
| `face run -c suite.yaml` | Runs full evaluation workflow (agent exec + evaluators) |
| `face report --from results.json` | Generates human-readable report from stored results |
| `face regress --suite suite.yaml --since v0.3.0` | Compare results against historical baseline |
| `face dataset add --from agent-run.json` | Adds a passing output to golden dataset store |
| `face expected promote --from results.json --label <name>` | Promotes evaluation results to a labeled golden dataset for later use as expected reference via `--expected <label>` |
| `face suggest-eval --source <branch> --expected <branch>` | Analyzes differences between source and expected/ideal branches to suggest evaluators and criteria |
| `face init --repo <url> --expected-branch <branch>` | Clones repo with both working and expected/ideal branches for evaluation setup |

### 5.2 Suite Configuration (JSON/YAML)
Must include:
- Repo + commit ref
- Agent configuration(s)
- Inputs & expected outputs (or oracles)
- Expected reference (optional, for comparison-based evaluation):
  - `expected_source`: `branch | path | dataset`
  - Source identifier (branch name, file path, or dataset label)
- Evaluators to run
- Sandbox config (container, resource limits, timeout)

### 5.3 Workspace & Isolation
Requirement | Details
-----------|--------
Sandboxing | Docker/DevContainer with pinned digest (default)
No accidental file mutation | Code runs inside `src-modified/` clone; optional `src-expected/` clone for ideal/reference branch
Multiple branch support | Can clone and maintain separate directories for source, modified, and expected branches
Network policy | Default off, opt-in allowlist
Reproducibility | Logs model name, temp, seed, CPU, OS, etc.

### 5.4 Agent Adapters
- Must accept: repo path, suite context, env vars
- Must output: agent stdout/stderr + normalized **FACE Log**
- First supported agent: **GitHub Copilot CLI**
- Future adapters: Claude Code, Codex, Cursor, Aider, OpenAI o1 agent mode, etc.

### 5.5 Canonical Log Spec
FACE will define an official JSON schema containing:
- Model info, parameters, time, cost, tokens
- Messages, tool calls, errors
- Agent execution metadata (exit code, duration, version)

### 5.6 Evaluators
✅ Built-in for MVP:

| Evaluator | Type | Output Metric |
|-----------|------|---------------|
| `git-diff` | code-based | files changed, LOC, entropy |
| `build` | command-based | pass/fail + build time |
| `tests` | command-based | % of tests passed, failures |
| `lint` | command-based | warning/error counts |
| `typecheck` | command-based | pass/fail + error count |
| `tokens` | log-based | model tokens + cost |
| `expected-diff` | code-based | comparison against expected/ideal branch output |
| `agent-judge` | agent/llm-based | agentic |

Optional / Post-MVP:

| Evaluator | Type |
|-----------|------|
| `security` scan | code |
| `performance` benchmarks | code |
| `semantic diff / AST impact` | code |
| `accessibility, docs quality, comments quality` | LLM |

All evaluators must:
- Implement a shared interface
- Return ≥1 evaluation result with status: `passed | failed | skipped`
- May produce artifacts

#### 5.6.1 Evaluator Suggestion Workflow

FACE can automatically analyze differences between a source branch and an expected/ideal branch to suggest appropriate evaluators and evaluation criteria.

**Process:**

1. **Branch Analysis**: Compare source branch with expected/ideal branch
   - Detect file types changed (e.g., `.ts`, `.py`, `.json`, config files)
   - Identify structural changes (new files, deleted files, renamed files)
   - Analyze modification patterns (test additions, dependency changes, config updates)

2. **Evaluator Recommendation**: Based on detected changes, suggest relevant evaluators
   - Code changes → `git-diff`, `expected-diff`, `typecheck`, `lint`
   - Test file changes → `tests`, `coverage`
   - Build config changes → `build`, `dependency-check`
   - Documentation changes → `llm-judge` (docs quality)

3. **Criteria Generation**: For each suggested evaluator, generate specific pass/fail criteria
   - Extract expected outcomes from ideal branch (e.g., test pass rate, lint error count)
   - Define thresholds based on ideal branch characteristics
   - Suggest custom metrics (e.g., "should add ≥3 test cases", "should reduce complexity")

4. **Suite Template Output**: Generate a draft `suite.yaml` with:
   - Recommended evaluators
   - Pre-populated expected values from ideal branch
   - Commented suggestions for manual review

**Example Output:**
```yaml
# Generated evaluator suggestions based on analysis of:
# Source: main, Expected: feature/ai-completed
evaluators:
  - name: expected-diff
    threshold: 0.85  # 85% similarity to expected branch
  - name: tests
    min_pass_rate: 100  # All tests pass in expected branch
  - name: typecheck
    max_errors: 0  # No type errors in expected branch
  - name: lint
    max_warnings: 2  # Expected branch has 2 warnings
# Suggested based on detected patterns:
  - name: llm-judge
    criteria: "Includes comprehensive error handling"
    # Reason: Expected branch adds try-catch blocks
```

### 5.7 Output / Reporting
| Artifact | Format |
|----------|--------|
| Raw results bundle | JSON |
| Human report | Markdown |
| Artifacts | Patch files, build logs, test logs, evaluator outputs |
| CI summary | Optional minimal Markdown/stdout |

### 5.8 Execution Model

FACE defines a clear execution model for agent runs, evaluator execution, and future support for multi-agent and multi-replication runs.

5.8.1 Execution Flow
FOR EACH AGENT RUN (serial)
  1. Prepare workspace
  2. Execute agent (mutates src-modified)
  3. Normalize logs to FACE Log
  4. Run evaluators (parallel, unless disabled)
  5. Aggregate results + artifacts

5.8.2 Serial vs Parallel Rules
Stage	Default Mode	Notes
Agent execution	Serial	Agents mutate workspace state; run one at a time
Evaluators	Parallel	Evaluators operate on immutable snapshots; safe to parallelize
Multi-agent runs	Future	Architecture supports, not implemented in MVP
Multi-replication (variance runs)	Future	Execution model designed to extend to N replications

5.8.3 CLI Concurrency Flags
face run --max-parallel-evaluators <n>
# future:
face run --max-parallel-agents <n>
face run --replications <n> --seed-strategy fixed|increment

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Performance | Full run < 3 min for small repo, < 10 min for medium repo |
| Modularity | Adapters + evaluators must be replaceable plugins |
| Reproducibility | Same suite + same commit = same result within variance |
| Extensibility | New agents, evaluators installable via npm |
| Security | No external network by default; sandbox enforced |
| OSS Stack | Node 20+, TypeScript, Apache-2.0 License |
| CI Support | GitHub Actions template provided |

---

## 7. Architecture Overview

face/
cli.ts
core/
orchestrator.ts
workspace.ts
env.ts
storage.ts
branch-analyzer.ts 
evaluator-suggester.ts  
adapters/
copilot-cli.ts
evaluators/
git-diff.ts
expected-diff.ts
agentic-judge.ts
schemas/
suite.schema.ts
facelog.schema.ts
reporters/
json.ts
markdown.ts

Execution flows:

**Standard evaluation:**
face run
├─ Prepare workspace (clone repo, copy to src-modified)
├─ [Optional] Clone expected branch to src-expected
├─ Run agent(s) via adapter(s) on src-modified
├─ Normalize logs → FACE Log
├─ Run evaluators in parallel
│  └─ [If expected branch exists] Run expected-diff evaluator
├─ Aggregate results
└─ Emit reports + artifact bundle

**Evaluator suggestion workflow:**
face suggest-eval --source main --expected feature/ai-completed
├─ Clone both branches (source → src-source, expected → src-expected)
├─ Run branch analyzer
│  ├─ Diff analysis (files, LOC, patterns)
│  ├─ File type detection
│  ├─ Structural change detection
│  └─ Build/test/config change detection
├─ Run evaluator suggester
│  ├─ Map detected changes → recommended evaluators
│  ├─ Extract metrics from expected branch (test results, lint counts, etc.)
│  ├─ Generate evaluation criteria and thresholds
│  └─ Create LLM-based criteria from code patterns
├─ Generate suite template YAML
└─ Output suggestions with reasoning


---

## 8. Expected Reference & Evaluator Suggestion Feature

### 8.1 Purpose
Enable teams to leverage existing high-quality AI agent outputs (or manually created "ideal" solutions) as evaluation references, and automatically generate appropriate evaluation criteria based on the differences between baseline and ideal states.

An **expected reference** may be:
- **A Git branch** — Compare against a feature branch or ideal implementation
- **A stored dataset** — Use a labeled golden dataset created with `face expected promote`
- **A manually provided directory or artifact bundle** — Point to any file path containing reference code/outputs

### 8.2 Use Cases

| Scenario | How It Helps | Expected Source Type |
|----------|-------------|---------------------|
| Team has a successful agent run | Clone that branch as "expected" and use it to evaluate future agent attempts | `branch` |
| Agent produces excellent output | Promote results with `face expected promote --label v1-baseline` for reuse | `dataset` |
| Manual "gold standard" exists | Use human-created ideal solution to compare agent outputs | `branch` or `path` |
| Iterative agent development | Compare agent v1 vs agent v2 outputs systematically | `dataset` (labeled versions) |
| Prompt engineering | Evaluate if prompt changes move output closer to or further from ideal | `dataset` or `branch` |
| External reference artifacts | Point directly to a directory containing reference implementation | `path` |

### 8.3 Expected Reference Resolution

FACE resolves expected references based on `expected_source` type:

| Source Type | Resolution Process | Example |
|------------|-------------------|---------|
| `branch` | Clone specified branch to `src-expected/` | `expected_source: branch`, `expected: feature/ai-completed` |
| `dataset` | Load labeled dataset from storage (created via `face expected promote`) | `expected_source: dataset`, `expected: v1-baseline` |
| `path` | Copy from specified directory or artifact bundle | `expected_source: path`, `expected: ./golden-outputs/v1/` |

### 8.4 Branch Analyzer Capabilities

The `branch-analyzer` component performs deep analysis between two references (works with any expected source type):

**Diff Metrics:**
- Files added, modified, deleted, renamed
- Lines added/removed per file and in total
- File type distribution (code, config, docs, tests)
- Change density (LOC changed / total LOC)

**Pattern Detection:**
- Test file additions/modifications
- Dependency updates (`package.json`, `requirements.txt`, etc.)
- Configuration changes (`.eslintrc`, `tsconfig.json`, etc.)
- Documentation updates (`README`, `/docs`)
- Code complexity changes (cyclomatic complexity, nesting depth)

**Structural Analysis:**
- New functions/classes/exports added
- Modified function signatures
- Import/dependency graph changes

### 8.5 Evaluator Suggester Logic

Maps detected changes to relevant evaluators:

| Detected Change Pattern | Suggested Evaluators | Generated Criteria |
|------------------------|---------------------|-------------------|
| Code files modified | `expected-diff`, `typecheck`, `lint` | Similarity threshold, error count limits |
| Test files added | `tests`, `coverage` | Min pass rate, coverage delta |
| Build config changed | `build` | Build success required |
| Dependencies updated | `security`, `build` | No vulnerabilities, successful build |
| Docs added/updated | `llm-judge` (docs quality) | Completeness, clarity rubric |
| Complexity reduced | `complexity` | Max complexity thresholds |

**Criteria Extraction:**
- Run evaluators on expected branch to get "passing" metrics
- Use those as thresholds (e.g., if expected has 0 lint errors, require ≤ 0)
- For subjective criteria, generate LLM prompts based on patterns (e.g., "includes error handling like expected branch")

### 8.6 Output Format

`face suggest-eval` produces:

1. **Analysis Summary** (Markdown/JSON):
```markdown
## Branch Analysis: main → feature/ai-completed

### Changes Detected
- 12 files modified, 3 files added
- +487 lines, -123 lines
- Test coverage increased by 15%
- 2 new dependencies added

### Recommended Evaluators
1. **expected-diff** - Measures similarity to ideal branch
2. **tests** - Ensures test pass rate matches or exceeds ideal
3. **typecheck** - No type errors (ideal branch has 0)
4. **lint** - Max 2 warnings (ideal branch has 2)
5. **build** - Successful build required
```

2. **Generated Suite YAML**:
```yaml
repo: https://github.com/user/repo
source_branch: main

# Expected reference options (choose one):
# Option 1: Branch reference
expected_source: branch
expected: feature/ai-completed

# Option 2: Dataset reference (created via face expected promote)
# expected_source: dataset
# expected: v1-baseline

# Option 3: Path reference
# expected_source: path
# expected: ./golden-outputs/2025-01-15/

evaluators:
  - name: expected-diff
    config:
      threshold: 0.85
      ignore_patterns: ['*.lock', 'dist/']
  - name: tests
    config:
      min_pass_rate: 1.0  # 100% from expected reference
  - name: typecheck
    config:
      max_errors: 0
  - name: lint
    config:
      max_warnings: 2
      max_errors: 0
  - name: build
    config:
      must_succeed: true
```

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Agents mutate host FS | sandbox only touches mounted working dir |
| Logs inconsistent across agents | FACE Log Spec + adapters |
| Vendor changes API/CLI | version pinning + adapter versioning |
| Stochastic model variance | multi-replication w/ CI bounds |
| Users misuse LLM-judge results | mark evaluator as "subjective" |
| OSS fragmentation | publish SDK + schema + starter templates |
| Expected reference doesn't represent true "ideal" | Document that expected reference is a comparison point, not absolute truth |
| Over-fitting to single expected output | Support multiple expected references for comparison (post-MVP) |
| Automatic criteria too strict/lenient | Generated suite is a starting template for manual refinement |
| Dataset storage grows unbounded | Implement retention policies and cleanup commands (post-MVP) |

---

## 9. MVP Scope (Success Criteria)

✅ **1 agent adapter**: GitHub Copilot CLI  
✅ **3 evaluators**: diff, files-changed, generic agentic-judge evaluator(natural language evaluation with structured output of evaluation-result. the agent can use tools like a coding agent to review code based on natural language evaluation instructions and produce structured eval results)
✅ **Suite config schema** + sample suite  
✅ **Expected reference support**: Support branch
✅ **Evaluator suggestion workflow**: Analyze differences and suggest evaluators  
✅ **Report output (JSON + Markdown)**  
✅ **Regression test mode**  

Not required for MVP:
- Multi-agent comparison dashboard
- Sandbox execution (Docker, timeout, no network)  
- Plugin marketplace
- Cloud UI
- GitHub Actions example workflow
- Golden dataset promotion: `face expected promote` command to label and store results  
- Expected reference support: In addition to support for branch, support dataset and path-based expected references  

---

## 10. Roadmap

| Phase | Timeline | Features |
|-------|----------|----------|
| **MVP** | 6–8 weeks | Copilot CLI adapter, core eval, diff/expected-diff/generic agentic-judge evaluator, expected reference support (branch/dataset/path), evaluator suggestion workflow, report generator |
| v0.2 | +4 weeks | Claude Code adapter, regression dataset UX, CI templates, enhanced LLM-based criteria generation |
| v0.3 | +4 weeks | Web dashboard, HTML reports, evaluator plugins |
| v0.4 | +6 weeks | Large suite parallelization, distributed runners, multi-expected reference comparison, dataset retention policies |
| v1.0 | TBD | Multi-agent benchmarks published, FACE Standard adopted by ≥ 3 OSS agents |

---

## 11. Open Questions

| Question | Owner |
|----------|-------|
| Should FACE maintain an official public "Agent Leaderboard"? | TBD |
| Should FACE produce a packaged OCI container for CI usage? | Yes (post-MVP) |
| What is the minimum required schema for FACE log spec? | Needs RFC |
| Should LLM-judge evaluators be in core or plugin-only? | PLUGIN ONLY |
| Should evaluator suggestion support multiple expected references for comparison? | Post-MVP |
| How to handle expected references becoming stale/outdated? | Document best practices: version tags, date tracking, dataset labeling conventions |
| Should branch analyzer use LLM for semantic analysis or stay deterministic? | MVP: deterministic only; LLM optional post-MVP |
| What storage format for promoted datasets? | JSON artifact bundles with metadata (label, timestamp, source info) |
| Should dataset labels support versioning/namespacing? | Yes, recommend convention: `<project>-<version>` or `<feature>-<date>` |

---
