/**
 * Storage Manager
 * 
 * Handles saving youBencha Logs, results bundles, and artifacts to the filesystem.
 * Manages artifact directory structure and manifest generation.
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import type { YouBenchaLog, ResultsBundle } from '../schemas/index.js';

/**
 * Save youBencha Log to artifacts directory
 * 
 * @param log - youBencha Log object to save
 * @param artifactsDir - Path to artifacts directory
 * @returns Path to saved file
 */
export async function saveYouBenchaLog(
  log: YouBenchaLog,
  artifactsDir: string
): Promise<string> {
  await ensureArtifactsDirectory(artifactsDir);

  const filePath = join(artifactsDir, 'youbencha.log.json');
  const content = JSON.stringify(log, null, 2);

  writeFileSync(filePath, content, 'utf-8');

  return filePath;
}

/**
 * Save results bundle to artifacts directory
 * 
 * @param bundle - Results bundle object to save
 * @param artifactsDir - Path to artifacts directory
 * @returns Path to saved file
 */
export async function saveResultsBundle(
  bundle: ResultsBundle,
  artifactsDir: string
): Promise<string> {
  await ensureArtifactsDirectory(artifactsDir);

  const filePath = join(artifactsDir, 'results.json');
  const content = JSON.stringify(bundle, null, 2);

  writeFileSync(filePath, content, 'utf-8');

  return filePath;
}

/**
 * Save an artifact file to artifacts directory
 * 
 * Supports nested paths (e.g., 'evaluators/git-diff.patch')
 * 
 * @param content - File content to save
 * @param filename - Filename or relative path within artifacts directory
 * @param artifactsDir - Path to artifacts directory
 * @returns Path to saved file
 */
export async function saveArtifact(
  content: string,
  filename: string,
  artifactsDir: string
): Promise<string> {
  const filePath = join(artifactsDir, filename);

  // Ensure parent directory exists
  const parentDir = dirname(filePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(filePath, content, 'utf-8');

  return filePath;
}

/**
 * Get manifest of all artifacts in directory
 * 
 * Returns list of relative file paths within artifacts directory.
 * Excludes directories (only includes files).
 * 
 * @param artifactsDir - Path to artifacts directory
 * @returns Array of relative file paths
 */
export async function getArtifactManifest(artifactsDir: string): Promise<string[]> {
  if (!existsSync(artifactsDir)) {
    return [];
  }

  const files: string[] = [];

  function scanDirectory(currentDir: string, relativePath: string = '') {
    const entries = readdirSync(currentDir);

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const relPath = relativePath ? join(relativePath, entry) : entry;

      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        // Recursively scan subdirectories
        scanDirectory(fullPath, relPath);
      } else if (stats.isFile()) {
        // Add file to manifest
        files.push(relPath);
      }
    }
  }

  scanDirectory(artifactsDir);

  return files.sort(); // Sort for consistent ordering
}

/**
 * Ensure artifacts directory exists
 * 
 * Creates directory if it doesn't exist, including parent directories.
 * 
 * @param artifactsDir - Path to artifacts directory
 */
export async function ensureArtifactsDirectory(artifactsDir: string): Promise<void> {
  if (!existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true });
  }
}

/**
 * Get relative path for artifact
 * 
 * Converts absolute artifact path to relative path within artifacts directory.
 * Useful for storing artifact references in results bundle.
 * 
 * @param artifactPath - Absolute path to artifact
 * @param artifactsDir - Path to artifacts directory
 * @returns Relative path from artifacts directory
 */
export function getRelativeArtifactPath(
  artifactPath: string,
  artifactsDir: string
): string {
  return relative(artifactsDir, artifactPath);
}
