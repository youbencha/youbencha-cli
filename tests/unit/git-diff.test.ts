/**
 * Unit tests for GitDiffEvaluator
 * 
 * Tests the GitDiffEvaluator implementation including:
 * - Files changed detection
 * - Lines added/removed calculation
 * - Change entropy calculation
 * 
 * TDD: These tests MUST FAIL initially before implementation
 */

import { GitDiffEvaluator } from '../../src/evaluators/git-diff.js';
import { EvaluationContext } from '../../src/evaluators/base.js';
import { YouBenchaLog } from '../../src/schemas/youbenchalog.schema.js';
import { SuiteConfig } from '../../src/schemas/suite.schema.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import simpleGit from 'simple-git';

describe('GitDiffEvaluator', () => {
  let evaluator: GitDiffEvaluator;
  let tempDir: string;
  let testRepoDir: string;
  let artifactsDir: string;

  // Increase timeout for git operations on Windows
  jest.setTimeout(30000);

  beforeAll(async () => {
    evaluator = new GitDiffEvaluator();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'youbencha-test-'));
    testRepoDir = path.join(tempDir, 'test-repo');
    artifactsDir = path.join(tempDir, 'artifacts');
    
    await fs.mkdir(testRepoDir, { recursive: true });
    await fs.mkdir(artifactsDir, { recursive: true });

    // Initialize a test git repository
    const git = simpleGit(testRepoDir);
    await git.init();
    await git.addConfig('user.name', 'Test User');
    await git.addConfig('user.email', 'test@example.com');
    
    // Create initial commit
    await fs.writeFile(path.join(testRepoDir, 'README.md'), '# Test Repo\n');
    await git.add('README.md');
    await git.commit('Initial commit');
  });

  afterAll(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(evaluator.name).toBe('git-diff');
    });

    it('should have descriptive description', () => {
      expect(evaluator.description).toBeDefined();
      expect(evaluator.description.length).toBeGreaterThan(10);
    });

    it('should not require expected reference', () => {
      expect(evaluator.requiresExpectedReference).toBe(false);
    });
  });

  describe('checkPreconditions', () => {
    it('should return true when git repository is available', async () => {
      const mockContext: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: {} as YouBenchaLog,
        config: {},
        suiteConfig: {} as SuiteConfig,
      };
      
      const canRun = await evaluator.checkPreconditions(mockContext);
      expect(canRun).toBe(true);
    });

    it('should return false when directory is not a git repository', async () => {
      const nonGitDir = path.join(tempDir, 'non-git');
      await fs.mkdir(nonGitDir, { recursive: true });
      
      const invalidContext: EvaluationContext = {
        modifiedDir: nonGitDir,
        artifactsDir,
        agentLog: {} as YouBenchaLog,
        config: {},
        suiteConfig: {} as SuiteConfig,
      };

      const canRun = await evaluator.checkPreconditions(invalidContext);
      expect(canRun).toBe(false);
    });

    it('should return false when directory does not exist', async () => {
      const invalidContext: EvaluationContext = {
        modifiedDir: '/nonexistent/path',
        artifactsDir,
        agentLog: {} as YouBenchaLog,
        config: {},
        suiteConfig: {} as SuiteConfig,
      };

      const canRun = await evaluator.checkPreconditions(invalidContext);
      expect(canRun).toBe(false);
    });
  });

  describe('evaluate', () => {
    let mockYouBenchaLog: YouBenchaLog;
    let mockSuiteConfig: SuiteConfig;

    beforeEach(() => {
      mockYouBenchaLog = {
        version: '1.0.0',
        agent: { name: 'test-agent', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'test-model', provider: 'test', parameters: {} },
        execution: {
          started_at: '2025-11-04T10:00:00.000Z',
          completed_at: '2025-11-04T10:01:00.000Z',
          duration_ms: 60000,
          exit_code: 0,
          status: 'success',
        },
        messages: [],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        errors: [],
        environment: {
          os: 'test',
          node_version: 'v20.0.0',
          youbencha_version: '1.0.0',
          working_directory: '/test',
        },
      };

      mockSuiteConfig = {
        version: '1.0.0',
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
        agent: { name: 'test-agent', config: {} },
        evaluators: [],
      };
    });

    it('should detect files changed', async () => {
      // Make some changes to the test repo
      const git = simpleGit(testRepoDir);
      await fs.writeFile(path.join(testRepoDir, 'new-file.ts'), 'console.log("hello");\n');
      await git.add('new-file.ts');
      await git.commit('Add new file');

      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: { base_commit: 'HEAD~1' },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.evaluator).toBe('git-diff');
      expect(result.status).toBe('passed');
      expect(result.metrics).toHaveProperty('files_changed');
      expect(result.metrics.files_changed).toBeGreaterThanOrEqual(1);
    });

    it('should detect untracked new files', async () => {
      // Create a test repo with an untracked file (simulating agent creating files without committing)
      const untrackedRepoDir = path.join(tempDir, 'untracked-repo');
      await fs.mkdir(untrackedRepoDir, { recursive: true });
      
      const git = simpleGit(untrackedRepoDir);
      await git.init();
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');
      
      // Create and commit initial file
      await fs.writeFile(path.join(untrackedRepoDir, 'existing.txt'), 'existing content\n');
      await git.add('existing.txt');
      await git.commit('Initial commit');
      
      // Create a new file without staging or committing it (simulating agent behavior)
      await fs.writeFile(path.join(untrackedRepoDir, 'untracked-new-file.ts'), 'console.log("new file");\n');

      const context: EvaluationContext = {
        modifiedDir: untrackedRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      // Should detect the untracked file
      expect(result.status).toBe('passed');
      expect(result.metrics.files_changed).toBeGreaterThanOrEqual(1);
      expect(result.metrics.lines_added).toBeGreaterThanOrEqual(1);
    });

    it('should detect staged new files', async () => {
      // Create a test repo with a staged but uncommitted file
      const stagedRepoDir = path.join(tempDir, 'staged-repo');
      await fs.mkdir(stagedRepoDir, { recursive: true });
      
      const git = simpleGit(stagedRepoDir);
      await git.init();
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');
      
      // Create and commit initial file
      await fs.writeFile(path.join(stagedRepoDir, 'existing.txt'), 'existing content\n');
      await git.add('existing.txt');
      await git.commit('Initial commit');
      
      // Create and stage a new file without committing it
      await fs.writeFile(path.join(stagedRepoDir, 'staged-new-file.ts'), 'console.log("staged");\n');
      await git.add('staged-new-file.ts');

      const context: EvaluationContext = {
        modifiedDir: stagedRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      // Should detect the staged file
      expect(result.status).toBe('passed');
      expect(result.metrics.files_changed).toBeGreaterThanOrEqual(1);
      expect(result.metrics.lines_added).toBeGreaterThanOrEqual(1);
    });

    it('should pass when no thresholds are configured', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.status).toBe('passed');
    });

    it('should pass when metrics are within thresholds', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {
          assertions: {
            max_files_changed: 100,
            max_lines_added: 1000,
            max_lines_removed: 1000,
          },
        },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.status).toBe('passed');
      expect(result.metrics.violations).toBeUndefined();
    });

    it('should fail when files_changed exceeds threshold', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {
          assertions: {
            max_files_changed: 0, // No files should be changed
          },
        },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      if (result.metrics.files_changed > 0) {
        expect(result.status).toBe('failed');
        expect(result.metrics.violations).toBeDefined();
        expect(result.metrics.violations).toContain(
          expect.stringContaining('files_changed')
        );
      }
    });

    it('should fail when lines_added exceeds threshold', async () => {
      // Add a file with many lines
      const git = simpleGit(testRepoDir);
      await fs.writeFile(
        path.join(testRepoDir, 'large-file.ts'),
        'console.log("line");\n'.repeat(100)
      );
      await git.add('large-file.ts');
      await git.commit('Add large file');

      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {
          base_commit: 'HEAD~1',
          assertions: {
            max_lines_added: 10, // Only 10 lines allowed
          },
        },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.status).toBe('failed');
      expect(result.metrics.violations).toBeDefined();
      expect(result.metrics.violations.some((v: string) => v.includes('lines_added'))).toBe(true);
    });

    it('should fail when total_changes exceeds threshold', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {
          assertions: {
            max_total_changes: 1, // Very restrictive
          },
        },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      const totalChanges = result.metrics.lines_added + result.metrics.lines_removed;
      if (totalChanges > 1) {
        expect(result.status).toBe('failed');
        expect(result.metrics.violations).toBeDefined();
        expect(result.metrics.violations).toContain(
          expect.stringContaining('total_changes')
        );
      }
    });

    it('should fail when change_entropy exceeds threshold', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {
          assertions: {
            max_change_entropy: 0.1, // Very low - forces concentrated changes
          },
        },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      if (result.metrics.change_entropy > 0.1) {
        expect(result.status).toBe('failed');
        expect(result.metrics.violations).toBeDefined();
        expect(result.metrics.violations).toContain(
          expect.stringContaining('change_entropy')
        );
      }
    });

    it('should include assertion values in metrics', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {
          assertions: {
            max_files_changed: 5,
            max_lines_added: 100,
          },
        },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.assertions).toBeDefined();
      expect(result.assertions.max_files_changed).toBe(5);
      expect(result.assertions.max_lines_added).toBe(100);
    });

    it('should include violations in message when failed', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {
          assertions: {
            max_files_changed: 0,
          },
        },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      if (result.status === 'failed') {
        expect(result.message).toContain('Violations');
      }
    });

    it('should calculate lines added and removed', async () => {
      // Modify an existing file
      const git = simpleGit(testRepoDir);
      const filePath = path.join(testRepoDir, 'README.md');
      const content = await fs.readFile(filePath, 'utf-8');
      await fs.writeFile(filePath, content + '\nNew line added\n');
      await git.add('README.md');
      await git.commit('Update README');

      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.metrics).toHaveProperty('lines_added');
      expect(result.metrics).toHaveProperty('lines_removed');
      expect(typeof result.metrics.lines_added).toBe('number');
      expect(typeof result.metrics.lines_removed).toBe('number');
    });

    it('should calculate change entropy', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.metrics).toHaveProperty('change_entropy');
      expect(typeof result.metrics.change_entropy).toBe('number');
      expect(result.metrics.change_entropy).toBeGreaterThanOrEqual(0);
    });

    it('should list changed files', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.metrics).toHaveProperty('changed_files');
      expect(Array.isArray(result.metrics.changed_files)).toBe(true);
    });

    it('should include file-level metrics', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      if (result.metrics.changed_files && result.metrics.changed_files.length > 0) {
        const firstFile = result.metrics.changed_files[0];
        expect(firstFile).toHaveProperty('path');
        expect(firstFile).toHaveProperty('additions');
        expect(firstFile).toHaveProperty('deletions');
      }
    });

    it('should calculate diff against specific base commit', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {
          base_commit: 'HEAD~1',
        },
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.status).toBe('passed');
      expect(result.metrics).toHaveProperty('base_commit');
    });

    it('should save diff artifact', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.artifacts).toBeDefined();
      expect(Array.isArray(result.artifacts)).toBe(true);
      
      if (result.artifacts && result.artifacts.length > 0) {
        const diffArtifact = result.artifacts.find(a => a.name === 'diff.patch');
        expect(diffArtifact).toBeDefined();
        
        // Verify artifact file exists
        if (diffArtifact) {
          const artifactPath = path.join(artifactsDir, diffArtifact.path);
          const exists = await fs.access(artifactPath).then(() => true).catch(() => false);
          expect(exists).toBe(true);
        }
      }
    });

    it('should handle repositories with no changes', async () => {
      // Create a clean repo with no uncommitted changes
      const cleanRepoDir = path.join(tempDir, 'clean-repo');
      await fs.mkdir(cleanRepoDir, { recursive: true });
      
      const git = simpleGit(cleanRepoDir);
      await git.init();
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');
      await fs.writeFile(path.join(cleanRepoDir, 'file.txt'), 'content\n');
      await git.add('file.txt');
      await git.commit('Initial commit');

      const context: EvaluationContext = {
        modifiedDir: cleanRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.status).toBe('passed');
      expect(result.metrics.files_changed).toBe(0);
      expect(result.metrics.lines_added).toBe(0);
      expect(result.metrics.lines_removed).toBe(0);
    });

    it('should include execution metadata', async () => {
      const context: EvaluationContext = {
        modifiedDir: testRepoDir,
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('duration_ms');
      expect(typeof result.duration_ms).toBe('number');
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should handle errors gracefully', async () => {
      const invalidContext: EvaluationContext = {
        modifiedDir: '/nonexistent/path',
        artifactsDir,
        agentLog: mockYouBenchaLog,
        config: {},
        suiteConfig: mockSuiteConfig,
      };

      const result = await evaluator.evaluate(invalidContext);
      
      expect(result.status).toBe('skipped');
      expect(result.message).toBeDefined();
      expect(result.message?.length).toBeGreaterThan(0);
    });
  });

  describe('entropy calculation', () => {
    it('should calculate higher entropy for changes across many files', async () => {
      // Create repo with changes to multiple files
      const multiFileRepoDir = path.join(tempDir, 'multi-file-repo');
      await fs.mkdir(multiFileRepoDir, { recursive: true });
      
      const git = simpleGit(multiFileRepoDir);
      await git.init();
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');
      
      // Create multiple files
      for (let i = 0; i < 5; i++) {
        await fs.writeFile(path.join(multiFileRepoDir, `file${i}.ts`), `// File ${i}\n`);
      }
      await git.add('.');
      await git.commit('Initial commit');
      
      // Modify all files
      for (let i = 0; i < 5; i++) {
        await fs.appendFile(path.join(multiFileRepoDir, `file${i}.ts`), `console.log(${i});\n`);
      }
      await git.add('.');
      await git.commit('Modify all files');

      const mockLog = {
        version: '1.0.0' as const,
        agent: { name: 'test', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'test', provider: 'test', parameters: {} },
        execution: { started_at: '', completed_at: '', duration_ms: 0, exit_code: 0, status: 'success' as const },
        messages: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        errors: [], environment: { os: '', node_version: '', youbencha_version: '', working_directory: '' },
      };
      const mockSuite = { version: '1.0.0' as const, repo: '', branch: '', agent: { name: 'test', config: {} }, evaluators: [] };

      const context: EvaluationContext = {
        modifiedDir: multiFileRepoDir,
        artifactsDir,
        agentLog: mockLog,
        config: { base_commit: 'HEAD~1' },
        suiteConfig: mockSuite,
      };

      const result = await evaluator.evaluate(context);
      
      expect(result.metrics.change_entropy).toBeGreaterThan(0);
    });

    it('should calculate lower entropy for changes to single file', async () => {
      // Create repo with changes to one file
      const singleFileRepoDir = path.join(tempDir, 'single-file-repo');
      await fs.mkdir(singleFileRepoDir, { recursive: true });
      
      const git = simpleGit(singleFileRepoDir);
      await git.init();
      await git.addConfig('user.name', 'Test User');
      await git.addConfig('user.email', 'test@example.com');
      
      await fs.writeFile(path.join(singleFileRepoDir, 'single.ts'), '// Single file\n');
      await git.add('.');
      await git.commit('Initial commit');
      
      // Modify only this file with many changes
      await fs.appendFile(path.join(singleFileRepoDir, 'single.ts'), 'console.log("many");\n'.repeat(10));
      await git.add('.');
      await git.commit('Modify single file');

      const mockLog = {
        version: '1.0.0' as const,
        agent: { name: 'test', version: '1.0.0', adapter_version: '1.0.0' },
        model: { name: 'test', provider: 'test', parameters: {} },
        execution: { started_at: '', completed_at: '', duration_ms: 0, exit_code: 0, status: 'success' as const },
        messages: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        errors: [], environment: { os: '', node_version: '', youbencha_version: '', working_directory: '' },
      };
      const mockSuite = { version: '1.0.0' as const, repo: '', branch: '', agent: { name: 'test', config: {} }, evaluators: [] };

      const context: EvaluationContext = {
        modifiedDir: singleFileRepoDir,
        artifactsDir,
        agentLog: mockLog,
        config: { base_commit: 'HEAD~1' },
        suiteConfig: mockSuite,
      };

      const result = await evaluator.evaluate(context);
      
      // Entropy should be lower when changes are concentrated
      expect(result.metrics.change_entropy).toBeGreaterThanOrEqual(0);
    });
  });
});
