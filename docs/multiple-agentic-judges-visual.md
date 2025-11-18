# Multiple Agentic Judge Evaluators - Visual Guide

## Problem: Single Judge with Too Many Assertions

```
┌─────────────────────────────────────────────────────┐
│           agentic-judge (single)                    │
│                                                     │
│  Context Window: OVERLOADED ⚠️                     │
│                                                     │
│  Assertions (10+):                                  │
│  ✓ has_error_handling                              │
│  ✓ errors_logged                                    │
│  ✓ functions_documented                             │
│  ✓ comments_clear                                   │
│  ✓ no_console_log                                   │
│  ✓ uses_proper_types                                │
│  ✓ follows_conventions                              │
│  ✓ has_tests                                        │
│  ✓ tests_comprehensive                              │
│  ✓ security_best_practices                          │
│                                                     │
│  Result: Single pass/fail status                   │
│  Problem: Hard to know which area failed           │
└─────────────────────────────────────────────────────┘
```

## Solution: Multiple Focused Judges

```
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│ agentic-judge-         │  │ agentic-judge-         │  │ agentic-judge-         │
│ error-handling         │  │ documentation          │  │ best-practices         │
│                        │  │                        │  │                        │
│ Context: FOCUSED ✓     │  │ Context: FOCUSED ✓     │  │ Context: FOCUSED ✓     │
│                        │  │                        │  │                        │
│ Assertions (2-3):      │  │ Assertions (2-3):      │  │ Assertions (2-3):      │
│ ✓ has_error_handling   │  │ ✓ functions_documented │  │ ✓ no_console_log       │
│ ✓ errors_logged        │  │ ✓ comments_clear       │  │ ✓ uses_proper_types    │
│                        │  │                        │  │ ✓ follows_conventions  │
│ Result: ✅ PASSED      │  │ Result: ❌ FAILED      │  │ Result: ✅ PASSED      │
└────────────────────────┘  └────────────────────────┘  └────────────────────────┘
        ↓                           ↓                            ↓
        │                           │                            │
        └───────────────────────────┴────────────────────────────┘
                                    ↓
                      ┌──────────────────────────────┐
                      │   Clear Results Report       │
                      │                              │
                      │  Overall: PARTIAL            │
                      │                              │
                      │  ✅ Error Handling: PASSED   │
                      │  ❌ Documentation: FAILED    │
                      │  ✅ Best Practices: PASSED   │
                      │                              │
                      │  Action: Fix documentation   │
                      └──────────────────────────────┘
```

## Execution Flow

```
Test Case Configuration (testcase-multiple-judges.yaml)
│
├── agent: copilot-cli
│   └── prompt: "Add error handling to API client"
│
└── evaluators: (run in parallel)
    │
    ├── git-diff
    │   └── Tracks: files changed, lines added/removed
    │
    ├── agentic-judge-error-handling
    │   ├── Evaluates: try-catch blocks, error messages, logging
    │   └── Output: Individual metrics + pass/fail status
    │
    ├── agentic-judge-documentation
    │   ├── Evaluates: JSDoc, error docs
    │   └── Output: Individual metrics + pass/fail status
    │
    └── agentic-judge-best-practices
        ├── Evaluates: code quality, conventions
        └── Output: Individual metrics + pass/fail status

Results Bundle (results.json)
│
└── evaluators: [
      {
        "evaluator": "git-diff",
        "status": "passed",
        "metrics": { "files_changed": 3, ... }
      },
      {
        "evaluator": "agentic-judge-error-handling",
        "status": "passed",
        "metrics": { 
          "has_try_catch": 1,
          "errors_logged": 1
        }
      },
      {
        "evaluator": "agentic-judge-documentation",
        "status": "failed",
        "metrics": { 
          "functions_documented": 0.5,
          "error_types_documented": 0
        }
      },
      {
        "evaluator": "agentic-judge-best-practices",
        "status": "passed",
        "metrics": { 
          "no_console_log": 1,
          "proper_error_types": 1
        }
      }
    ]

Markdown Report (report.md)
│
├── Summary
│   └── Overall: PARTIAL (1 failed, 3 passed)
│
├── Evaluator Results
│   ├── ✅ git-diff: PASSED
│   ├── ✅ agentic-judge-error-handling: PASSED
│   ├── ❌ agentic-judge-documentation: FAILED ← Action needed!
│   └── ✅ agentic-judge-best-practices: PASSED
│
└── Detailed Metrics
    └── [Per-evaluator breakdown with specific scores]
```

## Benefits Visualization

### Before (Single Judge)
```
Evaluation Time:    ████████████ (12 min)
Context Pollution:  ████████████ (High)
Clarity:           ████         (Low)
Debuggability:     ████         (Hard to pinpoint issues)
Parallelization:   ░░░░░░░░░░░░ (N/A - single judge)
```

### After (Multiple Judges)
```
Evaluation Time:    ████         (4 min per judge, parallel)
Context Pollution:  ████         (Low - focused context)
Clarity:           ████████████ (High - clear areas)
Debuggability:     ████████████ (Easy - isolated failures)
Parallelization:   ████████████ (3 judges run concurrently)
```

## Real-World Example

### Scenario: Adding Authentication Feature

**Test Case:** Add JWT authentication with error handling

**Configuration:**
```yaml
evaluators:
  - name: git-diff
  
  - name: agentic-judge-security
    config:
      assertions:
        jwt_secret_secure: "JWT secret is properly secured. Score 1 if env variable, 0 if hardcoded."
        password_hashed: "Passwords are hashed before storage. Score 1 if bcrypt/argon2, 0 if plaintext."
        
  - name: agentic-judge-error-handling
    config:
      assertions:
        auth_errors_handled: "Authentication errors handled gracefully. Score 1 if proper messages, 0 if generic."
        rate_limiting: "Rate limiting implemented for auth endpoints. Score 1 if present, 0 if absent."
        
  - name: agentic-judge-tests
    config:
      assertions:
        auth_tests_present: "Tests cover authentication flows. Score 1 if comprehensive, 0 if absent."
        edge_cases_tested: "Tests include edge cases (invalid tokens, expired, etc). Score 1 if yes, 0 if no."
```

**Results:**
```
✅ git-diff: PASSED (5 files changed, within limits)
✅ agentic-judge-security: PASSED (JWT secret secure, passwords hashed)
❌ agentic-judge-error-handling: FAILED (rate limiting missing)
✅ agentic-judge-tests: PASSED (comprehensive tests with edge cases)

Action Required: Add rate limiting to authentication endpoints
```

## Migration Example

### Old Configuration (Single Judge)
```yaml
evaluators:
  - name: agentic-judge
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        error_handling_complete: "..."
        errors_properly_logged: "..."
        functions_documented: "..."
        comments_clear: "..."
        no_debug_statements: "..."
        proper_types_used: "..."
        follows_style_guide: "..."
        tests_comprehensive: "..."
        tests_cover_errors: "..."
        security_no_sql_injection: "..."
```

### New Configuration (Multiple Judges)
```yaml
evaluators:
  - name: agentic-judge-error-handling
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        error_handling_complete: "..."
        errors_properly_logged: "..."
  
  - name: agentic-judge-documentation
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        functions_documented: "..."
        comments_clear: "..."
  
  - name: agentic-judge-code-quality
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        no_debug_statements: "..."
        proper_types_used: "..."
        follows_style_guide: "..."
  
  - name: agentic-judge-testing
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        tests_comprehensive: "..."
        tests_cover_errors: "..."
  
  - name: agentic-judge-security
    config:
      type: copilot-cli
      agent_name: agentic-judge
      assertions:
        security_no_sql_injection: "..."
```

**Result:**
- 5 independent pass/fail statuses instead of 1
- Easier to identify what needs fixing
- Each judge focuses on 2-3 related assertions
- Parallel execution for faster overall evaluation
