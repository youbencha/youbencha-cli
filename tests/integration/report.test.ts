import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { rimraf } from 'rimraf';

describe('Integration: Report Generation', () => {
  const testWorkspaceDir = path.join(__dirname, '..', '..', '.test-report-workspace');
  const testResultsPath = path.join(testWorkspaceDir, 'test-results.json');
  const testReportPath = path.join(testWorkspaceDir, 'test-report.md');

  beforeAll(async () => {
    // Create test workspace
    await fs.mkdir(testWorkspaceDir, { recursive: true });

    // Create a mock results.json file matching the ResultsBundle schema
    const mockResults = {
      version: '1.0.0',
      test_case: {
        name: 'test-case-1',
        description: 'Test case for integration testing',
        config_file: 'test-suite.yaml',
        config_hash: 'abc123',
        repo: 'https://github.com/test/repo',
        branch: 'main',
        commit: 'abc123def456',
      },
      execution: {
        started_at: '2025-11-04T10:00:00Z',
        completed_at: '2025-11-04T10:05:00Z',
        duration_ms: 300000,
        youbencha_version: '1.0.0',
        environment: {
          os: 'linux',
          node_version: 'v20.0.0',
          workspace_dir: '.youbencha-workspace'
        }
      },
      agent: {
        type: 'copilot-cli',
        youbencha_log_path: 'artifacts/youbencha-log.json',
        status: 'success' as const,
        exit_code: 0
      },
      evaluators: [
        {
          evaluator: 'git-diff',
          status: 'passed' as const,
          metrics: {
            files_changed: 3,
            insertions: 45,
            deletions: 12,
            total_changes: 57,
            entropy: 0.75
          },
          message: '3 files changed, 45 insertions(+), 12 deletions(-)',
          duration_ms: 5000,
          timestamp: '2025-11-04T10:02:00Z',
        },
        {
          evaluator: 'agentic-judge',
          status: 'passed' as const,
          metrics: {
            score: 0.85,
            criteria_met: 4,
            total_criteria: 5
          },
          message: 'Good implementation with minor improvements needed',
          duration_ms: 15000,
          timestamp: '2025-11-04T10:03:00Z',
        }
      ],
      summary: {
        total_evaluators: 2,
        passed: 2,
        failed: 0,
        skipped: 0,
        overall_status: 'passed' as const
      },
      artifacts: {
        agent_log: 'artifacts/youbencha-log.json',
        reports: ['artifacts/report.md'],
        evaluator_artifacts: []
      }
    };

    await fs.writeFile(testResultsPath, JSON.stringify(mockResults, null, 2));
  });

  afterAll(async () => {
    // Cleanup test workspace
    await rimraf(testWorkspaceDir);
  });

  it('should generate markdown report from results.json', async () => {
    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    // Run the report command
    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    const output = execSync(
      `node "${cliPath}" report --from "${testResultsPath}" --output "${testReportPath}"`,
      {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8'
      }
    );

    // Check that command completed
    expect(output).toContain('Report generated');

    // Verify report file was created
    const reportExists = await fs.access(testReportPath)
      .then(() => true)
      .catch(() => false);
    
    expect(reportExists).toBe(true);
  }, 30000);

  it('should include all required sections in markdown report', async () => {
    // Read the generated report
    const reportContent = await fs.readFile(testReportPath, 'utf-8');

    // Verify required sections are present
    expect(reportContent).toContain('# youBencha Evaluation Report');
    expect(reportContent).toContain('## Summary');
    expect(reportContent).toContain('## Test Case Configuration');
    expect(reportContent).toContain('## Execution Details');
    expect(reportContent).toContain('## Agent Execution');
    expect(reportContent).toContain('## Evaluator Results');
    expect(reportContent).toContain('## Artifacts');
    
    // Verify environment info is included in execution details
    expect(reportContent).toContain('Environment:');
    expect(reportContent).toContain('OS:');
    expect(reportContent).toContain('Node.js:');
    
    // Verify specific content
    expect(reportContent).toContain('main');
    expect(reportContent).toContain('copilot-cli');
    expect(reportContent).toContain('git-diff');
    expect(reportContent).toContain('agentic-judge');
    expect(reportContent).toContain('passed');
  });

  it('should include evaluator metrics in report', async () => {
    const reportContent = await fs.readFile(testReportPath, 'utf-8');

    // Check for git-diff metrics
    expect(reportContent).toContain('files_changed');
    expect(reportContent).toContain('insertions');
    expect(reportContent).toContain('deletions');
    
    // Check for agentic-judge metrics
    expect(reportContent).toContain('score');
    expect(reportContent).toContain('criteria_met');
  });

  it('should generate JSON report when format is json', async () => {
    const jsonReportPath = path.join(testWorkspaceDir, 'test-report.json');
    
    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    execSync(
      `node "${cliPath}" report --from "${testResultsPath}" --output "${jsonReportPath}" --format json`,
      {
        cwd: path.join(__dirname, '..', '..'),
        encoding: 'utf-8'
      }
    );

    // Verify JSON report file was created
    const jsonReportExists = await fs.access(jsonReportPath)
      .then(() => true)
      .catch(() => false);
    
    expect(jsonReportExists).toBe(true);

    // Verify JSON is valid
    const jsonContent = await fs.readFile(jsonReportPath, 'utf-8');
    const jsonData = JSON.parse(jsonContent);
    
    expect(jsonData).toHaveProperty('version');
    expect(jsonData).toHaveProperty('test_case');
    expect(jsonData).toHaveProperty('evaluators');
  }, 30000);

  it('should handle missing results file gracefully', async () => {
    const missingResultsPath = path.join(testWorkspaceDir, 'nonexistent.json');
    
    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(
        `node "${cliPath}" report --from "${missingResultsPath}"`,
        {
          cwd: path.join(__dirname, '..', '..'),
          encoding: 'utf-8'
        }
      );
    } catch (err) {
      error = err;
    }

    // Should fail with error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
  });

  it('should handle invalid JSON in results file', async () => {
    const invalidResultsPath = path.join(testWorkspaceDir, 'invalid-results.json');
    await fs.writeFile(invalidResultsPath, 'This is not valid JSON');
    
    // Build the CLI
    execSync('npm run build', { cwd: path.join(__dirname, '..', '..') });

    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');
    
    let error: any;
    try {
      execSync(
        `node "${cliPath}" report --from "${invalidResultsPath}"`,
        {
          cwd: path.join(__dirname, '..', '..'),
          encoding: 'utf-8'
        }
      );
    } catch (err) {
      error = err;
    }

    // Should fail with parsing error
    expect(error).toBeDefined();
    expect(error.status).toBe(1);
  });
});
