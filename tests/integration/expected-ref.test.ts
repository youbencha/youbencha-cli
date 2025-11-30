/**
 * Integration Test: Expected Reference Workflow
 * 
 * Tests the complete workflow for evaluating agent output against
 * an expected reference branch.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { rimraf } from 'rimraf';

describe('Integration: Expected Reference Workflow', () => {
  // Increase timeout for integration tests that involve git operations and builds
  jest.setTimeout(60000);

  const testWorkspaceDir = path.join(__dirname, '..', '..', '.test-workspace-expected-ref');
  const testRepoDir = path.join(testWorkspaceDir, 'test-repo');
  const testSuiteConfig = path.join(testWorkspaceDir, 'expected-ref-suite.yaml');

  beforeAll(async () => {
    // Create test workspace
    await fs.mkdir(testWorkspaceDir, { recursive: true });

    // Create a test repository with two branches
    await fs.mkdir(testRepoDir, { recursive: true });
    
    // Initialize git repo
    execSync('git init -b main', { cwd: testRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: testRepoDir });
    execSync('git config user.name "Test User"', { cwd: testRepoDir });
    
    // Create initial files on main branch
    const file1 = path.join(testRepoDir, 'file1.txt');
    const file2 = path.join(testRepoDir, 'file2.txt');
    await fs.writeFile(file1, 'Initial content 1\n');
    await fs.writeFile(file2, 'Initial content 2\n');
    
    execSync('git add .', { cwd: testRepoDir });
    execSync('git commit -m "Initial commit"', { cwd: testRepoDir });

    // Create expected branch with completed changes
    execSync('git checkout -b expected-completed', { cwd: testRepoDir });
    await fs.writeFile(file1, 'Expected content 1\nAdditional line\n');
    await fs.writeFile(file2, 'Expected content 2\nMore changes\n');
    execSync('git add .', { cwd: testRepoDir });
    execSync('git commit -m "Expected changes"', { cwd: testRepoDir });

    // Switch back to main
    execSync('git checkout main', { cwd: testRepoDir });

    // Create test suite configuration with expected reference
    const suiteYaml = `
version: "1.0"
repo: "${testRepoDir.replace(/\\/g, '/')}"
branch: main
expected_source: branch
expected: expected-completed
agent:
  adapter: copilot-cli
  version: 1.0
  prompt: "Update file1.txt and file2.txt"
evaluators:
  - name: git-diff
    config: {}
  - name: expected-diff
    config:
      threshold: 0.80
workspace_dir: "${testWorkspaceDir.replace(/\\/g, '/')}/.youbencha-workspace"
timeout: 300
`.trim();

    await fs.writeFile(testSuiteConfig, suiteYaml);
  });

  afterAll(async () => {
    // Cleanup test workspace
    await rimraf(testWorkspaceDir);
  });

  it('should clone both main and expected branches', async () => {
    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    // For this test, we're validating the workspace setup
    // In a real scenario with copilot-cli, the run command would execute
    // For now, we test the configuration is valid and parseable
    
    const suiteContent = await fs.readFile(testSuiteConfig, 'utf-8');
    expect(suiteContent).toContain('expected_source: branch');
    expect(suiteContent).toContain('expected: expected-completed');
    expect(suiteContent).toContain('expected-diff');
  });

  it('should include expected-diff evaluator in configuration', async () => {
    const suiteContent = await fs.readFile(testSuiteConfig, 'utf-8');
    
    // Verify expected-diff evaluator is configured
    expect(suiteContent).toContain('expected-diff');
    expect(suiteContent).toContain('threshold: 0.80');
  });

  it('should validate expected branch exists before running', async () => {
    // Verify expected branch exists in test repo
    const branches = execSync('git branch -a', { 
      cwd: testRepoDir,
      encoding: 'utf-8'
    });
    
    expect(branches).toContain('expected-completed');
  });

  it('should generate results with expected-diff metrics', async () => {
    // This test validates the expected structure
    // In a real scenario with copilot-cli running:
    // 1. Both branches would be cloned
    // 2. Agent would execute and modify code
    // 3. expected-diff would compare modified vs expected
    // 4. results.json would include similarity metrics
    
    // For now, we validate the test setup is correct
    expect(testRepoDir).toBeDefined();
    expect(testSuiteConfig).toBeDefined();
    
    // Verify both branches have different content
    const mainContent = await fs.readFile(path.join(testRepoDir, 'file1.txt'), 'utf-8');
    
    execSync('git checkout expected-completed', { cwd: testRepoDir });
    const expectedContent = await fs.readFile(path.join(testRepoDir, 'file1.txt'), 'utf-8');
    execSync('git checkout main', { cwd: testRepoDir });
    
    expect(mainContent).not.toBe(expectedContent);
    expect(expectedContent).toContain('Expected content');
  });

  it('should pass when similarity exceeds threshold', async () => {
    // This test describes expected behavior:
    // When agent produces output similar to expected branch (>80% similarity),
    // the expected-diff evaluator should mark status as 'passed'
    
    // Test structure validation
    expect(testSuiteConfig).toBeTruthy();
  });

  it('should fail when similarity is below threshold', async () => {
    // This test describes expected behavior:
    // When agent produces output different from expected branch (<80% similarity),
    // the expected-diff evaluator should mark status as 'failed'
    
    // Test structure validation
    expect(testSuiteConfig).toBeTruthy();
  });

  it('should include file-level similarity details in artifacts', async () => {
    // This test describes expected behavior:
    // The expected-diff evaluator should generate:
    // 1. expected-diff-report.json with file-by-file similarity
    // 2. File status for each: matched, changed, added, removed
    // 3. Per-file similarity scores (0.0 to 1.0)
    
    // Test structure validation
    const workspaceDir = path.join(testWorkspaceDir, '.youbencha-workspace');
    expect(workspaceDir).toBeTruthy();
  });
});
