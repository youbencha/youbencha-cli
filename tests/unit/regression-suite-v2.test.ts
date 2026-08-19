import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { defaultConfig } from '../../src/schemas/config.schema.js';
import {
  loadRegressionSuite,
  planRegressionSuite,
} from '../../src/regression/index.js';

describe('version 2 regression suite planning', () => {
  let temporaryDirectory: string;
  let suiteFile: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-suite-v2-')
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'task-one.yaml'),
      [
        'version: 2',
        'kind: task',
        'name: First task',
        'description: A target-neutral task',
        'repo: https://github.com/example/project.git',
        'task:',
        '  prompt: Make a focused change',
        'evaluators:',
        '  - name: git-diff',
        'setup:',
        '  cacheable: [npm-ci]',
        '  per_attempt:',
        '    - command: npm',
        '      args: [test]',
      ].join('\n')
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'task-two.yaml'),
      [
        'version: 2',
        'kind: task',
        'name: Second task',
        'description: Another target-neutral task',
        'repo: https://github.com/example/project.git',
        'task:',
        '  prompt_file: ./prompt.md',
        'evaluators:',
        '  - name: git-diff',
      ].join('\n')
    );
    await fs.writeFile(
      path.join(temporaryDirectory, 'prompt.md'),
      'Change the second behavior'
    );
    suiteFile = path.join(temporaryDirectory, 'suite.yaml');
    await fs.writeFile(
      suiteFile,
      [
        'version: 2',
        'name: migration',
        'suite:',
        '  tasks:',
        '    - id: first',
        '      file: ./task-one.yaml',
        '    - id: second',
        '      file: ./task-two.yaml',
        '  repetitions: 3',
        'profiles:',
        '  smoke:',
        '    tasks: [first]',
        '    targets: [candidate]',
        '    repetitions: 1',
        '    comparisons: []',
        '    rules: []',
        '  overlap:',
        "    tasks: '*'",
        '    targets: [incumbent, candidate]',
        '    repetitions: 2',
        '    comparisons: [current]',
        '    rules: [pass-drop]',
        'targets:',
        '  - id: incumbent',
        '    agent:',
        '      type: codex-cli',
        '      model: gpt-current',
        '      config:',
        '        reasoning_effort: high',
        '    harness:',
        "      exact_version: '1.2.3'",
        '  - id: candidate',
        '    agent:',
        '      type: claude-code',
        '      model: claude-next',
        '      config:',
        '        effort: high',
        '        permission_mode: dontAsk',
        '    harness:',
        "      exact_version: '2.4.0'",
        'execution:',
        '  max_concurrent: 4',
        'regression:',
        '  default_candidate_target: candidate',
        '  comparisons:',
        '    - id: current',
        '      candidate_target: candidate',
        '      baseline:',
        '        source: current_run',
        '        target: incumbent',
        '  rules:',
        '    - id: pass-drop',
        '      metric: overall_pass_rate',
        '      scopes: [target, testcase_target]',
        '      max_absolute_drop: 0.05',
        '      comparisons: [current]',
        '      minimum_samples: 2',
      ].join('\n')
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('compiles independent adapter configs without cross-harness leakage', async () => {
    const loaded = await loadRegressionSuite(suiteFile, { ...defaultConfig });
    const plan = planRegressionSuite(loaded, { profile: 'overlap' });
    const codex = plan.cells.find((cell) => cell.variantName === 'incumbent');
    const claude = plan.cells.find((cell) => cell.variantName === 'candidate');

    expect(codex?.config.agent.type).toBe('codex-cli');
    expect(codex?.config.agent.config).toMatchObject({
      reasoning_effort: 'high',
      prompt: 'Make a focused change',
    });
    expect(codex?.config.agent.config).not.toHaveProperty('effort');
    expect(claude?.config.agent.type).toBe('claude-code');
    expect(claude?.config.agent.config).toMatchObject({
      effort: 'high',
      prompt: 'Make a focused change',
    });
    expect(claude?.config.agent.config).not.toHaveProperty('reasoning_effort');
    expect(codex?.config.pre_execution).toHaveLength(2);
  });

  it('interleaves target queues deterministically and binds selection to identity', async () => {
    const loaded = await loadRegressionSuite(suiteFile, { ...defaultConfig });
    const first = planRegressionSuite(loaded, { profile: 'overlap' });
    const second = planRegressionSuite(loaded, { profile: 'overlap' });
    const smoke = planRegressionSuite(loaded, { profile: 'smoke' });

    expect(first.cellCount).toBe(8);
    expect(first.cells.map((cell) => cell.variantName)).toEqual([
      'incumbent',
      'candidate',
      'incumbent',
      'candidate',
      'incumbent',
      'candidate',
      'incumbent',
      'candidate',
    ]);
    expect(first.cells.map((cell) => cell.cellId)).toEqual(
      second.cells.map((cell) => cell.cellId)
    );
    expect(smoke.cellCount).toBe(1);
    expect(smoke.definitionHash).not.toBe(first.definitionHash);
    expect(smoke.selection).toMatchObject({
      profile: 'smoke',
      taskIds: ['first'],
      targetIds: ['candidate'],
      repetitions: 1,
      comparisonIds: [],
      ruleIds: [],
    });
    const providerOverride = planRegressionSuite(loaded, {
      profile: 'smoke',
      provider: 'e2b',
    });
    const repetitionOverride = planRegressionSuite(loaded, {
      profile: 'smoke',
      repetitions: 2,
    });
    expect(providerOverride.definitionHash).not.toBe(smoke.definitionHash);
    expect(repetitionOverride.definitionHash).not.toBe(smoke.definitionHash);
    expect(repetitionOverride.cellCount).toBe(2);
  });

  it('allows filters only to narrow profiles', async () => {
    const loaded = await loadRegressionSuite(suiteFile, { ...defaultConfig });

    expect(
      planRegressionSuite(loaded, {
        profile: 'overlap',
        caseIds: ['second'],
      }).cellCount
    ).toBe(4);
    expect(() =>
      planRegressionSuite(loaded, {
        profile: 'smoke',
        caseIds: ['second'],
      })
    ).toThrow('broaden profile');
  });

  it('requires current-run comparison targets in the effective plan', async () => {
    const loaded = await loadRegressionSuite(suiteFile, { ...defaultConfig });

    expect(() =>
      planRegressionSuite(loaded, {
        profile: 'overlap',
        targetIds: ['candidate'],
      })
    ).toThrow('requires selected baseline target');
  });

  it('resolves task-relative prompt files into every target config', async () => {
    const loaded = await loadRegressionSuite(suiteFile, { ...defaultConfig });
    const plan = planRegressionSuite(loaded, {
      caseIds: ['second'],
      targetIds: ['candidate'],
    });

    expect(plan.cells[0].config.agent.config?.prompt).toBe(
      'Change the second behavior'
    );
    expect(plan.cells[0].config.agent.config?.prompt_file).toBeUndefined();
  });
});
