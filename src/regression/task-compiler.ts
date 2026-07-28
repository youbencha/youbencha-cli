import type { Config } from '../schemas/config.schema.js';
import type {
  RegressionTarget,
  RegressionTaskDefinition,
  SuiteV2SetupStep,
} from '../schemas/suite-v2.schema.js';
import {
  agentConfigSchema,
  testCaseConfigSchema,
  type TestCaseConfig,
} from '../schemas/testcase.schema.js';
import { resolveEffectiveTestCaseConfig } from '../lib/effective-config.js';
import { identitySafeValue, stableHash } from '../experiments/identity.js';

export interface RegressionTaskSource {
  id: string;
  resolvedFile: string;
  definition: RegressionTaskDefinition;
}

export interface CompiledRegressionTask {
  testcaseId: string;
  targetId: string;
  config: TestCaseConfig;
  configHash: string;
}

const BUILTIN_SETUP: Record<
  Extract<SuiteV2SetupStep, string>,
  { command: string; args: string[] }
> = {
  'npm-ci': { command: 'npm', args: ['ci'] },
  'npm-install': { command: 'npm', args: ['install'] },
  'pnpm-install': { command: 'pnpm', args: ['install', '--frozen-lockfile'] },
  'yarn-install': { command: 'yarn', args: ['install', '--immutable'] },
  'bun-install': { command: 'bun', args: ['install', '--frozen-lockfile'] },
};

function compileSetupStep(step: SuiteV2SetupStep): {
  name: 'script';
  config: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    timeout_ms: number;
    working_dir?: string;
  };
} {
  const resolved =
    typeof step === 'string'
      ? { ...BUILTIN_SETUP[step], timeout_ms: 30000 }
      : step;
  return {
    name: 'script',
    config: {
      command: resolved.command,
      args: [...resolved.args],
      env: resolved.env,
      timeout_ms: resolved.timeout_ms,
      working_dir: resolved.working_dir,
    },
  };
}

/**
 * Compile a target-neutral task into the current internal test-case contract.
 *
 * The target agent is parsed independently, and the only value added to its
 * adapter configuration is the task-owned prompt source. No agent settings
 * can be inherited from another adapter.
 */
export function compileRegressionTask(
  task: RegressionTaskSource,
  target: RegressionTarget,
  globalConfig: Config
): CompiledRegressionTask {
  const promptConfig =
    task.definition.task.prompt !== undefined
      ? { prompt: task.definition.task.prompt }
      : { prompt_file: task.definition.task.prompt_file };
  const agent = agentConfigSchema.parse({
    ...target.agent,
    config: {
      ...(target.agent.config ?? {}),
      ...promptConfig,
    },
  });
  const setup = [
    ...task.definition.setup.cacheable,
    ...task.definition.setup.per_attempt,
  ].map(compileSetupStep);
  const evaluators = task.definition.evaluators.map((evaluator) =>
    'file' in evaluator
      ? { file: evaluator.file }
      : {
          name: evaluator.name,
          ...(evaluator.config === undefined
            ? {}
            : { config: evaluator.config }),
        }
  );

  const config = resolveEffectiveTestCaseConfig(
    testCaseConfigSchema.parse({
      name: task.definition.name,
      description: task.definition.description,
      repo: task.definition.repo,
      branch: task.definition.branch,
      commit: task.definition.commit,
      agent,
      expected_source: task.definition.expected_source,
      expected: task.definition.expected,
      evaluators,
      pre_execution: setup.length === 0 ? undefined : setup,
      post_evaluation: task.definition.post_evaluation,
      workspace_name: task.definition.workspace_name,
      timeout: task.definition.timeout,
    }),
    task.resolvedFile,
    globalConfig
  );
  const configHash = stableHash(
    identitySafeValue({ ...config, workspace_dir: undefined })
  );

  return {
    testcaseId: task.id,
    targetId: target.id,
    config,
    configHash,
  };
}
