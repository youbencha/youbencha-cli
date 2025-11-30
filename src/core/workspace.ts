/**
 * Workspace Manager
 * 
 * Manages isolated workspace directories for evaluation runs.
 * Handles repository cloning, lockfile management, and cleanup.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { simpleGit, SimpleGit, GitError } from 'simple-git';
import {
  generateWorkspacePaths,
  WorkspacePaths,
  ensureDirectory,
  fileExists,
} from '../lib/path-utils.js';
import * as logger from '../lib/logger.js';

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Git repository URL */
  repo: string;
  
  /** Branch to clone (optional - defaults to default branch) */
  branch?: string;
  
  /** Specific commit SHA to checkout (optional) */
  commit?: string;
  
  /** Expected reference branch for comparison (optional) */
  expectedBranch?: string;
  
  /** Custom workspace root directory (optional) */
  workspaceRoot?: string;
  
  /** Custom run ID (optional - defaults to timestamp-based) */
  runId?: string;
  
  /** Custom workspace name for human-readable folder names (optional) */
  workspaceName?: string;
  
  /** Timeout for Git operations in milliseconds (default: 300000 = 5 min) */
  timeout?: number;
}

/**
 * Workspace instance
 */
export interface Workspace {
  /** Unique run identifier */
  runId: string;
  
  /** Workspace paths */
  paths: WorkspacePaths;
  
  /** Repository URL */
  repo: string;
  
  /** Branch name (modified source) */
  branch?: string;
  
  /** Commit SHA (modified source) */
  modifiedCommit: string;
  
  /** Expected branch name (optional) */
  expectedBranch?: string;
  
  /** Expected commit SHA (optional) */
  expectedCommit?: string;
  
  /** Workspace creation timestamp */
  createdAt: string;
}

/**
 * Workspace error codes
 */
export enum WorkspaceErrorCode {
  WORKSPACE_LOCKED = 'WORKSPACE_LOCKED',
  CLONE_FAILED = 'CLONE_FAILED',
  EXPECTED_BRANCH_NOT_FOUND = 'EXPECTED_BRANCH_NOT_FOUND',
  CHECKOUT_FAILED = 'CHECKOUT_FAILED',
  CLEANUP_FAILED = 'CLEANUP_FAILED',
  INVALID_CONFIG = 'INVALID_CONFIG',
}

/**
 * Workspace error
 */
export class WorkspaceError extends Error {
  constructor(
    public code: WorkspaceErrorCode,
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/**
 * Lockfile data
 */
interface LockData {
  pid: number;
  timestamp: string;
  repo: string;
}

/**
 * Workspace Manager
 * 
 * Creates and manages isolated workspace directories for evaluation runs.
 */
export class WorkspaceManager {
  private workspaceRoot: string;
  private defaultTimeout: number;
  
  /**
   * Create a new workspace manager
   * 
   * @param workspaceRoot - Root directory for all workspaces (default: .youbencha-workspace)
   * @param defaultTimeout - Default timeout for Git operations in ms (default: 300000)
   */
  constructor(workspaceRoot?: string, defaultTimeout: number = 300000) {
    // Default to .youbencha-workspace under current working directory
    const rawRoot = workspaceRoot || path.join(process.cwd(), '.youbencha-workspace');
    
    // Ensure the root is an absolute path to guarantee consistent behavior
    // regardless of which directory the agent runs from (e.g., src-modified)
    this.workspaceRoot = path.isAbsolute(rawRoot) ? rawRoot : path.resolve(rawRoot);
    this.defaultTimeout = defaultTimeout;
  }
  
  /**
   * Create a new workspace and clone repositories
   * 
   * @param config - Workspace configuration
   * @returns Created workspace instance
   * @throws WorkspaceError if workspace creation fails
   */
  async createWorkspace(config: WorkspaceConfig): Promise<Workspace> {
    // Validate configuration
    this.validateConfig(config);
    
    // Generate workspace paths
    const paths = generateWorkspacePaths(
      config.workspaceRoot || this.workspaceRoot,
      config.runId,
      config.workspaceName
    );
    
    const runId = path.basename(paths.runDir);
    
    logger.debug(`Creating workspace: ${runId}`);
    
    // Check for existing lock
    if (await this.isLocked(paths.lockFile)) {
      throw new WorkspaceError(
        WorkspaceErrorCode.WORKSPACE_LOCKED,
        `Workspace is locked by another process. Lockfile: ${paths.lockFile}`
      );
    }
    
    // Create workspace directories
    await this.createDirectories(paths);
    
    // Create lockfile
    await this.createLockfile(paths.lockFile, config.repo);
    
    try {
      // Clone modified source repository
      const modifiedCommit = await this.cloneRepository(
        config.repo,
        paths.modifiedDir,
        config.branch,
        config.commit,
        config.timeout || this.defaultTimeout
      );
      
      // Clone expected reference if configured
      let expectedCommit: string | undefined;
      if (config.expectedBranch) {
        try {
          expectedCommit = await this.cloneRepository(
            config.repo,
            paths.expectedDir!,
            config.expectedBranch,
            undefined,
            config.timeout || this.defaultTimeout
          );
        } catch (error) {
          throw new WorkspaceError(
            WorkspaceErrorCode.EXPECTED_BRANCH_NOT_FOUND,
            `Failed to clone expected branch '${config.expectedBranch}': ${(error as Error).message}`,
            error as Error
          );
        }
      }
      
      const workspace: Workspace = {
        runId,
        paths,
        repo: config.repo,
        branch: config.branch,
        modifiedCommit,
        expectedBranch: config.expectedBranch,
        expectedCommit,
        createdAt: new Date().toISOString(),
      };
      
      logger.info(`Workspace created: ${runId}`);
      
      return workspace;
    } catch (error) {
      // Clean up on failure
      await this.cleanup({ runId, paths } as Workspace);
      throw error;
    }
  }
  
  /**
   * Clone a Git repository to a target directory
   * 
   * @param repoUrl - Repository URL
   * @param targetDir - Target directory path
   * @param branch - Branch to clone (optional)
   * @param commit - Specific commit to checkout (optional)
   * @param timeout - Timeout in milliseconds
   * @returns Resolved commit SHA
   * @throws WorkspaceError if clone fails
   */
  private async cloneRepository(
    repoUrl: string,
    targetDir: string,
    branch?: string,
    commit?: string,
    timeout: number = this.defaultTimeout
  ): Promise<string> {
    logger.debug(`Cloning ${repoUrl} to ${targetDir}`);
    
    const git: SimpleGit = simpleGit({
      timeout: {
        block: timeout,
      },
    });
    
    try {
      // Build clone options
      const cloneOptions: string[] = [];
      
      if (branch) {
        cloneOptions.push('--branch', branch);
        cloneOptions.push('--single-branch');
      }
      
      // Shallow clone for performance
      cloneOptions.push('--depth', '1');
      
      // Clone repository
      await git.clone(repoUrl, targetDir, cloneOptions);
      
      // Get repository git instance for the cloned repo
      const repoGit: SimpleGit = simpleGit(targetDir);
      
      // Checkout specific commit if provided
      if (commit) {
        try {
          // Need full history for specific commit
          await repoGit.fetch(['--unshallow']);
          await repoGit.checkout(commit);
        } catch (error) {
          throw new WorkspaceError(
            WorkspaceErrorCode.CHECKOUT_FAILED,
            `Failed to checkout commit '${commit}': ${(error as Error).message}`,
            error as Error
          );
        }
      }
      
      // Get current commit SHA
      const commitSha = await repoGit.revparse(['HEAD']);
      
      logger.debug(`Cloned to commit: ${commitSha}`);
      
      return commitSha.trim();
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      
      const gitError = error as GitError;
      throw new WorkspaceError(
        WorkspaceErrorCode.CLONE_FAILED,
        `Failed to clone repository '${repoUrl}': ${gitError.message}`,
        gitError
      );
    }
  }
  
  /**
   * Clean up workspace directory and lockfile
   * 
   * @param workspace - Workspace to clean up
   */
  async cleanup(workspace: Workspace): Promise<void> {
    logger.debug(`Cleaning up workspace: ${workspace.runId}`);
    
    try {
      // Remove lockfile first
      try {
        await fs.unlink(workspace.paths.lockFile);
      } catch (error) {
        logger.warn(`Failed to remove lockfile: ${(error as Error).message}`);
      }
      
      // Remove workspace directory
      try {
        await fs.rm(workspace.paths.runDir, { recursive: true, force: true });
      } catch (error) {
        logger.warn(`Failed to remove workspace directory: ${(error as Error).message}`);
      }
      
      logger.info(`Workspace cleaned up: ${workspace.runId}`);
    } catch (error) {
      logger.error(`Cleanup failed for workspace ${workspace.runId}: ${(error as Error).message}`);
      // Don't throw - cleanup should be best-effort
    }
  }
  
  /**
   * Get workspace information
   * 
   * @param workspace - Workspace instance
   * @returns Workspace information object
   */
  getWorkspaceInfo(workspace: Workspace): Record<string, unknown> {
    return {
      runId: workspace.runId,
      repo: workspace.repo,
      branch: workspace.branch,
      modifiedCommit: workspace.modifiedCommit,
      expectedBranch: workspace.expectedBranch,
      expectedCommit: workspace.expectedCommit,
      createdAt: workspace.createdAt,
      paths: {
        runDir: workspace.paths.runDir,
        modifiedDir: workspace.paths.modifiedDir,
        expectedDir: workspace.paths.expectedDir,
        artifactsDir: workspace.paths.artifactsDir,
      },
    };
  }
  
  /**
   * Check if workspace is locked
   * 
   * @param lockFilePath - Path to lockfile
   * @returns True if workspace is locked by active process
   */
  private async isLocked(lockFilePath: string): Promise<boolean> {
    try {
      // Check if lockfile exists
      if (!(await fileExists(lockFilePath))) {
        return false;
      }
      
      // Read lockfile
      const lockData = await this.readLockfile(lockFilePath);
      
      // Check if process is still running
      if (this.isProcessRunning(lockData.pid)) {
        return true;
      }
      
      // Stale lockfile - remove it
      logger.warn(`Removing stale lockfile (PID ${lockData.pid} not running)`);
      await fs.unlink(lockFilePath);
      return false;
    } catch (error) {
      logger.warn(`Error checking lockfile: ${(error as Error).message}`);
      return false;
    }
  }
  
  /**
   * Create lockfile with process information
   * 
   * @param lockFilePath - Path to lockfile
   * @param repo - Repository URL
   */
  private async createLockfile(lockFilePath: string, repo: string): Promise<void> {
    const lockData: LockData = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
      repo,
    };
    
    await fs.writeFile(lockFilePath, JSON.stringify(lockData, null, 2), 'utf-8');
  }
  
  /**
   * Read lockfile data
   * 
   * @param lockFilePath - Path to lockfile
   * @returns Lock data
   */
  private async readLockfile(lockFilePath: string): Promise<LockData> {
    const content = await fs.readFile(lockFilePath, 'utf-8');
    return JSON.parse(content) as LockData;
  }
  
  /**
   * Check if a process is running
   * 
   * @param pid - Process ID
   * @returns True if process is running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Create workspace directories
   * 
   * @param paths - Workspace paths
   */
  private async createDirectories(paths: WorkspacePaths): Promise<void> {
    await ensureDirectory(paths.runDir);
    await ensureDirectory(paths.artifactsDir);
    await ensureDirectory(paths.evaluatorArtifactsDir);
  }
  
  /**
   * Validate workspace configuration
   * 
   * @param config - Workspace configuration
   * @throws WorkspaceError if configuration is invalid
   */
  private validateConfig(config: WorkspaceConfig): void {
    if (!config.repo || typeof config.repo !== 'string') {
      throw new WorkspaceError(
        WorkspaceErrorCode.INVALID_CONFIG,
        'Repository URL is required and must be a string'
      );
    }
    
    if (config.repo.trim().length === 0) {
      throw new WorkspaceError(
        WorkspaceErrorCode.INVALID_CONFIG,
        'Repository URL cannot be empty'
      );
    }
    
    if (config.timeout !== undefined && (config.timeout < 0 || !Number.isInteger(config.timeout))) {
      throw new WorkspaceError(
        WorkspaceErrorCode.INVALID_CONFIG,
        'Timeout must be a positive integer'
      );
    }
  }
}

/**
 * Default export
 */
export default WorkspaceManager;
