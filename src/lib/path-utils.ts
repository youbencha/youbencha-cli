/**
 * Path Utilities
 * 
 * Provides workspace path generation and safe path operations.
 * Ensures consistent path handling across different platforms.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

/**
 * Workspace path structure
 */
export interface WorkspacePaths {
  /** Root workspace directory */
  root: string;
  
  /** Run-specific directory */
  runDir: string;
  
  /** Modified source directory (where agent operates) */
  modifiedDir: string;
  
  /** Expected source directory (reference branch) */
  expectedDir?: string;
  
  /** Artifacts directory for outputs */
  artifactsDir: string;
  
  /** Evaluator artifacts subdirectory */
  evaluatorArtifactsDir: string;
  
  /** Lockfile path */
  lockFile: string;
}

/**
 * Sanitize a workspace name to ensure it's safe for use as a directory name.
 * Removes or replaces any characters that could cause issues.
 * 
 * @param name - The workspace name to sanitize
 * @returns Sanitized workspace name
 */
export function sanitizeWorkspaceName(name: string): string {
  // Replace spaces with hyphens
  let sanitized = name.replace(/\s+/g, '-');
  // Remove any characters that aren't alphanumeric, dots, underscores, or hyphens
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '');
  // Ensure it starts with an alphanumeric character
  sanitized = sanitized.replace(/^[^a-zA-Z0-9]+/, '');
  // Limit length to 100 characters
  sanitized = sanitized.slice(0, 100);
  // If empty after sanitization, return a default
  return sanitized || 'workspace';
}

/**
 * Generate workspace paths for a new evaluation run
 * 
 * @param workspaceRoot - Root workspace directory (default: .youbencha-workspace)
 * @param runId - Unique run identifier (default: timestamp-based)
 * @param workspaceName - Custom workspace name (optional, creates human-readable folder)
 * @returns Workspace path structure
 */
export function generateWorkspacePaths(
  workspaceRoot?: string,
  runId?: string,
  workspaceName?: string
): WorkspacePaths {
  const root = workspaceRoot || path.join(process.cwd(), '.youbencha-workspace');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const uniqueSuffix = Date.now();
  
  // Determine the run ID based on configuration
  let id: string;
  if (runId) {
    // Use explicit runId if provided (for backward compatibility)
    id = runId;
  } else if (workspaceName) {
    // Use sanitized workspace name with timestamp for uniqueness
    const sanitized = sanitizeWorkspaceName(workspaceName);
    id = `${sanitized}-${timestamp}-${uniqueSuffix}`;
  } else {
    // Default: use generic run-{timestamp} format
    id = `run-${timestamp}-${uniqueSuffix}`;
  }
  
  const runDir = path.join(root, id);
  const modifiedDir = path.join(runDir, 'src-modified');
  const expectedDir = path.join(runDir, 'src-expected');
  const artifactsDir = path.join(runDir, 'artifacts');
  const evaluatorArtifactsDir = path.join(artifactsDir, 'evaluators');
  const lockFile = path.join(runDir, '.lock');
  
  return {
    root,
    runDir,
    modifiedDir,
    expectedDir,
    artifactsDir,
    evaluatorArtifactsDir,
    lockFile,
  };
}

/**
 * Safely join path segments, normalizing the result
 * 
 * @param segments - Path segments to join
 * @returns Normalized joined path
 */
export function safeJoin(...segments: string[]): string {
  return path.normalize(path.join(...segments));
}

/**
 * Check if a path is within a workspace directory (prevents path traversal)
 * 
 * @param targetPath - Path to check
 * @param workspaceRoot - Workspace root directory
 * @returns True if path is within workspace
 */
export function isPathWithinWorkspace(
  targetPath: string,
  workspaceRoot: string
): boolean {
  const normalizedTarget = path.normalize(path.resolve(targetPath));
  const normalizedRoot = path.normalize(path.resolve(workspaceRoot));
  
  return normalizedTarget.startsWith(normalizedRoot);
}

/**
 * Ensure a directory exists, creating it if necessary
 * 
 * @param dirPath - Directory path to ensure
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Check if a directory exists
 * 
 * @param dirPath - Directory path to check
 * @returns True if directory exists
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 * 
 * @param filePath - File path to check
 * @returns True if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Get relative path from workspace root
 * 
 * @param absolutePath - Absolute path
 * @param workspaceRoot - Workspace root directory
 * @returns Relative path from workspace root
 */
export function getRelativePath(
  absolutePath: string,
  workspaceRoot: string
): string {
  return path.relative(workspaceRoot, absolutePath);
}

/**
 * Resolve a path relative to workspace root
 * 
 * @param relativePath - Relative path
 * @param workspaceRoot - Workspace root directory
 * @returns Absolute path
 */
export function resolveWorkspacePath(
  relativePath: string,
  workspaceRoot: string
): string {
  return path.resolve(workspaceRoot, relativePath);
}

/**
 * Get temporary directory for the current platform
 * 
 * @returns Temporary directory path
 */
export function getTempDir(): string {
  return os.tmpdir();
}

/**
 * Create a temporary directory with a unique name
 * 
 * @param prefix - Prefix for directory name
 * @returns Path to created temporary directory
 */
export async function createTempDir(prefix: string = 'youbencha-'): Promise<string> {
  const tempRoot = getTempDir();
  const tempDir = path.join(tempRoot, `${prefix}${Date.now()}`);
  await ensureDirectory(tempDir);
  return tempDir;
}

/**
 * Recursively remove a directory and its contents
 * 
 * @param dirPath - Directory path to remove
 */
export async function removeDirectory(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors if directory doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Get directory size in bytes
 * 
 * @param dirPath - Directory path
 * @param maxDepth - Maximum directory depth to prevent excessive recursion
 * @param currentDepth - Current recursion depth (internal use)
 * @returns Total size in bytes
 */
export async function getDirectorySize(
  dirPath: string,
  maxDepth: number = 10,
  currentDepth: number = 0
): Promise<number> {
  if (currentDepth > maxDepth) {
    throw new Error(`Directory depth exceeds maximum of ${maxDepth} levels`);
  }
  
  let totalSize = 0;
  
  async function calculateSize(currentPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      throw new Error(`Directory depth exceeds maximum of ${maxDepth} levels`);
    }
    
    const stats = await fs.stat(currentPath);
    
    if (stats.isFile()) {
      totalSize += stats.size;
    } else if (stats.isDirectory()) {
      const entries = await fs.readdir(currentPath);
      await Promise.all(
        entries.map((entry) => calculateSize(path.join(currentPath, entry), depth + 1))
      );
    }
  }
  
  await calculateSize(dirPath, currentDepth);
  return totalSize;
}

/**
 * Default export with all path utilities
 */
export default {
  generateWorkspacePaths,
  safeJoin,
  isPathWithinWorkspace,
  ensureDirectory,
  directoryExists,
  fileExists,
  getRelativePath,
  resolveWorkspacePath,
  getTempDir,
  createTempDir,
  removeDirectory,
  getDirectorySize,
  sanitizeWorkspaceName,
};
