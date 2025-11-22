# RFC-001: youBencha - Framework for Evaluating AI Coding Agents

**State:** Draft  
**Author:** youBencha Project  
**Created:** 2025-11-09  
**Reviewers:** Open for community feedback  
**Review Status:** Under Review

---

## Table of Contents

1. [Overview and Context](#overview-and-context)
2. [Problem Statement](#problem-statement)
3. [Goals and Requirements](#goals-and-requirements)
4. [Proposed Solution](#proposed-solution)
5. [Technical Details](#technical-details)
6. [Architecture](#architecture)
7. [Timeline and Milestones](#timeline-and-milestones)
8. [Success Criteria](#success-criteria)
9. [Open Questions](#open-questions)
10. [References](#references)

---

## Overview and Context

### What is youBencha?

youBencha (pronounced "you bench-uh") is a **developer-first CLI framework** for evaluating and benchmarking AI-powered coding agents. As agentic coding workflows (GitHub Copilot CLI, Claude Code, Cursor, Aider, etc.) become normalized in software development, teams need a reproducible, objective way to measure agent performance, compare different agents, and prevent regressions when changing prompts, models, or tools.

### Target Audience

**Primary Users:**
- **AI Engineers & LLM Architects** - Need to validate that prompt/model changes improve output objectively
- **Development Teams** - Want to compare agent performance across different tools and track quality over time
- **CTO/Platform Owners** - Require metrics on cost, reliability, and ROI for AI coding tool investments

**Secondary Users:**
- **Open Source Maintainers** - Want to add support for their coding agent tools
- **Researchers** - Need standardized benchmarks for agent evaluation

### The Problem

| Current State | Consequence |
|--------------|-------------|
| Agent output quality varies wildly across tools, prompts, and models | No standardized way to compare agents objectively |
| Teams manually review agent code, relying on "vibes" | No repeatable evaluation or benchmarking |
| Small prompt/model tweaks may break previously successful behavior | No regression tracking across versions |
| Vendors claim performance improvements without reproducible evidence | No open standard for cross-agent comparison |

### Benefits

youBencha provides:

✅ **Agent-agnostic evaluation** - Test any coding agent through pluggable adapters  
✅ **Reproducible benchmarks** - Same suite + same commit = same results  
✅ **Flexible evaluation** - Built-in evaluators (diff analysis, expected reference comparison, AI judging) + custom plugins  
✅ **Developer-friendly CLI** - Simple commands, clear output, CI-ready  
✅ **Standardized logging** - youBencha Log format normalizes agent outputs for comparison  
✅ **Regression testing** - Track performance changes over time with expected references

---

## Problem Statement

### Who Has This Problem?

1. **Development teams adopting AI coding agents** struggle to answer:
   - "Which agent is best for our codebase and use cases?"
   - "Did this prompt change make output better or worse?"
   - "How do we prevent regressions when updating our agent toolchain?"

2. **AI platform teams building agent workflows** lack:
   - Standardized metrics to track agent quality over time
   - Automated evaluation for CI/CD integration
   - Ability to A/B test different agent configurations

3. **Open source projects** cannot:
   - Provide reproducible benchmarks for their agent tools
   - Compare their implementation against alternatives
   - Validate improvements objectively

### Why It Needs Solving

- **Financial Impact**: Teams spend significant engineering time manually reviewing AI-generated code without clear quality metrics
- **Risk Management**: Changing agent configurations (prompts, models, tools) without evaluation risks introducing subtle bugs or degraded output
- **Market Maturity**: The agent ecosystem needs standardized evaluation to mature beyond "vibes-based" selection
- **Scientific Method**: Objective measurement enables systematic improvement of agent systems

---

## Goals and Requirements

### In Scope (MVP)

| Goal | Description |
|------|-------------|
| **Single Agent Evaluation** | Run GitHub Copilot CLI (MVP) on a coding task and collect objective metrics |
| **Expected Reference Comparison** | Compare agent output against a known-good branch (e.g., successful AI output or human solution) |
| **Core Evaluators** | Provide git-diff analysis, expected-diff similarity scoring, and agentic-judge (AI-based code review) |
| **Reproducible Results** | Same suite configuration + same repository state = identical evaluation results |
| **Structured Output** | Generate JSON results bundles and human-readable Markdown reports |
| **Developer UX** | Simple CLI commands (`yb run`, `yb report`) with clear progress feedback |
| **youBencha Log Standard** | Normalize agent execution logs into consistent JSON format for cross-agent comparison |

### Out of Scope (Initial Release)

❌ **Multi-agent comparison** - Running multiple agents in same suite  
❌ **Sandboxed execution** - Docker/container isolation with network restrictions  
❌ **Cloud service/dashboard** - All interactions via CLI  
❌ **Plugin marketplace** - Distribution system for custom evaluators  
❌ **Natural language agents** - Non-coding conversational agents  
❌ **Live IDE plugins** - Editor integrations  

### Success Metrics

| Metric | Target |
|--------|--------|
| Setup to first evaluation | < 5 minutes for small repos |
| Evaluation reproducibility | 90% of runs produce identical results |
| Agent coverage | Support ≥ 1 agent in MVP (Copilot CLI), easy adapter pattern for others |
| Evaluator plugin API | Clear interface enabling custom evaluators |
| Community adoption | ≥ 3 organizations using youBencha within 6 months of release |

---

## Proposed Solution

### High-Level Architecture

youBencha follows a **pipeline architecture** where each stage transforms data for the next:

```
┌─────────────────────────────────────────────────────────────────┐
│                          yb run -c suite.yaml                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. WORKSPACE SETUP                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │ Clone Repo   │────▶│ src-modified/│     │ src-expected/│   │
│  │ (branch)     │     │ (working)    │     │ (reference)  │   │
│  └──────────────┘     └──────────────┘     └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. AGENT EXECUTION                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │ Agent Adapter│────▶│ Execute Agent│────▶│ youBencha Log│   │
│  │ (copilot-cli)│     │ on src-mod/  │     │ (normalized) │   │
│  └──────────────┘     └──────────────┘     └──────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. EVALUATORS (Parallel Execution)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  git-diff    │  │expected-diff │  │agentic-judge │          │
│  │  (LOC, files)│  │(similarity %)│  │(AI review)   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. RESULTS AGGREGATION                                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  results.json                                               │ │
│  │  ├─ Suite metadata (repo, branch, commit, config hash)     │ │
│  │  ├─ Agent execution details (status, duration, logs)       │ │
│  │  ├─ Evaluator results array (status, metrics, artifacts)   │ │
│  │  └─ Summary (passed/failed/skipped counts, overall status) │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. REPORTING                                                    │
│  yb report --from results.json --format markdown                │
│  ────────────────────────────────────────────────────────────▶  │
│  Human-readable Markdown report with tables, metrics, files     │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Suite Configuration (YAML/JSON)

Defines **what to evaluate** and **how**:

```yaml
# Repository to evaluate
repo: https://github.com/octocat/Hello-World.git
branch: main

# Agent configuration
agent:
  type: copilot-cli
  config:
    prompt: "Add comprehensive error handling to all API endpoints"

# Optional: Expected reference for comparison
expected_source: branch
expected: feature/error-handling-complete

# Evaluators to run
evaluators:
  - name: git-diff
  - name: expected-diff
    config:
      threshold: 0.85  # Require 85% similarity to pass
  - name: agentic-judge
    config:
      assertions:
        - "All API endpoints have try-catch blocks"
        - "Error responses follow REST standards"
        - "Logging is added for all errors"
```

#### 2. Agent Adapters

**Purpose**: Isolate agent-specific logic, execute agents, normalize outputs to youBencha Log format

**Interface**:
```typescript
interface AgentAdapter {
  checkAvailability(): Promise<boolean>;
  execute(context: AgentExecutionContext): Promise<AgentExecutionResult>;
  normalizeLog(output: string, result: AgentExecutionResult): YouBenchaLog;
}
```

**MVP Implementation**: `CopilotCLIAdapter` - executes `gh copilot suggest` with prompts

**Future Adapters**: Claude Code, Cursor, Aider, OpenAI o1, etc.

#### 3. youBencha Log Format

**Purpose**: Standardized JSON schema for agent execution metadata, enabling cross-agent comparison

**Schema**:
```json
{
  "version": "1.0.0",
  "agent": {
    "name": "copilot-cli",
    "version": "1.0.0"
  },
  "model": {
    "name": "gpt-4",
    "provider": "openai",
    "parameters": {
      "temperature": 0.7,
      "max_tokens": 4096
    }
  },
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "total_tokens": 1801,
    "estimated_cost_usd": 0.0234
  },
  "execution": {
    "status": "completed",
    "duration_ms": 12345,
    "started_at": "2025-11-09T12:00:00Z",
    "completed_at": "2025-11-09T12:00:12Z"
  },
  "messages": [...],
  "tool_calls": [...]
}
```

#### 4. Evaluators

**Purpose**: Analyze agent output and produce structured evaluation results

**Built-in Evaluators (MVP)**:

| Evaluator | Type | Metrics | Description |
|-----------|------|---------|-------------|
| `git-diff` | Code-based | `files_changed`, `lines_added`, `lines_removed`, `change_entropy` | Analyzes Git changes made by agent |
| `expected-diff` | Code-based | `aggregate_similarity`, `files_matched`, `files_changed`, `file_similarities` | Compares output against expected reference branch |
| `agentic-judge` | AI-based | `score`, `assertions_met`, `reasoning` | Uses AI agent to review code quality based on natural language assertions |

**Evaluator Interface**:
```typescript
interface Evaluator {
  evaluate(context: EvaluationContext): Promise<EvaluationResult>;
}

interface EvaluationResult {
  evaluator: string;
  status: 'passed' | 'failed' | 'skipped';
  metrics: Record<string, any>;
  message: string;
  duration_ms: number;
  timestamp: string;
  artifacts?: string[];
  error?: { message: string; stack_trace?: string };
}
```

#### 5. Results Bundle

**Purpose**: Complete artifact containing all evaluation data

**Structure**:
```json
{
  "version": "1.0.0",
  "suite": {
    "config_hash": "abc123...",
    "repo": "https://github.com/...",
    "branch": "main",
    "commit": "def456..."
  },
  "execution": {
    "started_at": "2025-11-09T12:00:00Z",
    "completed_at": "2025-11-09T12:01:30Z",
    "duration_ms": 90000,
    "youbencha_version": "0.1.0",
    "environment": {
      "os": "Windows 11",
      "node_version": "20.10.0"
    }
  },
  "agent": {
    "type": "copilot-cli",
    "youbencha_log_path": "youbencha.log.json",
    "status": "completed",
    "exit_code": 0
  },
  "evaluators": [
    {
      "evaluator": "git-diff",
      "status": "passed",
      "metrics": {
        "files_changed": 3,
        "lines_added": 45,
        "lines_removed": 12
      },
      "message": "Changes detected",
      "duration_ms": 234
    },
    {
      "evaluator": "expected-diff",
      "status": "passed",
      "metrics": {
        "aggregate_similarity": 0.87,
        "threshold": 0.85
      },
      "message": "Output matches expected reference (87% similarity)",
      "duration_ms": 456
    }
  ],
  "summary": {
    "total_evaluators": 2,
    "passed": 2,
    "failed": 0,
    "skipped": 0,
    "overall_status": "passed"
  }
}
```

---

## Technical Details

### Technology Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.0+
- **CLI Framework**: Commander.js
- **Schema Validation**: Zod
- **Git Operations**: simple-git
- **Diff Analysis**: diff library
- **Progress UI**: ora (spinners)
- **Configuration**: YAML/JSON parsing

### Key Design Decisions

#### 1. **Why Node.js/TypeScript?**

**Rationale**: 
- Most coding agents (Copilot CLI, Cursor, etc.) are JavaScript/TypeScript native
- npm ecosystem provides easy distribution and plugin management
- Strong typing with TypeScript ensures robust adapter/evaluator contracts
- Cross-platform compatibility (Windows, macOS, Linux)

**Tradeoffs**:
- ✅ Easy adoption for JavaScript/TypeScript developers
- ✅ Rich ecosystem for CLI tooling
- ❌ May require Node.js installation for users unfamiliar with JS ecosystem

#### 2. **Why Pluggable Architecture?**

**Rationale**:
- Agent landscape is fragmented and rapidly evolving
- Teams may need custom evaluators for domain-specific requirements
- Clear interfaces (AgentAdapter, Evaluator) enable community contributions

**Tradeoffs**:
- ✅ Extensibility without core changes
- ✅ Community can add agent support independently
- ❌ Slightly more complex initial implementation

#### 3. **Why Parallel Evaluator Execution?**

**Rationale**:
- Evaluators operate on immutable snapshots (cloned repository state)
- No shared mutable state between evaluators
- Significant performance improvement for suites with multiple evaluators

**Implementation**:
```typescript
const evaluatorPromises = suiteConfig.evaluators.map(async (evalConfig) => {
  const evaluator = this.getEvaluator(evalConfig.name);
  return await evaluator.evaluate(context);
});

const results = await Promise.allSettled(evaluatorPromises);
```

**Tradeoffs**:
- ✅ Faster evaluation (3-5x for typical suites)
- ✅ Isolated failures (one evaluator crash doesn't block others)
- ❌ Slightly more complex error handling

#### 4. **Why Separate Workspace Directories?**

**Rationale**:
- Prevents accidental mutation of source repository
- Enables clean diff comparison (baseline vs modified vs expected)
- Supports future multi-agent runs without workspace conflicts

**Structure**:
```
.youbencha-workspace/
└── run-20251109-120000-abc123/
    ├── src-modified/        # Agent works here
    ├── src-expected/        # Expected reference (if configured)
    ├── artifacts/
    │   ├── youbencha.log.json
    │   ├── results.json
    │   └── evaluator-outputs/
```

#### 5. **Why youBencha Log Standard?**

**Rationale**:
- Different agents produce wildly different log formats
- Cross-agent comparison requires normalized data
- Enable future features like cost tracking, token usage analysis

**Example Normalization (Copilot CLI → youBencha Log)**:
```typescript
normalizeLog(output: string, result: AgentExecutionResult): YouBenchaLog {
  // Extract model info from Copilot CLI output
  const modelMatch = output.match(/model: ([\w-]+)/i);
  
  return {
    version: '1.0.0',
    agent: {
      name: 'copilot-cli',
      version: this.getVersion()
    },
    model: {
      name: modelMatch?.[1] || 'unknown',
      provider: 'openai'
    },
    execution: {
      status: result.status,
      duration_ms: result.durationMs,
      started_at: result.startedAt,
      completed_at: result.completedAt
    },
    messages: this.extractMessages(output),
    tool_calls: []
  };
}
```

### Code Examples

#### Creating a Custom Evaluator

```typescript
import { Evaluator, EvaluationContext, EvaluationResult } from 'youbencha';

export class TestCoverageEvaluator implements Evaluator {
  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    const startTime = Date.now();
    
    try {
      // Run test coverage in modified directory
      const { stdout } = await exec('npm test -- --coverage', {
        cwd: context.modifiedDir
      });
      
      // Parse coverage percentage
      const coverageMatch = stdout.match(/All files\s+\|\s+([\d.]+)/);
      const coverage = parseFloat(coverageMatch?.[1] || '0');
      
      // Check threshold
      const threshold = context.config.min_coverage || 80;
      const passed = coverage >= threshold;
      
      return {
        evaluator: 'test-coverage',
        status: passed ? 'passed' : 'failed',
        metrics: {
          coverage_percent: coverage,
          threshold_percent: threshold
        },
        message: `Test coverage: ${coverage}% (threshold: ${threshold}%)`,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        evaluator: 'test-coverage',
        status: 'skipped',
        metrics: {},
        message: 'Failed to run tests',
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        error: {
          message: error.message
        }
      };
    }
  }
}
```

#### Using youBencha Programmatically

```typescript
import { Orchestrator, suiteConfigSchema } from 'youbencha';
import * as fs from 'fs';
import * as yaml from 'yaml';

// Load suite configuration
const suiteYaml = fs.readFileSync('suite.yaml', 'utf-8');
const suiteConfig = suiteConfigSchema.parse(yaml.parse(suiteYaml));

// Run evaluation
const orchestrator = new Orchestrator({
  keepWorkspace: true,  // Default is true - workspace is kept for inspection
  maxConcurrentEvaluators: 4
});

const results = await orchestrator.runEvaluation(suiteConfig);

// Check overall status
if (results.summary.overall_status === 'passed') {
  console.log('✅ All evaluators passed');
  process.exit(0);
} else {
  console.log('❌ Evaluation failed');
  process.exit(1);
}
```

### Security Considerations

| Risk | Mitigation (MVP) | Future Enhancement |
|------|------------------|-------------------|
| Agent executes malicious code | User responsibility - run in trusted environments only | Docker sandbox with network isolation |
| Repository cloning from untrusted sources | Git operations use standard authentication mechanisms | Add repository allowlist configuration |
| Evaluator arbitrary code execution | Evaluators run in same process (trusted plugins) | Plugin signing and verification system |
| Sensitive data in logs | youBencha Log excludes env vars by default | Add configurable data redaction rules |

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         youBencha CLI                            │
│                         (yb command)                             │
└────────────┬────────────────────────────────────┬────────────────┘
             │                                    │
             ▼                                    ▼
┌─────────────────────────┐        ┌─────────────────────────────┐
│   Command Handlers       │        │   Report Generator          │
│   ├─ run.ts              │        │   ├─ json.ts                │
│   └─ report.ts           │        │   └─ markdown.ts            │
└────────────┬─────────────┘        └─────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Orchestrator                             │
│   Coordinates evaluation workflow:                               │
│   1. Workspace setup   4. Run evaluators (parallel)             │
│   2. Agent execution   5. Aggregate results                      │
│   3. Log normalization 6. Cleanup                                │
└────┬─────────────┬─────────────┬─────────────┬──────────────────┘
     │             │             │             │
     ▼             ▼             ▼             ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│Workspace│  │ Adapters │  │Evaluators│  │ Storage  │
│ Manager │  │          │  │          │  │          │
└─────────┘  └──────────┘  └──────────┘  └──────────┘
     │             │             │             │
     ▼             ▼             ▼             ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│Git Ops  │  │copilot-  │  │git-diff  │  │JSON      │
│(clone,  │  │cli       │  │expected- │  │Files     │
│checkout)│  │          │  │diff      │  │          │
│         │  │(future:  │  │agentic-  │  │          │
│         │  │ claude,  │  │judge     │  │          │
│         │  │ cursor)  │  │          │  │          │
└─────────┘  └──────────┘  └──────────┘  └──────────┘
```

### Data Flow

```
User Input (suite.yaml)
        ↓
[Schema Validation]
        ↓
Suite Configuration Object
        ↓
[Workspace Manager]
        ↓
Isolated Workspace (src-modified/, src-expected/)
        ↓
[Agent Adapter]
        ↓
Agent Execution (mutates src-modified/)
        ↓
[Log Normalization]
        ↓
youBencha Log (JSON)
        ↓
[Evaluators (Parallel)]
        ↓
Evaluation Results Array
        ↓
[Results Aggregation]
        ↓
Results Bundle (JSON) → Storage
        ↓
[Report Generator]
        ↓
Markdown Report → User
```

### Module Responsibilities

| Module | Responsibility | Key Functions |
|--------|---------------|---------------|
| `cli/` | CLI interface, command routing | Parse arguments, display help, invoke commands |
| `core/orchestrator.ts` | Workflow coordination | `runEvaluation()`, orchestrate all stages |
| `core/workspace.ts` | Workspace lifecycle | `createWorkspace()`, `cleanup()`, Git operations |
| `core/env.ts` | Environment detection | Detect OS, Node version, youBencha version |
| `core/storage.ts` | Artifact persistence | Save logs, results, manifest artifacts |
| `adapters/` | Agent execution | `execute()`, `normalizeLog()`, `checkAvailability()` |
| `evaluators/` | Code analysis | `evaluate()`, return structured results |
| `reporters/` | Report generation | Transform results JSON to human-readable formats |
| `schemas/` | Data validation | Zod schemas for suite config, results, logs |
| `lib/` | Shared utilities | Logging, diff utilities, path helpers, progress UI |

### Extension Points

**For Agent Developers:**
```typescript
// Implement AgentAdapter interface
export class MyAgentAdapter implements AgentAdapter {
  async checkAvailability(): Promise<boolean> {
    // Check if 'myagent' CLI is installed
    return commandExists('myagent');
  }

  async execute(context: AgentExecutionContext): Promise<AgentExecutionResult> {
    // Run your agent tool
    const result = await exec(`myagent --prompt "${context.config.prompt}"`, {
      cwd: context.workspaceDir,
      timeout: context.timeout
    });
    
    return {
      status: result.exitCode === 0 ? 'completed' : 'failed',
      exitCode: result.exitCode,
      output: result.stdout,
      error: result.stderr,
      durationMs: result.duration,
      startedAt: result.startTime,
      completedAt: result.endTime
    };
  }

  normalizeLog(output: string, result: AgentExecutionResult): YouBenchaLog {
    // Parse your agent's output format and map to youBencha Log schema
    return {
      version: '1.0.0',
      agent: { name: 'myagent', version: '1.0' },
      // ... rest of mapping
    };
  }
}
```

**For Evaluator Developers:**
```typescript
// Implement Evaluator interface
export class MyEvaluator implements Evaluator {
  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    // Access workspace directories
    const modifiedFiles = await fs.readdir(context.modifiedDir);
    const expectedFiles = context.expectedDir 
      ? await fs.readdir(context.expectedDir)
      : [];
    
    // Perform your analysis
    const myMetric = this.calculateMetric(modifiedFiles, expectedFiles);
    
    // Return structured result
    return {
      evaluator: 'my-evaluator',
      status: myMetric > threshold ? 'passed' : 'failed',
      metrics: { my_metric: myMetric },
      message: `Analysis complete: ${myMetric}`,
      duration_ms: elapsed,
      timestamp: new Date().toISOString()
    };
  }
}
```

---

## Timeline and Milestones

### Phase 1: MVP Development (6-8 weeks)

**Week 1-2: Core Infrastructure**
- ✅ Project setup (TypeScript, Jest, linting)
- ✅ Schema definitions (suite config, results, youBencha log)
- ✅ Workspace management (Git cloning, directory structure)
- ✅ Basic CLI scaffolding (`yb run`, `yb report`)

**Week 3-4: Agent Execution & Logging**
- ✅ AgentAdapter interface and base implementation
- ✅ CopilotCLIAdapter (GitHub Copilot CLI integration)
- ✅ youBencha Log normalization
- ✅ Environment detection and metadata collection

**Week 5-6: Evaluators**
- ✅ Evaluator interface and base implementation
- ✅ git-diff evaluator (file changes, LOC, entropy)
- ✅ expected-diff evaluator (similarity scoring)
- ✅ agentic-judge evaluator (AI code review)
- ✅ Parallel evaluator execution

**Week 7-8: Integration & Polish**
- ✅ Results aggregation and storage
- ✅ Markdown report generator
- ✅ Error handling and resilience
- ✅ Progress feedback UI
- 🔲 Documentation (README, examples)
- 🔲 Integration tests
- 🔲 Example suite configurations

**MVP Release Criteria:**
- All acceptance scenarios from user stories pass
- ≥ 80% test coverage
- Documentation covers setup, basic usage, and custom evaluator creation
- At least 2 example suites (simple and with expected reference)

### Phase 2: Community & Expansion (Weeks 9-12)

**Week 9-10: Community Infrastructure**
- RFC process establishment (this document)
- Contribution guidelines (CONTRIBUTING.md)
- Issue templates (bug reports, feature requests, evaluator proposals)
- CI/CD setup (GitHub Actions for tests, linting, releases)
- npm package publication

**Week 11-12: Extended Features**
- Claude Code adapter implementation
- Build/test/lint evaluators (command-based)
- Enhanced error reporting
- Performance optimizations

### Phase 3: Advanced Features (Weeks 13-20)

**Weeks 13-16: Regression & Dataset Management**
- `yb expected promote` command for golden datasets
- Path-based expected references
- Historical baseline comparison
- Dataset versioning and retention

**Weeks 17-20: Platform & Ecosystem**
- GitHub Actions workflow templates
- Web-based report viewer (HTML export)
- Plugin distribution guidelines
- Multi-agent comparison support

### Long-term Roadmap (6-12 months)

**Q2 2025:**
- Sandbox execution (Docker/DevContainer isolation)
- Network policy controls
- Resource limits (CPU, memory, timeout)
- Security evaluator (vulnerability scanning)

**Q3 2025:**
- Official agent benchmarks published
- Community plugin marketplace
- Cloud-based result storage (optional)
- youBencha Dashboard (web UI)

**Q4 2025:**
- Multi-agent comparative benchmarks
- Cost optimization recommendations
- Semantic diff evaluator (AST-based)
- youBencha Standard adoption by ≥ 3 major agent projects

---

## Success Criteria

### Technical Success

| Criterion | Measurement |
|-----------|-------------|
| **Reproducibility** | 90% of evaluation runs with same config produce identical results (excluding timestamps) |
| **Performance** | Full evaluation completes in < 3 minutes for repos with < 1000 files |
| **Reliability** | < 5% failure rate on standard test suites |
| **Extensibility** | Community contributes ≥ 2 custom evaluators within 3 months of release |
| **Compatibility** | Works on Windows, macOS, Linux with Node.js 20+ |

### Product Success

| Criterion | Measurement |
|-----------|-------------|
| **Adoption** | ≥ 100 npm downloads per week within 3 months |
| **Engagement** | ≥ 10 GitHub stars and 3 contributors within 6 months |
| **Use Cases** | ≥ 3 organizations using youBencha in production within 6 months |
| **Documentation** | ≥ 5 blog posts/tutorials from community within 6 months |

### Community Success

| Criterion | Measurement |
|-----------|-------------|
| **Agent Coverage** | ≥ 3 agent adapters available (Copilot CLI, Claude Code, one community-contributed) |
| **Evaluator Ecosystem** | ≥ 5 evaluators in core + ≥ 3 community plugins |
| **Standard Adoption** | youBencha Log format adopted by ≥ 1 agent project |
| **Feedback Quality** | ≥ 20 GitHub issues opened (indicates active usage) |

### Key Performance Indicators (KPIs)

**Development Phase:**
- Code coverage: ≥ 80%
- Build time: < 30 seconds
- Test suite execution: < 60 seconds
- Zero critical security vulnerabilities (npm audit)

**Post-Launch (First 3 Months):**
- Weekly active users: 50+
- Average evaluation time: < 5 minutes
- Error rate: < 5%
- Documentation coverage: 100% of public APIs

---

## Open Questions

### Technical Questions

| Question | Status | Owner | Notes |
|----------|--------|-------|-------|
| Should we support TOML configuration in addition to YAML/JSON? | Open | Community | YAML sufficient for MVP, revisit based on feedback |
| How should we handle very large repositories (> 1GB)? | Open | Core Team | Consider shallow clones, sparse checkouts in Phase 2 |
| Should evaluators run in isolated processes for safety? | Open | Core Team | Process isolation adds complexity; defer to post-MVP if needed |
| What's the minimum required schema for youBencha Log? | **Needs Discussion** | Core Team | Current schema may be too OpenAI-centric |
| Should we support running evaluators on agent stdout/stderr directly? | Open | Community | Some evaluators (e.g., cost tracking) may need raw logs |

### Product Questions

| Question | Status | Owner | Notes |
|----------|--------|-------|-------|
| Should youBencha maintain an official public agent leaderboard? | Open | Governance | Could drive adoption but requires maintenance |
| How do we prevent "teaching to the test" (over-optimizing for evaluators)? | **Needs Discussion** | Research | Diverse evaluator suite may help; needs best practices guide |
| Should we provide hosted evaluation services (cloud runners)? | Deferred | Business | Not MVP; revisit after community adoption |
| What license is most appropriate for community growth? | Open | Legal | Currently MIT; consider Apache 2.0 for patent protection |

### Ecosystem Questions

| Question | Status | Owner | Notes |
|----------|--------|-------|-------|
| How do we ensure evaluator quality (avoid spam/malicious plugins)? | Open | Governance | Consider plugin verification/signing process |
| Should there be an official "youBencha Certified" program for agents? | Open | Marketing | Could incentivize agent developers to adopt standard |
| How do we handle agent vendors gaming benchmarks? | **Needs Discussion** | Governance | Transparency (publish suite configs), diverse evaluators |
| Should youBencha support proprietary/closed-source agents? | Open | Policy | Yes via adapters, but may limit log normalization capabilities |

### Community & Governance

| Question | Status | Owner | Notes |
|----------|--------|-------|-------|
| What governance model should youBencha adopt? | **Needs RFC** | Founders | Consider BDFL, committee, or foundation models |
| How do we fund ongoing development and infrastructure? | Open | Governance | Options: sponsorships, grants, commercial services |
| Should there be an official youBencha conference or community events? | Deferred | Community | Revisit after 1000+ users |

---

## References

### Related Work

**Agent Testing Frameworks:**
- [LangChain Evaluators](https://python.langchain.com/docs/guides/evaluation/) - Python-based evaluation for LangChain agents
- [RAGAS](https://github.com/explodinggradients/ragas) - Retrieval Augmented Generation Assessment
- [OpenAI Evals](https://github.com/openai/evals) - Evaluation framework for OpenAI models

**Benchmarking Systems:**
- [SWE-bench](https://www.swebench.com/) - Benchmark for evaluating language models on real-world software engineering tasks
- [HumanEval](https://github.com/openai/human-eval) - Code generation benchmark
- [MBPP](https://github.com/google-research/google-research/tree/master/mbpp) - Mostly Basic Python Problems benchmark

**Testing Frameworks (Inspiration):**
- Jest (JavaScript testing) - Parallel execution, clear output
- pytest (Python testing) - Plugin architecture, fixtures
- Cucumber (BDD) - Human-readable test specifications

### Documentation

- [youBencha PRD](./prd.md) - Detailed product requirements
- [Feature Spec](./specs/001-face-framework/spec.md) - MVP feature specification
- [GitHub Repository](https://github.com/yourusername/youbencha) - Source code and issues

### Standards & Specifications

- [youBencha Log Schema](./src/schemas/youbenchalog.schema.ts) - Normalized agent log format
- [Results Bundle Schema](./src/schemas/result.schema.ts) - Evaluation results structure
- [Suite Configuration Schema](./src/schemas/suite.schema.ts) - Evaluation suite definition

---

## Appendix

### Example: Complete Evaluation Flow

**1. User creates suite.yaml:**
```yaml
repo: https://github.com/myorg/api-server.git
branch: main

agent:
  type: copilot-cli
  config:
    prompt: "Add input validation to all POST endpoints using Joi"

expected_source: branch
expected: feature/validation-complete

evaluators:
  - name: git-diff
  - name: expected-diff
    config:
      threshold: 0.80
  - name: agentic-judge
    config:
      assertions:
        - "All POST endpoints have Joi validation schemas"
        - "Validation errors return 400 status codes"
        - "Error messages are user-friendly"
```

**2. User runs evaluation:**
```bash
$ yb run -c suite.yaml

⠋ Setting up workspace...
✔ Workspace created: run-20251109-143052-a7f3d1
⠋ Cloning repository...
✔ Cloned: main @ commit abc123
✔ Cloned expected: feature/validation-complete @ commit def456

Agent prompt: "Add input validation to all POST endpoints using Joi"
Agent type: copilot-cli
Working directory: .youbencha-workspace/run-20251109-143052-a7f3d1/src-modified
Starting agent execution...

[Agent output streams here...]

✔ Agent execution completed: completed
✔ Duration: 45.3s
✔ Exit code: 0
✔ Token usage: 3245 tokens (prompt: 1834, completion: 1411)
✔ Estimated cost: $0.0421

⠋ Running evaluators...
  ⠋ git-diff
  ⠋ expected-diff
  ⠋ agentic-judge

✔ Evaluators completed: 3 results
  ✔ git-diff: passed (234ms)
  ✔ expected-diff: passed (567ms)
  ✔ agentic-judge: passed (12.4s)

✔ Results bundle saved: .youbencha-workspace/run-20251109-143052-a7f3d1/artifacts/results.json
✔ Workspace cleaned up

Evaluation Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Overall Status: ✅ PASSED
  Total Evaluators: 3
  Passed: 3 | Failed: 0 | Skipped: 0
  Duration: 1m 32s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Results saved to: .youbencha-workspace/run-20251109-143052-a7f3d1/artifacts/results.json
Generate report: yb report --from .youbencha-workspace/run-20251109-143052-a7f3d1/artifacts/results.json
```

**3. User generates report:**
```bash
$ yb report --from .youbencha-workspace/run-20251109-143052-a7f3d1/artifacts/results.json

✔ Report generated: evaluation-report.md
```

**4. Report contents (evaluation-report.md):**
```markdown
# youBencha Evaluation Report

**Overall Status:** ✅ PASSED  
**Date:** 2025-11-09 14:32:24  
**Duration:** 1m 32s

## Suite Configuration

- **Repository:** https://github.com/myorg/api-server.git
- **Branch:** main
- **Commit:** abc123
- **Expected Branch:** feature/validation-complete (def456)
- **Agent:** copilot-cli

## Summary

| Metric | Value |
|--------|-------|
| Total Evaluators | 3 |
| Passed | 3 |
| Failed | 0 |
| Skipped | 0 |

## Evaluator Results

### ✅ git-diff (234ms)

Changes detected

| Metric | Value |
|--------|-------|
| Files Changed | 5 |
| Lines Added | 123 |
| Lines Removed | 34 |
| Change Entropy | 0.42 |

### ✅ expected-diff (567ms)

Output matches expected reference (87% similarity)

| Metric | Value |
|--------|-------|
| Aggregate Similarity | 87.0% |
| Threshold | 80.0% |
| Files Matched | 3 |
| Files Changed | 2 |

#### File-level Details

| File | Similarity | Status |
|------|-----------|--------|
| src/routes/users.ts | 85.2% | 🔄 changed |
| src/routes/posts.ts | 92.1% | 🔄 changed |
| src/middleware/validation.ts | 100.0% | ✓ matched |
| package.json | 100.0% | ✓ matched |
| src/schemas/user.schema.ts | 100.0% | ✓ matched |

### ✅ agentic-judge (12.4s)

All assertions met - validation implementation is complete and follows best practices

| Metric | Value |
|--------|-------|
| Assertions Met | 3/3 |
| Score | 0.95 |

**Criteria Evaluation:**
- ✅ All POST endpoints have Joi validation schemas
- ✅ Validation errors return 400 status codes
- ✅ Error messages are user-friendly

**Reasoning:**
The agent successfully added Joi validation to all 4 POST endpoints (/users, /posts, /comments, /auth/register). Each endpoint now validates request bodies before processing, returns standardized 400 responses for validation failures, and provides clear error messages indicating which fields failed validation. The implementation follows Joi best practices with reusable schemas.

---

*Generated by youBencha v0.1.0*
```

### Glossary

- **Agent**: An AI-powered coding tool that can read code, make changes, and write files (e.g., GitHub Copilot CLI, Claude Code)
- **Adapter**: A youBencha component that interfaces with a specific agent tool and normalizes its outputs
- **Evaluator**: A pluggable component that analyzes agent output and produces evaluation results
- **Suite**: A configuration file defining a complete evaluation workflow (repo, agent, evaluators)
- **youBencha Log**: Standardized JSON format for agent execution metadata, enabling cross-agent comparison
- **Expected Reference**: A baseline for comparison (e.g., a Git branch with known-good output)
- **Results Bundle**: Complete artifact containing suite config, agent execution details, evaluator results, and metadata
- **Workspace**: Isolated directory structure where agent execution and evaluation occur

---

## Feedback & Discussion

This RFC is open for community feedback. Please share your thoughts on:

1. **Use Cases**: Are there evaluation scenarios not covered by this design?
2. **Architecture**: Are there better approaches to agent adapters, evaluators, or workspace management?
3. **youBencha Log Standard**: Is the proposed schema sufficient for cross-agent comparison?
4. **Priorities**: Should any features be moved into or out of the MVP?
5. **Naming**: Is "youBencha" (pun on "you benchmark") clear and appropriate?

**Discussion Channels:**
- GitHub Issues: [youbencha/issues](https://github.com/yourusername/youbencha/issues)
- GitHub Discussions: [youbencha/discussions](https://github.com/yourusername/youbencha/discussions)
- RFC Pull Request: [Link to PR]

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-09  
**Status:** Draft - Seeking Community Feedback
