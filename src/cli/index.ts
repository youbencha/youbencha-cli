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
import { registerSuggestTestCaseCommand } from './commands/suggest-testcase.js';
import { listCommand } from './commands/list.js';
import { initCommand } from './commands/init.js';
import { validateCommand } from './commands/validate.js';
import { installAgentsCommand } from './commands/install-agents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  // Read package.json for version
  const packageJsonPath = join(__dirname, '..', '..', 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8')) as { version: string };

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
      `    ${commandName} init                   # Create a starter configuration\n` +
      `    ${commandName} run -c testcase.yaml  # Run an evaluation\n` +
      `    ${commandName} eval -c eval.yaml     # Evaluate existing code without running agent`)
    .version(packageJson.version);

  // Register init command (create starter test case)
  program
    .command('init')
    .description('Create a starter testcase.yaml configuration')
    .option('--force', 'Overwrite existing testcase.yaml if present')
    .addHelpText('after', `
Examples:
  $ ${commandName} init                    # Create testcase.yaml in current directory
  $ ${commandName} init --force            # Overwrite existing testcase.yaml
  
  This creates a fully-commented starter configuration you can customize.
    `)
    .action(initCommand);

  // Register install-agents command (install agent files for agentic-judge)
  program
    .command('install-agents')
    .description('Install agentic-judge agent files for GitHub Copilot CLI and Claude Code')
    .option('--force', 'Overwrite existing agent files')
    .addHelpText('after', `
Examples:
  $ ${commandName} install-agents                  # Install agent files (skip existing)
  $ ${commandName} install-agents --force          # Overwrite existing agent files

This installs the following files in your current directory:
  - .github/agents/agentic-judge.md (for GitHub Copilot CLI)
  - .claude/agents/agentic-judge.md (for Claude Code)

These files are required for the agentic-judge evaluator to function.
    `)
    .action(installAgentsCommand);

  // Register commands
  program
    .command('run')
    .description('Run a test case against an AI agent')
    .requiredOption('-c, --config <path>', 'Path to test case configuration file (YAML or JSON, e.g., testcase.yaml or testcase.json)')
    .option('--delete-workspace', 'Delete workspace directory after evaluation (by default, workspace is kept for inspection)')
    .addHelpText('after', `
Examples:
  $ ${commandName} run -c testcase.yaml                    # Run evaluation (workspace kept by default)
  $ ${commandName} run -c testcase.json                    # JSON format is also supported
  $ ${commandName} run -c testcase.yaml --delete-workspace # Delete workspace after completion
  
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

  // Register suggest-testcase command (User Story 3)
  registerSuggestTestCaseCommand(program);

  // Register list command (show available evaluators)
  program
    .command('list')
    .description('List available evaluators and their descriptions')
    .addHelpText('after', `
Examples:
  $ ${commandName} list                           # Show all available evaluators
  
  Use this to discover which evaluators you can use in your testcase.yaml or testcase.json
    `)
    .action(listCommand);

  // Register validate command (check test case configuration)
  program
    .command('validate')
    .description('Validate a test case configuration without running it')
    .requiredOption('-c, --config <path>', 'Path to test case configuration file (YAML or JSON)')
    .option('-v, --verbose', 'Show detailed validation information')
    .addHelpText('after', `
Examples:
  $ ${commandName} validate -c testcase.yaml         # Quick validation check
  $ ${commandName} validate -c testcase.json         # JSON format is also supported
  $ ${commandName} validate -c testcase.yaml -v      # Detailed validation with suggestions
  
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
