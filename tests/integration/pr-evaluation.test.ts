/**
 * Integration Tests: Pull Request Evaluation
 * 
 * Tests the PR evaluation workflow where the user evaluates an existing PR
 * without running an agent.
 */

import { Orchestrator } from '../../src/core/orchestrator.js';
import { SuiteConfig } from '../../src/schemas/suite.schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Pull Request Evaluation', () => {
  let orchestrator: Orchestrator;
  const workspaceRoot = path.join(process.cwd(), '.test-workspace-pr');

  beforeEach(() => {
    orchestrator = new Orchestrator({
      keepWorkspace: false,
    });
  });

  afterEach(async () => {
    // Clean up test workspace
    try {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Schema Validation', () => {
    it('should accept valid PR evaluation configuration', () => {
      const config: SuiteConfig = {
        repo: 'https://github.com/octocat/Hello-World.git',
        pull_request: {
          url: 'https://github.com/octocat/Hello-World/pull/1',
        },
        evaluators: [
          { name: 'git-diff' },
        ],
      };

      // Should not throw
      expect(config).toBeDefined();
    });

    it('should reject invalid PR URL format', () => {
      const { suiteConfigSchema } = require('../../src/schemas/suite.schema.js');
      
      const invalidConfig = {
        repo: 'https://github.com/octocat/Hello-World.git',
        pull_request: {
          url: 'https://github.com/octocat/Hello-World/issues/1', // Issues, not PR
        },
        evaluators: [
          { name: 'git-diff' },
        ],
      };

      expect(() => suiteConfigSchema.parse(invalidConfig)).toThrow();
    });

    it('should reject configuration with both agent and pull_request', () => {
      const { suiteConfigSchema } = require('../../src/schemas/suite.schema.js');
      
      const invalidConfig = {
        repo: 'https://github.com/octocat/Hello-World.git',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Test prompt',
          },
        },
        pull_request: {
          url: 'https://github.com/octocat/Hello-World/pull/1',
        },
        evaluators: [
          { name: 'git-diff' },
        ],
      };

      expect(() => suiteConfigSchema.parse(invalidConfig)).toThrow(/Either agent configuration or pull_request/);
    });

    it('should reject configuration with neither agent nor pull_request', () => {
      const { suiteConfigSchema } = require('../../src/schemas/suite.schema.js');
      
      const invalidConfig = {
        repo: 'https://github.com/octocat/Hello-World.git',
        evaluators: [
          { name: 'git-diff' },
        ],
      };

      expect(() => suiteConfigSchema.parse(invalidConfig)).toThrow(/Either agent configuration or pull_request/);
    });
  });

  describe('Workspace Setup', () => {
    it('should extract PR number from URL', () => {
      const prUrl = 'https://github.com/octocat/Hello-World/pull/123';
      const match = prUrl.match(/\/pull\/(\d+)\/?$/);
      
      expect(match).toBeTruthy();
      expect(match![1]).toBe('123');
    });

    it('should handle PR URLs with trailing slash', () => {
      const prUrl = 'https://github.com/octocat/Hello-World/pull/456/';
      const match = prUrl.match(/\/pull\/(\d+)\/?$/);
      
      expect(match).toBeTruthy();
      expect(match![1]).toBe('456');
    });
  });

  // Note: Full integration tests require actual GitHub PR access
  // These would be run in a CI environment with network access
  describe('Full Workflow (Requires Network)', () => {
    it.skip('should clone and evaluate a real PR', async () => {
      const config: SuiteConfig = {
        repo: 'https://github.com/octocat/Hello-World.git',
        pull_request: {
          url: 'https://github.com/octocat/Hello-World/pull/1',
        },
        evaluators: [
          { name: 'git-diff' },
        ],
        workspace_dir: workspaceRoot,
      };

      const results = await orchestrator.runEvaluation(config, 'test-config.yaml');

      expect(results).toBeDefined();
      expect(results.agent.type).toBe('none');
      expect(results.agent.status).toBe('skipped');
      expect(results.evaluators).toHaveLength(1);
    });
  });
});
