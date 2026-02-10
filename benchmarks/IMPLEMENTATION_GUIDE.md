# Benchmark Implementation Guide

This guide provides step-by-step instructions for implementing the remaining benchmarks in the youBencha suite.

## Quick Reference

Use this template structure for each benchmark:

```
benchmarks/{category}.{number}-{name}/
├── README.md          # Overview and learning objectives
├── task.md            # Task description for the agent
├── suite.yaml         # youBencha evaluation suite
├── initial/           # Starting repository state
│   ├── package.json
│   ├── README.md (if applicable)
│   ├── src/
│   └── tests/ (if applicable)
└── expected/          # Reference implementation
    ├── package.json
    ├── README.md (if changed)
    ├── src/
    └── tests/ (if changed)
```

## Implementation Checklist

For each benchmark:

- [ ] Create directory structure
- [ ] Write README.md with:
  - Overview and objectives
  - Starting state description
  - Expected outcome checklist
  - Evaluation criteria
  - Learning objectives
  - Common failure modes
- [ ] Write task.md with:
  - Clear objective
  - Specific requirements
  - What NOT to do
  - Success criteria
  - Context
- [ ] Create initial/ directory with:
  - Working code in starting state
  - Realistic project structure
  - Any configuration files
- [ ] Create expected/ directory with:
  - Reference implementation
  - Only changed files need to be complete
  - Unchanged files can be symlinked
- [ ] Write suite.yaml with:
  - Appropriate evaluators (3-5 recommended)
  - Clear assertions and thresholds
  - Metadata (category, difficulty, etc.)
- [ ] Test the benchmark:
  - Run with at least one agent
  - Verify evaluators work correctly
  - Adjust thresholds if needed
- [ ] Document in benchmarks/README.md

## Priority Order for Implementation

### Phase 1: Easy Benchmarks (Week 1)
1. ✅ 1.1 Add Installation Instructions - COMPLETE
2. 1.3 Fix Markdown Formatting
3. 2.1 Fix Null Pointer
4. 7.2 Add ESLint Configuration

**Rationale**: These are quick to implement and test basic agent capabilities. They establish the benchmark pattern and can be completed quickly.

### Phase 2: Medium Benchmarks (Weeks 2-3)
5. 2.2 Add Error Handling
6. 3.1 Add Unit Tests
7. 3.2 Write Integration Tests
8. 4.1 Extract Duplicate Code
9. 4.2 Refactor Long Function
10. 5.1 Add Authentication
11. 6.1 Fix SQL Injection
12. 6.2 Add Input Validation
13. 7.1 Add TypeScript

**Rationale**: These represent core development tasks. They require more setup but are still manageable. Focus on quality over quantity.

### Phase 3: Hard Benchmarks (Weeks 4-5)
14. 4.3 Callbacks to Async/Await
15. 5.2 Add Pagination
16. 5.3 Add Rate Limiting
17. 6.3 Fix XSS
18. 8.1 CommonJS to ESM
19. 8.2 Upgrade Deprecated API
20. 8.3 REST to GraphQL

**Rationale**: Complex tasks requiring substantial setup. Should be implemented after learning from easier benchmarks.

### Phase 4: Documentation & Suites (Week 6)
21. 1.2 Generate API Documentation
22. 2.3 Fix Memory Leak
23. 3.3 Add Test Factories
24. 7.3 Add CI Pipeline

Plus:
- Create benchmark suite configurations (quick-validation, development-workflow, etc.)
- Run comprehensive validation
- Document results and insights

## Detailed Steps for Each Benchmark

### Step 1: Research and Design (30-60 minutes)

1. **Understand the use case**
   - Read the description in docs/use-cases-and-benchmarks.md
   - Think about real-world scenarios where this task occurs
   - Consider what makes this task challenging for agents

2. **Define success criteria**
   - What must the agent accomplish?
   - What constraints must it respect?
   - What quality standards apply?

3. **Choose evaluators**
   - git-diff: Always include for scope tracking
   - expected-diff: Include when there's a clear reference
   - tests/lint/build: Include when applicable
   - agentic-judge: Create 2-3 focused judges for quality aspects

### Step 2: Create Initial State (1-2 hours)

1. **Set up project structure**
   ```bash
   mkdir -p benchmarks/{category}.{number}-{name}/{initial,expected}
   cd benchmarks/{category}.{number}-{name}/initial
   npm init -y  # If Node.js project
   ```

2. **Write realistic code**
   - Not toy examples - code that looks like real projects
   - Include comments where natural
   - Ensure code works (can run/build/test)

3. **Add necessary files**
   - package.json with dependencies
   - Configuration files (.eslintrc, tsconfig.json, etc.)
   - README if the benchmark involves documentation

4. **Test the initial state**
   ```bash
   npm install
   npm test  # If tests exist
   npm run build  # If build exists
   ```

### Step 3: Create Expected Outcome (1-2 hours)

1. **Implement the ideal solution**
   - Follow the task description exactly
   - Apply best practices
   - Make minimal, focused changes

2. **Document why it's ideal**
   - Add comments explaining key decisions
   - Keep it simple but complete

3. **Test the expected state**
   ```bash
   npm install
   npm test
   npm run build
   ```

4. **Measure the changes**
   ```bash
   git diff --stat initial/ expected/
   # Note files changed, lines added/removed for suite.yaml
   ```

### Step 4: Write Documentation (1 hour)

1. **Create README.md** (see Benchmark 1.1 as template)
   - Overview section
   - Task description
   - Expected outcome checklist
   - Evaluation criteria
   - Learning objectives
   - Common failure modes
   - Usage instructions

2. **Create task.md** (see Benchmark 1.1 as template)
   - Clear objective
   - Specific requirements (numbered list)
   - What NOT to do (important!)
   - Success criteria checklist
   - Context and hints

### Step 5: Create Suite Configuration (1 hour)

1. **Start with template**
   ```yaml
   name: "Benchmark Name"
   description: "Clear description"
   
   repo: ./initial
   branch: main
   
   expected_source: path
   expected: ./expected
   
   agent:
     type: copilot-cli
     config:
       prompt: |
         [Load task from task.md]
   
   evaluators:
     - name: git-diff
       config:
         assertions:
           # Based on your measurements
     
     - name: expected-diff
       config:
         threshold: 0.75  # Adjust based on task
     
     - name: agentic-judge-{aspect}
       config:
         type: copilot-cli
         agent_name: agentic-judge
         assertions:
           # Specific quality checks
   ```

2. **Tune evaluator thresholds**
   - Start conservative (stricter)
   - Run test and adjust based on results
   - Document rationale for thresholds

3. **Add metadata**
   ```yaml
   metadata:
     category: documentation|bugfix|testing|refactoring|feature|security|config|migration
     difficulty: easy|medium|hard
     estimated_time_minutes: N
     files_expected_to_change: N
     lines_expected_to_add: N
     primary_skill: X
     secondary_skills: [Y, Z]
   ```

### Step 6: Test and Validate (1-2 hours)

1. **Run the benchmark**
   ```bash
   cd benchmarks/{category}.{number}-{name}
   yb run -c suite.yaml --keep-workspace
   ```

2. **Review results**
   ```bash
   yb report --from .youbencha-workspace/run-*/artifacts/results.json
   ```

3. **Validate evaluators**
   - Do evaluators correctly identify good solutions?
   - Do evaluators catch common mistakes?
   - Are thresholds appropriate?

4. **Iterate if needed**
   - Adjust suite.yaml
   - Update task.md if unclear
   - Refine expected/ if needed

### Step 7: Document and Commit (30 minutes)

1. **Update benchmarks/README.md**
   - Add to status table
   - Mark as Ready or In Progress

2. **Update benchmarks/IMPLEMENTATION_STATUS.md**
   - Add to completed list
   - Note any insights or challenges

3. **Commit with descriptive message**
   ```bash
   git add benchmarks/{category}.{number}-{name}
   git commit -m "Add Benchmark {category}.{number}: {Name}"
   ```

## Tips and Best Practices

### Creating Realistic Initial States

**DO:**
- ✅ Use realistic file structures (src/, tests/, etc.)
- ✅ Include actual dependencies in package.json
- ✅ Write code that looks like production code
- ✅ Add comments where natural (not excessive)
- ✅ Ensure code is runnable/buildable

**DON'T:**
- ❌ Use toy examples or overly simplified code
- ❌ Include obvious bugs (unless that's the point)
- ❌ Have inconsistent style (unless testing style fixes)
- ❌ Use placeholder names (foo, bar, baz)

### Writing Clear Task Descriptions

**DO:**
- ✅ Be specific about requirements
- ✅ Number requirements for clarity
- ✅ Include "what NOT to do" section
- ✅ Provide context about the project
- ✅ Give hints without giving away the solution

**DON'T:**
- ❌ Be vague or ambiguous
- ❌ Assume agent knowledge of conventions
- ❌ Make requirements open-ended
- ❌ Skip edge case handling requirements

### Choosing Evaluators

**Always Include:**
- git-diff (tracks scope and focus)

**Include When Applicable:**
- expected-diff (when clear reference exists)
- tests (when tests should pass)
- lint/typecheck (when code quality matters)
- build (when build should succeed)

**Use Agentic Judges For:**
- Content quality (documentation, error messages)
- Code patterns (error handling, security)
- Subjective quality (readability, consistency)
- Domain-specific requirements

### Setting Thresholds

**git-diff thresholds:**
- Easy: max_files_changed: 1-2
- Medium: max_files_changed: 3-5
- Hard: max_files_changed: 5+

**expected-diff thresholds:**
- Strict (generated code, config): 0.90-0.95
- Balanced (implementation): 0.75-0.85
- Lenient (creative tasks): 0.65-0.75

**agentic-judge scoring:**
- Binary: 1 (pass) or 0 (fail)
- Partial: 1 (excellent), 0.5 (acceptable), 0 (missing)
- Avoid: Fine-grained scores (0.0-1.0) are harder to evaluate consistently

## Common Challenges and Solutions

### Challenge: Initial state is too complex
**Solution**: Simplify to focus on the specific skill being tested. Use minimal dependencies.

### Challenge: Expected outcome is subjective
**Solution**: Add clear comments explaining why this is a good solution. Use expected-diff with lower threshold (0.65-0.75).

### Challenge: Evaluators are too strict
**Solution**: Review actual good solutions and adjust thresholds. Remember: the goal is to identify quality, not perfection.

### Challenge: Evaluators are too lenient
**Solution**: Add more agentic judges for specific quality checks. Increase git-diff constraints.

### Challenge: Task is unclear to agents
**Solution**: Run test with agent, see where it gets confused, update task.md with clarifications.

### Challenge: Benchmark takes too long
**Solution**: Reduce repository size. Simplify dependencies. Focus on core task, remove peripheral code.

## Example: Implementing Benchmark 2.1 (Fix Null Pointer)

Let me walk through implementing a new benchmark:

### 1. Research (30 min)
- Task: Fix a null pointer causing crashes
- Common in: API route handlers, database queries
- Agent should: Add null check, return appropriate error response
- Constraints: Don't break existing tests, minimal change

### 2. Create Initial State (1 hour)

```bash
mkdir -p benchmarks/2.1-fix-null-pointer/initial
cd benchmarks/2.1-fix-null-pointer/initial
npm init -y
npm install express
```

Create `src/routes/users.js`:
```javascript
// Bug: Missing null check causes crash
app.get('/api/users/:id', async (req, res) => {
  const user = await db.getUser(req.params.id);
  // Bug: user might be null
  res.json({ id: user.id, name: user.name });
});
```

Create failing test in `tests/users.test.js`.

### 3. Create Expected Outcome (1 hour)

Copy initial/ to expected/, fix the bug:

```javascript
app.get('/api/users/:id', async (req, res) => {
  const user = await db.getUser(req.params.id);
  
  if (!user) {
    return res.status(404).json({ 
      error: 'User not found' 
    });
  }
  
  res.json({ id: user.id, name: user.name });
});
```

Update test to verify 404 response.

### 4. Write Documentation (1 hour)

Create README.md and task.md following templates.

### 5. Create Suite (1 hour)

Write suite.yaml with:
- git-diff: max_files_changed: 2 (route + test)
- expected-diff: threshold: 0.80
- tests: all must pass
- agentic-judge-error-handling: check for null check and 404
- agentic-judge-error-messages: verify error message quality

### 6. Test (1 hour)

Run with copilot-cli, review results, adjust thresholds.

### 7. Document (30 min)

Update README status, commit.

Total time: ~5-6 hours for a medium complexity benchmark.

## Getting Help

If you're stuck:
1. Review Benchmark 1.1 as a reference
2. Check docs/use-cases-and-benchmarks.md for design rationale
3. Look at youBencha test suites for evaluator examples
4. Ask in GitHub discussions or issues

## Validation Script (Future)

We should create a script to validate benchmark structure:

```bash
./scripts/validate-benchmark.sh benchmarks/2.1-fix-null-pointer

Checking structure...
✅ README.md exists
✅ task.md exists
✅ suite.yaml exists
✅ initial/ directory exists
✅ expected/ directory exists

Checking suite.yaml...
✅ Has required fields
✅ Has at least 3 evaluators
✅ Has metadata section
⚠️  Warning: No git-diff evaluator found

Checking initial state...
✅ Code is valid
✅ package.json exists
⚠️  Warning: No tests found

Checking expected state...
✅ Code is valid
✅ Changes detected in 2 files

Running benchmark...
✅ Benchmark completes successfully
✅ All evaluators run
✅ Results bundle generated

Overall: ✅ PASS (2 warnings)
```

## Conclusion

Follow this guide to implement benchmarks consistently and efficiently. Start with easy benchmarks to establish the pattern, then move to more complex ones.

Remember: **Quality over quantity**. A few well-designed benchmarks are more valuable than many poorly designed ones.

Each benchmark you create helps:
- Establish objective standards for AI coding agents
- Identify strengths and weaknesses of different agents
- Track improvement over time
- Guide development of better agents

Happy benchmark building! 🚀
