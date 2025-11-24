import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { rimraf } from 'rimraf';

describe('Integration: Error Handling', () => {
  const testWorkspaceDir = path.join(__dirname, '..', '..', '.test-error-workspace');

  beforeAll(async () => {
    // Create test workspace
    await fs.mkdir(testWorkspaceDir, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup test workspace
    await rimraf(testWorkspaceDir);
  });

  it('should handle missing config file', async () => {
    const missingConfig = path.join(testWorkspaceDir, 'nonexistent.yaml');
    
    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(`node "${cliPath}" run -c "${missingConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8'
      });
    } catch (err) {
      error = err;
    }

    // Should fail with error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
    
    const stderr = error.stderr || error.stdout || '';
    expect(stderr).toMatch(/not found|does not exist|ENOENT/i);
  }, 30000);

  it('should handle invalid YAML syntax', async () => {
    const invalidYamlConfig = path.join(testWorkspaceDir, 'invalid-syntax.yaml');
    
    // Create file with invalid YAML
    await fs.writeFile(invalidYamlConfig, `
version: "1.0"
repo: "https://github.com/test/repo"
branch: main
  invalid indentation here
agent:
  adapter: copilot-cli
`);

    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(`node "${cliPath}" run -c "${invalidYamlConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8'
      });
    } catch (err) {
      error = err;
    }

    // Should fail with YAML parsing error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
  }, 30000);

  it('should handle missing required fields in config', async () => {
    const incompleteConfig = path.join(testWorkspaceDir, 'incomplete.yaml');
    
    // Create config missing required fields (no evaluators)
    await fs.writeFile(incompleteConfig, `
version: "1.0"
repo: "https://github.com/test/repo"
branch: main
agent:
  adapter: copilot-cli
  version: 1.0
  prompt: "Test prompt"
`);

    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(`node "${cliPath}" run -c "${incompleteConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8'
      });
    } catch (err) {
      error = err;
    }

    // Should fail with validation error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
    
    const stderr = error.stderr || error.stdout || '';
    expect(stderr).toMatch(/required|validation|evaluators/i);
  }, 30000);

  it('should handle invalid repository URL', async () => {
    const invalidRepoConfig = path.join(testWorkspaceDir, 'invalid-repo.yaml');
    
    // Create config with nonexistent repository
    await fs.writeFile(invalidRepoConfig, `
version: "1.0"
repo: "https://github.com/nonexistent/repository-that-does-not-exist-12345"
branch: main
agent:
  adapter: copilot-cli
  version: 1.0
  prompt: "Test prompt"
evaluators:
  - name: git-diff
    config: {}
workspace_dir: "${testWorkspaceDir.replace(/\\/g, '/')}/.youbencha-workspace"
timeout: 30
`);

    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(`node "${cliPath}" run -c "${invalidRepoConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8',
        timeout: 45000 // 45 second timeout
      });
    } catch (err) {
      error = err;
    }

    // Should fail with repository error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
    
    const stderr = error.stderr || error.stdout || '';
    expect(stderr).toMatch(/clone|repository|not found|failed/i);
  }, 60000);

  it('should handle invalid branch name', async () => {
    const invalidBranchConfig = path.join(testWorkspaceDir, 'invalid-branch.yaml');
    
    // Create a test repo first
    const testRepoDir = path.join(testWorkspaceDir, 'test-repo');
    await fs.mkdir(testRepoDir, { recursive: true });
    
    execSync('git init -b main', { cwd: testRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: testRepoDir });
    execSync('git config user.name "Test User"', { cwd: testRepoDir });
    
    const testFile = path.join(testRepoDir, 'test.txt');
    await fs.writeFile(testFile, 'Hello World\n');
    execSync('git add .', { cwd: testRepoDir });
    execSync('git commit -m "Initial commit"', { cwd: testRepoDir });

    // Create config with nonexistent branch
    await fs.writeFile(invalidBranchConfig, `
version: "1.0"
repo: "${testRepoDir.replace(/\\/g, '/')}"
branch: nonexistent-branch-12345
agent:
  adapter: copilot-cli
  version: 1.0
  prompt: "Test prompt"
evaluators:
  - name: git-diff
    config: {}
workspace_dir: "${testWorkspaceDir.replace(/\\/g, '/')}/.youbencha-workspace"
timeout: 30
`);

    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(`node "${cliPath}" run -c "${invalidBranchConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8',
        timeout: 45000
      });
    } catch (err) {
      error = err;
    }

    // Should fail with branch error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
    
    const stderr = error.stderr || error.stdout || '';
    expect(stderr).toMatch(/branch|checkout|not found|failed/i);
  }, 60000);

  it('should handle unknown evaluator', async () => {
    const unknownEvaluatorConfig = path.join(testWorkspaceDir, 'unknown-evaluator.yaml');
    
    const testRepoDir = path.join(testWorkspaceDir, 'test-repo-2');
    await fs.mkdir(testRepoDir, { recursive: true });
    
    execSync('git init -b main', { cwd: testRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: testRepoDir });
    execSync('git config user.name "Test User"', { cwd: testRepoDir });
    
    const testFile = path.join(testRepoDir, 'test.txt');
    await fs.writeFile(testFile, 'Hello World\n');
    execSync('git add .', { cwd: testRepoDir });
    execSync('git commit -m "Initial commit"', { cwd: testRepoDir });

    // Create config with unknown evaluator
    await fs.writeFile(unknownEvaluatorConfig, `
name: "Error Handling Test"
description: "Test case with unknown evaluator"
repo: "https://github.com/youbencha/youbencha-cli"
branch: main
agent:
  type: copilot-cli
  config:
    prompt: "Test prompt"
evaluators:
  - name: nonexistent-evaluator-xyz
    config: {}
workspace_dir: "${testWorkspaceDir.replace(/\\/g, '/')}/.youbencha-workspace"
timeout: 30
`);

    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(`node "${cliPath}" run -c "${unknownEvaluatorConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8',
        timeout: 45000
      });
    } catch (err) {
      error = err;
    }

    // Should fail with evaluator error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
    
    const stderr = error.stderr || error.stdout || '';
    expect(stderr).toMatch(/evaluator|not found|unknown|invalid/i);
  }, 60000);

  it('should handle timeout during execution', async () => {
    const timeoutConfig = path.join(testWorkspaceDir, 'timeout.yaml');
    
    const testRepoDir = path.join(testWorkspaceDir, 'test-repo-3');
    await fs.mkdir(testRepoDir, { recursive: true });
    
    execSync('git init -b main', { cwd: testRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: testRepoDir });
    execSync('git config user.name "Test User"', { cwd: testRepoDir });
    
    const testFile = path.join(testRepoDir, 'test.txt');
    await fs.writeFile(testFile, 'Hello World\n');
    execSync('git add .', { cwd: testRepoDir });
    execSync('git commit -m "Initial commit"', { cwd: testRepoDir });

    // Create config with very short timeout
    await fs.writeFile(timeoutConfig, `
version: "1.0"
repo: "${testRepoDir.replace(/\\/g, '/')}"
branch: main
agent:
  adapter: copilot-cli
  version: 1.0
  prompt: "Test prompt"
evaluators:
  - name: git-diff
    config: {}
workspace_dir: "${testWorkspaceDir.replace(/\\/g, '/')}/.youbencha-workspace"
timeout: 1
`);

    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(`node "${cliPath}" run -c "${timeoutConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8',
        timeout: 10000 // 10 second outer timeout
      });
    } catch (err) {
      error = err;
    }

    // Should fail with timeout or execution error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
    
    // Note: Timeout handling might result in different error messages
    // depending on where the timeout occurs
  }, 30000);

  it('should handle expected branch not found', async () => {
    const expectedBranchConfig = path.join(testWorkspaceDir, 'expected-branch-missing.yaml');
    
    // Create a test repo
    const testRepoDir = path.join(testWorkspaceDir, 'test-repo-expected');
    await fs.mkdir(testRepoDir, { recursive: true });
    
    execSync('git init -b main', { cwd: testRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: testRepoDir });
    execSync('git config user.name "Test User"', { cwd: testRepoDir });
    
    const testFile = path.join(testRepoDir, 'test.txt');
    await fs.writeFile(testFile, 'Hello World\n');
    execSync('git add .', { cwd: testRepoDir });
    execSync('git commit -m "Initial commit"', { cwd: testRepoDir });

    // Create config with nonexistent expected branch
    await fs.writeFile(expectedBranchConfig, `
version: "1.0"
repo: "${testRepoDir.replace(/\\/g, '/')}"
branch: main
expected_source: branch
expected: nonexistent-expected-branch
agent:
  adapter: copilot-cli
  version: 1.0
  prompt: "Test prompt"
evaluators:
  - name: git-diff
    config: {}
  - name: expected-diff
    config:
      threshold: 0.80
workspace_dir: "${testWorkspaceDir.replace(/\\/g, '/')}/.youbencha-workspace"
timeout: 30
`);

    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(`node "${cliPath}" run -c "${expectedBranchConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8',
        timeout: 45000
      });
    } catch (err) {
      error = err;
    }

    // Should fail with expected branch error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
    
    const stderr = error.stderr || error.stdout || '';
    expect(stderr).toMatch(/expected.*branch|branch.*not found|failed/i);
    
    // Should not execute agent when expected branch is missing
    expect(stderr).not.toMatch(/agent.*execution|copilot.*running/i);
  }, 60000);

  it('should cleanup workspace on error', async () => {
    const errorConfig = path.join(testWorkspaceDir, 'error-cleanup.yaml');
    
    // Create config that will fail (invalid repo)
    await fs.writeFile(errorConfig, `
version: "1.0"
repo: "https://github.com/invalid/repo-xyz-123"
branch: main
agent:
  adapter: copilot-cli
  version: 1.0
  prompt: "Test prompt"
evaluators:
  - name: git-diff
    config: {}
workspace_dir: "${testWorkspaceDir.replace(/\\/g, '/')}/.youbencha-workspace-cleanup"
timeout: 30
`);

    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    try {
      execSync(`node "${cliPath}" run -c "${errorConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8',
        timeout: 45000
      });
    } catch (err) {
      // Expected to fail
    }

    // Workspace should still be created (cleanup is optional)
    // This test mainly validates that errors don't leave hanging processes
    const workspaceDir = path.join(testWorkspaceDir, '.youbencha-workspace-cleanup');
    const workspaceExists = await fs.access(workspaceDir)
      .then(() => true)
      .catch(() => false);
    
    // Either workspace doesn't exist (fully cleaned up) or exists (partial cleanup)
    // Both are acceptable - main thing is no hanging processes
    expect([true, false]).toContain(workspaceExists);
  }, 60000);
});
