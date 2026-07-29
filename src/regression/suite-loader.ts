import * as fs from 'fs/promises';
import * as path from 'path';
import type { Config } from '../schemas/config.schema.js';
import {
  regressionSuiteDefinitionSchema,
  regressionTaskDefinitionSchema,
  type RegressionSuiteDefinition,
  type RegressionTaskDefinition,
} from '../schemas/suite-v2.schema.js';
import {
  loadConfig,
  substituteVariablesInObject,
} from '../lib/config-loader.js';
import { parseConfig } from '../lib/config-parser.js';
import {
  identitySafeValue,
  redactSensitiveValues,
  stableHash,
} from '../experiments/identity.js';

export interface LoadedRegressionTask {
  id: string;
  declaredFile: string;
  resolvedFile: string;
  definition: RegressionTaskDefinition;
  definitionHash: string;
}

export interface LoadedRegressionSuite {
  sourceFile: string;
  definition: RegressionSuiteDefinition;
  definitionHash: string;
  tasks: LoadedRegressionTask[];
  globalConfig: Config;
  redactedEffectiveConfiguration: unknown;
}

function errorMessage(error: unknown): string {
  return String(error).replace(/^(?:[A-Za-z]+)?Error:\s*/, '');
}

async function readParsedFile(file: string): Promise<unknown> {
  try {
    const content = await fs.readFile(file, 'utf8');
    return parseConfig(content, file);
  } catch (error) {
    throw new Error(`${file}: ${errorMessage(error)}`);
  }
}

function unresolvedVariables(value: unknown, location = ''): string[] {
  if (typeof value === 'string') {
    return [...value.matchAll(/\$\{([^}]+)\}/g)].map(
      (match) => `${location || '<root>'}: \${${match[1]}}`
    );
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      unresolvedVariables(item, `${location}[${index}]`)
    );
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      unresolvedVariables(item, location ? `${location}.${key}` : key)
    );
  }
  return [];
}

function substituteAndRequireResolved(
  value: unknown,
  config: Config,
  file: string
): unknown {
  const substituted = substituteVariablesInObject(
    value,
    config.variables ?? {}
  );
  const unresolved = unresolvedVariables(substituted);
  if (unresolved.length > 0) {
    throw new Error(
      `${file}: unresolved configuration variable${unresolved.length === 1 ? '' : 's'}: ${unresolved.join(', ')}`
    );
  }
  return substituted;
}

export async function loadRegressionSuite(
  suiteFile: string,
  globalConfig?: Config
): Promise<LoadedRegressionSuite> {
  const sourceFile = path.resolve(suiteFile);
  const effectiveGlobalConfig = globalConfig ?? (await loadConfig());
  const parsed = substituteAndRequireResolved(
    await readParsedFile(sourceFile),
    effectiveGlobalConfig,
    sourceFile
  );

  let definition: RegressionSuiteDefinition;
  try {
    definition = regressionSuiteDefinitionSchema.parse(parsed);
  } catch (error) {
    throw new Error(
      `${sourceFile}: invalid version 2 suite definition: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const baseDir = path.dirname(sourceFile);
  const tasks = await Promise.all(
    definition.suite.tasks.map(async (entry) => {
      const resolvedFile = path.resolve(baseDir, entry.file);
      const taskData = substituteAndRequireResolved(
        await readParsedFile(resolvedFile),
        effectiveGlobalConfig,
        resolvedFile
      );
      let taskDefinition: RegressionTaskDefinition;
      try {
        taskDefinition = regressionTaskDefinitionSchema.parse(taskData);
      } catch (error) {
        throw new Error(
          `${sourceFile}: task "${entry.id}" declared at ${entry.file} (${resolvedFile}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      return {
        id: entry.id,
        declaredFile: entry.file.replace(/\\/g, '/'),
        resolvedFile,
        definition: taskDefinition,
        definitionHash: stableHash(identitySafeValue(taskDefinition)),
      };
    })
  );

  const identity = {
    definition,
    tasks: tasks.map((task) => ({
      id: task.id,
      file: task.declaredFile,
      definition_hash: task.definitionHash,
    })),
  };
  return {
    sourceFile,
    definition,
    definitionHash: stableHash(identitySafeValue(identity)),
    tasks,
    globalConfig: effectiveGlobalConfig,
    redactedEffectiveConfiguration: redactSensitiveValues({
      ...identity,
      tasks: tasks.map((task) => ({
        id: task.id,
        file: task.declaredFile,
        definition_hash: task.definitionHash,
        definition: task.definition,
      })),
    }),
  };
}
