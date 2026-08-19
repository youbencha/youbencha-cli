import { CliExitCode, getResultsExitCode } from '../../src/lib/exit-codes.js';
import type { ResultsBundle } from '../../src/schemas/result.schema.js';

function resultWith(
  overallStatus: ResultsBundle['summary']['overall_status'],
  failed = 0,
  skipped = 0,
  agentStatus: ResultsBundle['agent']['status'] = 'success'
): ResultsBundle {
  return {
    agent: {
      status: agentStatus,
      exit_code: agentStatus === 'success' ? 0 : 1,
    },
    summary: {
      overall_status: overallStatus,
      failed,
      skipped,
    },
  } as ResultsBundle;
}

describe('CLI exit codes', () => {
  it('returns zero only for a complete passing result', () => {
    expect(getResultsExitCode(resultWith('passed'))).toBe(CliExitCode.Success);
  });

  it('distinguishes evaluator failure from partial evaluation', () => {
    expect(getResultsExitCode(resultWith('failed', 1))).toBe(
      CliExitCode.EvaluationFailed
    );
    expect(getResultsExitCode(resultWith('partial', 0, 1))).toBe(
      CliExitCode.EvaluationPartial
    );
  });

  it('gives execution failure precedence over evaluator outcomes', () => {
    expect(getResultsExitCode(resultWith('failed', 1, 0, 'failed'))).toBe(
      CliExitCode.ExecutionError
    );
  });
});
