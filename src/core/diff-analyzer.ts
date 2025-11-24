/**
 * DiffAnalyzer - Analyzes differences between source and output folders
 * 
 * Supports both git repositories and plain directories.
 * Detects file changes, line changes, patterns, and provides metrics for suite generation.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { diffLines } from 'diff';

/**
 * Analysis result from comparing two folders
 */
export interface DiffAnalysis {
  source_path: string;
  output_path: string;
  is_git_repo: boolean;
  
  files: {
    added: string[];
    modified: string[];
    deleted: string[];
    renamed: Array<{
      from: string;
      to: string;
    }>;
  };
  
  lines: {
    added: number;
    removed: number;
    total_changed: number;
  };
  
  file_types: Record<string, number>;
  
  patterns: {
    tests_added: boolean;
    tests_modified: boolean;
    config_changed: boolean;
    dependencies_updated: boolean;
    docs_added: boolean;
    docs_modified: boolean;
    auth_patterns: boolean;
    api_changes: boolean;
  };
  
  density: {
    files_changed_ratio: number;
    lines_changed_ratio: number;
  };
}

/**
 * DiffAnalyzer implementation
 */
export class DiffAnalyzer {
  // Patterns to exclude from analysis
  private readonly EXCLUDE_PATTERNS = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.youbencha-workspace',
    '.DS_Store',
    'Thumbs.db'
  ];

  // Test file patterns
  private readonly TEST_PATTERNS = [
    /\.test\./i,
    /\.spec\./i,
    /__tests__/i,
    /\/tests?\//i
  ];

  // Config file patterns
  private readonly CONFIG_PATTERNS = [
    /\.json$/i,
    /\.yaml$/i,
    /\.yml$/i,
    /\.toml$/i,
    /\.ini$/i,
    /\.config\./i,
    /rc$/i
  ];

  // Documentation patterns
  private readonly DOC_PATTERNS = [
    /\.md$/i,
    /\/docs?\//i,
    /README/i,
    /CHANGELOG/i,
    /CONTRIBUTING/i
  ];

  // Auth/security patterns
  private readonly AUTH_PATTERNS = [
    /auth/i,
    /security/i,
    /token/i,
    /jwt/i,
    /password/i,
    /credential/i,
    /oauth/i
  ];

  // API patterns
  private readonly API_PATTERNS = [
    /\bapi\b/i,
    /endpoint/i,
    /route/i,
    /handler/i,
    /controller/i,
    /\/routes?\//i,
    /\/api\//i
  ];

  /**
   * Check if a path is a git repository
   */
  async isGitRepo(dirPath: string): Promise<boolean> {
    try {
      const gitPath = path.join(dirPath, '.git');
      const stats = await fs.stat(gitPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Detect file type distribution from file list
   */
  detectFileTypes(files: string[]): Record<string, number> {
    const types: Record<string, number> = {};

    for (const file of files) {
      const ext = path.extname(file) || '';
      types[ext] = (types[ext] || 0) + 1;
    }

    return types;
  }

  /**
   * Detect patterns in the analysis
   */
  detectPatterns(analysis: DiffAnalysis): DiffAnalysis['patterns'] {
    const allFiles = [
      ...analysis.files.added,
      ...analysis.files.modified,
      ...analysis.files.deleted
    ];

    return {
      tests_added: this.matchesAnyPattern(analysis.files.added, this.TEST_PATTERNS),
      tests_modified: this.matchesAnyPattern(analysis.files.modified, this.TEST_PATTERNS),
      config_changed: this.matchesAnyPattern(
        [...analysis.files.added, ...analysis.files.modified],
        this.CONFIG_PATTERNS
      ),
      dependencies_updated: this.hasDependencyChanges([
        ...analysis.files.added,
        ...analysis.files.modified
      ]),
      docs_added: this.matchesAnyPattern(analysis.files.added, this.DOC_PATTERNS),
      docs_modified: this.matchesAnyPattern(analysis.files.modified, this.DOC_PATTERNS),
      auth_patterns: this.matchesAnyPattern(allFiles, this.AUTH_PATTERNS),
      api_changes: this.matchesAnyPattern(allFiles, this.API_PATTERNS)
    };
  }

  /**
   * Analyze differences between source and output folders
   */
  async analyzeFolders(sourcePath: string, outputPath: string): Promise<DiffAnalysis> {
    // Validate directories exist
    await this.validateDirectory(sourcePath);
    await this.validateDirectory(outputPath);

    // Detect if output is a git repo
    const isGitRepo = await this.isGitRepo(outputPath);

    // Get file lists
    const sourceFiles = await this.getFileList(sourcePath);
    const outputFiles = await this.getFileList(outputPath);

    // Compute file changes
    const fileChanges = this.computeFileChanges(sourceFiles, outputFiles);

    // Compute line changes
    const lineChanges = await this.computeLineChanges(
      sourcePath,
      outputPath,
      fileChanges.modified
    );

    // Detect file types
    const fileTypes = this.detectFileTypes([
      ...fileChanges.added,
      ...fileChanges.modified
    ]);

    // Create initial analysis
    const analysis: DiffAnalysis = {
      source_path: sourcePath,
      output_path: outputPath,
      is_git_repo: isGitRepo,
      files: {
        added: fileChanges.added,
        modified: fileChanges.modified,
        deleted: fileChanges.deleted,
        renamed: []  // TODO: Implement rename detection
      },
      lines: {
        added: lineChanges.added,
        removed: lineChanges.removed,
        total_changed: lineChanges.added + lineChanges.removed
      },
      file_types: fileTypes,
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
        files_changed_ratio: 0,
        lines_changed_ratio: 0
      }
    };

    // Detect patterns
    analysis.patterns = this.detectPatterns(analysis);

    // Calculate density
    analysis.density = await this.calculateDensity(
      sourcePath,
      outputPath,
      analysis
    );

    return analysis;
  }

  /**
   * Validate that a directory exists and is readable
   */
  private async validateDirectory(dirPath: string): Promise<void> {
    try {
      const stats = await fs.stat(dirPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Directory not found: ${dirPath}`);
      }
      throw error;
    }
  }

  /**
   * Get list of files in directory recursively (excluding patterns)
   */
  private async getFileList(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    const shouldExclude = this.shouldExclude.bind(this);

    async function walk(currentPath: string, basePath: string): Promise<void> {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(basePath, fullPath);

        // Skip excluded patterns
        if (shouldExclude(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await walk(fullPath, basePath);
        } else if (entry.isFile()) {
          files.push(relativePath);
        }
      }
    }

    await walk(dirPath, dirPath);
    return files;
  }

  /**
   * Check if a path should be excluded from analysis
   */
  private shouldExclude(relativePath: string): boolean {
    return this.EXCLUDE_PATTERNS.some(pattern => 
      relativePath.includes(pattern)
    );
  }

  /**
   * Compute file-level changes
   */
  private computeFileChanges(
    sourceFiles: string[],
    outputFiles: string[]
  ): {
    added: string[];
    modified: string[];
    deleted: string[];
  } {
    const sourceSet = new Set(sourceFiles);
    const outputSet = new Set(outputFiles);

    const added = outputFiles.filter(f => !sourceSet.has(f));
    const deleted = sourceFiles.filter(f => !outputSet.has(f));
    const common = outputFiles.filter(f => sourceSet.has(f));

    return {
      added,
      modified: common,  // Will be refined by content comparison
      deleted
    };
  }

  /**
   * Compute line-level changes for modified files
   */
  private async computeLineChanges(
    sourcePath: string,
    outputPath: string,
    potentiallyModified: string[]
  ): Promise<{ added: number; removed: number }> {
    let totalAdded = 0;
    let totalRemoved = 0;

    // Check which files are actually modified
    for (const file of potentiallyModified) {
      const sourceFile = path.join(sourcePath, file);
      const outputFile = path.join(outputPath, file);

      try {
        const sourceContent = await fs.readFile(sourceFile, 'utf-8');
        const outputContent = await fs.readFile(outputFile, 'utf-8');

        if (sourceContent !== outputContent) {
          const diff = diffLines(sourceContent, outputContent);
          
          for (const part of diff) {
            if (part.added) {
              totalAdded += part.count || 0;
            } else if (part.removed) {
              totalRemoved += part.count || 0;
            }
          }
        }
      } catch {
        // Skip files that can't be read
        continue;
      }
    }

    // Also count added files
    const outputFiles = potentiallyModified.filter(f => {
      const sourceFile = path.join(sourcePath, f);
      try {
        void fs.access(sourceFile);
        return false;
      } catch {
        return true;
      }
    });

    for (const file of outputFiles) {
      try {
        const content = await fs.readFile(path.join(outputPath, file), 'utf-8');
        const lines = content.split('\n').length;
        totalAdded += lines;
      } catch {
        continue;
      }
    }

    return {
      added: totalAdded,
      removed: totalRemoved
    };
  }

  /**
   * Calculate change density ratios
   */
  private async calculateDensity(
    sourcePath: string,
    outputPath: string,
    analysis: DiffAnalysis
  ): Promise<{ files_changed_ratio: number; lines_changed_ratio: number }> {
    // Get total files
    const sourceFiles = await this.getFileList(sourcePath);
    const outputFiles = await this.getFileList(outputPath);
    const totalFiles = new Set([...sourceFiles, ...outputFiles]).size;

    const changedFiles = 
      analysis.files.added.length +
      analysis.files.modified.length +
      analysis.files.deleted.length;

    const filesRatio = totalFiles > 0 ? changedFiles / totalFiles : 0;

    // Calculate total lines (approximate)
    let totalLines = 0;
    for (const file of outputFiles) {
      try {
        const content = await fs.readFile(path.join(outputPath, file), 'utf-8');
        totalLines += content.split('\n').length;
      } catch {
        continue;
      }
    }

    const linesRatio = totalLines > 0 ? analysis.lines.total_changed / totalLines : 0;

    return {
      files_changed_ratio: Math.min(filesRatio, 1.0),
      lines_changed_ratio: Math.min(linesRatio, 1.0)
    };
  }

  /**
   * Check if any file matches any of the patterns
   */
  private matchesAnyPattern(files: string[], patterns: RegExp[]): boolean {
    return files.some(file => 
      patterns.some(pattern => pattern.test(file))
    );
  }

  /**
   * Check if dependency files have changed
   */
  private hasDependencyChanges(files: string[]): boolean {
    const depFiles = [
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'Gemfile',
      'Gemfile.lock',
      'requirements.txt',
      'Pipfile',
      'Pipfile.lock',
      'go.mod',
      'go.sum',
      'Cargo.toml',
      'Cargo.lock'
    ];

    return files.some(file => 
      depFiles.some(depFile => file.endsWith(depFile))
    );
  }
}
