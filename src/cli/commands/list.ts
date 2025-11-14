/**
 * List Command
 * 
 * Lists available evaluators and their descriptions.
 */

import * as logger from '../../lib/logger.js';
import { GitDiffEvaluator } from '../../evaluators/git-diff.js';
import { ExpectedDiffEvaluator } from '../../evaluators/expected-diff.js';
import { AgenticJudgeEvaluator } from '../../evaluators/agentic-judge.js';

/**
 * List command handler - shows available evaluators
 */
export async function listCommand(): Promise<void> {
  // Get all evaluators
  const evaluators = [
    new GitDiffEvaluator(),
    new ExpectedDiffEvaluator(),
    new AgenticJudgeEvaluator(),
  ];

  logger.info('');
  logger.info('📋 Available Evaluators:');
  logger.info('');

  evaluators.forEach((evaluator) => {
    const reqRef = evaluator.requiresExpectedReference ? '(requires expected reference)' : '';
    logger.info(`▪ ${evaluator.name} ${reqRef}`);
    logger.info(`  ${evaluator.description}`);
    logger.info('');
  });

  logger.info('💡 Usage in suite.yaml:');
  logger.info('');
  logger.info('  evaluators:');
  logger.info('    - name: git-diff');
  logger.info('    - name: expected-diff');
  logger.info('      config:');
  logger.info('        threshold: 0.85');
  logger.info('    - name: agentic-judge');
  logger.info('      config:');
  logger.info('        type: copilot-cli');
  logger.info('        agent_name: agentic-judge');
  logger.info('        criteria:');
  logger.info('          metric_name: "Description of what to check"');
  logger.info('');
  logger.info('See examples/ directory for complete suite configurations.');
  logger.info('');
}
