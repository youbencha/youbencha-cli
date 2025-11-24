# Model Selection Feature Implementation Summary

## Overview
This implementation adds the ability to select specific AI models when using the copilot CLI adapter for both agent execution and agentic-judge evaluators.

## Implementation Details

### 1. Schema Updates
Added optional `model` field to agent configuration in two schema files:

**`src/schemas/suite.schema.ts`:**
- Defined `copilotModelSchema` enum with 8 supported model names
- Added `model` field to `agentConfigSchema` as optional

**`src/schemas/testcase.schema.ts`:**
- Defined model enum with the same 8 supported model names
- Added `model` field to `agentConfigSchema` as optional

Supported models:
- claude-sonnet-4.5
- claude-sonnet-4
- claude-haiku-4.5
- gpt-5
- gpt-5.1
- gpt-5.1-codex-mini
- gpt-5.1-codex
- gemini-3-pro-preview

### 2. Adapter Updates
**`src/adapters/copilot-cli.ts`:**
Modified `buildCopilotCommand()` method to:
- Extract model from context.config
- Include `--model` flag in command arguments when model is specified
- Position model flag before agent flag for proper CLI ordering

Command format: `copilot -p "prompt" --model gpt-5.1 --agent my-agent ...`

### 3. Evaluator Updates
**`src/evaluators/agentic-judge.ts`:**
Modified agent execution context to:
- Pass through model configuration from evaluator config
- Allow different models for agent execution vs evaluation

### 4. Orchestrator Updates
**`src/core/orchestrator.ts`:**
Updated agent execution context creation to:
- Include model from test case agent configuration
- Pass model to adapter for execution

## Test Coverage

### Unit Tests (tests/unit/model-selection.test.ts)
- 20 tests covering schema validation
- Tests for all 8 supported model types
- Tests for invalid model names
- Tests for optional model field
- Tests for model in evaluator config

### Integration Tests (tests/integration/model-selection.test.ts)
- 11 tests covering command building
- Tests for model parameter inclusion
- Tests for absence when not specified
- Tests for model + agent parameter combination
- Tests for all 8 model types

### Existing Tests
All existing tests continue to pass:
- Adapter contract tests (18 tests)
- Copilot CLI adapter tests (28 tests)
- Other unit and integration tests

## Example Configuration

### Agent with Model Selection
```yaml
agent:
  type: copilot-cli
  model: gpt-5.1
  config:
    prompt: "Fix the bug"
```

### Evaluator with Different Model
```yaml
evaluators:
  - name: agentic-judge
    config:
      type: copilot-cli
      model: claude-sonnet-4.5
      agent_name: agentic-judge
      assertions:
        test_passes: "All tests pass"
```

## Backwards Compatibility
- Model field is optional
- Existing configurations without model specification continue to work
- No breaking changes to existing functionality

## Command Line Example
When model is specified, the generated command includes the `--model` flag:
```
copilot -p "Fix the bug" --model gpt-5.1 --agent my-agent --allow-all-tools --allow-all-paths --log-level all --log-dir /path/to/logs --add-dir /workspace
```

## Files Modified
1. `src/schemas/suite.schema.ts` - Added model enum and field
2. `src/schemas/testcase.schema.ts` - Added model enum and field
3. `src/adapters/copilot-cli.ts` - Added model flag to command building
4. `src/evaluators/agentic-judge.ts` - Pass model to adapter
5. `src/core/orchestrator.ts` - Include model in execution context

## Files Created
1. `examples/testcase-with-model.yaml` - Example configuration
2. `tests/unit/model-selection.test.ts` - Unit tests
3. `tests/integration/model-selection.test.ts` - Integration tests

## Validation
- ✅ TypeScript compilation succeeds
- ✅ All unit tests pass (68 tests)
- ✅ All integration tests pass (11 tests)
- ✅ Schema validation works correctly
- ✅ Command building includes --model flag
- ✅ Backwards compatible with existing configurations
- ✅ Example files demonstrate usage

## Issue Resolution
This implementation fully addresses the requirements in the issue:
- ✅ Ability to select model for copilot CLI adapter
- ✅ Applies to agent configuration
- ✅ Applies to agentic-judge evaluator
- ✅ Uses correct `--model` flag syntax
- ✅ Supports all 8 specified model values
