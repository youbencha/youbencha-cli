# youBencha Benchmark Suite

This directory contains benchmark repositories and evaluation suites for testing AI coding agents with youBencha.

## Overview

Benchmarks are organized by category and difficulty level. Each benchmark provides:
- A starting repository state
- A clear task description
- An expected outcome (reference implementation)
- A youBencha evaluation suite

## Benchmark Categories

### 1. Documentation & README Tasks
Simple, low-risk tasks that test basic comprehension and writing ability.

- **1.1-add-installation-instructions**: Add installation section to README
- **1.2-generate-api-documentation**: Add JSDoc comments to functions
- **1.3-fix-markdown-formatting**: Clean up inconsistent markdown

### 2. Bug Fixes & Error Handling
Testing debugging and error handling capabilities.

- **2.1-fix-null-pointer**: Fix null/undefined error with proper checking
- **2.2-add-error-handling**: Add comprehensive try-catch and logging
- **2.3-fix-memory-leak**: Identify and fix event listener leak

### 3. Test Writing & TDD
Evaluating test writing capabilities and coverage.

- **3.1-add-unit-tests**: Write unit tests with edge cases
- **3.2-write-integration-tests**: Create API integration tests
- **3.3-add-test-factories**: Create test data factories

### 4. Refactoring & Code Quality
Higher-order tasks requiring code comprehension and improvement.

- **4.1-extract-duplicate-code**: DRY refactoring into utility
- **4.2-refactor-long-function**: Break down complex function
- **4.3-callbacks-to-async-await**: Modernize async patterns

### 5. Feature Implementation
Complex end-to-end feature additions.

- **5.1-add-authentication**: Implement JWT auth middleware
- **5.2-add-pagination**: Add database and API pagination
- **5.3-add-rate-limiting**: Implement rate limiting with Redis

### 6. Security & Vulnerability Fixes
Critical security awareness and secure coding.

- **6.1-fix-sql-injection**: Replace string concat with parameterized queries
- **6.2-add-input-validation**: Implement Zod validation
- **6.3-fix-xss**: Sanitize user content and add CSP

### 7. Configuration & Build Setup
DevOps and tooling setup tasks.

- **7.1-add-typescript**: Convert JS project to TypeScript
- **7.2-add-eslint**: Set up linting configuration
- **7.3-add-ci-pipeline**: Create GitHub Actions workflow

### 8. Migration & Upgrade Tasks
Systematic code transformations and upgrades.

- **8.1-commonjs-to-esm**: Migrate to ES modules
- **8.2-upgrade-deprecated-api**: Update to new API
- **8.3-rest-to-graphql**: Migrate endpoints to GraphQL

## Difficulty Levels

### 🟢 Easy (1-2 files, <50 lines)
Quick tasks testing basic capabilities: 1.1, 1.3, 2.1, 7.2

### 🟡 Medium (3-5 files, 50-200 lines)
Real-world tasks requiring coordination: 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 6.1, 6.2, 7.1

### 🔴 Hard (5+ files, 200+ lines)
Complex tasks requiring deep understanding: 4.3, 5.2, 5.3, 6.3, 8.1, 8.2, 8.3

## Benchmark Structure

Each benchmark follows this structure:

```
benchmark-{category}-{number}-{name}/
├── README.md                  # Benchmark overview
├── task.md                    # Task description for the agent
├── suite.yaml                 # youBencha evaluation configuration
├── initial/                   # Starting repository state
│   ├── src/
│   ├── tests/
│   └── package.json
└── expected/                  # Expected outcome (reference)
    ├── src/
    └── tests/
```

## Running Benchmarks

### Single Benchmark

```bash
# Run a specific benchmark
yb run -c benchmarks/1.1-add-installation-instructions/suite.yaml

# View results
yb report --from .youbencha-workspace/run-*/artifacts/results.json
```

### Benchmark Suites

```bash
# Quick validation suite (4 easy benchmarks, ~10 min)
yb run -c benchmarks/suites/quick-validation.yaml

# Development workflow suite (5 medium benchmarks, ~30 min)
yb run -c benchmarks/suites/development-workflow.yaml

# Advanced engineering suite (5 hard benchmarks, ~60 min)
yb run -c benchmarks/suites/advanced-engineering.yaml

# Security & quality suite (5 specialized, ~45 min)
yb run -c benchmarks/suites/security-quality.yaml

# Comprehensive suite (all 24 benchmarks, ~120 min)
yb run -c benchmarks/suites/comprehensive.yaml
```

## Creating New Benchmarks

Follow these steps to add a new benchmark:

1. **Choose Category & Number**: Select appropriate category (1-8) and next available number
2. **Create Structure**: Use the benchmark template structure
3. **Write Task Description**: Clear, specific task in `task.md`
4. **Prepare Initial State**: Working repository in `initial/` directory
5. **Create Reference**: Ideal solution in `expected/` directory
6. **Configure Evaluation**: Define evaluators in `suite.yaml`
7. **Test**: Run benchmark with multiple agents to validate
8. **Document**: Update this README and main docs

## Evaluation Criteria

Each benchmark uses multiple evaluators:

- **git-diff**: Track scope and focus of changes
- **expected-diff**: Compare against reference implementation
- **tests**: Ensure tests pass
- **lint/typecheck/build**: Validate code quality
- **agentic-judge-***: Specialized quality assessments

## Agent Comparison

Run benchmarks across multiple agents to compare:

- **Success Rate**: % of benchmarks producing working code
- **Quality Score**: Average across evaluators
- **Change Efficiency**: Lines changed vs. expected
- **Test Safety**: % maintaining passing tests
- **Time & Tokens**: Performance metrics
- **Security**: % of security benchmarks passed

## Contributing

To contribute benchmarks:

1. Review existing benchmarks for consistency
2. Follow the benchmark structure template
3. Test with at least 2 different agents
4. Ensure evaluation criteria are objective
5. Document expected outcomes clearly
6. Submit PR with benchmark and validation results

## Benchmark Status

| ID | Name | Status | Difficulty | Validated Agents |
|----|------|--------|------------|------------------|
| 1.1 | Add Installation Instructions | 🟢 Ready | Easy | - |
| 1.2 | Generate API Documentation | 📝 Planned | Easy | - |
| 1.3 | Fix Markdown Formatting | 📝 Planned | Easy | - |
| 2.1 | Fix Null Pointer | 📝 Planned | Easy | - |
| 2.2 | Add Error Handling | 📝 Planned | Medium | - |
| ... | ... | ... | ... | ... |

Legend:
- 🟢 Ready: Benchmark complete and tested
- 🚧 In Progress: Being developed
- 📝 Planned: Designed but not implemented
- ✅ Validated: Tested with multiple agents

## Resources

- [Use Cases and Benchmarks Documentation](../docs/use-cases-and-benchmarks.md)
- [youBencha Getting Started Guide](../GETTING-STARTED.md)
- [Evaluation Best Practices](../docs/evaluation-best-practices.md)

## License

Same as youBencha project (MIT)
