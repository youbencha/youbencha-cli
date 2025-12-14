/**
 * Config Command
 * 
 * Manages youBencha configuration files at project or user level.
 */

import * as fs from 'fs/promises';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { 
  loadConfig, 
  getDefaultConfigPath, 
  configExists, 
  findActiveConfigFile 
} from '../../lib/config-loader.js';
import { Config } from '../../schemas/config.schema.js';
import * as logger from '../../lib/logger.js';

/**
 * Options for config init command
 */
interface ConfigInitOptions {
  global?: boolean;
  force?: boolean;
}

/**
 * Options for config get command
 */
interface ConfigGetOptions {
  // No additional options for now
}

/**
 * Options for config set command
 */
interface ConfigSetOptions {
  global?: boolean;
}

/**
 * Options for config list command
 */
interface ConfigListOptions {
  // No additional options for now
}

/**
 * Initialize a configuration file
 * 
 * Creates a starter configuration file with helpful comments
 */
export async function configInitCommand(options: ConfigInitOptions): Promise<void> {
  const level = options.global ? 'user' : 'project';
  const configPath = getDefaultConfigPath(level);
  
  // Check if config already exists
  const exists = await configExists(level);
  if (exists && !options.force) {
    const existingFile = await findActiveConfigFile();
    logger.error(`Configuration file already exists at ${level} level: ${existingFile}`);
    logger.info('Use --force to overwrite');
    process.exit(1);
  }
  
  // Create config file with helpful comments
  const configContent = `# youBencha Configuration File
#
# This file configures default behavior for youBencha CLI.
# You can create both user-level (~/.youbencharc) and project-level (.youbencharc) configs.
# Priority: CLI flags > project config > user config > defaults

# Default workspace directory for evaluation runs
# workspace_dir: .youbencha-workspace

# Default output directory for eval-only runs
# output_dir: .youbencha-eval

# Default timeout for operations in milliseconds (5 minutes)
# timeout_ms: 300000

# Default log level (debug, info, warn, error)
# log_level: info

# Whether to keep workspace after evaluation by default
# keep_workspace: true

# Environment variables for substitution in configuration files
# These can be referenced using \${VAR_NAME} syntax
# variables:
#   PROJECT_NAME: my-project
#   REPO_BASE: https://github.com/myorg

# Default agent configuration
# agent:
#   timeout_ms: 600000  # 10 minutes
#   model: gpt-4o       # Default model for agents that support it

# Default evaluator configuration
# evaluators:
#   max_concurrent: 4
`;
  
  await fs.writeFile(configPath, configContent, 'utf-8');
  logger.info(`✓ Created ${level}-level configuration file: ${configPath}`);
  logger.info('');
  logger.info('Edit this file to customize youBencha behavior.');
  logger.info('Uncomment and modify the settings you want to change.');
}

/**
 * List current configuration
 * 
 * Shows the merged configuration from all sources
 */
export async function configListCommand(_options: ConfigListOptions): Promise<void> {
  const config = await loadConfig();
  const activeFile = await findActiveConfigFile();
  
  logger.info('Current youBencha Configuration:');
  logger.info('');
  
  if (activeFile) {
    logger.info(`Active config file: ${activeFile}`);
  } else {
    logger.info('No config file found (using defaults)');
  }
  
  logger.info('');
  logger.info('Settings:');
  logger.info(stringifyYaml(config));
}

/**
 * Get a specific configuration value
 * 
 * @param key - Configuration key (supports dot notation, e.g., 'agent.timeout_ms')
 */
export async function configGetCommand(key: string, _options: ConfigGetOptions): Promise<void> {
  const config = await loadConfig();
  
  // Parse key path
  const keys = key.split('.');
  let value: unknown = config;
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      logger.error(`Configuration key not found: ${key}`);
      process.exit(1);
    }
  }
  
  if (typeof value === 'object') {
    logger.info(stringifyYaml({ [key]: value }));
  } else {
    logger.info(String(value));
  }
}

/**
 * Set a configuration value
 * 
 * @param key - Configuration key
 * @param value - Value to set
 */
export async function configSetCommand(
  key: string, 
  value: string, 
  options: ConfigSetOptions
): Promise<void> {
  const level = options.global ? 'user' : 'project';
  const configPath = getDefaultConfigPath(level);
  
  // Load existing config or create new one
  let config: Config;
  const exists = await configExists(level);
  
  if (exists) {
    const activeFile = await findActiveConfigFile();
    if (!activeFile) {
      logger.error('Failed to find config file');
      process.exit(1);
    }
    
    // Read existing config
    const content = await fs.readFile(activeFile, 'utf-8');
    config = parseYaml(content) || {};
  } else {
    // Start with empty config
    config = {};
  }
  
  // Parse key path and set value
  const keys = key.split('.');
  let current: Record<string, unknown> = config as unknown as Record<string, unknown>;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!(k in current)) {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }
  
  const lastKey = keys[keys.length - 1];
  
  // Try to parse value as number or boolean
  let parsedValue: string | number | boolean = value;
  if (value === 'true') parsedValue = true;
  else if (value === 'false') parsedValue = false;
  else if (!isNaN(Number(value))) parsedValue = Number(value);
  
  current[lastKey] = parsedValue;
  
  // Write config file
  await fs.writeFile(configPath, stringifyYaml(config), 'utf-8');
  logger.info(`✓ Set ${key} = ${value} in ${level}-level config`);
  logger.info(`Config file: ${configPath}`);
}

/**
 * Unset/remove a configuration value
 * 
 * @param key - Configuration key to remove
 */
export async function configUnsetCommand(
  key: string,
  options: ConfigSetOptions
): Promise<void> {
  const level = options.global ? 'user' : 'project';
  const exists = await configExists(level);
  
  if (!exists) {
    logger.error(`No ${level}-level config file found`);
    process.exit(1);
  }
  
  const activeFile = await findActiveConfigFile();
  if (!activeFile) {
    logger.error('Failed to find config file');
    process.exit(1);
  }
  
  // Read existing config
  const content = await fs.readFile(activeFile, 'utf-8');
  const config = parseYaml(content) || {};
  
  // Parse key path and remove value
  const keys = key.split('.');
  let current: Record<string, unknown> = config;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!(k in current)) {
      logger.error(`Configuration key not found: ${key}`);
      process.exit(1);
    }
    current = current[k] as Record<string, unknown>;
  }
  
  const lastKey = keys[keys.length - 1];
  if (!(lastKey in current)) {
    logger.error(`Configuration key not found: ${key}`);
    process.exit(1);
  }
  
  delete current[lastKey];
  
  // Write config file
  await fs.writeFile(activeFile, stringifyYaml(config), 'utf-8');
  logger.info(`✓ Removed ${key} from ${level}-level config`);
}
