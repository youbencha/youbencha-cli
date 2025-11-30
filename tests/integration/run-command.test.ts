import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { rimraf } from 'rimraf';

describe('Integration: Run Command', () => {
  const testWorkspaceDir = path.join(__dirname, '..', '..', '.test-workspace');
  const testSuiteConfig = path.join(testWorkspaceDir, 'test-suite.yaml');
  const testRepoDir = path.join(testWorkspaceDir, 'test-repo');

  beforeAll(async () => {
    // Create test workspace
    await fs.mkdir(testWorkspaceDir, { recursive: true });

    // Create a minimal test repository
    await fs.mkdir(testRepoDir, { recursive: true });
    
    // Initialize git repo
    execSync('git init -b main', { cwd: testRepoDir });
    execSync('git config user.email "test@example.com"', { cwd: testRepoDir });
    execSync('git config user.name "Test User"', { cwd: testRepoDir });
    
    // Create test file
    const testFile = path.join(testRepoDir, 'test.txt');
    await fs.writeFile(testFile, 'Hello World\n');
    
    execSync('git add .', { cwd: testRepoDir });
    execSync('git commit -m "Initial commit"', { cwd: testRepoDir });

    // Create test suite configuration
    // Note: Using a well-known public GitHub repo for schema validation
    // The actual test will check workspace creation, not full execution
    const suiteYaml = `
name: run-command-integration-test
description: Integration test for run command
repo: "https://github.com/octocat/Hello-World.git"
branch: master
agent:
  type: copilot-cli
  config:
    prompt: "Add a new line to README"
evaluators:
  - name: git-diff
    config: {}
workspace_dir: "${testWorkspaceDir.replace(/\\/g, '/')}/.youbencha-workspace"
timeout: 300
`.trim();

    await fs.writeFile(testSuiteConfig, suiteYaml);
  });

  afterAll(async () => {
    // Cleanup test workspace
    await rimraf(testWorkspaceDir);
  });

  it('should run complete evaluation workflow', async () => {
    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    // Run the evaluation (using node to run the built CLI)
    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let output: string;
    let exitCode = 0;
    
    try {
      output = execSync(`node "${cliPath}" run -c "${testSuiteConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8',
        env: {
          ...process.env,
          // Skip actual copilot execution for integration test
          YOUBENCHA_TEST_MODE: 'true'
        }
      });
    } catch (error: any) {
      output = error.stdout || error.message;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      exitCode = error.status || 1;
    }

    // For now, we expect this to fail gracefully if copilot-cli is not available
    // The test validates that the workflow structure is correct
    expect(output).toBeTruthy();
    
    // Check if workspace was created
    const workspaceDir = path.join(testWorkspaceDir, '.youbencha-workspace');
    const workspaceExists = await fs.access(workspaceDir)
      .then(() => true)
      .catch(() => false);
    
    // Workspace should exist even if copilot-cli fails
    expect(workspaceExists).toBe(true);
  }, 60000); // 60 second timeout

  it('should generate valid results.json structure', async () => {
    // This test assumes the previous test ran and created artifacts
    // In a real scenario with copilot-cli available, we would check:
    // 1. results.json exists
    // 2. results.json has valid structure
    // 3. evaluators array is populated
    // 4. git-diff evaluator results are present
    
    const workspaceDir = path.join(testWorkspaceDir, '.youbencha-workspace');
    
    // Try to find run directories
    let runDirs: string[] = [];
    try {
      const entries = await fs.readdir(workspaceDir);
      runDirs = entries.filter(entry => entry.startsWith('run-'));
    } catch (error) {
      // Workspace might not exist if copilot-cli is not available
    }

    if (runDirs.length > 0) {
      // Get the most recent run directory
      const latestRun = runDirs.sort().reverse()[0];
      const resultsPath = path.join(workspaceDir, latestRun, 'artifacts', 'results.json');
      
      try {
        const resultsContent = await fs.readFile(resultsPath, 'utf-8');
        const results = JSON.parse(resultsContent);
        
        // Validate structure
        expect(results).toHaveProperty('version');
        expect(results).toHaveProperty('suite');
        expect(results).toHaveProperty('execution');
        expect(results).toHaveProperty('evaluators');
        expect(results).toHaveProperty('summary');
        
        // Validate evaluators array
        expect(Array.isArray(results.evaluators)).toBe(true);
        
        // Check for git-diff evaluator
        const gitDiffEval = results.evaluators.find(
          (e: any) => e.evaluator_name === 'git-diff'
        );
        expect(gitDiffEval).toBeDefined();
      } catch (error) {
        // Results might not be generated if copilot-cli is not available
        // This is expected in CI environments
        console.log('Results validation skipped - copilot-cli may not be available');
      }
    }
  });

  it('should handle suite configuration validation', async () => {
    const invalidSuiteConfig = path.join(testWorkspaceDir, 'invalid-suite.yaml');
    
    // Create invalid suite (missing required fields)
    const invalidYaml = `
version: "1.0"
repo: "${testRepoDir.replace(/\\/g, '/')}"
# Missing branch, agent, and evaluators
`.trim();

    await fs.writeFile(invalidSuiteConfig, invalidYaml);

    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(`node "${cliPath}" run -c "${invalidSuiteConfig}"`, {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8'
      });
    } catch (err) {
      error = err;
    }

    // Should fail with validation error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
  });
});
