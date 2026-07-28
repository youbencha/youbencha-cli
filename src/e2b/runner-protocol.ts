import { e2bRunnerPhaseSchema, type E2BRunnerPhase } from './schemas.js';

export const E2B_RUNNER_EXECUTABLE = '/opt/youbencha/bin/run-cell';
export const E2B_CELL_MANIFEST_PATH = '/work/input/cell.json';
export const E2B_RUNNER_WORKING_DIRECTORY = '/work';
export const E2B_OUTPUT_MANIFEST_PATH = '/work/output/manifest.json';
export const E2B_OUTPUT_ARCHIVE_PATH = '/work/output/artifacts.tar.zst';

export interface E2BRunnerCommand {
  executable: typeof E2B_RUNNER_EXECUTABLE;
  args: readonly [E2BRunnerPhase, typeof E2B_CELL_MANIFEST_PATH];
  cwd: typeof E2B_RUNNER_WORKING_DIRECTORY;
}

/**
 * Returns the closed, fixed runner command. User-controlled values belong in
 * the cell manifest and can never become executable text or command arguments.
 */
export function runnerCommand(phase: E2BRunnerPhase): E2BRunnerCommand {
  const parsedPhase = e2bRunnerPhaseSchema.parse(phase);
  return {
    executable: E2B_RUNNER_EXECUTABLE,
    args: [parsedPhase, E2B_CELL_MANIFEST_PATH],
    cwd: E2B_RUNNER_WORKING_DIRECTORY,
  };
}

export const E2B_RUNNER_PHASES: readonly E2BRunnerPhase[] = Object.freeze([
  'prepare',
  'agent',
  'evaluate',
  'post-evaluate',
  'package',
]);
