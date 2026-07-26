import * as path from 'path';
import type { Config } from '../schemas/config.schema.js';
import { evalConfigSchema, type EvalConfig } from '../schemas/eval.schema.js';
import {
  testCaseConfigSchema,
  type EvaluatorConfig,
  type TestCaseConfig,
} from '../schemas/testcase.schema.js';
import { parseEvaluatorConfig } from '../schemas/evaluator-config.schema.js';
import {
  resolveEvaluatorConfigs,
  validateEvaluatorNames,
  type ResolvedEvaluatorConfig,
} from './evaluator-loader.js';
import { resolvePromptValue } from './prompt-loader.js';
import { substituteVariablesInObject } from './config-loader.js';

function findUnresolvedVariables(value: unknown, location = ''): string[] {
  if (typeof value === 'string') {
    const names = [...value.matchAll(/\$\{([^}]+)\}/g)].map(
      (match) => match[1]
    );
    return names.map((name) => `${location || '<root>'}: \${${name}}`);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findUnresolvedVariables(item, `${location}[${index}]`)
    );
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      findUnresolvedVariables(item, location ? `${location}.${key}` : key)
    );
  }

  return [];
}

function substituteConfiguredVariables<T>(data: T, config: Config): T {
  const substituted = substituteVariablesInObject(data, config.variables ?? {});
  const unresolved = findUnresolvedVariables(substituted);
  if (unresolved.length > 0) {
    throw new Error(
      `Unresolved configuration variable${unresolved.length === 1 ? '' : 's'}: ${unresolved.join(', ')}`
    );
  }
  return substituted;
}

function resolveEvaluatorPrompts(
  evaluators: readonly ResolvedEvaluatorConfig[],
  baseDir: string,
  options: {
    requireAgentType?: boolean;
    inheritedAgentType?: string;
  } = {}
): ResolvedEvaluatorConfig[] {
  return evaluators.map((evaluator) => {
    const resolvedConfig = { ...(evaluator.config ?? {}) };
    const prompt = resolvedConfig.prompt;
    const promptFile = resolvedConfig.prompt_file;

    if (prompt !== undefined || promptFile !== undefined) {
      resolvedConfig.prompt = resolvePromptValue(
        typeof prompt === 'string' ? prompt : undefined,
        typeof promptFile === 'string' ? promptFile : undefined,
        baseDir
      );
      delete resolvedConfig.prompt_file;
    }

    return {
      ...evaluator,
      config: parseEvaluatorConfig(evaluator.name, resolvedConfig, {
        requireAgentType: options.requireAgentType,
        inheritedAgentType: options.inheritedAgentType,
      }),
    };
  });
}

/**
 * Build the same fully resolved test-case configuration used by run and validate.
 */
export function resolveEffectiveTestCaseConfig(
  data: unknown,
  configFile: string,
  globalConfig: Config
): TestCaseConfig {
  const parsed = testCaseConfigSchema.parse(
    substituteConfiguredVariables(data, globalConfig)
  );
  const baseDir = path.dirname(path.resolve(configFile));
  const evaluators = resolveEvaluatorPrompts(
    resolveEvaluatorConfigs(parsed.evaluators, baseDir),
    baseDir,
    { inheritedAgentType: parsed.agent.type }
  );
  validateEvaluatorNames(evaluators);

  const prompt = parsed.agent.config?.prompt;
  const promptFile = parsed.agent.config?.prompt_file;
  const resolvedPrompt = resolvePromptValue(prompt, promptFile, baseDir);
  const agentConfig = parsed.agent.config
    ? { ...parsed.agent.config, prompt: resolvedPrompt, prompt_file: undefined }
    : parsed.agent.config;

  return testCaseConfigSchema.parse({
    ...parsed,
    workspace_dir: parsed.workspace_dir ?? globalConfig.workspace_dir,
    timeout:
      parsed.timeout ??
      globalConfig.agent?.timeout_ms ??
      globalConfig.timeout_ms,
    agent: {
      ...parsed.agent,
      model: parsed.agent.model ?? globalConfig.agent?.model,
      config: agentConfig,
    },
    evaluators: evaluators as EvaluatorConfig[],
  });
}

/**
 * Build a fully resolved eval-only configuration before evaluator execution.
 */
export function resolveEffectiveEvalConfig(
  data: unknown,
  configFile: string,
  globalConfig: Config
): EvalConfig {
  const parsed = evalConfigSchema.parse(
    substituteConfiguredVariables(data, globalConfig)
  );
  const baseDir = path.dirname(path.resolve(configFile));
  const evaluators = resolveEvaluatorPrompts(parsed.evaluators, baseDir, {
    requireAgentType: true,
  });
  validateEvaluatorNames(evaluators);

  return {
    ...parsed,
    output_dir: parsed.output_dir ?? globalConfig.output_dir,
    evaluators,
  };
}
