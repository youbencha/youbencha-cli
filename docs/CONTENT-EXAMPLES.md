# Content Examples for youBencha Launch

Ready-to-use content for various channels. Adapt as needed for your voice and platform requirements.

---

## Blog Post: Introducing youBencha

*This is the follow-up to your GitHub Universe reflection post.*

---

### Introducing youBencha: The Testing Framework for AI Coding Agents

In my last post, I shared three key insights from GitHub Universe:

1. **Agents are the future** for writing code
2. **Developer adoption** still has a trust problem
3. **Agent craftsmanship** is the next major engineering skill

I ended that post with a promise: I'd introduce a new open-source tool for agent testing, evaluation, and benchmarking. Today, I'm excited to deliver on that promise.

Meet **youBencha**.

---

#### The Problem: Evaluating AI on Vibes

Here's a scenario you might recognize:

You're using Copilot (or Claude, or Cursor) to help with a coding task. You tweak your prompt, run it again, and the output *feels* better. But did it actually improve? How would you know?

Most teams evaluate AI coding tools the same way we evaluated code in the pre-testing era: manual review, gut feelings, and hoping for the best.

This doesn't scale.

When you're changing prompts weekly, comparing multiple tools, or trying to justify AI investment to leadership, you need data, not vibes.

---

#### The Solution: Test-Driven Agent Evaluation

youBencha brings the rigor of software testing to AI agent evaluation.

If you've ever written a unit test, you already understand the model:

| Software Testing | youBencha |
|-----------------|-----------|
| Test Suite | Evaluation Configuration |
| Test Case | Agent Task |
| Assertions | Evaluation Criteria |
| CI Regression Tests | Expected Reference Comparison |

Define your evaluation criteria. Run reproducible benchmarks. Get objective metrics.

---

#### How It Works

**Step 1: Define your evaluation**

Create a YAML file describing what you want to test:

```yaml
name: "Error Handling Implementation"
description: "Evaluate the agent's ability to add comprehensive error handling"

repo: https://github.com/your-org/api-server.git
branch: main

agent:
  type: copilot-cli
  config:
    prompt: "Add try-catch blocks and proper error responses to all API endpoints"

evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      assertions:
        has_try_catch: "All API endpoints have try-catch blocks. Score 1 if complete, 0 if missing."
        proper_status_codes: "Error responses use appropriate HTTP status codes (4xx for client errors, 5xx for server errors)."
        error_logging: "Errors are logged with sufficient context for debugging."
```

**Step 2: Run the evaluation**

```bash
npm install -g youbencha
yb run -c testcase.yaml
```

youBencha will:
1. Clone your repository to an isolated workspace
2. Run the agent with your prompt
3. Execute evaluators in parallel
4. Save structured results

**Step 3: Review the results**

```bash
yb report --from .youbencha-workspace/run-*/artifacts/results.json
```

You get a detailed report with:
- What files changed (and how much)
- Whether your evaluation criteria passed or failed
- AI-powered quality assessment with reasoning

---

#### Built-in Evaluators

youBencha ships with three evaluators:

**1. git-diff**
Measures the scope of changes:
- Files changed
- Lines added/removed
- Change entropy (how distributed are the changes?)

**2. expected-diff**
Compares agent output to a reference implementation:
- Similarity scoring
- File-by-file comparison
- Configurable thresholds

**3. agentic-judge**
AI-powered quality assessment:
- Define assertions in natural language
- The judge uses tools to read files and analyze code
- Returns structured pass/fail results with reasoning

---

#### Comparing to a "Golden" Reference

One of youBencha's most powerful features is reference comparison. If you have a known-good implementation (maybe from a senior developer, or a previous successful agent run), you can use it as your evaluation baseline:

```yaml
repo: https://github.com/your-org/api-server.git
branch: main

expected_source: branch
expected: feature/error-handling-done  # The "correct" implementation

evaluators:
  - name: expected-diff
    config:
      threshold: 0.85  # Must be 85% similar to pass
```

This is perfect for:
- **Regression testing**: Ensure prompt changes don't make output worse
- **Tool comparison**: Objectively compare Copilot vs Claude vs Cursor
- **Quality gates**: Integrate into CI/CD pipelines

---

#### Why Open Source?

The AI agent landscape is fragmented and rapidly evolving. New tools appear weekly. Prompts that worked yesterday may fail tomorrow.

No single company can—or should—control how we evaluate these tools.

youBencha is MIT licensed because:
- **Transparency**: You can see exactly how evaluations work
- **Extensibility**: Add adapters for new agents, evaluators for your needs
- **Trust**: The community can verify and improve the framework

---

#### Agent-Agnostic by Design

youBencha's adapter architecture means it works with any agent:

Currently supported:
- GitHub Copilot CLI
- Claude Code

Coming soon (or contribute!):
- Cursor
- Aider
- OpenAI o1 agent mode
- Your custom agent

Adding a new adapter is straightforward:

```typescript
interface AgentAdapter {
  checkAvailability(): Promise<boolean>;
  execute(context: AgentExecutionContext): Promise<AgentExecutionResult>;
  normalizeLog(output: string, result: AgentExecutionResult): YouBenchaLog;
}
```

---

#### Building Trust Through Measurement

Remember the trust problem I mentioned in my GitHub Universe post? Developers who tried AI once, had a bad experience, and concluded it "doesn't work"?

youBencha helps address this by:

1. **Making improvement visible**: Show before/after metrics when prompts change
2. **Setting realistic expectations**: Define what success looks like upfront
3. **Building confidence incrementally**: Start with simple evaluations, add complexity over time
4. **Creating shared understanding**: Team-wide evaluation criteria eliminate subjective debates

---

#### Get Started in 5 Minutes

```bash
# Install
npm install -g youbencha

# Create a simple evaluation
cat > testcase.yaml << EOF
name: "First Evaluation"
description: "A simple test to verify agent output"

repo: https://github.com/youbencha/hello-world.git
branch: main

agent:
  type: copilot-cli
  config:
    prompt: "Add a comment explaining what this repository does"

evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      type: copilot-cli
      assertions:
        readme_modified: "README.md was modified"
        comment_added: "A helpful comment was added"
EOF

# Run it
yb run -c testcase.yaml

# View results
yb report --from .youbencha-workspace/run-*/artifacts/results.json
```

---

#### What's Next?

This is just the beginning. The roadmap includes:

- **More adapters**: Cursor, Aider, and community-contributed agents
- **CI/CD integration**: GitHub Actions workflow templates
- **Web reports**: Beautiful HTML output for stakeholders
- **Evaluator ecosystem**: Community-contributed evaluators for testing, security, and more
- **Regression tracking**: Compare results over time

But the most important next step is **your feedback**.

What agents do you want to benchmark? What evaluators would be most useful? What's missing from the current approach?

Try it out and let me know:
- **GitHub**: https://github.com/youbencha/youbencha-cli
- **npm**: `npm install -g youbencha`

The age of vibes-based AI evaluation is over. Let's build something better together.

---

*youBencha is open source under the MIT license. Star the repo if you find it useful, and contributions are always welcome!*

---

## Social Media: Launch Day Pack

### Twitter/X Thread

**Tweet 1 (with image/GIF):**
```
🚀 Introducing youBencha

The testing framework for AI coding agents.

Stop evaluating your AI tools on vibes.
Start measuring what matters.

Open source. Agent-agnostic. Developer-first.

🧵 What it does and why it matters 👇
```

**Tweet 2:**
```
The problem:

You change an AI prompt and the output "feels" better.

But did it actually improve? 
Did you accidentally break something else?
How do you compare Copilot vs Claude objectively?

Most teams answer with: 🤷‍♂️
```

**Tweet 3:**
```
The solution:

youBencha brings software testing principles to agent evaluation.

📝 Define test cases in YAML
🤖 Run agents in isolation
📊 Measure with pluggable evaluators
📈 Get reproducible results

Same config = same outcome.
```

**Tweet 4:**
```
Built-in evaluators:

• git-diff — What changed? How much?
• expected-diff — Compare to a reference implementation
• agentic-judge — AI-powered quality assessment

Plus: write your own.
```

**Tweet 5:**
```
Agent-agnostic:

Currently supported:
✅ GitHub Copilot CLI
✅ Claude Code

Adapter pattern means any agent can be added.

Contributions welcome! 🙌
```

**Tweet 6:**
```
Why open source?

The AI agent landscape is fragmented and evolving fast.

No single company should control how we evaluate these tools.

MIT licensed. Community-driven. Transparent.
```

**Tweet 7 (CTA):**
```
Get started in 5 minutes:

npm install -g youbencha
yb run -c testcase.yaml
yb report --from results.json

📖 Docs: [link]
⭐ GitHub: [link]

What agents do you want to benchmark?
```

---

### LinkedIn Post

```
🚀 Excited to introduce youBencha — an open-source framework for testing AI coding agents.

THE PROBLEM

Teams are making critical decisions about AI coding tools based on feelings:
• "Copilot feels more helpful"
• "Claude seems to write cleaner code"
• "That prompt change made things better... I think"

This is the pre-TDD era all over again.

THE SOLUTION

youBencha applies software testing principles to agent evaluation:

✅ Define evaluation criteria in YAML
✅ Run reproducible benchmarks
✅ Compare agents objectively
✅ Integrate into CI/CD

Think of it as Jest or pytest for AI coding tools.

WHY IT MATTERS

As agents become central to development workflows, we need objective ways to:
• Validate prompt changes
• Compare tool options
• Prevent quality regressions
• Build trust in AI-generated code

youBencha provides that foundation.

GET STARTED

npm install -g youbencha

GitHub: [link]
Full documentation: [link]

I'd love your feedback:
• What challenges do you face evaluating AI tools?
• What metrics matter most to your team?
• What agents would you want to benchmark?

#OpenSource #AIEngineering #DeveloperTools #SoftwareEngineering
```

---

### Reddit r/programming

**Title:** I built an open-source testing framework for AI coding agents — feedback welcome

**Body:**
```
Hey r/programming,

Like many of you, I've been using AI coding assistants more and more. But I kept running into the same question: "Did that prompt change actually make things better?"

Manual review doesn't scale, and there's no standard way to compare different tools or configurations objectively.

So I built youBencha — think of it as pytest/Jest for AI coding agents.

**What it does:**
- Runs agents on defined tasks in isolated workspaces
- Measures output with pluggable evaluators (git-diff, similarity scoring, AI-powered review)
- Produces reproducible, comparable results

**Example config:**
```yaml
name: "Error Handling Test"
repo: https://github.com/example/repo
agent:
  type: copilot-cli
  config:
    prompt: "Add error handling to API endpoints"
evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      assertions:
        has_try_catch: "All endpoints have try-catch blocks"
```

**Currently supports:**
- GitHub Copilot CLI
- Claude Code

**Tech stack:** Node.js, TypeScript, Zod for validation

GitHub: [link]
npm: `npm install -g youbencha`

Would love feedback on:
1. What metrics matter when evaluating AI coding tools?
2. What agents would you want supported?
3. What evaluators would be useful?

MIT licensed, contributions welcome.
```

---

### Hacker News Show HN

**Title:** Show HN: youBencha – Test framework for AI coding agents

**Body:**
```
Hi HN,

I built youBencha (https://github.com/youbencha/youbencha-cli) to solve a problem I kept hitting when using AI coding assistants: how do you know if changes to prompts, models, or tools actually improve output quality?

Manual review doesn't scale, and "it feels better" isn't a metric you can track or automate.

youBencha applies software testing concepts to agent evaluation:

- Define test cases in YAML/JSON
- Run agents in isolated workspaces
- Evaluate with pluggable evaluators
- Get reproducible, comparable results

Built-in evaluators:
- git-diff (scope of changes)
- expected-diff (similarity to reference implementation)  
- agentic-judge (AI-powered quality assessment)

Currently supports GitHub Copilot CLI and Claude Code, with an adapter pattern for adding more.

Quick start:
  npm install -g youbencha
  yb run -c testcase.yaml

Tech: Node.js, TypeScript, Zod for schema validation, simple-git for Git ops.

I'm particularly interested in:
1. What metrics matter most when evaluating AI tools?
2. What agents should be prioritized?
3. What's missing from this approach?

MIT licensed.
```

---

## Email Template: Launch Announcement

**Subject:** Introducing youBencha: Test-Driven AI Agent Evaluation

**Body:**
```
Hi [Name],

I wanted to share something I've been building: youBencha, an open-source framework for testing and benchmarking AI coding agents.

THE PROBLEM

Teams are evaluating AI tools based on feelings, not data:
- "Did that prompt change actually help?"
- "Which tool is best for our codebase?"
- "How do we prevent regressions when updating configs?"

THE SOLUTION

youBencha brings software testing rigor to agent evaluation:

→ Define evaluation criteria in YAML
→ Run reproducible benchmarks
→ Compare agents objectively
→ Integrate into CI/CD

Think of it as Jest/pytest for AI coding tools.

WHY I'M SHARING THIS

I think you'd find it useful for [specific reason based on their work/role].

GET STARTED

npm install -g youbencha

• GitHub: [link]
• Docs: [link]

Would love your feedback — what challenges do you face when evaluating AI tools?

Best,
[Your name]
```

---

## Conference Talk Abstract

**Title:** From Vibes to Metrics: Test-Driven Evaluation of AI Coding Agents

**Abstract:**
```
AI coding assistants are transforming software development, but how do we know if they're actually improving our work? Most teams evaluate AI tools based on gut feelings: "That prompt change made things better... I think."

In this talk, I'll introduce test-driven approaches to AI agent evaluation, drawing parallels between traditional software testing and emerging best practices for benchmarking coding assistants.

You'll learn:

1. Why "vibes-based" evaluation fails at scale
2. How to define objective evaluation criteria for AI-generated code
3. Practical patterns for comparing agents, tracking regressions, and building trust
4. An introduction to youBencha, an open-source framework for agent testing

Whether you're optimizing prompts, choosing between tools, or building AI-powered developer experiences, this talk provides a framework for making data-driven decisions.

Attendees will leave with:
- A mental model for agent evaluation
- Practical evaluation criteria they can apply immediately
- Understanding of reproducible benchmarking patterns
```

**Bio:**
```
[Your name] is a [role] focused on developer experience and AI-assisted software development. They're the creator of youBencha, an open-source framework for evaluating AI coding agents. When not building tools, they can be found [personal touch].
```

---

## Newsletter/Email Sequence

### Email 1: Welcome (after signup/star)

**Subject:** Welcome to youBencha

```
Hey!

Thanks for checking out youBencha.

Quick start:
1. npm install -g youbencha
2. Create testcase.yaml (see examples/)
3. yb run -c testcase.yaml
4. yb report --from results.json

If you hit any issues, reply to this email or open a GitHub issue.

Questions I'd love your input on:
- What agents do you want to evaluate?
- What metrics matter most to you?

Happy benchmarking!

[Your name]
```

### Email 2: First evaluation tips (Day 3)

**Subject:** 3 tips for your first youBencha evaluation

```
Hey!

Setting up your first evaluation? Here are 3 tips:

1. START SIMPLE
Begin with just git-diff. It tells you what changed without complex configuration.

2. BE SPECIFIC WITH ASSERTIONS
❌ "Code is good"
✅ "All functions have error handling. Score 1 if complete, 0 if missing."

3. USE REFERENCE COMPARISONS
If you have a "known good" implementation, use expected-diff to compare against it.

Example setup: [link to docs]

Questions? Reply to this email.

[Your name]
```

### Email 3: Feature highlight (Day 7)

**Subject:** Did you know? Compare agents side-by-side

```
Hey!

youBencha's adapter architecture means you can evaluate the same task with different agents:

```yaml
# copilot-evaluation.yaml
agent:
  type: copilot-cli

# claude-evaluation.yaml  
agent:
  type: claude-code
```

Run both, compare results, make data-driven tool decisions.

Currently supported:
- GitHub Copilot CLI
- Claude Code

Want another agent? Let me know or contribute an adapter!

[Your name]
```

---

*Use these templates as starting points. Adapt for your voice, context, and specific platforms.*
