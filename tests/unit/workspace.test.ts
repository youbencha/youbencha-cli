/**
 * Unit Tests: Workspace Manager
 * 
 * Tests for workspace creation, Git repository cloning,
 * lockfile management, and cleanup operations.
 */

import * as fs from 'fs/promises';
import { simpleGit } from 'simple-git';
import {
  WorkspaceManager,
  WorkspaceConfig,
  WorkspaceError,
  WorkspaceErrorCode,
} from '../../src/core/workspace';
import { generateWorkspacePaths, fileExists, ensureDirectory } from '../../src/lib/path-utils';

// Mock dependencies
jest.mock('simple-git');
jest.mock('fs/promises');
jest.mock('../../src/lib/path-utils');

describe('WorkspaceManager', () => {
  let mockFs: jest.Mocked<typeof fs>;
  let mockSimpleGit: jest.MockedFunction<typeof simpleGit>;
  let mockGenerateWorkspacePaths: jest.MockedFunction<typeof generateWorkspacePaths>;
  let mockFileExists: jest.MockedFunction<typeof fileExists>;
  let mockEnsureDirectory: jest.MockedFunction<typeof ensureDirectory>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs = fs as jest.Mocked<typeof fs>;
    mockSimpleGit = simpleGit as jest.MockedFunction<typeof simpleGit>;
    mockGenerateWorkspacePaths = generateWorkspacePaths as jest.MockedFunction<typeof generateWorkspacePaths>;
    mockFileExists = fileExists as jest.MockedFunction<typeof fileExists>;
    mockEnsureDirectory = ensureDirectory as jest.MockedFunction<typeof ensureDirectory>;
    
    // Default mock implementations
    mockGenerateWorkspacePaths.mockReturnValue({
      root: '/mock/.youbencha-workspace',
      runDir: '/mock/.youbencha-workspace/run-test',
      modifiedDir: '/mock/.youbencha-workspace/run-test/src-modified',
      expectedDir: '/mock/.youbencha-workspace/run-test/src-expected',
      artifactsDir: '/mock/.youbencha-workspace/run-test/artifacts',
      evaluatorArtifactsDir: '/mock/.youbencha-workspace/run-test/artifacts/evaluators',
      lockFile: '/mock/.youbencha-workspace/run-test/.lock',
    });
    
    // Default: no lockfile exists
    mockFileExists.mockResolvedValue(false);
    
    // Default: directory creation succeeds
    mockEnsureDirectory.mockResolvedValue(undefined);
  });
  
  describe('constructor', () => {
    it('should initialize with default workspace root', () => {
      const manager = new WorkspaceManager();
      expect(manager).toBeDefined();
    });
    
    it('should initialize with custom workspace root', () => {
      const customRoot = '/custom/workspace';
      const manager = new WorkspaceManager(customRoot);
      expect(manager).toBeDefined();
    });
  });
  
  describe('createWorkspace', () => {
    it('should create workspace directories and lockfile', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      const workspace = await manager.createWorkspace(config);
      
      expect(workspace).toBeDefined();
      expect(workspace.runId).toBeDefined();
      expect(workspace.paths).toBeDefined();
      // Verify ensureDirectory was called for workspace directories
      expect(mockEnsureDirectory).toHaveBeenCalled();
    });
    
    it('should create all required directories', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      await manager.createWorkspace(config);
      
      // Should create run directory, artifacts directory, and evaluator artifacts
      expect(mockEnsureDirectory).toHaveBeenCalledWith(
        expect.stringMatching(/run-/)
      );
      expect(mockEnsureDirectory).toHaveBeenCalledWith(
        expect.stringMatching(/artifacts/)
      );
      expect(mockEnsureDirectory).toHaveBeenCalledWith(
        expect.stringMatching(/evaluators/)
      );
    });
    
    it('should write lockfile with process info', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      await manager.createWorkspace(config);
      
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.lock$/),
        expect.stringContaining('"pid":'),
        'utf-8'
      );
    });
    
    it('should fail if workspace already locked', async () => {
      // Lockfile exists and process is running
      mockFileExists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString(), repo: 'test' })
      );
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      await expect(manager.createWorkspace(config)).rejects.toThrow(WorkspaceError);
      await expect(manager.createWorkspace(config)).rejects.toMatchObject({
        code: WorkspaceErrorCode.WORKSPACE_LOCKED,
      });
    });
    
    it('should handle stale lockfile (process no longer exists)', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      
      // Lockfile exists but process 99999 is not running (stale)
      mockFileExists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ pid: 99999, timestamp: new Date().toISOString(), repo: 'test' })
      );
      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      const workspace = await manager.createWorkspace(config);
      
      expect(workspace).toBeDefined();
      expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringMatching(/\.lock$/));
    });
  });
  
  describe('cloneRepository', () => {
    it('should clone repository to modified directory', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123def'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      await manager.createWorkspace(config);
      
      expect(mockGit.clone).toHaveBeenCalledWith(
        'https://github.com/test/repo.git',
        expect.stringMatching(/src-modified$/),
        expect.arrayContaining(['--branch', 'main', '--single-branch', '--depth', '1'])
      );
    });
    
    it('should resolve and store commit SHA', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123def456'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      const workspace = await manager.createWorkspace(config);
      
      expect(workspace.modifiedCommit).toBe('abc123def456');
      expect(mockGit.revparse).toHaveBeenCalledWith(['HEAD']);
    });
    
    it('should clone expected reference if configured', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
        expectedBranch: 'feature/completed',
      };
      
      const workspace = await manager.createWorkspace(config);
      
      expect(mockGit.clone).toHaveBeenCalledTimes(2);
      expect(mockGit.clone).toHaveBeenCalledWith(
        'https://github.com/test/repo.git',
        expect.stringMatching(/src-expected$/),
        expect.arrayContaining(['--branch', 'feature/completed'])
      );
      expect(workspace.expectedCommit).toBeDefined();
    });
    
    it('should handle clone failure with descriptive error', async () => {
      const mockGit = {
        clone: jest.fn().mockRejectedValue(new Error('Repository not found')),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.rm.mockResolvedValue(undefined);
      mockFs.unlink.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/nonexistent.git',
        branch: 'main',
      };
      
      await expect(manager.createWorkspace(config)).rejects.toThrow(WorkspaceError);
      await expect(manager.createWorkspace(config)).rejects.toMatchObject({
        code: WorkspaceErrorCode.CLONE_FAILED,
      });
    });
    
    it('should fail fast if expected branch does not exist', async () => {
      const mockGit = {
        clone: jest.fn()
          .mockResolvedValueOnce(undefined) // First clone (modified) succeeds
          .mockRejectedValueOnce(new Error('Remote branch not found')), // Second clone (expected) fails
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.rm.mockResolvedValue(undefined);
      mockFs.unlink.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
        expectedBranch: 'nonexistent-branch',
      };
      
      // Only call once and check both conditions
      const promise = manager.createWorkspace(config);
      await expect(promise).rejects.toThrow(WorkspaceError);
    });
    
    it('should use specific commit if provided', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        checkout: jest.fn().mockResolvedValue(undefined),
        fetch: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('specific123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        commit: 'specific123',
      };
      
      await manager.createWorkspace(config);
      
      expect(mockGit.checkout).toHaveBeenCalledWith('specific123');
    });
  });
  
  describe('cleanup', () => {
    it('should remove workspace directory and lockfile', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.rm.mockResolvedValue(undefined);
      mockFs.unlink.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      const workspace = await manager.createWorkspace(config);
      await manager.cleanup(workspace);
      
      expect(mockFs.rm).toHaveBeenCalledWith(
        expect.stringMatching(/run-/),
        { recursive: true, force: true }
      );
    });
    
    it('should remove lockfile before removing directory', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.rm.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      const workspace = await manager.createWorkspace(config);
      await manager.cleanup(workspace);
      
      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringMatching(/\.lock$/)
      );
      expect(mockFs.rm).toHaveBeenCalled();
    });
    
    it('should handle cleanup errors gracefully', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      // After workspace creation, simulate unlink/rm failures
      mockFs.unlink.mockRejectedValue(new Error('Permission denied'));
      mockFs.rm.mockRejectedValue(new Error('Directory not empty'));
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      const workspace = await manager.createWorkspace(config);
      
      // Should not throw, just log warnings
      await expect(manager.cleanup(workspace)).resolves.not.toThrow();
    });
    
    it('should continue cleanup even if lockfile removal fails', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.unlink.mockRejectedValue(new Error('Lockfile not found'));
      mockFs.rm.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      const workspace = await manager.createWorkspace(config);
      await manager.cleanup(workspace);
      
      // Should still call rm even if unlink fails
      expect(mockFs.rm).toHaveBeenCalled();
    });
  });
  
  describe('isLocked', () => {
    it('should return true if lockfile exists and process is running', async () => {
      mockFileExists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString(), repo: 'test' })
      );
      
      const manager = new WorkspaceManager();
      const locked = await manager['isLocked']('/mock/path/.lock');
      
      expect(locked).toBe(true);
    });
    
    it('should return false if lockfile does not exist', async () => {
      mockFileExists.mockResolvedValue(false);
      
      const manager = new WorkspaceManager();
      const locked = await manager['isLocked']('/mock/path/.lock');
      
      expect(locked).toBe(false);
    });
    
    it('should return false if lockfile exists but process is not running', async () => {
      mockFileExists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue(
        JSON.stringify({ pid: 99999, timestamp: new Date().toISOString(), repo: 'test' })
      );
      mockFs.unlink.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const locked = await manager['isLocked']('/mock/path/.lock');
      
      expect(locked).toBe(false);
    });
  });
  
  describe('getWorkspaceInfo', () => {
    it('should return workspace information', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn().mockResolvedValue('abc123'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
      };
      
      const workspace = await manager.createWorkspace(config);
      const info = manager.getWorkspaceInfo(workspace);
      
      expect(info).toMatchObject({
        runId: expect.any(String),
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
        modifiedCommit: 'abc123',
      });
    });
    
    it('should include expected branch info if configured', async () => {
      const mockGit = {
        clone: jest.fn().mockResolvedValue(undefined),
        revparse: jest.fn()
          .mockResolvedValueOnce('abc123')
          .mockResolvedValueOnce('def456'),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);
      mockFs.writeFile.mockResolvedValue(undefined);
      
      const manager = new WorkspaceManager();
      const config: WorkspaceConfig = {
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
        expectedBranch: 'feature/completed',
      };
      
      const workspace = await manager.createWorkspace(config);
      const info = manager.getWorkspaceInfo(workspace);
      
      expect(info).toMatchObject({
        expectedBranch: 'feature/completed',
        expectedCommit: expect.any(String),
      });
    });
  });
});
