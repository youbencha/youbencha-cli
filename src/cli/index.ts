#!/usr/bin/env node
/**
 * youBencha CLI Entry Point
 * 
 * Main CLI application using Commander.js.
 * Registers all commands and handles version/help.
 */

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Import commands
import { runCommand } from './commands/run.js';
import { reportCommand } from './commands/report.js';
import { registerSuggestSuiteCommand } from './commands/suggest-suite.js';
import { listCommand } from './commands/list.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Main CLI function
 */
async function main() {
  // Read package.json for version
  const packageJsonPath = join(__dirname, '..', '..', 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

  // Create Commander program
  const program = new Command();

  program
    .name('yb')
    .description('youBencha - Evaluate and compare AI coding agents with confidence\n\n' +
      '  A developer-friendly framework for testing AI coding tools.\n' +
      '  Run agents, measure their output, and get objective insights.\n\n' +
      '  Quick start: yb run -c examples/basic-suite.yaml')
    .version(packageJson.version);

  // Register commands
  program
    .command('run')
    .description('Run an evaluation suite against an AI agent')
    .requiredOption('-c, --config <path>', 'Path to suite configuration file (e.g., suite.yaml)')
    .option('--keep-workspace', 'Keep workspace directory after evaluation (useful for debugging)')
    .addHelpText('after', `
Examples:
  $ yb run -c suite.yaml                    # Run evaluation with default settings
  $ yb run -c suite.yaml --keep-workspace   # Keep files for inspection
  
  See examples/basic-suite.yaml for a working configuration.
    `)
    .action(runCommand);

  program
    .command('report')
    .description('Generate a human-readable report from evaluation results')
    .requiredOption('--from <path>', 'Path to results JSON file (e.g., .youbencha-workspace/run-*/artifacts/results.json)')
    .option('--format <format>', 'Report format: json, markdown', 'markdown')
    .option('--output <path>', 'Output path for report (defaults to artifacts directory)')
    .addHelpText('after', `
Examples:
  $ yb report --from .youbencha-workspace/run-abc123/artifacts/results.json
  $ yb report --from results.json --format markdown --output report.md
  
  The report includes:
  - Overall evaluation status
  - Individual evaluator results with metrics
  - Links to detailed artifacts
    `)
    .action(reportCommand);

  // Register suggest-suite command (User Story 3)
  registerSuggestSuiteCommand(program);

  // Register list command (show available evaluators)
  program
    .command('list')
    .description('List available evaluators and their descriptions')
    .addHelpText('after', `
Examples:
  $ yb list                           # Show all available evaluators
  
  Use this to discover which evaluators you can use in your suite.yaml
    `)
    .action(listCommand);

  // Parse arguments
  await program.parseAsync(process.argv);
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
