/**
 * Unit tests for DiffAnalyzer
 * Tests folder comparison and pattern detection functionality
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DiffAnalyzer } from '../../src/core/diff-analyzer';

describe('DiffAnalyzer', () => {
  let analyzer: DiffAnalyzer;
  let tempDir: string;
  let sourceDir: string;
  let outputDir: string;

  beforeEach(async () => {
    analyzer = new DiffAnalyzer();
    
    // Create temporary test directories
    tempDir = path.join(process.cwd(), '.test-temp', `diff-test-${Date.now()}`);
    sourceDir = path.join(tempDir, 'source');
    outputDir = path.join(tempDir, 'output');
    
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directories
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('isGitRepo', () => {
    test('returns true for git repository', async () => {
      // Create .git directory
      await fs.mkdir(path.join(sourceDir, '.git'));
      
      const result = await analyzer.isGitRepo(sourceDir);
      expect(result).toBe(true);
    });

    test('returns false for non-git directory', async () => {
      const result = await analyzer.isGitRepo(sourceDir);
      expect(result).toBe(false);
    });

    test('returns false for non-existent directory', async () => {
      const result = await analyzer.isGitRepo('/non/existent/path');
      expect(result).toBe(false);
    });
  });

  describe('detectFileTypes', () => {
    test('correctly counts file extensions', () => {
      const files = [
        'src/index.ts',
        'src/utils.ts',
        'src/helper.js',
        'README.md',
        'docs/guide.md',
        'config.json'
      ];

      const result = analyzer.detectFileTypes(files);

      expect(result).toEqual({
        '.ts': 2,
        '.js': 1,
        '.md': 2,
        '.json': 1
      });
    });

    test('handles files without extensions', () => {
      const files = ['Makefile', 'Dockerfile', 'LICENSE'];

      const result = analyzer.detectFileTypes(files);

      expect(result).toEqual({
        '': 3
      });
    });

    test('handles empty array', () => {
      const result = analyzer.detectFileTypes([]);
      expect(result).toEqual({});
    });
  });

  describe('detectPatterns', () => {
    test('detects test files added', () => {
      const analysis = {
        source_path: sourceDir,
        output_path: outputDir,
        is_git_repo: false,
        files: {
          added: ['tests/auth.test.ts', 'src/utils.spec.js'],
          modified: [],
          deleted: [],
          renamed: []
        },
        lines: {
          added: 100,
          removed: 0,
          total_changed: 100
        },
        file_types: { '.ts': 1, '.js': 1 },
        patterns: {
          tests_added: false,
          tests_modified: false,
          config_changed: false,
          dependencies_updated: false,
          docs_added: false,
          docs_modified: false,
          auth_patterns: false,
          api_changes: false
        },
        density: {
          files_changed_ratio: 0.5,
          lines_changed_ratio: 0.3
        }
      };

      const result = analyzer.detectPatterns(analysis);

      expect(result.tests_added).toBe(true);
      expect(result.tests_modified).toBe(false);
    });

    test('detects test files modified', () => {
      const analysis = {
        source_path: sourceDir,
        output_path: outputDir,
        is_git_repo: false,
        files: {
          added: [],
          modified: ['__tests__/integration.test.ts'],
          deleted: [],
          renamed: []
        },
        lines: {
          added: 50,
          removed: 20,
          total_changed: 70
        },
        file_types: { '.ts': 1 },
        patterns: {
          tests_added: false,
          tests_modified: false,
          config_changed: false,
          dependencies_updated: false,
          docs_added: false,
          docs_modified: false,
          auth_patterns: false,
          api_changes: false
        },
        density: {
          files_changed_ratio: 0.2,
          lines_changed_ratio: 0.1
        }
      };

      const result = analyzer.detectPatterns(analysis);

      expect(result.tests_modified).toBe(true);
      expect(result.tests_added).toBe(false);
    });

    test('detects config changes', () => {
      const analysis = {
        source_path: sourceDir,
        output_path: outputDir,
        is_git_repo: false,
        files: {
          added: [],
          modified: ['package.json', 'tsconfig.json', '.eslintrc.yaml'],
          deleted: [],
          renamed: []
        },
        lines: {
          added: 10,
          removed: 5,
          total_changed: 15
        },
        file_types: { '.json': 2, '.yaml': 1 },
        patterns: {
          tests_added: false,
          tests_modified: false,
          config_changed: false,
          dependencies_updated: false,
          docs_added: false,
          docs_modified: false,
          auth_patterns: false,
          api_changes: false
        },
        density: {
          files_changed_ratio: 0.3,
          lines_changed_ratio: 0.05
        }
      };

      const result = analyzer.detectPatterns(analysis);

      expect(result.config_changed).toBe(true);
    });

    test('detects dependencies updated', () => {
      const analysis = {
        source_path: sourceDir,
        output_path: outputDir,
        is_git_repo: false,
        files: {
          added: [],
          modified: ['package.json', 'package-lock.json'],
          deleted: [],
          renamed: []
        },
        lines: {
          added: 50,
          removed: 10,
          total_changed: 60
        },
        file_types: { '.json': 2 },
        patterns: {
          tests_added: false,
          tests_modified: false,
          config_changed: false,
          dependencies_updated: false,
          docs_added: false,
          docs_modified: false,
          auth_patterns: false,
          api_changes: false
        },
        density: {
          files_changed_ratio: 0.1,
          lines_changed_ratio: 0.05
        }
      };

      const result = analyzer.detectPatterns(analysis);

      expect(result.dependencies_updated).toBe(true);
    });

    test('detects documentation added', () => {
      const analysis = {
        source_path: sourceDir,
        output_path: outputDir,
        is_git_repo: false,
        files: {
          added: ['README.md', 'docs/api-guide.md'],
          modified: [],
          deleted: [],
          renamed: []
        },
        lines: {
          added: 200,
          removed: 0,
          total_changed: 200
        },
        file_types: { '.md': 2 },
        patterns: {
          tests_added: false,
          tests_modified: false,
          config_changed: false,
          dependencies_updated: false,
          docs_added: false,
          docs_modified: false,
          auth_patterns: false,
          api_changes: false
        },
        density: {
          files_changed_ratio: 0.2,
          lines_changed_ratio: 0.1
        }
      };

      const result = analyzer.detectPatterns(analysis);

      expect(result.docs_added).toBe(true);
      expect(result.docs_modified).toBe(false);
    });

    test('detects documentation modified', () => {
      const analysis = {
        source_path: sourceDir,
        output_path: outputDir,
        is_git_repo: false,
        files: {
          added: [],
          modified: ['docs/README.md'],
          deleted: [],
          renamed: []
        },
        lines: {
          added: 50,
          removed: 20,
          total_changed: 70
        },
        file_types: { '.md': 1 },
        patterns: {
          tests_added: false,
          tests_modified: false,
          config_changed: false,
          dependencies_updated: false,
          docs_added: false,
          docs_modified: false,
          auth_patterns: false,
          api_changes: false
        },
        density: {
          files_changed_ratio: 0.05,
          lines_changed_ratio: 0.02
        }
      };

      const result = analyzer.detectPatterns(analysis);

      expect(result.docs_modified).toBe(true);
      expect(result.docs_added).toBe(false);
    });

    test('detects authentication patterns', () => {
      const analysis = {
        source_path: sourceDir,
        output_path: outputDir,
        is_git_repo: false,
        files: {
          added: ['src/middleware/auth.ts', 'src/utils/jwt-token.ts'],
          modified: ['src/security/validate.ts'],
          deleted: [],
          renamed: []
        },
        lines: {
          added: 300,
          removed: 50,
          total_changed: 350
        },
        file_types: { '.ts': 3 },
        patterns: {
          tests_added: false,
          tests_modified: false,
          config_changed: false,
          dependencies_updated: false,
          docs_added: false,
          docs_modified: false,
          auth_patterns: false,
          api_changes: false
        },
        density: {
          files_changed_ratio: 0.3,
          lines_changed_ratio: 0.2
        }
      };

      const result = analyzer.detectPatterns(analysis);

      expect(result.auth_patterns).toBe(true);
    });

    test('detects API changes', () => {
      const analysis = {
        source_path: sourceDir,
        output_path: outputDir,
        is_git_repo: false,
        files: {
          added: ['src/api/users.ts', 'src/routes/handler.ts'],
          modified: ['src/endpoints/posts.ts'],
          deleted: [],
          renamed: []
        },
        lines: {
          added: 400,
          removed: 100,
          total_changed: 500
        },
        file_types: { '.ts': 3 },
        patterns: {
          tests_added: false,
          tests_modified: false,
          config_changed: false,
          dependencies_updated: false,
          docs_added: false,
          docs_modified: false,
          auth_patterns: false,
          api_changes: false
        },
        density: {
          files_changed_ratio: 0.4,
          lines_changed_ratio: 0.3
        }
      };

      const result = analyzer.detectPatterns(analysis);

      expect(result.api_changes).toBe(true);
    });

    test('detects multiple patterns simultaneously', () => {
      const analysis = {
        source_path: sourceDir,
        output_path: outputDir,
        is_git_repo: false,
        files: {
          added: [
            'src/auth/jwt.ts',
            'tests/auth.test.ts',
            'docs/auth-guide.md'
          ],
          modified: ['package.json'],
          deleted: [],
          renamed: []
        },
        lines: {
          added: 500,
          removed: 10,
          total_changed: 510
        },
        file_types: { '.ts': 2, '.md': 1, '.json': 1 },
        patterns: {
          tests_added: false,
          tests_modified: false,
          config_changed: false,
          dependencies_updated: false,
          docs_added: false,
          docs_modified: false,
          auth_patterns: false,
          api_changes: false
        },
        density: {
          files_changed_ratio: 0.5,
          lines_changed_ratio: 0.4
        }
      };

      const result = analyzer.detectPatterns(analysis);

      expect(result.auth_patterns).toBe(true);
      expect(result.tests_added).toBe(true);
      expect(result.docs_added).toBe(true);
      expect(result.config_changed).toBe(true);
    });
  });

  describe('analyzeFolders', () => {
    test('detects added files', async () => {
      // Create files only in output
      await fs.writeFile(path.join(outputDir, 'new-file.ts'), 'content');
      await fs.writeFile(path.join(outputDir, 'another.js'), 'content');

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(result.files.added).toContain('new-file.ts');
      expect(result.files.added).toContain('another.js');
      expect(result.files.added.length).toBe(2);
    });

    test('detects modified files', async () => {
      // Create same file with different content
      await fs.writeFile(path.join(sourceDir, 'file.ts'), 'original content');
      await fs.writeFile(path.join(outputDir, 'file.ts'), 'modified content');

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(result.files.modified).toContain('file.ts');
      expect(result.files.added.length).toBe(0);
      expect(result.files.deleted.length).toBe(0);
    });

    test('detects deleted files', async () => {
      // Create file only in source
      await fs.writeFile(path.join(sourceDir, 'removed.ts'), 'content');

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(result.files.deleted).toContain('removed.ts');
    });

    test('calculates line changes', async () => {
      await fs.writeFile(path.join(sourceDir, 'file.ts'), 'line1\nline2\nline3');
      await fs.writeFile(path.join(outputDir, 'file.ts'), 'line1\nmodified\nline3\nline4');

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(result.lines.added).toBeGreaterThan(0);
      expect(result.lines.removed).toBeGreaterThan(0);
      expect(result.lines.total_changed).toBe(result.lines.added + result.lines.removed);
    });

    test('detects file types distribution', async () => {
      await fs.writeFile(path.join(outputDir, 'file1.ts'), 'content');
      await fs.writeFile(path.join(outputDir, 'file2.ts'), 'content');
      await fs.writeFile(path.join(outputDir, 'file3.js'), 'content');
      await fs.writeFile(path.join(outputDir, 'README.md'), 'content');

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(result.file_types['.ts']).toBe(2);
      expect(result.file_types['.js']).toBe(1);
      expect(result.file_types['.md']).toBe(1);
    });

    test('calculates change density ratios', async () => {
      // Create baseline files
      await fs.writeFile(path.join(sourceDir, 'file1.ts'), 'a\nb\nc\nd\ne');
      await fs.writeFile(path.join(sourceDir, 'file2.ts'), 'x\ny\nz');
      
      // Modify one file
      await fs.writeFile(path.join(outputDir, 'file1.ts'), 'a\nmodified\nc\nd\ne');
      await fs.writeFile(path.join(outputDir, 'file2.ts'), 'x\ny\nz');

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(result.density.files_changed_ratio).toBeGreaterThan(0);
      expect(result.density.files_changed_ratio).toBeLessThanOrEqual(1);
      expect(result.density.lines_changed_ratio).toBeGreaterThan(0);
      expect(result.density.lines_changed_ratio).toBeLessThanOrEqual(1);
    });

    test('detects patterns in analyzed folders', async () => {
      // Create test files
      await fs.mkdir(path.join(outputDir, 'src'), { recursive: true });
      await fs.mkdir(path.join(outputDir, 'tests'), { recursive: true });
      await fs.writeFile(path.join(outputDir, 'src', 'auth.ts'), 'auth code');
      await fs.writeFile(path.join(outputDir, 'tests', 'auth.test.ts'), 'test code');
      await fs.writeFile(path.join(outputDir, 'README.md'), 'docs');

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(result.patterns.auth_patterns).toBe(true);
      expect(result.patterns.tests_added).toBe(true);
      expect(result.patterns.docs_added).toBe(true);
    });

    test('handles nested directories', async () => {
      // Create nested structure
      await fs.mkdir(path.join(outputDir, 'src', 'api'), { recursive: true });
      await fs.writeFile(path.join(outputDir, 'src', 'api', 'handler.ts'), 'content');

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      // Normalize path for cross-platform compatibility
      const expectedPath = path.join('src', 'api', 'handler.ts');
      expect(result.files.added).toContain(expectedPath);
    });

    test('throws error for non-existent source directory', async () => {
      await expect(
        analyzer.analyzeFolders('/non/existent/source', outputDir)
      ).rejects.toThrow();
    });

    test('throws error for non-existent output directory', async () => {
      await expect(
        analyzer.analyzeFolders(sourceDir, '/non/existent/output')
      ).rejects.toThrow();
    });

    test('correctly identifies git repository', async () => {
      await fs.mkdir(path.join(outputDir, '.git'));

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(result.is_git_repo).toBe(true);
    });

    test('correctly identifies non-git directory', async () => {
      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(result.is_git_repo).toBe(false);
    });

    test('ignores common excluded patterns', async () => {
      // Create files that should be ignored
      await fs.mkdir(path.join(outputDir, 'node_modules'), { recursive: true });
      await fs.writeFile(path.join(outputDir, 'node_modules', 'pkg.js'), 'content');
      await fs.mkdir(path.join(outputDir, '.git'), { recursive: true });
      await fs.writeFile(path.join(outputDir, '.git', 'config'), 'content');
      
      // Create file that should NOT be ignored
      await fs.writeFile(path.join(outputDir, 'src.ts'), 'content');

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      // Should only count the actual source file
      expect(result.files.added).toContain('src.ts');
      expect(result.files.added).not.toContain('node_modules/pkg.js');
      expect(result.files.added).not.toContain('.git/config');
    });

    test('handles empty directories', async () => {
      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      expect(result.files.added).toEqual([]);
      expect(result.files.modified).toEqual([]);
      expect(result.files.deleted).toEqual([]);
      expect(result.lines.added).toBe(0);
      expect(result.lines.removed).toBe(0);
    });

    test('returns valid DiffAnalysis structure', async () => {
      await fs.writeFile(path.join(outputDir, 'file.ts'), 'content');

      const result = await analyzer.analyzeFolders(sourceDir, outputDir);

      // Verify structure matches DiffAnalysis interface
      expect(result).toHaveProperty('source_path');
      expect(result).toHaveProperty('output_path');
      expect(result).toHaveProperty('is_git_repo');
      expect(result).toHaveProperty('files');
      expect(result.files).toHaveProperty('added');
      expect(result.files).toHaveProperty('modified');
      expect(result.files).toHaveProperty('deleted');
      expect(result.files).toHaveProperty('renamed');
      expect(result).toHaveProperty('lines');
      expect(result.lines).toHaveProperty('added');
      expect(result.lines).toHaveProperty('removed');
      expect(result.lines).toHaveProperty('total_changed');
      expect(result).toHaveProperty('file_types');
      expect(result).toHaveProperty('patterns');
      expect(result).toHaveProperty('density');
    });
  });
});
