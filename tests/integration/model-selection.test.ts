/**
 * Integration test for Model Selection Feature
 *
 * Tests that model configuration flows correctly through the entire system
 */

import { buildCopilotCommand } from '../../src/adapters/copilot-cli.js';
import { AgentExecutionContext } from '../../src/adapters/base.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

describe('Model Selection Integration', () => {
  let testWorkspaceDir: string;
  let testArtifactsDir: string;

  beforeEach(async () => {
    // Create temporary directories
    testWorkspaceDir = path.join(os.tmpdir(), `yb-model-test-${Date.now()}`);
    testArtifactsDir = path.join(testWorkspaceDir, 'artifacts');
    await fs.mkdir(testWorkspaceDir, { recursive: true });
    await fs.mkdir(testArtifactsDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fs.rm(testWorkspaceDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Copilot CLI Adapter with Model', () => {
    it('should build command with model parameter', () => {
      const context: AgentExecutionContext = {
        workspaceDir: testWorkspaceDir,
        repoDir: testWorkspaceDir,
        artifactsDir: testArtifactsDir,
        config: {
          prompt: 'Fix the bug',
          model: 'gpt-5.1',
        },
        timeout: 60000,
        env: {},
      };

      const { command, args } = buildCopilotCommand(context);

      expect(command).toBe('copilot');
      expect(args).toContain('--model');
      expect(args).toContain('gpt-5.1');

      const modelIndex = args.indexOf('--model');
      expect(modelIndex).toBeGreaterThan(-1);
      expect(args[modelIndex + 1]).toBe('gpt-5.1');
    });

    it('should build command without model parameter when not specified', () => {
      const context: AgentExecutionContext = {
        workspaceDir: testWorkspaceDir,
        repoDir: testWorkspaceDir,
        artifactsDir: testArtifactsDir,
        config: {
          prompt: 'Fix the bug',
        },
        timeout: 60000,
        env: {},
      };

      const { command, args } = buildCopilotCommand(context);

      expect(command).toBe('copilot');
      expect(args).not.toContain('--model');
    });

    it('should build command with both model and agent parameters', () => {
      const context: AgentExecutionContext = {
        workspaceDir: testWorkspaceDir,
        repoDir: testWorkspaceDir,
        artifactsDir: testArtifactsDir,
        config: {
          prompt: 'Fix the bug',
          model: 'claude-sonnet-4.5',
          agent: 'custom-agent',
        },
        timeout: 60000,
        env: {},
      };

      const { command, args } = buildCopilotCommand(context);

      expect(command).toBe('copilot');
      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet-4.5');
      expect(args).toContain('--agent');
      expect(args).toContain('custom-agent');

      const modelIndex = args.indexOf('--model');
      const agentIndex = args.indexOf('--agent');
      expect(modelIndex).toBeLessThan(agentIndex);
    });
  });

  describe('Different Model Types', () => {
    const models = ['claude-sonnet-4.5', 'gpt-5.1', 'custom-model'];

    models.forEach((model) => {
      it(`should handle model ${model}`, () => {
        const context: AgentExecutionContext = {
          workspaceDir: testWorkspaceDir,
          repoDir: testWorkspaceDir,
          artifactsDir: testArtifactsDir,
          config: {
            prompt: 'Test prompt',
            model: model,
          },
          timeout: 60000,
          env: {},
        };

        const result = buildCopilotCommand(context);

        expect(result.args).toContain('--model');
        expect(result.args).toContain(model);
      });
    });
  });
});
