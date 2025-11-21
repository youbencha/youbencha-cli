/**
 * Prompt Loader Utility
 * 
 * Provides functionality to load prompt content from files.
 * Supports both relative and absolute paths with proper error handling.
 */

import { readFileSync } from 'fs';
import { join, isAbsolute } from 'path';

/**
 * Error thrown when prompt file cannot be loaded
 */
export class PromptFileError extends Error {
  constructor(message: string, public readonly filePath: string) {
    super(message);
    this.name = 'PromptFileError';
  }
}

/**
 * Load prompt content from a file
 * 
 * Supports:
 * - Relative paths (resolved from baseDir)
 * - Absolute paths
 * - Common text file formats (.txt, .md, etc.)
 * 
 * @param promptFile - Path to the prompt file (relative or absolute)
 * @param baseDir - Base directory for resolving relative paths (default: process.cwd())
 * @returns The content of the prompt file as a string
 * @throws PromptFileError if the file cannot be read
 * 
 * @example
 * // Load from relative path
 * const prompt = loadPromptFromFile('./prompts/my-prompt.md', '/path/to/config/dir');
 * 
 * @example
 * // Load from absolute path
 * const prompt = loadPromptFromFile('/absolute/path/to/prompt.txt');
 */
export function loadPromptFromFile(
  promptFile: string,
  baseDir: string = process.cwd()
): string {
  try {
    // Resolve the file path
    const filePath = isAbsolute(promptFile)
      ? promptFile
      : join(baseDir, promptFile);
    
    // Read the file content
    const content = readFileSync(filePath, 'utf-8');
    
    // Return trimmed content (remove leading/trailing whitespace)
    return content.trim();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new PromptFileError(
      `Failed to load prompt from file "${promptFile}": ${errorMessage}`,
      promptFile
    );
  }
}

/**
 * Resolve prompt value from either inline prompt or prompt file
 * 
 * This function handles the logic of choosing between inline prompt
 * and prompt file, with validation to ensure they're mutually exclusive.
 * 
 * @param prompt - Inline prompt string (optional)
 * @param promptFile - Path to prompt file (optional)
 * @param baseDir - Base directory for resolving relative paths
 * @returns The resolved prompt content, or undefined if neither is provided
 * @throws Error if both prompt and promptFile are provided
 * @throws PromptFileError if promptFile is provided but cannot be loaded
 * 
 * @example
 * // Use inline prompt
 * const resolved = resolvePromptValue('My inline prompt', undefined, '/base');
 * 
 * @example
 * // Use prompt file
 * const resolved = resolvePromptValue(undefined, './prompt.md', '/base');
 */
export function resolvePromptValue(
  prompt: string | undefined,
  promptFile: string | undefined,
  baseDir: string = process.cwd()
): string | undefined {
  // Validate mutual exclusivity
  if (prompt && promptFile) {
    throw new Error(
      'Cannot specify both "prompt" and "prompt_file". Please use only one.'
    );
  }
  
  // Return inline prompt if provided
  if (prompt) {
    return prompt;
  }
  
  // Load from file if provided
  if (promptFile) {
    return loadPromptFromFile(promptFile, baseDir);
  }
  
  // Neither provided
  return undefined;
}

/**
 * Default export with all prompt loading utilities
 */
export default {
  loadPromptFromFile,
  resolvePromptValue,
  PromptFileError,
};
