import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { parseConfig } from '../../src/lib/config-parser';
import { substituteVariablesInObject } from '../../src/lib/config-loader';
import { evalConfigSchema } from '../../src/schemas/eval.schema';
import { testCaseConfigSchema } from '../../src/schemas/testcase.schema';
import { configSchema } from '../../src/schemas/config.schema';
import { evaluatorDefinitionSchema } from '../../src/schemas/evaluator-definition.schema';
import { experimentDefinitionSchema } from '../../src/schemas/experiment.schema';

const repositoryRoot = path.resolve(__dirname, '..', '..');

describe('published documentation and examples', () => {
  it.each([
    'README.md',
    'docs/GETTING-STARTED.md',
    'docs/experiments.md',
    'docs/configuration.md',
    'docs/analyzing-results.md',
    'docs/codex-cli-adapter.md',
  ])('%s has no broken local Markdown links', (relativeDocumentPath) => {
    const documentPath = path.join(repositoryRoot, relativeDocumentPath);
    const content = fs.readFileSync(documentPath, 'utf8');
    const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
    const brokenLinks: string[] = [];

    for (const match of content.matchAll(linkPattern)) {
      const target = match[1]?.trim();
      if (
        !target ||
        target.startsWith('#') ||
        /^[a-z][a-z0-9+.-]*:/i.test(target)
      ) {
        continue;
      }
      const withoutAnchor = target.split('#', 1)[0];
      if (!withoutAnchor) continue;
      const resolved = path.resolve(path.dirname(documentPath), withoutAnchor);
      if (!fs.existsSync(resolved)) {
        brokenLinks.push(target);
      }
    }

    expect(brokenLinks).toEqual([]);
  });

  it('all published experiment examples satisfy the active schema and reference existing test cases', () => {
    const examplesDirectory = path.join(repositoryRoot, 'examples');
    const examples = fs
      .readdirSync(examplesDirectory)
      .filter((name) => /^experiment-.*\.(?:yaml|json)$/.test(name));
    const failures: string[] = [];

    for (const example of examples) {
      const examplePath = path.join(examplesDirectory, example);
      try {
        const definition = experimentDefinitionSchema.parse(
          parseConfig(fs.readFileSync(examplePath, 'utf8'), examplePath)
        );
        for (const testcase of definition.testcases) {
          const testcasePath = path.resolve(
            path.dirname(examplePath),
            testcase.file
          );
          if (!fs.existsSync(testcasePath)) {
            throw new Error(`missing test case ${testcase.file}`);
          }
          testCaseConfigSchema.parse(
            parseConfig(fs.readFileSync(testcasePath, 'utf8'), testcasePath)
          );
        }
      } catch (error) {
        failures.push(
          `${example}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    expect(examples.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('the npm package includes the complete published docs and examples trees', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
    ) as { files?: string[] };

    expect(packageJson.files).toEqual(
      expect.arrayContaining(['dist/', 'examples/', 'docs/', 'README.md'])
    );
    expect(
      fs.existsSync(
        path.join(
          repositoryRoot,
          'examples',
          'github-actions',
          'experiment-regression.yml'
        )
      )
    ).toBe(true);
  });

  it('all published testcase examples satisfy the active schema', () => {
    const examplesDirectory = path.join(repositoryRoot, 'examples');
    const examples = fs
      .readdirSync(examplesDirectory)
      .filter((name) => /^testcase-.*\.(?:yaml|json)$/.test(name));
    const failures: string[] = [];

    for (const example of examples) {
      const examplePath = path.join(examplesDirectory, example);
      try {
        const parsed = parseConfig(
          fs.readFileSync(examplePath, 'utf8'),
          examplePath
        );
        testCaseConfigSchema.parse(
          substituteVariablesInObject(parsed, {
            REPO_BASE: 'https://github.com/youbencha',
            DEFAULT_BRANCH: 'main',
            PROJECT_NAME: 'example-project',
          })
        );
      } catch (error) {
        failures.push(
          `${example}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it('all published eval examples satisfy the active schema', () => {
    const examplesDirectory = path.join(repositoryRoot, 'examples');
    const examples = fs
      .readdirSync(examplesDirectory)
      .filter((name) => /^eval-.*\.(?:yaml|json)$/.test(name));
    const failures: string[] = [];

    for (const example of examples) {
      const examplePath = path.join(examplesDirectory, example);
      try {
        evalConfigSchema.parse(
          parseConfig(fs.readFileSync(examplePath, 'utf8'), examplePath)
        );
      } catch (error) {
        failures.push(
          `${example}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it('published global config and reusable evaluators satisfy their schemas', () => {
    const configPath = path.join(
      repositoryRoot,
      'examples',
      'config-example.yaml'
    );
    configSchema.parse(
      parseConfig(fs.readFileSync(configPath, 'utf8'), configPath)
    );

    const evaluatorsDirectory = path.join(
      repositoryRoot,
      'examples',
      'evaluators'
    );
    const failures: string[] = [];
    for (const filename of fs.readdirSync(evaluatorsDirectory)) {
      if (!/\.(?:yaml|json)$/.test(filename)) continue;
      const evaluatorPath = path.join(evaluatorsDirectory, filename);
      try {
        evaluatorDefinitionSchema.parse(
          parseConfig(fs.readFileSync(evaluatorPath, 'utf8'), evaluatorPath)
        );
      } catch (error) {
        failures.push(
          `${filename}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    expect(failures).toEqual([]);
  });
});
