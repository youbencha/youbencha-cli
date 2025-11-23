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
import { evalCommand } from './commands/eval.js';
import { reportCommand } from './commands/report.js';
import { registerSuggestSuiteCommand } from './commands/suggest-suite.js';
import { listCommand } from './commands/list.js';
import { initCommand } from './commands/init.js';
import { validateCommand } from './commands/validate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Main CLI function
 */
async function main() {
  // Read package.json for version
  const packageJsonPath = join(__dirname, '..', '..', 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

  // Detect command name from how the CLI was invoked (supports both 'yb' and 'youbencha')
  const commandName = process.argv[1]?.includes('youbencha') ? 'youbencha' : 'yb';

  // Create Commander program
  const program = new Command();

  program
    .name(commandName)
    .description('youBencha - Evaluate and compare AI coding agents with confidence\n\n' +
      '  A developer-friendly framework for testing AI coding tools.\n' +
      '  Run agents, measure their output, and get objective insights.\n\n' +
      '  Quick start:\n' +
      `    ${commandName} init              # Create a starter configuration\n` +
      `    ${commandName} run -c suite.yaml # Run an evaluation`)
    .version(packageJson.version);

  // Register init command (create starter suite)
  program
    .command('init')
    .description('Create a starter suite.yaml configuration')
    .option('--force', 'Overwrite existing suite.yaml if present')
    .addHelpText('after', `
Examples:
  $ ${commandName} init                    # Create suite.yaml in current directory
  $ ${commandName} init --force            # Overwrite existing suite.yaml
  
  This creates a fully-commented starter configuration you can customize.
    `)
    .action(initCommand);

  // Register commands
  program
    .command('run')
    .description('Run an evaluation suite against an AI agent')
    .requiredOption('-c, --config <path>', 'Path to suite configuration file (YAML or JSON, e.g., suite.yaml or suite.json)')
    .option('--delete-workspace', 'Delete workspace directory after evaluation (by default, workspace is kept for inspection)')
    .addHelpText('after', `
Examples:
  $ ${commandName} run -c suite.yaml                    # Run evaluation (workspace kept by default)
  $ ${commandName} run -c suite.json                    # JSON format is also supported
  $ ${commandName} run -c suite.yaml --delete-workspace # Delete workspace after completion
  
  See examples/testcase-simple.yaml or examples/testcase-simple.json for working configurations.
    `)
    .action(runCommand);

  program
    .command('eval')
    .description('Run evaluators on existing directories (no agent execution)')
    .requiredOption('-c, --config <path>', 'Path to eval configuration file (YAML or JSON)')
    .addHelpText('after', `
Examples:
  $ ${commandName} eval -c eval.yaml                    # Evaluate existing directory
  $ ${commandName} eval -c eval.json                    # JSON format is also supported
  
  Use cases:
  - Re-evaluate agent outputs with different evaluators
  - Evaluate manual code changes
  - Test custom evaluators during development
  - CI/CD integration with other tools
  
  The eval command runs evaluators without executing an agent, making it
  faster and more flexible for iterative evaluation workflows.
    `)
    .action(evalCommand);

  program
    .command('report')
    .description('Generate a human-readable report from evaluation results')
    .requiredOption('--from <path>', 'Path to results JSON file (e.g., .youbencha-workspace/run-*/artifacts/results.json)')
    .option('--format <format>', 'Report format: json, markdown', 'markdown')
    .option('--output <path>', 'Output path for report (defaults to artifacts directory)')
    .addHelpText('after', `
Examples:
  $ ${commandName} report --from .youbencha-workspace/run-abc123/artifacts/results.json
  $ ${commandName} report --from results.json --format markdown --output report.md
  
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
  $ ${commandName} list                           # Show all available evaluators
  
  Use this to discover which evaluators you can use in your suite.yaml or suite.json
    `)
    .action(listCommand);

  // Register validate command (check suite configuration)
  program
    .command('validate')
    .description('Validate a suite configuration without running it')
    .requiredOption('-c, --config <path>', 'Path to suite configuration file (YAML or JSON)')
    .option('-v, --verbose', 'Show detailed validation information')
    .addHelpText('after', `
Examples:
  $ ${commandName} validate -c suite.yaml         # Quick validation check
  $ ${commandName} validate -c suite.json         # JSON format is also supported
  $ ${commandName} validate -c suite.yaml -v      # Detailed validation with suggestions
  
  Use this to check your configuration before committing or running.
    `)
    .action(validateCommand);

  // Parse arguments
  await program.parseAsync(process.argv);
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
