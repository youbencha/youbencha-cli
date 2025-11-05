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
    .description('youBencha - A friendly CLI framework for evaluating agentic coding tools')
    .version(packageJson.version);

  // Register commands
  program
    .command('run')
    .description('Run an evaluation suite')
    .requiredOption('-c, --config <path>', 'Path to suite configuration file')
    .option('--keep-workspace', 'Keep workspace directory after evaluation (for debugging)')
    .action(runCommand);

  program
    .command('report')
    .description('Generate a report from evaluation results')
    .requiredOption('--from <path>', 'Path to results JSON file')
    .option('--format <format>', 'Report format (json, markdown)', 'markdown')
    .option('--output <path>', 'Output path for report (defaults to artifacts directory)')
    .action(reportCommand);

  // Parse arguments
  await program.parseAsync(process.argv);
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
