/**
 * Unit Tests: Path Utilities
 * 
 * Tests for path utility functions including workspace path generation
 * and workspace name sanitization.
 */

import * as path from 'path';
import {
  generateWorkspacePaths,
  sanitizeWorkspaceName,
} from '../../src/lib/path-utils';

// Helper to normalize path separators for cross-platform testing
const normalizePath = (p: string): string => p.replace(/[\\\\]/g, '/');

describe('Path Utilities', () => {
  describe('sanitizeWorkspaceName', () => {
    it('should return valid names unchanged', () => {
      expect(sanitizeWorkspaceName('test-name')).toBe('test-name');
      expect(sanitizeWorkspaceName('TestName123')).toBe('TestName123');
      expect(sanitizeWorkspaceName('test.name')).toBe('test.name');
      expect(sanitizeWorkspaceName('test_name')).toBe('test_name');
    });

    it('should replace spaces with hyphens', () => {
      expect(sanitizeWorkspaceName('test name')).toBe('test-name');
      expect(sanitizeWorkspaceName('test  multiple   spaces')).toBe('test-multiple-spaces');
    });

    it('should remove invalid characters', () => {
      expect(sanitizeWorkspaceName('test@name#123')).toBe('testname123');
      expect(sanitizeWorkspaceName('test/name\\path')).toBe('testnamepath');
      expect(sanitizeWorkspaceName('test:name*query')).toBe('testnamequery');
    });

    it('should remove leading non-alphanumeric characters', () => {
      expect(sanitizeWorkspaceName('-test')).toBe('test');
      expect(sanitizeWorkspaceName('_test')).toBe('test');
      expect(sanitizeWorkspaceName('.test')).toBe('test');
      expect(sanitizeWorkspaceName('---test')).toBe('test');
    });

    it('should handle names that become empty after sanitization', () => {
      expect(sanitizeWorkspaceName('!!!')).toBe('workspace');
      expect(sanitizeWorkspaceName('@#$%')).toBe('workspace');
      expect(sanitizeWorkspaceName('---')).toBe('workspace');
    });

    it('should truncate long names to 100 characters', () => {
      const longName = 'a'.repeat(150);
      expect(sanitizeWorkspaceName(longName)).toHaveLength(100);
    });

    it('should handle edge cases', () => {
      expect(sanitizeWorkspaceName('')).toBe('workspace');
      expect(sanitizeWorkspaceName('  ')).toBe('workspace');
    });
  });

  describe('generateWorkspacePaths', () => {
    const mockRoot = '/test/workspace';

    it('should generate default run-{timestamp} format when no runId or workspaceName provided', () => {
      const paths = generateWorkspacePaths(mockRoot);
      expect(normalizePath(paths.runDir)).toMatch(/^\/test\/workspace\/run-\d{4}-\d{2}-\d{2}-\d+$/);
    });

    it('should use explicit runId when provided', () => {
      const paths = generateWorkspacePaths(mockRoot, 'custom-run-id');
      expect(normalizePath(paths.runDir)).toBe('/test/workspace/custom-run-id');
    });

    it('should use workspaceName for human-readable folder names', () => {
      const paths = generateWorkspacePaths(mockRoot, undefined, 'my-test-case');
      expect(normalizePath(paths.runDir)).toMatch(/^\/test\/workspace\/my-test-case-\d{4}-\d{2}-\d{2}-\d+$/);
    });

    it('should sanitize workspaceName before using it', () => {
      const paths = generateWorkspacePaths(mockRoot, undefined, 'My Test Case!');
      expect(normalizePath(paths.runDir)).toMatch(/^\/test\/workspace\/My-Test-Case-\d{4}-\d{2}-\d{2}-\d+$/);
    });

    it('should prefer runId over workspaceName when both provided', () => {
      const paths = generateWorkspacePaths(mockRoot, 'explicit-id', 'workspace-name');
      expect(normalizePath(paths.runDir)).toBe('/test/workspace/explicit-id');
    });

    it('should generate all required paths correctly', () => {
      const paths = generateWorkspacePaths(mockRoot, 'test-run');
      
      expect(normalizePath(paths.root)).toBe('/test/workspace');
      expect(normalizePath(paths.runDir)).toBe('/test/workspace/test-run');
      expect(normalizePath(paths.modifiedDir)).toBe('/test/workspace/test-run/src-modified');
      expect(paths.expectedDir).toBeDefined();
      expect(normalizePath(paths.expectedDir as string)).toBe('/test/workspace/test-run/src-expected');
      expect(normalizePath(paths.artifactsDir)).toBe('/test/workspace/test-run/artifacts');
      expect(normalizePath(paths.evaluatorArtifactsDir)).toBe('/test/workspace/test-run/artifacts/evaluators');
      expect(normalizePath(paths.lockFile)).toBe('/test/workspace/test-run/.lock');
    });

    it('should use default workspace root when not provided', () => {
      const originalCwd = process.cwd();
      const paths = generateWorkspacePaths();
      
      expect(normalizePath(paths.root)).toBe(normalizePath(path.join(originalCwd, '.youbencha-workspace')));
    });

    it('should handle special characters in workspaceName', () => {
      const paths = generateWorkspacePaths(mockRoot, undefined, 'Add README comment');
      expect(paths.runDir).toMatch(/Add-README-comment/);
    });

    it('should handle workspaceName with multiple special chars', () => {
      const paths = generateWorkspacePaths(mockRoot, undefined, 'test@#$%case');
      expect(paths.runDir).toMatch(/testcase/);
    });
  });
});
