import type { ResultsBundle } from '../schemas/result.schema.js';

export const CliExitCode = {
  Success: 0,
  ExecutionError: 1,
  EvaluationFailed: 2,
  EvaluationPartial: 3,
} as const;

export type CliExitCodeValue = (typeof CliExitCode)[keyof typeof CliExitCode];

/**
 * Convert a completed result bundle into the stable CLI quality-gate outcome.
 * Execution failures take precedence over evaluator outcomes.
 */
export function getResultsExitCode(results: ResultsBundle): CliExitCodeValue {
  if (results.agent.status !== 'success' || results.agent.exit_code !== 0) {
    return CliExitCode.ExecutionError;
  }

  if (
    results.summary.failed > 0 ||
    results.summary.overall_status === 'failed'
  ) {
    return CliExitCode.EvaluationFailed;
  }

  if (
    results.summary.skipped > 0 ||
    results.summary.overall_status === 'partial'
  ) {
    return CliExitCode.EvaluationPartial;
  }

  return CliExitCode.Success;
}
