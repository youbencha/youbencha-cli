# youBencha for Test-Driven Developers

**TL;DR:** If you write tests, you already understand youBencha. This guide maps concepts you know from testing to youBencha's evaluation system.

---

## Mental Model: Evaluation ≈ Testing

youBencha evaluates AI agent code changes the same way you test regular code:

| You Already Know | youBencha Equivalent | Example |
|-----------------|---------------------|---------|
| **Test Suite** | Evaluation Suite (`suite.yaml`) | `describe("Authentication")` → `repo: myapp, evaluators: [...]` |
| **Test Case** | Evaluator | `it("validates JWT")` → `name: agentic-judge, criteria: [...]` |
| **Assertion** | Evaluation Criterion | `expect(isValid).toBe(true)` → `"JWT tokens properly validated"` |
| **Test Fixture** | Workspace | `beforeEach(() => setupDB())` → `modifiedDir: /workspace/src-modified` |
| **Test Runner** | CLI (`yb run`) | `jest` → `yb run -c suite.yaml` |
| **Test Report** | Evaluation Report | `jest --coverage` → `yb report --from results.json` |

---

## Quick Start: Your First "Test"

### As a Jest Test
```javascript
describe("Adding auth feature", () => {
  it("should have JWT validation", () => {
    const code = readFile("src/auth.ts");
    expect(code).toContain("jwt.verify");
  });
  
  it("should handle errors", () => {
    const code = readFile("src/auth.ts");
    expect(code).toMatch(/try.*catch/);
  });
});
```

### As a youBencha Evaluation
```yaml
# suite.yaml
repo: https://github.com/myorg/myapp
branch: feature/add-auth

agent:
  type: copilot-cli

evaluators:
  - name: agentic-judge
    config:
      criteria:
        jwt_validation_present: "Code includes JWT token validation"
        error_handling_present: "Error handling with try-catch blocks"
```

**Run it:**
```bash
yb run -c suite.yaml
```

---

## Core Concepts

### 1. Test Suites → Evaluation Suites

**Jest:**
```javascript
describe("User Management", () => {
  describe("Authentication", () => {
    it("validates tokens", () => { ... });
  });
  
  describe("Authorization", () => {
    it("checks permissions", () => { ... });
  });
});
```

**youBencha:**
```yaml
# auth-suite.yaml
evaluators:
  - name: agentic-judge
    config:
      criteria:
        - "JWT tokens validated"
        - "Permission checks implemented"
```

### 2. Assertions → Evaluation Criteria

**Jest:**
```javascript
expect(response.status).toBe(200);
expect(response.data).toHaveProperty("token");
expect(token).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
```

**youBencha:**
```yaml
criteria:
  http_status: "API returns 200 for valid requests"
  token_format: "JWT tokens follow RFC 7519 format"
  response_structure: "Response includes token property"
```

### 3. Test Setup/Teardown → Workspace Management

**Jest:**
```javascript
let testDB;

beforeEach(async () => {
  testDB = await createTestDB();
  await seedData(testDB);
});

afterEach(async () => {
  await testDB.cleanup();
});
```

**youBencha:**
```yaml
# Automatic workspace management
# Before: Clone repo to isolated directory
# After: Optionally keep or clean up (--keep-workspace flag)
```

No manual setup needed - youBencha handles it!

### 4. Test Runners → CLI

**Jest:**
```bash
jest                          # Run all tests
jest auth.test.js            # Run specific test
jest --watch                 # Watch mode
jest --coverage              # With coverage
```

**youBencha:**
```bash
yb run -c suite.yaml              # Run evaluation
yb run -c auth-suite.yaml         # Run specific suite
yb run -c suite.yaml --keep       # Keep workspace for inspection
yb report --from results.json     # Generate report
```

---

## Advanced Patterns

### Pattern 1: Smoke Tests

**Jest:**
```javascript
describe("Smoke Tests", () => {
  it("app should start", () => {
    expect(app.isRunning()).toBe(true);
  });
  
  it("critical routes exist", () => {
    expect(routes).toContain("/api/health");
  });
});
```

**youBencha (Proposed):**
```yaml
evaluators:
  - name: smoke  # Future evaluator
    config:
      checks:
        - type: file-exists
          files: [src/main.ts, package.json]
        - type: syntax-valid
          language: typescript
```

### Pattern 2: Integration Tests

**Jest:**
```javascript
describe("Auth Integration", () => {
  it("login flow works end-to-end", async () => {
    const loginResponse = await api.post("/auth/login", credentials);
    expect(loginResponse.status).toBe(200);
    
    const protectedResponse = await api.get("/profile", {
      headers: { Authorization: loginResponse.data.token }
    });
    expect(protectedResponse.status).toBe(200);
  });
});
```

**youBencha:**
```yaml
evaluators:
  - name: agentic-judge
    config:
      criteria:
        complete_auth_flow: "Login endpoint returns token, protected endpoints accept token"
        end_to_end_working: "Full authentication flow is functional"
```

### Pattern 3: Regression Tests

**Jest:**
```javascript
describe("Regression: #1234", () => {
  it("should not reintroduce memory leak", () => {
    const before = process.memoryUsage().heapUsed;
    runOperation();
    const after = process.memoryUsage().heapUsed;
    expect(after - before).toBeLessThan(1024 * 1024); // <1MB
  });
});
```

**youBencha:**
```yaml
# Compare against known-good baseline
expected_source: branch
expected: bugfix/memory-leak-resolved

evaluators:
  - name: expected-diff
    config:
      threshold: 0.95  # Should be very similar to fix
  
  - name: agentic-judge
    config:
      criteria:
        no_memory_leak: "Memory cleanup implemented properly"
```

---

## Common Testing Patterns

### ✅ Test Coverage → Evaluation Coverage

**Jest:**
```bash
jest --coverage
# Coverage: 85% statements, 80% branches
```

**youBencha (Proposed):**
```yaml
evaluators:
  - name: coverage  # Future evaluator
    config:
      critical_files:
        - src/auth/*.ts
        - src/api/*.ts
      require_coverage: 100%
```

### ✅ Flaky Test Detection → Stability Evaluation

**Jest:**
```javascript
// Mark as flaky
it.skip("sometimes fails", () => { ... });
```

**youBencha (Proposed):**
```yaml
evaluators:
  - name: stability  # Future evaluator
    config:
      evaluator: agentic-judge
      runs: 5
      consistency_threshold: 0.9
```

### ✅ Parameterized Tests → Criteria Variations

**Jest:**
```javascript
test.each([
  { input: "admin", expected: true },
  { input: "user", expected: false },
])("role $input has access: $expected", ({ input, expected }) => {
  expect(hasAccess(input)).toBe(expected);
});
```

**youBencha:**
```yaml
criteria:
  admin_access: "Admin role has full access"
  user_access: "User role has limited access"
  guest_access: "Guest role has read-only access"
```

---

## Best Practices

### 1. Make Criteria Specific (Like Good Test Names)

❌ **Bad:**
```yaml
criteria:
  - "Code quality is good"
  - "Tests exist"
```

✅ **Good:**
```yaml
criteria:
  error_handling: "All async functions have try-catch blocks"
  test_coverage: "All CRUD operations have unit tests"
  validation: "API endpoints validate input with Zod schemas"
```

### 2. Use Expected References (Like Baseline Tests)

**Jest:**
```javascript
it("matches snapshot", () => {
  expect(render()).toMatchSnapshot();
});
```

**youBencha:**
```yaml
expected_source: branch
expected: feature/completed-correctly

evaluators:
  - name: expected-diff
    config:
      threshold: 0.85
```

### 3. Organize by Concern (Like Test Organization)

**Jest:**
```
tests/
  unit/
    auth.test.ts
    api.test.ts
  integration/
    e2e.test.ts
```

**youBencha:**
```
suites/
  unit-checks.yaml       # Quick, focused evaluations
  integration.yaml       # End-to-end evaluation
  comprehensive.yaml     # Full quality review
```

---

## Real-World Examples

### Example 1: API Feature Addition

**As Jest Tests:**
```javascript
describe("User API", () => {
  describe("POST /users", () => {
    it("creates user with valid data", async () => {
      const res = await api.post("/users", validUser);
      expect(res.status).toBe(201);
    });
    
    it("validates required fields", async () => {
      const res = await api.post("/users", {});
      expect(res.status).toBe(400);
    });
    
    it("prevents duplicate emails", async () => {
      await api.post("/users", user);
      const res = await api.post("/users", user);
      expect(res.status).toBe(409);
    });
  });
});
```

**As youBencha Evaluation:**
```yaml
repo: https://github.com/myorg/api
branch: feature/user-api

evaluators:
  - name: git-diff  # Track scope of changes
  
  - name: agentic-judge
    config:
      criteria:
        endpoint_created: "POST /users endpoint implemented"
        validation_present: "Input validation for required fields"
        duplicate_check: "Email uniqueness constraint enforced"
        proper_status_codes: "Returns 201 for success, 400 for validation, 409 for conflict"
        error_responses: "Error responses include helpful messages"
```

### Example 2: Refactoring

**As Jest Tests:**
```javascript
describe("Payment Refactoring", () => {
  it("preserves existing behavior", () => {
    const oldResult = oldImplementation(input);
    const newResult = newImplementation(input);
    expect(newResult).toEqual(oldResult);
  });
});
```

**As youBencha Evaluation:**
```yaml
repo: https://github.com/myorg/payments
branch: refactor/async-await
expected_source: branch
expected: main  # Compare to pre-refactor

evaluators:
  - name: expected-diff
    config:
      threshold: 0.90  # Should be highly similar
  
  - name: agentic-judge
    config:
      criteria:
        callbacks_removed: "All callbacks converted to async/await"
        behavior_preserved: "Functionality unchanged"
        error_handling_maintained: "Error handling logic preserved"
```

---

## FAQ

### Q: Is this just testing with extra steps?
**A:** No - youBencha tests *the agent that wrote the code*, not the code itself. Traditional tests verify runtime behavior. youBencha evaluates if the agent followed your instructions and produced quality code.

### Q: Can I use both traditional tests AND youBencha?
**A:** Absolutely! Recommended flow:
1. Agent writes code
2. youBencha evaluates quality (did agent follow instructions?)
3. Traditional tests run (does code work correctly?)

### Q: What if my criteria is subjective?
**A:** That's where agentic-judge shines - it can handle nuanced criteria like "code is readable" or "comments are helpful". But try to be specific: "Functions under 50 lines" beats "code is clean".

### Q: How do I debug failing evaluations?
**A:** Just like debugging test failures:
1. Read the evaluation message
2. Look at the workspace (`--keep-workspace` flag)
3. Check which criteria failed
4. Adjust agent prompt or criteria as needed

---

## Migration Guide: From Tests to Evaluations

If you have existing tests, here's how to think about evaluations:

### Unit Tests → Pattern/Smoke Evaluators
Your unit tests check specific functions work correctly.  
Evaluators check specific patterns exist in code.

### Integration Tests → Agentic Judge
Your integration tests verify components work together.  
Agentic judge verifies components are properly integrated.

### E2E Tests → Still Run E2E Tests!
E2E tests verify runtime behavior.  
youBencha evaluates code quality.  
**You need both!**

---

## Next Steps

1. **Write your first suite:** Start with `git-diff` and one `agentic-judge` criterion
2. **Add expected reference:** If you have a "correct" implementation, use `expected-diff`
3. **Iterate on criteria:** Refine based on evaluation results
4. **Integrate in CI:** Run evaluations on every agent-generated PR

---

## Further Reading

- [Evaluator Recommendations](./EVALUATOR_RECOMMENDATIONS.md) - Detailed proposals for new evaluator types
- [RFC-001](../RFC-001-youBencha-Framework.md) - Framework design philosophy
- [Examples](../examples/) - Sample evaluation suites

---

*Remember: You're not learning a new paradigm - you're applying testing concepts you already know to evaluate AI-generated code. If it feels unfamiliar, ask: "How would I test this with Jest/Pytest/JUnit?" and adapt that approach.*
