/**
 * Agent Files Module
 * 
 * Provides shared logic for installing agent files to user projects.
 * Used by both `yb init` and `yb install-agents` commands.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  GITHUB_AGENTIC_JUDGE_CONTENT,
  CLAUDE_AGENTIC_JUDGE_CONTENT,
} from '../agents/index.js';

/**
 * Definition of an agent file that can be installed.
 * Contains the file path, content, and metadata for installation.
 * 
 * @interface AgentFileDefinition
 */
export interface AgentFileDefinition {
  /** Relative path from target directory (e.g., ".github/agents/agentic-judge.md") */
  relativePath: string;
  
  /** Agent file content as string */
  content: string;
  
  /** Human-readable description for CLI output */
  description: string;
}

/**
 * Result of attempting to install a single agent file.
 * Reports the outcome of the installation operation.
 * 
 * @interface InstallResult
 */
export interface InstallResult {
  /** The file path that was processed */
  file: string;
  
  /** What happened to the file */
  status: 'created' | 'skipped' | 'overwritten' | 'error';
  
  /** Error message if status is 'error' */
  error?: string;
}

/**
 * Options for agent file installation.
 * Controls installation behavior such as force overwrite and target directory.
 * 
 * @interface InstallAgentsOptions
 */
export interface InstallAgentsOptions {
  /** Overwrite existing files if true */
  force?: boolean;
  
  /** Target directory (defaults to process.cwd()) */
  targetDir?: string;
}

/**
 * Complete result of the install-agents operation.
 * Contains individual file results, summary counts, and overall success status.
 * 
 * @interface InstallAgentsResult
 */
export interface InstallAgentsResult {
  /** Results for each agent file */
  files: InstallResult[];
  
  /** Summary counts */
  summary: {
    created: number;
    skipped: number;
    overwritten: number;
    errors: number;
  };
  
  /** Overall success (true if no errors) */
  success: boolean;
}

/**
 * All agent files that should be installed
 */
const AGENT_FILES: AgentFileDefinition[] = [
  {
    relativePath: '.github/agents/agentic-judge.md',
    content: GITHUB_AGENTIC_JUDGE_CONTENT,
    description: 'GitHub Copilot CLI agentic-judge agent',
  },
  {
    relativePath: '.claude/agents/agentic-judge.md',
    content: CLAUDE_AGENTIC_JUDGE_CONTENT,
    description: 'Claude Code agentic-judge agent',
  },
];

/**
 * Maps filesystem error codes to user-friendly messages
 */
const ERROR_MESSAGES: Record<string, string> = {
  EACCES: 'Permission denied. Check directory write permissions.',
  ENOSPC: 'Disk full. Free up space and try again.',
  EROFS: 'Read-only filesystem. Cannot write agent files.',
};

/**
 * Get the list of agent files available for installation
 * 
 * @returns Array of agent file definitions
 * 
 * @example
 * const files = getAgentFiles();
 * console.log(files.length); // 2
 * console.log(files[0].relativePath); // ".github/agents/agentic-judge.md"
 */
export function getAgentFiles(): readonly AgentFileDefinition[] {
  return AGENT_FILES;
}

/**
 * Check if a file exists at the given path
 * 
 * @param filePath - Absolute path to check
 * @returns true if file exists, false otherwise
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a user-friendly error message for a filesystem error
 * 
 * @param error - The error object
 * @returns User-friendly error message
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code && ERROR_MESSAGES[nodeError.code]) {
      return ERROR_MESSAGES[nodeError.code];
    }
    return error.message;
  }
  return 'Unknown error occurred';
}

/**
 * Install a single agent file
 * 
 * @param targetDir - Base directory to install to
 * @param definition - Agent file definition
 * @param force - Whether to overwrite existing files
 * @returns Installation result for this file
 */
async function installSingleFile(
  targetDir: string,
  definition: AgentFileDefinition,
  force: boolean
): Promise<InstallResult> {
  const absolutePath = path.join(targetDir, definition.relativePath);
  
  try {
    const exists = await fileExists(absolutePath);
    
    if (exists && !force) {
      return {
        file: definition.relativePath,
        status: 'skipped',
      };
    }
    
    // Create parent directory if needed
    const parentDir = path.dirname(absolutePath);
    await fs.mkdir(parentDir, { recursive: true });
    
    // Write the file
    await fs.writeFile(absolutePath, definition.content, 'utf-8');
    
    return {
      file: definition.relativePath,
      status: exists ? 'overwritten' : 'created',
    };
  } catch (error) {
    return {
      file: definition.relativePath,
      status: 'error',
      error: getErrorMessage(error),
    };
  }
}

/**
 * Install agent files to the specified target directory
 * 
 * @param options - Installation options
 * @returns Promise resolving to installation results
 * 
 * @example
 * // Install with defaults (cwd, no force)
 * const result = await installAgentFiles();
 * 
 * @example
 * // Install with force overwrite
 * const result = await installAgentFiles({ force: true });
 * 
 * @example
 * // Install to specific directory
 * const result = await installAgentFiles({ targetDir: '/path/to/project' });
 */
export async function installAgentFiles(
  options?: InstallAgentsOptions
): Promise<InstallAgentsResult> {
  const targetDir = options?.targetDir ?? process.cwd();
  const force = options?.force ?? false;
  
  const results: InstallResult[] = [];
  
  for (const definition of AGENT_FILES) {
    const result = await installSingleFile(targetDir, definition, force);
    results.push(result);
  }
  
  // Calculate summary
  const summary = {
    created: results.filter(r => r.status === 'created').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    overwritten: results.filter(r => r.status === 'overwritten').length,
    errors: results.filter(r => r.status === 'error').length,
  };
  
  return {
    files: results,
    summary,
    success: summary.errors === 0,
  };
}
