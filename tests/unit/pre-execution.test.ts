/**
 * Pre-Execution Unit Tests
 * 
 * Tests for script pre-executions.
 */

import { ScriptPreExecution } from '../../src/pre-execution/script.js';
import { PreExecutionContext } from '../../src/pre-execution/base.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Platform-specific command helpers
const isWindows = process.platform === 'win32';

// Commands that work on both platforms
const getEnvVarCommand = () => isWindows ? 'cmd' : 'printenv';
const getEnvVarArgs = (varName: string) => isWindows ? ['/c', `echo %${varName}%`] : [varName];
const getPrintAllEnvCommand = () => isWindows ? 'cmd' : 'printenv';
const getPrintAllEnvArgs = () => isWindows ? ['/c', 'set'] : [];
const getPwdCommand = () => isWindows ? 'cmd' : 'pwd';
const getPwdArgs = () => isWindows ? ['/c', 'cd'] : [];
const getFalseCommand = () => isWindows ? 'cmd' : 'false';
const getFalseArgs = () => isWindows ? ['/c', 'exit 1'] : [];

describe('ScriptPreExecution', () => {
  let executor: ScriptPreExecution;
  let mockContext: PreExecutionContext;
  let tempDir: string;

  beforeEach(async () => {
    executor = new ScriptPreExecution();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'youbencha-pre-test-'));

    mockContext = {
      workspaceDir: tempDir,
      repoDir: tempDir,
      artifactsDir: path.join(tempDir, 'artifacts'),
      testCaseName: 'test-case',
      repoUrl: 'https://github.com/test/test.git',
      branch: 'main',
      config: {
        command: 'echo',
        args: ['Hello World'],
        timeout_ms: 5000,
      },
    };

    // Create artifacts directory
    await fs.mkdir(mockContext.artifactsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(executor.name).toBe('script');
    });

    it('should have descriptive description', () => {
      expect(executor.description).toContain('script');
      expect(executor.description).toContain('before agent execution');
    });
  });

  describe('checkPreconditions', () => {
    it('should return true for valid command', async () => {
      const result = await executor.checkPreconditions(mockContext);
      expect(result).toBe(true);
    });

    it('should return false for empty command', async () => {
      mockContext.config = { command: '' };
      const result = await executor.checkPreconditions(mockContext);
      expect(result).toBe(false);
    });

    it('should return false for whitespace-only command', async () => {
      mockContext.config = { command: '   ' };
      const result = await executor.checkPreconditions(mockContext);
      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute simple command successfully', async () => {
      const result = await executor.execute(mockContext);

      expect(result.status).toBe('success');
      expect(result.pre_executor).toBe('script');
      expect(result.message).toContain('completed successfully');
      expect(result.metadata).toHaveProperty('exit_code', 0);
      expect(result.duration_ms).toBeGreaterThan(0);
      expect(result.timestamp).toBeDefined();
    });

    it('should replace WORKSPACE_DIR variable in args', async () => {
      mockContext.config = {
        command: 'echo',
        args: ['${WORKSPACE_DIR}'],
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout).toContain(tempDir);
    });

    it('should replace TEST_CASE_NAME variable in args', async () => {
      mockContext.config = {
        command: 'echo',
        args: ['${TEST_CASE_NAME}'],
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout).toContain('test-case');
    });

    it('should replace multiple variables in args', async () => {
      mockContext.config = {
        command: 'echo',
        args: ['Test=${TEST_CASE_NAME}'],
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout).toContain('test-case');
    });

    it('should pass environment variables to script using printenv', async () => {
      mockContext.config = {
        command: getEnvVarCommand(),
        args: isWindows ? ['/c', 'echo %MY_VAR%'] : ['MY_VAR'],
        env: {
          MY_VAR: 'test-value',
        },
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout).toContain('test-value');
    });

    it('should automatically provide WORKSPACE_DIR as environment variable', async () => {
      mockContext.config = {
        command: getEnvVarCommand(),
        args: getEnvVarArgs('WORKSPACE_DIR'),
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout).toContain(tempDir);
    });

    it('should automatically provide TEST_CASE_NAME as environment variable', async () => {
      mockContext.config = {
        command: getEnvVarCommand(),
        args: getEnvVarArgs('TEST_CASE_NAME'),
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout).toContain('test-case');
    });

    it('should automatically provide BRANCH as environment variable', async () => {
      mockContext.config = {
        command: getEnvVarCommand(),
        args: getEnvVarArgs('BRANCH'),
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout).toContain('main');
    });

    it('should return failed status for non-zero exit code', async () => {
      mockContext.config = {
        command: getFalseCommand(),
        args: getFalseArgs(),
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('failed');
      expect(result.message).toContain('exited with code');
      expect(result.metadata?.exit_code).not.toBe(0);
      expect(result.error).toBeDefined();
    });

    it('should handle command that does not exist', async () => {
      mockContext.config = {
        command: 'nonexistent-command-12345',
        args: [],
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
    });

    it('should respect working_dir configuration', async () => {
      // Create subdirectory
      const subDir = path.join(tempDir, 'subdir');
      await fs.mkdir(subDir, { recursive: true });

      mockContext.config = {
        command: getPwdCommand(),
        args: getPwdArgs(),
        working_dir: subDir,
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout).toContain('subdir');
    });

    it('should truncate long output', async () => {
      // Generate output longer than 1000 characters
      const longString = 'x'.repeat(2000);
      mockContext.config = {
        command: 'echo',
        args: [longString],
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout?.length).toBeLessThanOrEqual(1000);
    });

    it('should allow creating directories', async () => {
      const newDir = path.join(tempDir, 'newdir');
      mockContext.config = {
        command: 'mkdir',
        args: ['-p', newDir],
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');

      // Verify directory was created
      const stats = await fs.stat(newDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe('security', () => {
    it('should not expose all process.env variables', async () => {
      // Set a sensitive environment variable that should NOT be passed to script
      process.env.SENSITIVE_SECRET = 'should-not-be-exposed';
      
      mockContext.config = {
        command: getPrintAllEnvCommand(),
        args: getPrintAllEnvArgs(),
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      
      // Verify sensitive variable is NOT in output
      expect(result.metadata?.stdout).not.toContain('SENSITIVE_SECRET');
      expect(result.metadata?.stdout).not.toContain('should-not-be-exposed');
      
      // Clean up
      delete process.env.SENSITIVE_SECRET;
    });

    it('should only pass safe environment variables', async () => {
      mockContext.config = {
        command: getPrintAllEnvCommand(),
        args: getPrintAllEnvArgs(),
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      
      // Verify safe variables ARE present (use variables that appear early alphabetically to avoid truncation issues)
      // Output is truncated to 1000 chars, so only check for variables that appear early
      expect(result.metadata?.stdout).toContain('BRANCH');
      expect(result.metadata?.stdout).toContain('PATH');
    });

    it('should allow user-provided env variables from config', async () => {
      mockContext.config = {
        command: getEnvVarCommand(),
        args: getEnvVarArgs('CUSTOM_VAR'),
        env: {
          CUSTOM_VAR: 'custom-value',
        },
        timeout_ms: 5000,
      };

      const result = await executor.execute(mockContext);
      expect(result.status).toBe('success');
      expect(result.metadata?.stdout).toContain('custom-value');
    });
  });
});
