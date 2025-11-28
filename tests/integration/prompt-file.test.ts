/**
 * Integration tests for prompt file loading
 * 
 * Tests the ability to load prompts from files in both agent execution
 * and evaluator configurations.
 */

import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { testCaseConfigSchema } from '../../src/schemas/testcase.schema';
import { resolvePromptValue } from '../../src/lib/prompt-loader';

describe('Integration: Prompt File Loading', () => {
  const testTempDir = join(__dirname, '.test-prompt-file-integration');
  const promptsDir = join(testTempDir, 'prompts');
  
  beforeAll(() => {
    // Create temporary test directory structure
    mkdirSync(promptsDir, { recursive: true });
    
    // Create sample prompt files
    writeFileSync(
      join(promptsDir, 'agent-prompt.md'),
      '# Agent Prompt\n\nThis is a test prompt for agent execution.',
      'utf-8'
    );
    
    writeFileSync(
      join(promptsDir, 'evaluator-prompt.txt'),
      'This is a test prompt for evaluator.',
      'utf-8'
    );
  });
  
  afterAll(() => {
    // Clean up test directory
    rmSync(testTempDir, { recursive: true, force: true });
  });
  
  describe('Schema Validation', () => {
    it('should accept test case config with agent prompt_file', () => {
      const config = {
        name: 'Test with prompt file',
        description: 'Test description',
        repo: 'https://github.com/test/repo',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt_file: './prompts/agent-prompt.md',
          },
        },
        evaluators: [
          { name: 'git-diff' },
        ],
      };
      
      const result = testCaseConfigSchema.safeParse(config);
      
      expect(result.success).toBe(true);
    });
    
    it('should accept test case config with inline prompt', () => {
      const config = {
        name: 'Test with inline prompt',
        description: 'Test description',
        repo: 'https://github.com/test/repo',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'This is an inline prompt',
          },
        },
        evaluators: [
          { name: 'git-diff' },
        ],
      };
      
      const result = testCaseConfigSchema.safeParse(config);
      
      expect(result.success).toBe(true);
    });
    
    it('should reject config with both prompt and prompt_file', () => {
      const config = {
        name: 'Test with both',
        description: 'Test description',
        repo: 'https://github.com/test/repo',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Inline prompt',
            prompt_file: './prompts/agent-prompt.md',
          },
        },
        evaluators: [
          { name: 'git-diff' },
        ],
      };
      
      const result = testCaseConfigSchema.safeParse(config);
      
      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessages = JSON.stringify(result.error.issues);
        expect(errorMessages).toContain('Cannot specify both');
        expect(errorMessages).toContain('prompt');
        expect(errorMessages).toContain('prompt_file');
      }
    });
    
    it('should accept config with neither prompt nor prompt_file', () => {
      const config = {
        name: 'Test without prompt',
        description: 'Test description',
        repo: 'https://github.com/test/repo',
        agent: {
          type: 'copilot-cli',
          config: {},
        },
        evaluators: [
          { name: 'git-diff' },
        ],
      };
      
      const result = testCaseConfigSchema.safeParse(config);
      
      expect(result.success).toBe(true);
    });
    
    it('should accept evaluator config with prompt_file', () => {
      const config = {
        name: 'Test with evaluator prompt file',
        description: 'Test description',
        repo: 'https://github.com/test/repo',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Agent prompt',
          },
        },
        evaluators: [
          {
            name: 'agentic-judge',
            config: {
              type: 'copilot-cli',
              agent_name: 'agentic-judge',
              prompt_file: './prompts/evaluator-prompt.txt',
              assertions: {
                test: 'Test assertion',
              },
            },
          },
        ],
      };
      
      const result = testCaseConfigSchema.safeParse(config);
      
      expect(result.success).toBe(true);
    });
  });
  
  describe('Prompt Resolution', () => {
    it('should resolve agent prompt from file with relative path', () => {
      const promptFile = './prompts/agent-prompt.md';
      
      const resolved = resolvePromptValue(undefined, promptFile, testTempDir);
      
      expect(resolved).toBe('# Agent Prompt\n\nThis is a test prompt for agent execution.');
    });
    
    it('should resolve evaluator prompt from file with relative path', () => {
      const promptFile = './prompts/evaluator-prompt.txt';
      
      const resolved = resolvePromptValue(undefined, promptFile, testTempDir);
      
      expect(resolved).toBe('This is a test prompt for evaluator.');
    });
    
    it('should prefer inline prompt over undefined prompt_file', () => {
      const inlinePrompt = 'This is an inline prompt';
      
      const resolved = resolvePromptValue(inlinePrompt, undefined, testTempDir);
      
      expect(resolved).toBe(inlinePrompt);
    });
    
    it('should handle absolute paths for prompt files', () => {
      const absolutePath = join(promptsDir, 'agent-prompt.md');
      
      const resolved = resolvePromptValue(undefined, absolutePath, testTempDir);
      
      expect(resolved).toBe('# Agent Prompt\n\nThis is a test prompt for agent execution.');
    });
  });
  
  describe('Example Configuration Files', () => {
    it('should validate testcase-prompt-file.yaml structure', () => {
      const config = {
        name: 'Add README comment using prompt file',
        description: 'Tests the agent\'s ability to add a comment to README using a prompt loaded from a file',
        repo: 'https://github.com/youbencha/hello-world.git
',
        branch: 'master',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt_file: './prompts/add-readme-comment.md',
          },
        },
        evaluators: [
          {
            name: 'git-diff',
            config: {
              max_files_changed: 1,
              max_lines_added: 5,
            },
          },
        ],
      };
      
      const result = testCaseConfigSchema.safeParse(config);
      
      expect(result.success).toBe(true);
    });
    
    it('should validate testcase-evaluator-prompt-file.yaml structure', () => {
      const config = {
        name: 'Add README comment with file-based evaluation instructions',
        description: 'Tests the agent with evaluation instructions loaded from a file',
        repo: 'https://github.com/youbencha/hello-world.git
',
        branch: 'master',
        agent: {
          type: 'copilot-cli',
          config: {
            prompt: 'Add a friendly welcome message to README.md',
          },
        },
        evaluators: [
          {
            name: 'git-diff',
            config: {
              max_files_changed: 1,
              max_lines_added: 5,
            },
          },
          {
            name: 'agentic-judge',
            config: {
              type: 'copilot-cli',
              agent_name: 'agentic-judge',
              prompt_file: './prompts/strict-evaluation-instructions.txt',
              assertions: {
                readme_was_modified: 'The README.md file was modified. Score 1 if true, 0 if false.',
                message_is_friendly: 'A friendly welcome message was added. Score 1 if friendly, 0.5 if neutral, 0 if absent or unfriendly.',
                no_errors: 'No syntax errors or broken markdown. Score 1 if valid, 0 if broken.',
              },
            },
          },
        ],
      };
      
      const result = testCaseConfigSchema.safeParse(config);
      
      expect(result.success).toBe(true);
    });
  });
});
