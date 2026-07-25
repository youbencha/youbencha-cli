/**
 * Doctor command
 *
 * Checks the local prerequisites that commonly prevent a first youBencha run.
 * The check runner accepts dependencies so behavior can be tested without
 * requiring agent CLIs or changing the host filesystem.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { constants as fsConstants } from 'fs';
import { configSchema, Config } from '../../schemas/config.schema.js';
import { parseConfig } from '../../lib/config-parser.js';
import { findActiveConfigFile, loadConfig } from '../../lib/config-loader.js';
import { getAgentFiles } from '../../lib/agent-files.js';
import * as logger from '../../lib/logger.js';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
  remediation?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  effectiveConfig?: Config;
  ok: boolean;
}

export interface DoctorDependencies {
  nodeVersion: string;
  cwd: string;
  commandVersion(command: string): Promise<string | null>;
  isWritable(targetPath: string): Promise<boolean>;
  pathExists(targetPath: string): Promise<boolean>;
  findActiveConfigFile(): Promise<string | null>;
  readTextFile(targetPath: string): Promise<string>;
  loadConfig(): Promise<Config>;
}

function getCommandVersion(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      ['--version'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve((stdout || stderr).trim() || 'installed');
      }
    );
  });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isWritable(targetPath: string): Promise<boolean> {
  let candidate = path.resolve(targetPath);

  while (!(await pathExists(candidate))) {
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      return false;
    }
    candidate = parent;
  }

  try {
    const stats = await fs.stat(candidate);
    if (!stats.isDirectory()) {
      return false;
    }
    await fs.access(candidate, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const defaultDependencies: DoctorDependencies = {
  nodeVersion: process.versions.node,
  cwd: process.cwd(),
  commandVersion: getCommandVersion,
  isWritable,
  pathExists,
  findActiveConfigFile,
  readTextFile: (targetPath) => fs.readFile(targetPath, 'utf8'),
  loadConfig,
};

function summarizeConfig(config: Config): string {
  return [
    `workspace=${config.workspace_dir}`,
    `output=${config.output_dir}`,
    `timeout=${config.timeout_ms}ms`,
    `log=${config.log_level}`,
  ].join(', ');
}

export async function runDoctor(
  dependencies: DoctorDependencies = defaultDependencies
): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const majorVersion = Number.parseInt(
    dependencies.nodeVersion.split('.')[0] ?? '',
    10
  );

  checks.push(
    majorVersion >= 20
      ? {
          name: 'Node.js',
          status: 'pass',
          message: `Node.js ${dependencies.nodeVersion}`,
        }
      : {
          name: 'Node.js',
          status: 'fail',
          message: `Node.js ${dependencies.nodeVersion || 'unknown'} is unsupported`,
          remediation: 'Install Node.js 20 or 22 and run yb doctor again.',
        }
  );

  const gitVersion = await dependencies.commandVersion('git');
  checks.push(
    gitVersion
      ? { name: 'Git', status: 'pass', message: gitVersion }
      : {
          name: 'Git',
          status: 'fail',
          message: 'Git was not found on PATH',
          remediation: 'Install Git and make sure the git command is on PATH.',
        }
  );

  const agentCommands = [
    { command: 'copilot', label: 'GitHub Copilot CLI' },
    { command: 'claude', label: 'Claude Code CLI' },
  ];
  const installedAgents: string[] = [];
  for (const agent of agentCommands) {
    const version = await dependencies.commandVersion(agent.command);
    if (version) {
      installedAgents.push(`${agent.label} (${version})`);
    }
  }
  checks.push(
    installedAgents.length > 0
      ? {
          name: 'Agent CLI',
          status: 'pass',
          message: installedAgents.join('; '),
        }
      : {
          name: 'Agent CLI',
          status: 'warn',
          message: 'No supported agent CLI was found on PATH',
          remediation:
            'Install and authenticate GitHub Copilot CLI or Claude Code before running a test case.',
        }
  );

  let effectiveConfig: Config | undefined;
  try {
    const activeConfigPath = await dependencies.findActiveConfigFile();
    if (activeConfigPath) {
      const rawConfig = await dependencies.readTextFile(activeConfigPath);
      configSchema.parse(parseConfig(rawConfig, activeConfigPath));
    }
    effectiveConfig = await dependencies.loadConfig();
    checks.push({
      name: 'Configuration',
      status: 'pass',
      message: activeConfigPath
        ? `${activeConfigPath}; ${summarizeConfig(effectiveConfig)}`
        : `defaults; ${summarizeConfig(effectiveConfig)}`,
    });
  } catch (error) {
    checks.push({
      name: 'Configuration',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
      remediation:
        'Fix the active .youbencha configuration, then rerun yb doctor.',
    });
  }

  const workspaceDir = path.resolve(
    dependencies.cwd,
    effectiveConfig?.workspace_dir ?? '.youbencha-workspace'
  );
  checks.push(
    (await dependencies.isWritable(workspaceDir))
      ? {
          name: 'Workspace',
          status: 'pass',
          message: `${workspaceDir} can be created or written`,
        }
      : {
          name: 'Workspace',
          status: 'fail',
          message: `${workspaceDir} is not writable`,
          remediation:
            'Choose a writable workspace_dir in .youbencharc or fix directory permissions.',
        }
  );

  const missingAgentFiles: string[] = [];
  for (const definition of getAgentFiles()) {
    const agentPath = path.resolve(dependencies.cwd, definition.relativePath);
    if (!(await dependencies.pathExists(agentPath))) {
      missingAgentFiles.push(definition.relativePath);
    }
  }
  checks.push(
    missingAgentFiles.length === 0
      ? {
          name: 'Judge agent files',
          status: 'pass',
          message: 'Agent files are installed for both supported CLIs',
        }
      : {
          name: 'Judge agent files',
          status: 'warn',
          message: `Missing ${missingAgentFiles.join(', ')}`,
          remediation:
            'Run yb install-agents before using an agentic-judge evaluator.',
        }
  );

  return {
    checks,
    effectiveConfig,
    ok: !checks.some((check) => check.status === 'fail'),
  };
}

export async function doctorCommand(): Promise<void> {
  const result = await runDoctor();

  logger.info('youBencha doctor');
  logger.info('');
  for (const check of result.checks) {
    const marker =
      check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗';
    const output = `${marker} ${check.name}: ${check.message}`;
    if (check.status === 'fail') {
      logger.error(output);
    } else if (check.status === 'warn') {
      logger.warn(output);
    } else {
      logger.info(output);
    }
    if (check.remediation) {
      logger.info(`  Next: ${check.remediation}`);
    }
  }

  logger.info('');
  if (result.ok) {
    logger.info(
      'Ready to use youBencha. Warnings apply only to optional workflows.'
    );
  } else {
    logger.error(
      'Doctor found blocking issues. Resolve them and rerun yb doctor.'
    );
    process.exitCode = 1;
  }
}
