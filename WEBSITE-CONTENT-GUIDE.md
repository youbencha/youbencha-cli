# youBencha Website Content Guide

This document extracts key marketing and messaging points from the master documentation to help create compelling website content.

---

## Tagline Options

1. **"Evaluate AI coding agents with confidence"**
2. **"Your benchmark for AI coding quality"**
3. **"From prompt to proof: Test your AI coding agents"**
4. **"Developer-first framework for AI agent evaluation"**

---

## Hero Section

**Headline:** Evaluate AI Coding Agents with Confidence

**Subheadline:** A developer-first CLI framework for testing AI-powered coding tools. Run agents, measure their output, and get objective insights—all through a simple command-line interface.

**CTA Buttons:**
- Primary: "Get Started in 3 Steps"
- Secondary: "View Documentation"

**Quick Stats:**
- ⚡ 3-step setup
- 🔌 Agent-agnostic architecture  
- 📊 Multiple evaluation dimensions
- 🔒 Isolated workspace execution

---

## Key Value Propositions

### For AI Engineers
**"Rapid Iteration and Debugging"**

- Get immediate feedback during prompt engineering
- Debug failures with full context (logs, diffs, metrics)
- Iterate quickly on agent configurations
- Track token usage and costs per evaluation

**Pain Point Addressed:** "How do I know if my prompt changes actually improved the agent?"

### For Development Teams
**"Objective Agent Comparison"**

- Compare different models on the same tasks
- Identify which tasks are hardest for agents
- Aggregate metrics across test suites
- Pattern recognition for common failure modes

**Pain Point Addressed:** "Which AI coding tool should we choose for our team?"

### For Organizations
**"Regression Detection & Cost Management"**

- Track performance across model updates
- Detect quality degradation before production
- Monitor costs and ROI over time
- Compliance audit trails for AI-generated code

**Pain Point Addressed:** "How do we ensure our AI coding assistant doesn't regress as models change?"

---

## Feature Highlights

### 1. Agent-Agnostic Architecture
**Headline:** Works with Any AI Agent

**Description:** youBencha's pluggable adapter system means you're not locked into a single vendor. Start with GitHub Copilot CLI today, switch to other agents tomorrow.

**Visual:** Diagram showing youBencha connecting to multiple agents

### 2. Multi-Dimensional Evaluation
**Headline:** Evaluate Beyond "Does It Compile?"

**Built-in Evaluators:**
- **git-diff:** Scope and entropy of changes
- **expected-diff:** Similarity to reference implementation
- **agentic-judge:** AI-powered quality assessment

**Visual:** Three-column layout showing evaluator outputs

### 3. Reproducible & Isolated
**Headline:** Safe, Repeatable Evaluations

**Features:**
- Isolated workspace execution
- Never modifies your working directory
- Complete execution logs (youBencha Log format)
- Workspace kept for inspection by default

**Visual:** Workspace isolation diagram

### 4. Extensible Pipeline
**Headline:** Customize Your Workflow

**Extension Points:**
- **Pre-Execution:** Setup environment, inject secrets, generate code
- **Custom Evaluators:** Define your own quality criteria
- **Post-Evaluation:** Export to databases, send notifications, run analysis

**Visual:** Pipeline flow diagram

---

## Use Case Scenarios

### Scenario 1: Prompt Engineering
**User:** AI Engineer optimizing prompts

**Journey:**
1. Write initial prompt
2. Run evaluation: `yb run -c suite.yaml`
3. Review metrics and diff
4. Iterate on prompt
5. Compare results over iterations

**Outcome:** 40% improvement in assertion pass rate after 5 iterations

### Scenario 2: Model Comparison
**User:** Engineering Manager choosing between models

**Journey:**
1. Create test suite with 10 representative tasks
2. Run suite with GPT-5
3. Run same suite with Claude Sonnet
4. Compare aggregate metrics
5. Make data-driven decision

**Outcome:** Chose Claude Sonnet - 15% higher pass rate, 20% lower cost

### Scenario 3: Regression Testing
**User:** Platform Team monitoring agent quality

**Journey:**
1. Setup daily regression suite in CI/CD
2. Track results over time (JSONL export)
3. New model update deployed
4. Regression alert triggered
5. Investigation reveals 3 failing test cases
6. Report to vendor, roll back update

**Outcome:** Prevented 3 production issues before deployment

---

## Comparison Table

| Feature | youBencha | Manual Testing | Custom Scripts |
|---------|-----------|----------------|----------------|
| **Standardized Format** | ✅ youBencha Log | ❌ Varies | ❌ Custom |
| **Multi-Agent Support** | ✅ Pluggable | ⚠️ Per-agent | ⚠️ Per-agent |
| **Built-in Evaluators** | ✅ 3+ evaluators | ❌ Manual | ❌ Build yourself |
| **Time-Series Analysis** | ✅ JSONL export | ❌ No | ⚠️ DIY |
| **Isolated Execution** | ✅ Workspace | ⚠️ Manual | ⚠️ DIY |
| **Ready in 5 minutes** | ✅ Yes | ❌ No | ❌ No |

---

## Testimonial Placeholders

> "youBencha helped us objectively compare 3 different AI coding assistants. We chose the one that was 30% better on our actual use cases, not just marketing benchmarks."
> 
> — **Engineering Manager, Series B SaaS Company**

> "Before youBencha, I'd spend 30 minutes manually reviewing each prompt iteration. Now I get objective metrics in 5 minutes and iterate 5x faster."
>
> — **AI Engineer, Enterprise Software**

> "We run youBencha in CI/CD for every model update. It's caught 12 regressions before they hit production in the last 3 months."
>
> — **Platform Team Lead, Fintech Startup**

---

## Getting Started Flow (for Website)

### Step 1: Install
```bash
npm install -g youbencha
```
**Time:** 30 seconds

### Step 2: Create Configuration
```bash
yb init
```
Edit `suite.yaml` to define your evaluation.

**Time:** 2 minutes

### Step 3: Run Evaluation
```bash
yb run -c suite.yaml
```
**Time:** 2-5 minutes (depends on agent)

### Step 4: View Results
```bash
yb report --from .youbencha-workspace/run-*/artifacts/results.json
```
**Time:** Instant

**Total Time to First Evaluation:** Under 5 minutes

---

## Technical Differentiators

### 1. youBencha Log Format
**Benefit:** Cross-agent comparison on standardized metrics

**Technical:** Adapters normalize agent-specific output to common schema with:
- Model info
- Token usage
- Execution metadata
- Messages and tool calls

**Why It Matters:** Compare GPT vs Claude vs Gemini apples-to-apples

### 2. Parallel Evaluator Execution
**Benefit:** Fast evaluation even with multiple judges

**Technical:** All evaluators run via `Promise.allSettled()` for concurrent execution

**Why It Matters:** 5 evaluators in the same time as 1

### 3. Workspace Locking
**Benefit:** Safe concurrent evaluations

**Technical:** Prevents workspace conflicts with filesystem-based locking

**Why It Matters:** Run multiple evaluations simultaneously without collision

---

## FAQs for Website

### General

**Q: What AI agents does youBencha support?**

A: Currently GitHub Copilot CLI, with pluggable architecture for future agents (Cursor, Cody, etc.). The adapter system makes it easy to add new agents.

**Q: Does youBencha work on Windows/Mac/Linux?**

A: Yes! Requires Node.js 20+ and Git. Platform-specific command execution is handled automatically.

**Q: How long does an evaluation take?**

A: Depends on your agent and task complexity. Simple tasks: 2-5 minutes. Complex tasks: 5-10 minutes. Evaluators add ~1-2 minutes total (run in parallel).

### Technical

**Q: Where does youBencha run the agent?**

A: In an isolated workspace directory (`.youbencha-workspace/`). Your working directory is never modified.

**Q: Can I run youBencha in CI/CD?**

A: Absolutely! Works great in GitHub Actions, GitLab CI, Jenkins, etc. See our [CI/CD integration guide](docs/integration-examples.md).

**Q: How do I track results over time?**

A: Use the database post-evaluator to export to JSONL format. Query with `jq` or import to your analytics platform.

### Security

**Q: Is it safe to run evaluations on private code?**

A: Evaluations run in isolated workspaces. However, the agent does have access to the repository code. We recommend:
- Running in containers or VMs for untrusted code
- Only using suite configurations from trusted sources
- Following our [security best practices](SECURITY.md)

**Q: Does youBencha send data to external services?**

A: youBencha itself doesn't. However:
- Agents may send code to their respective AI services
- Webhook post-evaluators send results to configured URLs
- Database post-evaluators export results locally

### Pricing

**Q: How much does youBencha cost?**

A: youBencha is open source (MIT license) and free. You'll incur costs for:
- AI agent usage (token costs from OpenAI, Anthropic, etc.)
- Optional: Hosted infrastructure if you use our future cloud service

---

## Call-to-Action Variations

**Primary CTAs:**
1. "Start Evaluating in 5 Minutes"
2. "Install youBencha Now"
3. "Try Your First Evaluation"
4. "Get Started Free"

**Secondary CTAs:**
1. "Read the Documentation"
2. "See Example Configurations"
3. "View on GitHub"
4. "Join Our Discord" (if community exists)

**Enterprise CTAs:**
1. "Schedule a Demo"
2. "Talk to Sales"
3. "Request Enterprise Features"

---

## Social Proof Ideas

### GitHub Stats
- ⭐ Star count
- 🔱 Fork count
- 💬 Contributors
- 📦 npm downloads

### Usage Metrics (if available)
- "Trusted by X companies"
- "X+ evaluations run"
- "X+ developers"

### Logos (when available)
Row of company logos using youBencha

---

## SEO Keywords

**Primary:**
- AI coding agent evaluation
- AI code quality testing
- AI agent benchmarking
- GitHub Copilot testing
- AI developer tools

**Secondary:**
- prompt engineering tools
- AI code review
- coding agent comparison
- AI agent regression testing
- developer productivity tools

**Long-tail:**
- "how to test AI coding agents"
- "evaluate GitHub Copilot quality"
- "compare AI coding assistants"
- "measure AI code generation quality"
- "AI agent evaluation framework"

---

## Content Sections for Website

### Homepage
1. Hero with tagline and CTAs
2. Key value props (3 columns)
3. Feature highlights (with visuals)
4. Use case scenarios
5. Getting started flow
6. Social proof
7. Final CTA

### Product Pages

**For AI Engineers:**
- Focus on rapid iteration
- Debugging capabilities
- Token cost tracking
- Example workflows

**For Teams:**
- Agent comparison features
- Aggregate metrics
- Pattern recognition
- ROI tracking

**For Enterprise:**
- Regression detection
- Compliance and audit
- Cost management
- Integration capabilities

### Documentation Site
- Getting Started Guide (GETTING-STARTED.md)
- CLI Reference
- Evaluators Guide
- Integration Examples
- Best Practices
- Troubleshooting

### Blog Post Ideas
1. "5 Minutes to Your First AI Agent Evaluation"
2. "How We Compare GPT vs Claude on Real Coding Tasks"
3. "Preventing AI Agent Regression in Production"
4. "The Cost of AI Coding: Tracking Token Usage Over Time"
5. "Building Custom Evaluators for Your Domain"
6. "Case Study: 30% Quality Improvement Through Data-Driven Prompt Engineering"

---

## Visual Asset Ideas

### Diagrams
1. **Pipeline Architecture** - 8-stage flow
2. **Workspace Isolation** - Before/after diagram
3. **Multi-Agent Support** - Hub-and-spoke with adapters
4. **Evaluator Types** - Three columns (git-diff, expected-diff, agentic-judge)
5. **Time-Series Analysis** - Line graph showing trend

### Screenshots
1. **Terminal Output** - yb run command in action
2. **Markdown Report** - Sample evaluation report
3. **Configuration File** - Annotated suite.yaml
4. **Results JSON** - Highlighted key fields
5. **CI/CD Integration** - GitHub Actions workflow

### Animations/GIFs
1. **Quick Start** - 3-step installation and first run
2. **Report Generation** - From results.json to markdown
3. **Workspace Creation** - Isolated directory structure
4. **Parallel Evaluation** - Multiple evaluators running

---

## Pricing Page Structure (Future)

### Free Tier (Current)
- ✅ CLI tool (MIT license)
- ✅ All evaluators
- ✅ Local execution
- ✅ Community support
- ❌ No cloud features

### Cloud Tier (Future)
- ✅ Everything in Free
- ✅ Hosted results database
- ✅ Web dashboard
- ✅ Team collaboration
- ✅ API access
- Price: $X/user/month

### Enterprise Tier (Future)
- ✅ Everything in Cloud
- ✅ SSO/SAML
- ✅ Custom evaluators
- ✅ Dedicated support
- ✅ SLA
- Price: Custom

---

*This guide consolidates key messaging, features, and content ideas from MASTER-DOCUMENTATION.md for website development.*
