/**
 * User-Friendly Error Messages
 * 
 * Provides clear, actionable error messages for common user-facing issues.
 * Each error includes context and suggests specific solutions.
 */

/**
 * User-friendly error with title, description, and action items
 */
export interface UserError {
  title: string;
  description: string;
  actions: string[];
  technicalDetails?: string;
}

/**
 * Format user error for console output
 */
export function formatUserError(error: UserError): string {
  const lines: string[] = [];
  
  lines.push('');
  lines.push(`❌ ${error.title}`);
  lines.push('');
  lines.push(error.description);
  lines.push('');
  
  if (error.actions.length > 0) {
    lines.push('💡 What to do:');
    error.actions.forEach((action, i) => {
      lines.push(`   ${i + 1}. ${action}`);
    });
    lines.push('');
  }
  
  if (error.technicalDetails) {
    lines.push('Technical details:');
    lines.push(`   ${error.technicalDetails}`);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Common user error scenarios
 */
export const UserErrors = {
  /**
   * Agent tool not installed
   */
  agentNotInstalled: (agentType: string): UserError => ({
    title: `Agent tool '${agentType}' not found`,
    description: `youBencha needs ${agentType} to run evaluations, but it's not installed or not in your PATH.`,
    actions: [
      `Install ${agentType} following the official documentation`,
      `Add ${agentType} to your system PATH`,
      `Verify installation by running: ${agentType === 'copilot-cli' ? 'copilot --version' : `${agentType} --version`}`,
      'Restart your terminal after installation',
    ],
  }),

  /**
   * Invalid suite configuration
   */
  invalidConfig: (errors: string[]): UserError => ({
    title: 'Invalid suite configuration',
    description: 'Your suite.yaml file has validation errors that need to be fixed.',
    actions: [
      'Review the errors below and update your suite.yaml',
      'Check example configurations in the examples/ directory',
      'Refer to the documentation: https://github.com/youbencha/youbencha-cli#quick-start',
    ],
    technicalDetails: errors.join('; '),
  }),

  /**
   * Repository clone failed
   */
  cloneFailed: (repoUrl: string, reason: string): UserError => ({
    title: 'Failed to clone repository',
    description: `Could not clone ${repoUrl}. This might be due to network issues, invalid URL, or access permissions.`,
    actions: [
      'Verify the repository URL is correct and accessible',
      'Check your internet connection',
      'If it\'s a private repository, ensure you have proper authentication (SSH keys or Git credentials)',
      'Try cloning the repository manually first: git clone ' + repoUrl,
    ],
    technicalDetails: reason,
  }),

  /**
   * Expected branch not found
   */
  expectedBranchNotFound: (branch: string, repo: string): UserError => ({
    title: `Expected reference branch '${branch}' not found`,
    description: `Your suite configuration references branch '${branch}' for comparison, but it doesn't exist in the repository.`,
    actions: [
      `Verify the branch name is correct (check with: git branch -r)`,
      `If the branch was recently deleted, update your suite.yaml to use a different reference`,
      'Remove the expected_source and expected fields if you don\'t need comparison',
    ],
    technicalDetails: `Repository: ${repo}`,
  }),

  /**
   * No evaluators configured
   */
  noEvaluators: (): UserError => ({
    title: 'No evaluators configured',
    description: 'Your suite.yaml must include at least one evaluator to run an evaluation.',
    actions: [
      'Add at least one evaluator to the "evaluators" section',
      'Common choices: git-diff (measures changes), agentic-judge (quality assessment)',
      'See examples/basic-suite.yaml for a working configuration',
    ],
  }),

  /**
   * Workspace permission denied
   */
  workspacePermissionDenied: (path: string): UserError => ({
    title: 'Permission denied',
    description: `youBencha cannot create or access the workspace directory at ${path}.`,
    actions: [
      'Check that you have write permissions in the current directory',
      'Try running from a directory where you have full permissions',
      'On Unix systems, check permissions with: ls -la',
      'Specify a custom workspace directory with the --workspace-dir flag',
    ],
  }),

  /**
   * Agent execution failed
   */
  agentExecutionFailed: (agentType: string, exitCode: number): UserError => ({
    title: `Agent execution failed`,
    description: `The ${agentType} agent terminated with an error (exit code ${exitCode}). This might be due to invalid prompts, API issues, or tool configuration.`,
    actions: [
      'Check the agent logs in the workspace artifacts directory',
      'Verify your prompt in suite.yaml is valid',
      `Test ${agentType} directly with a simple command to ensure it's working`,
      'If using API-based agents, check your API keys and rate limits',
    ],
  }),

  /**
   * Evaluator dependency missing
   */
  evaluatorDependencyMissing: (evaluator: string, dependency: string): UserError => ({
    title: `Evaluator '${evaluator}' cannot run`,
    description: `The ${evaluator} evaluator requires ${dependency} which is not available.`,
    actions: [
      `Install ${dependency} if needed`,
      `Check the evaluator's documentation for setup requirements`,
      'Remove this evaluator from suite.yaml if you don\'t need it',
    ],
  }),

  /**
   * Timeout exceeded
   */
  timeout: (operation: string, timeoutMs: number): UserError => ({
    title: 'Operation timed out',
    description: `The ${operation} operation exceeded the ${timeoutMs / 1000}s timeout limit.`,
    actions: [
      'Increase the timeout in your suite.yaml configuration',
      'Check if the repository is too large (consider a smaller test case)',
      'Verify network connectivity if downloading remote resources',
      'Check system resources (CPU, memory) - the operation might be stuck',
    ],
  }),

  /**
   * Results file not found
   */
  resultsNotFound: (path: string): UserError => ({
    title: 'Results file not found',
    description: `Cannot find the results file at: ${path}`,
    actions: [
      'Verify the file path is correct',
      'Check if the evaluation completed successfully',
      'Look for results in .youbencha-workspace/run-*/artifacts/results.json',
      'Run a new evaluation with: yb run -c suite.yaml',
    ],
  }),

  /**
   * Invalid evaluator configuration
   */
  invalidEvaluatorConfig: (evaluatorName: string, reason: string): UserError => ({
    title: `Invalid configuration for '${evaluatorName}' evaluator`,
    description: `The ${evaluatorName} evaluator has a configuration problem.`,
    actions: [
      'Review the evaluator configuration in your suite.yaml',
      'Check the documentation for required and optional fields',
      'See examples/basic-suite.yaml for working configurations',
    ],
    technicalDetails: reason,
  }),

  /**
   * Git not installed
   */
  gitNotInstalled: (): UserError => ({
    title: 'Git not found',
    description: 'youBencha requires Git to clone repositories and track changes, but Git is not installed or not in your PATH.',
    actions: [
      'Install Git from https://git-scm.com/downloads',
      'Add Git to your system PATH',
      'Verify installation by running: git --version',
      'Restart your terminal after installation',
    ],
  }),

  /**
   * Unsupported Node version
   */
  unsupportedNodeVersion: (current: string, required: string): UserError => ({
    title: 'Unsupported Node.js version',
    description: `youBencha requires Node.js ${required}, but you're running version ${current}.`,
    actions: [
      `Upgrade Node.js to version ${required} or higher`,
      'Use nvm (Node Version Manager) for easy version switching',
      'Download the latest Node.js from https://nodejs.org',
      'After upgrading, run: node --version to verify',
    ],
  }),
};
