/**
 * Configuration Loader
 * 
 * Loads and merges youBencha configuration from multiple sources:
 * 1. User-level config (~/.youbencharc or ~/.youbencha.yaml)
 * 2. Project-level config (.youbencharc or .youbencha.yaml in current directory)
 * 3. Default values
 * 
 * Priority: project config > user config > defaults
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { configSchema, Config, defaultConfig } from '../schemas/config.schema.js';
import { parseConfig } from './config-parser.js';
import * as logger from './logger.js';

/**
 * Configuration file names to search for (in order of preference)
 */
const CONFIG_FILENAMES = [
  '.youbencharc',
  '.youbencharc.yaml',
  '.youbencharc.yml',
  '.youbencharc.json',
  '.youbencha.yaml',
  '.youbencha.yml',
  '.youbencha.json',
];

/**
 * Find configuration file in a directory
 * 
 * @param directory - Directory to search
 * @returns Path to config file or null if not found
 */
async function findConfigFile(directory: string): Promise<string | null> {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = path.join(directory, filename);
    try {
      await fs.access(configPath);
      return configPath;
    } catch {
      // File doesn't exist, try next
      continue;
    }
  }
  return null;
}

/**
 * Load configuration from a file
 * 
 * @param configPath - Path to configuration file
 * @returns Parsed and validated configuration, or null if file doesn't exist or is invalid
 */
async function loadConfigFromFile(configPath: string): Promise<Config | null> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = parseConfig(content, configPath);
    const validated = configSchema.parse(parsed);
    return validated;
  } catch (error) {
    logger.warn(`Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Get user-level config directory
 * 
 * @returns User home directory
 */
function getUserConfigDir(): string {
  return os.homedir();
}

/**
 * Get project-level config directory
 * 
 * @returns Current working directory
 */
function getProjectConfigDir(): string {
  return process.cwd();
}

/**
 * Merge configurations with priority: specific > general
 * Later configs override earlier ones
 * 
 * @param configs - Array of configs in priority order (lowest to highest)
 * @returns Merged configuration
 */
function mergeConfigs(...configs: (Config | null)[]): Config {
  const result: Config = { ...defaultConfig };
  
  for (const config of configs) {
    if (!config) continue;
    
    // Merge top-level properties
    if (config.workspace_dir !== undefined) result.workspace_dir = config.workspace_dir;
    if (config.output_dir !== undefined) result.output_dir = config.output_dir;
    if (config.timeout_ms !== undefined) result.timeout_ms = config.timeout_ms;
    if (config.log_level !== undefined) result.log_level = config.log_level;
    if (config.keep_workspace !== undefined) result.keep_workspace = config.keep_workspace;
    
    // Merge variables (shallow merge)
    if (config.variables) {
      result.variables = { ...result.variables, ...config.variables };
    }
    
    // Merge agent config
    if (config.agent) {
      result.agent = {
        ...result.agent,
        ...config.agent,
      };
    }
    
    // Merge evaluators config
    if (config.evaluators) {
      result.evaluators = {
        ...result.evaluators,
        ...config.evaluators,
      };
    }
  }
  
  return result;
}

/**
 * Substitute variables in a string using ${VAR_NAME} syntax
 * 
 * @param value - String that may contain variable references
 * @param variables - Variable map
 * @returns String with variables substituted
 */
export function substituteVariables(value: string, variables: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
    if (varName in variables) {
      return variables[varName];
    }
    // Keep original if variable not found
    return match;
  });
}

/**
 * Substitute variables in an object recursively
 * 
 * @param obj - Object that may contain variable references in string values
 * @param variables - Variable map
 * @returns Object with variables substituted
 */
export function substituteVariablesInObject<T>(obj: T, variables: Record<string, string>): T {
  if (typeof obj === 'string') {
    return substituteVariables(obj, variables) as T;
  }
  
  if (Array.isArray(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return obj.map(item => substituteVariablesInObject(item, variables)) as T;
  }
  
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      result[key] = substituteVariablesInObject(value, variables);
    }
    return result as T;
  }
  
  return obj;
}

/**
 * Load merged configuration from all sources
 * 
 * @returns Merged configuration
 */
export async function loadConfig(): Promise<Config> {
  // Load user-level config
  const userConfigDir = getUserConfigDir();
  const userConfigFile = await findConfigFile(userConfigDir);
  const userConfig = userConfigFile ? await loadConfigFromFile(userConfigFile) : null;
  
  if (userConfigFile) {
    logger.debug(`Loaded user config from ${userConfigFile}`);
  }
  
  // Load project-level config
  const projectConfigDir = getProjectConfigDir();
  const projectConfigFile = await findConfigFile(projectConfigDir);
  const projectConfig = projectConfigFile ? await loadConfigFromFile(projectConfigFile) : null;
  
  if (projectConfigFile) {
    logger.debug(`Loaded project config from ${projectConfigFile}`);
  }
  
  // Merge: defaults < user < project
  return mergeConfigs(defaultConfig, userConfig, projectConfig);
}

/**
 * Find the actual config file being used (project or user level)
 * 
 * @returns Path to config file or null if no config file found
 */
export async function findActiveConfigFile(): Promise<string | null> {
  // Check project level first
  const projectConfigFile = await findConfigFile(getProjectConfigDir());
  if (projectConfigFile) {
    return projectConfigFile;
  }
  
  // Check user level
  const userConfigFile = await findConfigFile(getUserConfigDir());
  if (userConfigFile) {
    return userConfigFile;
  }
  
  return null;
}

/**
 * Get the default config file path for a given level
 * 
 * @param level - 'project' or 'user'
 * @returns Default config file path
 */
export function getDefaultConfigPath(level: 'project' | 'user'): string {
  const dir = level === 'user' ? getUserConfigDir() : getProjectConfigDir();
  return path.join(dir, '.youbencharc');
}

/**
 * Check if a config file exists at the given level
 * 
 * @param level - 'project' or 'user'
 * @returns True if config file exists
 */
export async function configExists(level: 'project' | 'user'): Promise<boolean> {
  const dir = level === 'user' ? getUserConfigDir() : getProjectConfigDir();
  const configFile = await findConfigFile(dir);
  return configFile !== null;
}
