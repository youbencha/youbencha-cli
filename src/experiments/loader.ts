import * as fs from 'fs/promises';
import * as path from 'path';
import type { Config } from '../schemas/config.schema.js';
import {
  experimentDefinitionSchema,
  type ExperimentDefinition,
} from '../schemas/experiment.schema.js';
import {
  testCaseConfigSchema,
  type TestCaseConfig,
} from '../schemas/testcase.schema.js';
import { loadConfig } from '../lib/config-loader.js';
import { parseConfig } from '../lib/config-parser.js';
import { resolveEffectiveTestCaseConfig } from '../lib/effective-config.js';
import {
  identitySafeValue,
  redactSensitiveValues,
  stableHash,
} from './identity.js';

export interface LoadedExperimentTestCase {
  id: string;
  declaredFile: string;
  resolvedFile: string;
  config: TestCaseConfig;
  configHash: string;
}

export interface LoadedExperiment {
  sourceFile: string;
  definition: ExperimentDefinition;
  definitionHash: string;
  testcases: LoadedExperimentTestCase[];
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

function mergeVariantAgent(
  testcase: TestCaseConfig,
  agent: ExperimentDefinition['variants'][number]['agent']
): TestCaseConfig {
  return testCaseConfigSchema.parse({
    ...testcase,
    agent: {
      ...testcase.agent,
      ...agent,
      config:
        testcase.agent.config === undefined && agent.config === undefined
          ? undefined
          : { ...testcase.agent.config, ...agent.config },
    },
  });
}

export function resolveVariantTestCaseConfig(
  testcase: TestCaseConfig,
  variant: ExperimentDefinition['variants'][number]
): TestCaseConfig {
  return mergeVariantAgent(testcase, variant.agent);
}

export async function loadExperiment(
  experimentFile: string,
  globalConfig?: Config
): Promise<LoadedExperiment> {
  const sourceFile = path.resolve(experimentFile);
  const parsed = await readParsedFile(sourceFile);
  let definition: ExperimentDefinition;
  try {
    definition = experimentDefinitionSchema.parse(parsed);
  } catch (error) {
    throw new Error(
      `${sourceFile}: invalid experiment definition: ${errorMessage(error)}`
    );
  }

  const effectiveGlobalConfig = globalConfig ?? (await loadConfig());
  const baseDir = path.dirname(sourceFile);
  const testcases = await Promise.all(
    definition.testcases.map(async (entry) => {
      const resolvedFile = path.resolve(baseDir, entry.file);
      const testcaseData = await readParsedFile(resolvedFile);
      let config: TestCaseConfig;
      try {
        config = resolveEffectiveTestCaseConfig(
          testcaseData,
          resolvedFile,
          effectiveGlobalConfig
        );
        for (const variant of definition.variants) {
          resolveVariantTestCaseConfig(config, variant);
        }
      } catch (error) {
        throw new Error(
          `${sourceFile}: testcase "${entry.id}" declared at ${entry.file} (${resolvedFile}): ${errorMessage(error)}`
        );
      }
      const identityConfig = identitySafeValue({
        ...config,
        workspace_dir: undefined,
      });
      return {
        id: entry.id,
        declaredFile: entry.file.replace(/\\/g, '/'),
        resolvedFile,
        config,
        configHash: stableHash(identityConfig),
      };
    })
  );

  const effectiveConfiguration = {
    definition,
    testcases: testcases.map((testcase) => ({
      id: testcase.id,
      file: testcase.declaredFile,
      config_hash: testcase.configHash,
      config: testcase.config,
    })),
  };

  return {
    sourceFile,
    definition,
    definitionHash: stableHash(
      identitySafeValue({
        definition,
        testcases: testcases.map((testcase) => ({
          id: testcase.id,
          file: testcase.declaredFile,
          config_hash: testcase.configHash,
        })),
      })
    ),
    testcases,
    redactedEffectiveConfiguration: redactSensitiveValues(
      effectiveConfiguration
    ),
  };
}
