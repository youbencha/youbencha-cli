# Benchmark 1.1: Add Installation Instructions

**Category**: Documentation & README Tasks  
**Difficulty**: 🟢 Easy  
**Estimated Time**: 2-5 minutes  
**Files Expected to Change**: 1 (README.md)

## Overview

This benchmark tests an AI coding agent's ability to add clear, complete installation instructions to a minimal README file. It evaluates basic comprehension, technical writing ability, and the capacity to make focused changes without modifying unrelated content.

## Task Description

Add installation instructions to the README.md file for a simple Node.js CLI tool. The instructions should include:

1. **Prerequisites**: Required Node.js version
2. **Installation Command**: npm install command
3. **Quick Start**: Basic command to run the tool
4. **Format**: Use proper markdown formatting

## Starting State

The repository contains:
- A functional Node.js CLI tool (`src/cli.js`)
- A `package.json` with project metadata
- A minimal README.md with only the project name and a one-line description
- No installation instructions

## Expected Outcome

The agent should:
- ✅ Add an "Installation" section to README.md
- ✅ Include Node.js version requirement (from package.json)
- ✅ Include npm install command
- ✅ Include quick start usage example
- ✅ Use proper markdown formatting (headings, code blocks)
- ✅ Make NO changes to other files
- ✅ Not modify existing README content (preserve project name and description)

## Evaluation Criteria

### Primary Evaluators

1. **git-diff**: Ensures focused changes
   - Max 1 file changed (README.md only)
   - Max 15 lines added
   - Max 0 lines removed (should only add content)
   - Max change entropy: 2.0 (changes are focused)

2. **agentic-judge-content**: Validates instruction completeness
   - Prerequisites mentioned (Node.js version)
   - Installation command included
   - Quick start command included
   - All information is accurate

3. **agentic-judge-formatting**: Validates markdown quality
   - Proper heading hierarchy
   - Code blocks use ``` syntax
   - Consistent formatting with existing README style
   - No markdown syntax errors

### Success Metrics

- **Pass Threshold**: All 3 evaluators pass
- **Quality Score**: Weighted average of evaluator scores
  - git-diff: 30% (focused changes)
  - agentic-judge-content: 40% (completeness)
  - agentic-judge-formatting: 30% (quality)

## Learning Objectives

This benchmark reveals:

1. **Reading Comprehension**: Can the agent understand the project from package.json?
2. **Technical Writing**: Can the agent write clear instructions?
3. **Change Minimalism**: Does the agent make only necessary changes?
4. **Format Awareness**: Does the agent follow markdown conventions?
5. **Context Preservation**: Does the agent maintain existing content?

## Common Failure Modes

### Agent Makes Too Many Changes
- Modifies existing README content unnecessarily
- Changes other files (package.json, source code)
- Adds excessive content (LICENSE, CONTRIBUTING, etc.)

### Agent Provides Incomplete Instructions
- Missing prerequisites
- Missing installation command
- Missing usage example
- Vague or incorrect information

### Agent Has Poor Formatting
- Incorrect markdown syntax
- Inconsistent with existing README style
- No code blocks or poorly formatted blocks
- Wrong heading levels

### Agent Misunderstands Context
- Adds instructions for wrong technology (Python instead of Node.js)
- References non-existent files or commands
- Copies generic instructions not tailored to this project

## Benchmark Variations

This benchmark can be extended with variations:

- **1.1a**: Add installation for global npm package (`npm install -g`)
- **1.1b**: Add installation for both npm and yarn
- **1.1c**: Add installation with additional system dependencies
- **1.1d**: Add installation instructions in a different language/ecosystem (Python, Go, etc.)

## Usage

### Run this benchmark

```bash
yb run -c benchmarks/1.1-add-installation-instructions/suite.yaml
```

### View results

```bash
yb report --from .youbencha-workspace/run-*/artifacts/results.json --format markdown
```

### Compare with expected outcome

```bash
# The suite.yaml uses expected-diff evaluator to compare against
# the reference implementation in the expected/ directory
```

## Agent Comparison

When comparing multiple agents on this benchmark, look for:

1. **Completeness**: Does the agent include all required elements?
2. **Clarity**: Are the instructions easy to follow?
3. **Accuracy**: Is the information correct (versions, commands)?
4. **Conciseness**: Does the agent avoid unnecessary verbosity?
5. **Consistency**: Does the formatting match the existing style?

## Reference Implementation

See the `expected/` directory for a reference solution that:
- Adds exactly what's needed
- Uses clear, concise language
- Follows markdown best practices
- Preserves all existing content

## Notes

- This is an ideal "first benchmark" to test basic agent capabilities
- Low risk: changes are documentation-only
- Clear success criteria: objective evaluation
- Fast: should complete in under 5 minutes
- Reveals fundamental competencies that predict success on harder tasks
