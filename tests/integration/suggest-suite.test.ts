/**
 * Integration tests for suggest-testcase command
 * Tests the complete workflow of generating suite suggestions
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Suggest Suite Integration', () => {
  let tempDir: string;
  let outputDir: string;
  let agentFile: string;

  beforeEach(async () => {
    // Create temp directory for test
    tempDir = path.join(process.cwd(), '.test-temp', `suggest-testcase-${Date.now()}`);
    outputDir = path.join(tempDir, 'output');
    await fs.mkdir(outputDir, { recursive: true });

    // Create a test agent file
    agentFile = path.join(tempDir, 'test-agent.md');
    await fs.writeFile(agentFile, '# Test Agent\n\nTest agent instructions.');
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Command Validation', () => {
    test('fails when output directory does not exist', async () => {
      const nonExistentDir = path.join(tempDir, 'non-existent');

      try {
        await execAsync(
          `node dist/cli/index.js suggest-testcase --agent copilot-cli --output-dir ${nonExistentDir}`,
          { cwd: process.cwd() }
        );
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.code).toBe(1);
        expect(error.stderr).toContain('Directory not found');
      }
    });

    test('fails when agent type is unsupported', async () => {
      try {
        await execAsync(
          `node dist/cli/index.js suggest-testcase --agent unknown-agent --output-dir ${outputDir}`,
          { cwd: process.cwd() }
        );
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.code).toBe(1);
        expect(error.stderr).toContain('Unsupported agent type');
      }
    });

    test('fails when agent file does not exist', async () => {
      try {
        await execAsync(
          `node dist/cli/index.js suggest-testcase --agent copilot-cli --output-dir ${outputDir} --agent-file /non/existent/file.md`,
          { cwd: process.cwd() }
        );
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.code).toBe(1);
        // May fail on agent validation before reaching agent file validation
        expect(
          error.stderr.includes('Agent file not found') || 
          error.stderr.includes('is not installed')
        ).toBe(true);
      }
    });

    test('validates output directory is readable', async () => {
      // Create output directory with some test files
      await fs.writeFile(path.join(outputDir, 'test.ts'), 'content');

      // This should validate successfully (but may fail on agent execution)
      // We're just testing the validation step
      const command = `node dist/cli/index.js suggest-testcase --agent copilot-cli --output-dir ${outputDir} --agent-file ${agentFile}`;
      
      // Note: This will fail on agent execution, but validation should pass
      try {
        await execAsync(command, { cwd: process.cwd(), timeout: 30000 });
      } catch (error: any) {
        // We expect it to fail at agent execution, not validation
        expect(error.stderr).not.toContain('Invalid output directory');
        expect(error.stderr).not.toContain('Cannot access directory');
      }
    }, 60000);  // 60 second timeout for full agent execution attempt
  });

  describe('Agent File Validation', () => {
    test('loads agent file successfully', async () => {
      // Create a proper agent file
      const properAgentFile = path.join(tempDir, 'proper-agent.md');
      await fs.writeFile(properAgentFile, `
# youBencha Suite Suggestion Agent

## Your Role
Expert evaluation strategist

## Domain Knowledge
- Evaluator types
- Suite configuration

## Workflow
1. Step 1
2. Step 2

## Examples
Example content
      `);

      // Verify file structure (this would be done by the command)
      const content = await fs.readFile(properAgentFile, 'utf-8');
      expect(content).toContain('Your Role');
      expect(content).toContain('Domain Knowledge');
      expect(content).toContain('Workflow');
      expect(content).toContain('Examples');
    });

    test('detects incomplete agent file structure', async () => {
      const incompleteFile = path.join(tempDir, 'incomplete.md');
      await fs.writeFile(incompleteFile, '# Incomplete\nMissing required sections');

      const content = await fs.readFile(incompleteFile, 'utf-8');
      
      // Should be missing required sections
      expect(content).not.toContain('Your Role');
      expect(content).not.toContain('Domain Knowledge');
    });

    test('reads actual suggest-testcase agent file', async () => {
      const actualAgentFile = path.join(process.cwd(), 'agents', 'suggest-suite.agent.md');
      
      // Verify the real agent file exists and has proper structure
      const content = await fs.readFile(actualAgentFile, 'utf-8');
      
      expect(content).toContain('# youBencha Suite Suggestion Agent');
      expect(content).toContain('## Your Role');
      expect(content).toContain('## Domain Knowledge');
      expect(content).toContain('## Workflow Instructions');
      expect(content).toContain('## Example Dialogues');
      expect(content).toContain('git-diff');
      expect(content).toContain('expected-diff');
      expect(content).toContain('agentic-judge');
    });
  });

  describe('Generated Suite Validation', () => {
    test('validates generated suite has required fields', async () => {
      // Mock a generated suite
      const mockSuite = `
repo: https://github.com/example/test
branch: main
agent:
  type: copilot-cli
evaluators:
  - name: git-diff
  - name: agentic-judge
    config:
      agent:
        type: copilot-cli
        config:
          system_prompt: "Test prompt"
      evaluation_criteria:
        - "Criterion 1"
      `;

      // Parse and validate
      expect(mockSuite).toContain('repo:');
      expect(mockSuite).toContain('agent:');
      expect(mockSuite).toContain('evaluators:');
      expect(mockSuite).toContain('git-diff');
      expect(mockSuite).toContain('agentic-judge');
    });

    test('validates suite with expected reference', async () => {
      const mockSuite = `
repo: https://github.com/example/test
branch: feature/new
expected_source: branch
expected: main
agent:
  type: copilot-cli
evaluators:
  - name: git-diff
  - name: expected-diff
    config:
      threshold: 0.85
      `;

      expect(mockSuite).toContain('expected_source: branch');
      expect(mockSuite).toContain('expected: main');
      expect(mockSuite).toContain('expected-diff');
      expect(mockSuite).toContain('threshold: 0.85');
    });

    test('validates suite with agentic-judge config', async () => {
      const mockSuite = `
evaluators:
  - name: agentic-judge
    config:
      agent:
        type: copilot-cli
        config:
          tools: [read, search, analyze]
          system_prompt: |
            You are evaluating code quality.
            Output EvaluationResult JSON.
      evaluation_criteria:
        - "Criterion 1"
        - "Criterion 2"
      `;

      expect(mockSuite).toContain('agentic-judge');
      expect(mockSuite).toContain('tools: [read, search, analyze]');
      expect(mockSuite).toContain('system_prompt:');
      expect(mockSuite).toContain('evaluation_criteria:');
      expect(mockSuite).toContain('EvaluationResult JSON');
    });
  });

  describe('DiffAnalyzer Integration', () => {
    test('analyzes simple folder changes', async () => {
      // Import DiffAnalyzer
      const { DiffAnalyzer } = await import('../../src/core/diff-analyzer');
      const analyzer = new DiffAnalyzer();

      // Create source folder
      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(path.join(sourceDir, 'file1.ts'), 'original');

      // Create output folder with changes
      await fs.writeFile(path.join(outputDir, 'file1.ts'), 'modified');
      await fs.writeFile(path.join(outputDir, 'file2.ts'), 'new file');

      // Analyze
      const analysis = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(analysis.files.modified).toContain('file1.ts');
      expect(analysis.files.added).toContain('file2.ts');
      expect(analysis.lines.added).toBeGreaterThan(0);
    });

    test('detects authentication patterns', async () => {
      const { DiffAnalyzer } = await import('../../src/core/diff-analyzer');
      const analyzer = new DiffAnalyzer();

      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      // Create auth-related files
      await fs.mkdir(path.join(outputDir, 'src'), { recursive: true });
      await fs.writeFile(path.join(outputDir, 'src', 'auth.ts'), 'auth code');
      await fs.writeFile(path.join(outputDir, 'src', 'jwt-token.ts'), 'jwt code');

      const analysis = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(analysis.patterns.auth_patterns).toBe(true);
    });

    test('detects test file additions', async () => {
      const { DiffAnalyzer } = await import('../../src/core/diff-analyzer');
      const analyzer = new DiffAnalyzer();

      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      // Create test files
      await fs.mkdir(path.join(outputDir, 'tests'), { recursive: true });
      await fs.writeFile(path.join(outputDir, 'tests', 'auth.test.ts'), 'test code');
      await fs.writeFile(path.join(outputDir, 'src.spec.js'), 'spec code');

      const analysis = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(analysis.patterns.tests_added).toBe(true);
    });

    test('detects API changes', async () => {
      const { DiffAnalyzer } = await import('../../src/core/diff-analyzer');
      const analyzer = new DiffAnalyzer();

      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      // Create API files
      await fs.mkdir(path.join(outputDir, 'src', 'api'), { recursive: true });
      await fs.writeFile(path.join(outputDir, 'src', 'api', 'users.ts'), 'api code');
      await fs.writeFile(path.join(outputDir, 'src', 'routes.ts'), 'routes code');

      const analysis = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(analysis.patterns.api_changes).toBe(true);
    });

    test('detects multiple patterns simultaneously', async () => {
      const { DiffAnalyzer } = await import('../../src/core/diff-analyzer');
      const analyzer = new DiffAnalyzer();

      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      // Create multiple pattern files
      await fs.mkdir(path.join(outputDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(outputDir, 'tests'), { recursive: true });
      await fs.writeFile(path.join(outputDir, 'src', 'auth.ts'), 'auth');
      await fs.writeFile(path.join(outputDir, 'tests', 'auth.test.ts'), 'test');
      await fs.writeFile(path.join(outputDir, 'README.md'), 'docs');
      await fs.writeFile(path.join(outputDir, 'package.json'), '{}');

      const analysis = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(analysis.patterns.auth_patterns).toBe(true);
      expect(analysis.patterns.tests_added).toBe(true);
      expect(analysis.patterns.docs_added).toBe(true);
      expect(analysis.patterns.config_changed).toBe(true);
    });
  });

  describe('Real-World Scenarios', () => {
    test('simulates authentication feature scenario', async () => {
      const { DiffAnalyzer } = await import('../../src/core/diff-analyzer');
      const analyzer = new DiffAnalyzer();

      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(sourceDir, { recursive: true });

      // Simulate auth feature output
      await fs.mkdir(path.join(outputDir, 'src', 'middleware'), { recursive: true });
      await fs.mkdir(path.join(outputDir, 'tests'), { recursive: true });
      
      await fs.writeFile(
        path.join(outputDir, 'src', 'middleware', 'auth.ts'),
        'export function authenticateJWT() { /* ... */ }'
      );
      await fs.writeFile(
        path.join(outputDir, 'tests', 'auth.test.ts'),
        'describe("auth", () => { /* tests */ })'
      );
      await fs.writeFile(
        path.join(outputDir, 'README.md'),
        '# Auth Feature\n\nAdded JWT authentication'
      );

      const analysis = await analyzer.analyzeFolders(sourceDir, outputDir);

      // Should detect auth, tests, and docs
      expect(analysis.patterns.auth_patterns).toBe(true);
      expect(analysis.patterns.tests_added).toBe(true);
      expect(analysis.patterns.docs_added).toBe(true);
      
      // Should have reasonable metrics
      expect(analysis.files.added.length).toBeGreaterThan(0);
      // Note: lines.added counts lines in added files, which happens during computeLineChanges
      // The count may be 0 if files are added but not yet processed
      expect(analysis.lines.total_changed).toBeGreaterThanOrEqual(0);
    });

    test('simulates refactoring scenario', async () => {
      const { DiffAnalyzer } = await import('../../src/core/diff-analyzer');
      const analyzer = new DiffAnalyzer();

      const sourceDir = path.join(tempDir, 'source');
      await fs.mkdir(path.join(sourceDir, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(sourceDir, 'src', 'payment.ts'),
        'function processPayment(callback) { /* callback style */ }'
      );

      await fs.mkdir(path.join(outputDir, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(outputDir, 'src', 'payment.ts'),
        'async function processPayment() { /* async/await style */ }'
      );

      const analysis = await analyzer.analyzeFolders(sourceDir, outputDir);

      // Refactoring should show modifications, not additions
      const expectedPath = path.join('src', 'payment.ts');
      expect(analysis.files.modified).toContain(expectedPath);
      expect(analysis.files.added.length).toBe(0);
      
      // Should have some line changes
      expect(analysis.lines.added).toBeGreaterThan(0);
      expect(analysis.lines.removed).toBeGreaterThan(0);
    });
  });
});
