# User Story 3 Refinement: AI-Assisted Suite Generation

**Date**: 2025-11-09  
**Status**: Specification Updated

## Overview

Refined User Story 3 from a simple branch-comparison CLI command to an interactive, agentic workflow that understands user intent and suggests contextually appropriate evaluation configurations.

## Key Changes

### Before: Automated Evaluator Suggestions
- Simple command: `yb suggest-eval --source main --expected feature/ai-completed`
- Analyzed branch diffs and pattern-matched to evaluators
- Limited to git repositories with pre-existing branches
- Generic suggestions without understanding user intent

### After: AI-Assisted Suite Generation from Successful Agent Output
- Interactive command: `yb suggest-suite --agent <agent-tool> --output-dir <path>`
- AI agent prompts user for context (source folder, baseline, original instructions)
- Works with any folder structure (git repos or plain directories)
- Maps user intent + code changes → contextually appropriate evaluators
- Generates suite with reasoning comments explaining suggestions

## Agentic Solution Design

### Workflow
1. **Launch**: User runs `yb suggest-suite --agent copilot-cli --output-dir ./my-feature-output`
2. **Agent Initialization**: youBencha launches configured agent with `agents/suggest-suite.agent.md` file
3. **Context Gathering** (Interactive):
   - Agent prompts: "What folder contains your successful agent output?"
   - Agent detects if it's a git repo:
     - **Git repo**: "What branch/commit should I use as baseline?"
     - **Not git repo**: "What folder contains the original source?"
   - Agent prompts: "What instructions/prompt did you use to make these changes?"
4. **Analysis**:
   - Compute diff between source and output
   - Identify patterns (files added/modified/deleted, types, structural changes)
   - Map user's stated intent to detected outcomes
5. **Generation**:
   - Create `suite.yaml` with:
     - Repository config pointing to baseline
     - Expected reference pointing to successful output
     - Suggested evaluators with reasoning comments
     - Evaluation criteria derived from user's original instructions

### Agent File Structure (`agents/suggest-suite.agent.md`)

```markdown
# youBencha Suite Suggestion Agent

## Your Role
You are an expert at analyzing code changes and suggesting appropriate evaluation strategies...

## Domain Knowledge
- youBencha evaluator types: git-diff, expected-diff, agentic-judge, etc.
- Suite configuration format (YAML/JSON)
- Common code change patterns → evaluator mappings

## Workflow
1. Prompt user for output folder path
2. Detect if git repo and adjust prompts
3. Gather baseline/source information
4. Request original instructions/intent
5. Compute and analyze diff
6. Map intent + patterns → evaluators
7. Generate suite.yaml with reasoning

## Examples
[Include example dialogues and generated suites]
```

## Benefits of Agentic Approach

1. **Natural Interaction**: Conversational prompting feels intuitive vs memorizing CLI flags
2. **Context-Aware**: Agent understands user intent, not just code patterns
3. **Flexible Input**: Works with git repos, plain folders, or any structure
4. **Tool-Agnostic**: Agent file works with Copilot CLI, Aider, Claude Code, etc.
5. **Educational**: Generated suites include reasoning comments explaining suggestions
6. **Extensible**: Future versions can search agent logs for historical context

## Updated Functional Requirements

### New FRs (FR-019 through FR-029)
- **FR-019**: `yb suggest-suite --agent <agent-tool>` command
- **FR-020**: Agent file at `agents/suggest-suite.agent.md`
- **FR-021**: Agent file structure (system prompt, workflow, examples)
- **FR-022**: Interactive prompting for context
- **FR-023**: Git repo detection with adaptive prompts
- **FR-024**: Diff computation and pattern detection
- **FR-025**: Intent-to-outcome mapping
- **FR-026**: Suite generation with reasoning
- **FR-027**: Commented explanations in generated suite
- **FR-028**: Agent tool validation
- **FR-029**: Path validation

### Updated CLI Interface
- **FR-026**: Changed from `yb suggest-eval --source <branch> --expected <branch>` to `yb suggest-suite --agent <agent-tool> --output-dir <path>`

## New Edge Cases
- Invalid paths during agent-assisted generation
- Identical source and output folders
- Vague/missing user instructions
- Configured agent tool not installed

## Updated Success Criteria
- **SC-006**: Interactive session completes in <3 minutes for repos with <100 changed files
- **SC-007**: Generated suites include ≥3 evaluators with correct pattern mappings

## New Key Entities
- **Agent File**: Tool-agnostic `.agent.md` file guiding AI agents through workflows
- **Suite Suggestion Session**: Interactive agent session for context gathering and suite generation

## Future Extensions (Out of Scope for MVP)
- **Agent log search**: Auto-extract prompts/instructions from previous runs
- **Batch suite generation**: Generate multiple suites from historical runs
- These are explicitly documented in "Out of Scope" section

## Implementation Notes

### Agent File Location
- Path: `agents/suggest-suite.agent.md`
- Format: Markdown with clear sections (Role, Domain Knowledge, Workflow, Examples)
- Compatible with: Copilot CLI, Aider, Claude Code, and similar tools

### CLI Integration
```bash
# User runs
yb suggest-suite --agent copilot-cli --output-dir ./successful-output

# youBencha internally executes
gh copilot agents/suggest-suite.agent.md --context workspace=./successful-output
```

### Generated Suite Example
```yaml
# Generated by youBencha Suite Suggestion Agent
# Based on: User's feature to "add authentication middleware"
# Detected: New auth middleware files, test additions, config changes

repository:
  url: ./my-repo
  baseline: main

expected:
  source: branch
  ref: feature/auth-completed

evaluators:
  # Suggested because: User intended to add auth, agent created middleware files
  # This evaluator verifies structural similarity to expected auth implementation
  - name: expected-diff
    config:
      threshold: 0.85
      
  # Suggested because: Test files were added (auth.test.ts)
  # This evaluator verifies test coverage matches expected reference
  - name: agentic-judge
    criteria: "Verify authentication middleware includes proper error handling..."
```

## Validation Checklist

- [x] User Story 3 rewritten with agentic approach
- [x] All functional requirements updated (FR-019 through FR-029)
- [x] CLI interface updated (FR-026)
- [x] New edge cases added
- [x] Success criteria updated (SC-006, SC-007)
- [x] Key entities expanded (Agent File, Suite Suggestion Session)
- [x] Assumptions updated (agent file compatibility, user context availability)
- [x] Out of Scope section updated (agent log search, batch generation)
- [x] Maintains MVP scope (no implementation details, technology-agnostic)
