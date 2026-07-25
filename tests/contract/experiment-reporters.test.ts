import type { ExperimentResult } from '../../src/schemas/experiment-result.schema.js';
import {
  generateExperimentJson,
  generateExperimentJunit,
  generateExperimentMarkdown,
  getExperimentReportPaths,
} from '../../src/reporters/experiment.js';

const result: ExperimentResult = {
  schema_version: '1.0.0',
  experiment_version: 1,
  experiment_id: 'contract',
  definition_hash: 'a'.repeat(64),
  started_at: '2026-07-24T12:00:00.000Z',
  completed_at: '2026-07-24T12:00:00.000Z',
  final_status: 'passed',
  exit_code: 0,
  effective_configuration: {},
  sources: [],
  provenance: {
    youbencha_version: '0.1.5-beta',
    agent_cli_versions: {},
    requested_models: {},
    resolved_models: {},
  },
  cells: [],
  aggregates: [],
  comparisons: [],
  artifacts: {},
  warnings: [],
};

describe('experiment reporter contract', () => {
  it('exposes synchronous deterministic generators', () => {
    expect(generateExperimentJson(result)).toMatch(/"schema_version": "1.0.0"/);
    expect(generateExperimentMarkdown(result)).toContain(
      '# youBencha Experiment'
    );
    expect(generateExperimentJunit(result)).toContain('<testsuite');
  });

  it('exposes conventional output paths', () => {
    const paths = getExperimentReportPaths('experiment-output');
    expect(paths.json).toMatch(/results\.json$/);
    expect(paths.markdown).toMatch(/report\.md$/);
    expect(paths.junit).toMatch(/junit\.xml$/);
  });
});
