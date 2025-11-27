import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import * as path from 'path';

describe('Integration: CLI Commands', () => {
  const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli', 'index.js');

  describe('Command name detection', () => {
    it('should support yb command with correct help text', () => {
      const output = execSync(`node ${cliPath} --help`, { encoding: 'utf-8' });
      
      // Should show "yb" in the usage line when called directly
      expect(output).toContain('Usage:');
      expect(output).toContain('youBencha - Evaluate and compare AI coding agents');
      
      // Should contain command examples
      expect(output).toContain('init');
      expect(output).toContain('run');
      expect(output).toContain('report');
      expect(output).toContain('list');
      expect(output).toContain('validate');
    });

    it('should show version correctly', () => {
      const output = execSync(`node ${cliPath} --version`, { encoding: 'utf-8' });
      expect(output).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should support init subcommand help', () => {
      const output = execSync(`node ${cliPath} init --help`, { encoding: 'utf-8' });
      expect(output).toContain('Create a starter testcase.yaml configuration');
      expect(output).toContain('Examples:');
      expect(output).toContain('init');
    });

    it('should support run subcommand help', () => {
      const output = execSync(`node ${cliPath} run --help`, { encoding: 'utf-8' });
      expect(output).toContain('Run a test case against an AI agent');
      expect(output).toContain('Examples:');
      expect(output).toContain('run -c testcase.yaml');
    });

    it('should support report subcommand help', () => {
      const output = execSync(`node ${cliPath} report --help`, { encoding: 'utf-8' });
      expect(output).toContain('Generate a human-readable report');
      expect(output).toContain('Examples:');
      expect(output).toContain('report --from');
    });

    it('should support list subcommand', () => {
      const output = execSync(`node ${cliPath} list`, { encoding: 'utf-8' });
      expect(output).toContain('Available Evaluators');
      expect(output).toContain('git-diff');
      expect(output).toContain('expected-diff');
      expect(output).toContain('agentic-judge');
    });

    it('should support validate subcommand help', () => {
      const output = execSync(`node ${cliPath} validate --help`, { encoding: 'utf-8' });
      expect(output).toContain('Validate a test case configuration without running it');
      expect(output).toContain('Examples:');
      expect(output).toContain('validate -c testcase.yaml');
    });
  });
});
