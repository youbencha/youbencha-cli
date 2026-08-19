import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { defaultConfig } from '../../src/schemas/config.schema.js';
import {
  canonicalJson,
  loadExperiment,
  planExperiment,
  redactSensitiveValues,
} from '../../src/experiments/index.js';

describe('experiment loading and planning', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-experiment-')
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'task.yaml'),
      [
        'name: Task',
        'description: A deterministic task',
        'repo: https://github.com/example/example.git',
        'agent:',
        '  type: copilot-cli',
        '  config:',
        '    prompt: Make a focused change',
        'evaluators:',
        '  - name: git-diff',
        '    config:',
        '      assertions:',
        '        max_files_changed: 1',
      ].join('\n')
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'experiment.yaml'),
      [
        'version: 1',
        'name: deterministic',
        'testcases:',
        '  - id: task',
        '    file: ./task.yaml',
        'variants:',
        '  - name: first',
        '    agent:',
        '      type: copilot-cli',
        '      config:',
        '        reasoning_effort: high',
        '  - name: second',
        '    agent:',
        '      type: claude-code',
        'repetitions: 2',
        'execution:',
        '  max_concurrent: 2',
      ].join('\n')
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('resolves relative test case files and creates a stable ordered matrix', async () => {
    const file = path.join(temporaryDirectory, 'experiment.yaml');
    const first = planExperiment(
      await loadExperiment(file, { ...defaultConfig })
    );
    const second = planExperiment(
      await loadExperiment(file, { ...defaultConfig })
    );

    expect(first.cellCount).toBe(4);
    expect(first.cells.map((cell) => cell.variantName)).toEqual([
      'first',
      'first',
      'second',
      'second',
    ]);
    expect(first.cells.map((cell) => cell.repetition)).toEqual([0, 1, 0, 1]);
    expect(first.cells.map((cell) => cell.cellId)).toEqual(
      second.cells.map((cell) => cell.cellId)
    );
    expect(new Set(first.cells.map((cell) => cell.cellId)).size).toBe(4);
  });

  it('redacts absolute paths from effective plan output', async () => {
    const plan = planExperiment(
      await loadExperiment(path.join(temporaryDirectory, 'experiment.yaml'), {
        ...defaultConfig,
        workspace_dir: temporaryDirectory,
      })
    );
    const serialized = JSON.stringify(plan.redactedEffectiveConfiguration);

    expect(serialized).not.toContain(temporaryDirectory);
    expect(serialized).toContain('<absolute-path>');
  });

  it('canonicalizes key order and path separators', () => {
    expect(canonicalJson({ z: 1, a: { d: 2, b: 1 } })).toBe(
      '{"a":{"b":1,"d":2},"z":1}'
    );
    expect(redactSensitiveValues({ token: 'secret' })).toEqual({
      token: '[REDACTED]',
    });
    const signedUrl = redactSensitiveValues(
      'https://example.com/repo.git?sig=query-secret&safe=value#access_token=fragment-secret'
    );
    expect(signedUrl).not.toContain('query-secret');
    expect(signedUrl).not.toContain('fragment-secret');
    expect(signedUrl).toContain('safe=value');
  });

  it('hashes absolute-looking semantic prompts in full', async () => {
    const taskFile = path.join(temporaryDirectory, 'task.yaml');
    const experimentFile = path.join(temporaryDirectory, 'experiment.yaml');
    const writeTask = async (prompt: string): Promise<void> =>
      fs.writeFile(
        taskFile,
        [
          'name: Task',
          'description: A deterministic task',
          'repo: https://github.com/example/example.git',
          'agent:',
          '  type: copilot-cli',
          '  config:',
          `    prompt: "${prompt}"`,
          'evaluators:',
          '  - name: git-diff',
        ].join('\n')
      );

    await writeTask('/one/task');
    const firstLoaded = await loadExperiment(experimentFile, {
      ...defaultConfig,
    });
    const firstPlan = planExperiment(firstLoaded);
    await writeTask('/two/task');
    const secondLoaded = await loadExperiment(experimentFile, {
      ...defaultConfig,
    });
    const secondPlan = planExperiment(secondLoaded);

    expect(firstLoaded.testcases[0].configHash).not.toBe(
      secondLoaded.testcases[0].configHash
    );
    expect(firstLoaded.definitionHash).not.toBe(secondLoaded.definitionHash);
    expect(firstPlan.cells[0].cellId).not.toBe(secondPlan.cells[0].cellId);
    expect(
      JSON.stringify(secondLoaded.redactedEffectiveConfiguration)
    ).toContain('/two/task');
  });

  it('plans without invoking an agent or creating runtime directories', async () => {
    const before = (await fs.readdir(temporaryDirectory)).sort();
    planExperiment(
      await loadExperiment(path.join(temporaryDirectory, 'experiment.yaml'), {
        ...defaultConfig,
      })
    );
    const after = (await fs.readdir(temporaryDirectory)).sort();

    expect(after).toEqual(before);
  });

  it('identifies the declaring experiment and testcase on load errors', async () => {
    await fs.writeFile(
      path.join(temporaryDirectory, 'experiment.yaml'),
      [
        'version: 1',
        'name: broken',
        'testcases:',
        '  - id: missing',
        '    file: ./missing.yaml',
        'variants:',
        '  - name: default',
        '    agent:',
        '      type: copilot-cli',
      ].join('\n')
    );

    await expect(
      loadExperiment(path.join(temporaryDirectory, 'experiment.yaml'), {
        ...defaultConfig,
      })
    ).rejects.toThrow('missing.yaml');
  });
});
