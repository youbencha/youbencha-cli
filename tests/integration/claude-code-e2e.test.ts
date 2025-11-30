/**
 * Integration tests for Claude Code Adapter end-to-end execution
 * 
 * These tests verify the complete workflow of Claude Code execution
 * through youBencha, including workspace setup, execution, and output capture.
 * 
 * Note: These tests require Claude Code CLI to be installed and authenticated.
 * In CI environments without Claude Code, tests will be skipped.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
import { AgentExecutionContext } from '../../src/adapters/base.js';

describe('Claude Code End-to-End Integration', () => {
  let adapter: ClaudeCodeAdapter;
  let tempWorkspace: string;

  // Skip tests unless CLAUDE_CODE_INTEGRATION_TESTS env var is set
  // These tests call the real Claude CLI and will timeout in CI/development environments
  const skipIfNoClaude = (): boolean => {
    if (!process.env.CLAUDE_CODE_INTEGRATION_TESTS) {
      console.log('Skipping: Set CLAUDE_CODE_INTEGRATION_TESTS=1 to run real Claude CLI tests');
      return true;
    }
    return false;
  };

  beforeAll(async () => {
    adapter = new ClaudeCodeAdapter();
  });

  beforeEach(async () => {
    // Create a temporary workspace for each test
    tempWorkspace = path.join('/tmp', `youbencha-claude-test-${Date.now()}`);
    await fs.mkdir(tempWorkspace, { recursive: true });
    await fs.mkdir(path.join(tempWorkspace, 'artifacts'), { recursive: true });
  });

  afterEach(async () => {
    // Clean up the temporary workspace
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Adapter Integration', () => {
    it('should have claude-code as adapter name', () => {
      expect(adapter.name).toBe('claude-code');
    });

    it('should have valid semver version', () => {
      expect(adapter.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('Execution Context Handling', () => {
    it('should handle execution context with prompt', async () => {
      if (skipIfNoClaude()) return;
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Echo "Hello World"',
        },
        timeout: 30000,
        env: {},
      };

      const result = await adapter.execute(context);

      // Should complete without throwing
      expect(result).toBeDefined();
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('durationMs');
    });

    it('should return failed status for invalid configuration', async () => {
      if (skipIfNoClaude()) return;
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {}, // Missing prompt
        timeout: 30000,
        env: {},
      };

      const result = await adapter.execute(context);

      expect(result.status).toBe('failed');
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Log Normalization Integration', () => {
    it('should produce valid YouBenchaLog from execution result', async () => {
      if (skipIfNoClaude()) return;
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt',
        },
        timeout: 30000,
        env: {},
      };

      const result = await adapter.execute(context);
      const log = adapter.normalizeLog(result.output, result);

      // Verify log structure
      expect(log.version).toBe('1.0.0');
      expect(log.agent.name).toBe('claude-code');
      expect(log.model.provider).toBe('Anthropic');
      expect(log.execution).toBeDefined();
      expect(log.messages).toBeDefined();
      expect(Array.isArray(log.messages)).toBe(true);
    });
  });

  describe('Artifacts Directory Creation', () => {
    it('should create claude-code-logs directory when executing', async () => {
      if (skipIfNoClaude()) return;
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Test prompt for directory creation',
        },
        timeout: 30000,
        env: {},
      };

      await adapter.execute(context);

      // Check that claude-code-logs directory was created
      const logsDir = path.join(tempWorkspace, 'artifacts', 'claude-code-logs');
      const stats = await fs.stat(logsDir).catch(() => null);
      expect(stats?.isDirectory()).toBe(true);
    });
  });

  // Tests that require actual Claude Code CLI
  // These tests are designed to pass even when Claude CLI is not available
  describe('Full Execution (graceful when Claude Code CLI not available)', () => {
    it('should check availability without throwing', async () => {
      // This should return false if not available, not throw
      const available = await adapter.checkAvailability().catch(() => false);
      expect(typeof available).toBe('boolean');
    });

    it('should handle execution when CLI is not available', async () => {
      if (skipIfNoClaude()) return;
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Say "Hello from Claude"',
        },
        timeout: 5000, // Short timeout
        env: {},
      };

      const result = await adapter.execute(context);

      // If CLI is not available, status should be 'failed'
      // If CLI is available, it could be 'success', 'failed', or 'timeout'
      expect(['success', 'failed', 'timeout']).toContain(result.status);
    });

    it('should handle model parameter in config', async () => {
      if (skipIfNoClaude()) return;
      const context: AgentExecutionContext = {
        workspaceDir: tempWorkspace,
        repoDir: path.join(tempWorkspace, 'src-modified'),
        artifactsDir: path.join(tempWorkspace, 'artifacts'),
        config: {
          prompt: 'Say hello',
          model: 'claude-sonnet-4',
        },
        timeout: 5000,
        env: {},
      };

      const result = await adapter.execute(context);

      // Should complete (model may or may not be valid in test environment)
      expect(result).toBeDefined();
      expect(['success', 'failed', 'timeout']).toContain(result.status);
    });
  });
});
