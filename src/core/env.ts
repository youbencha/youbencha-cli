/**
 * Environment detector module
 * 
 * Detects OS/platform, Node.js version, youBencha version, and captures timestamps
 * for reproducible evaluation context.
 */

import { platform, arch, release } from 'os';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Environment context captured during evaluation
 */
export interface EnvironmentContext {
  /** Operating system (e.g., 'darwin', 'linux', 'win32') */
  os: string;
  
  /** CPU architecture (e.g., 'x64', 'arm64') */
  arch: string;
  
  /** OS release version */
  osVersion: string;
  
  /** Node.js version (e.g., '20.10.0') */
  nodeVersion: string;
  
  /** youBencha CLI version from package.json */
  youbenchaVersion: string;
  
  /** Timestamp when environment was captured (ISO 8601) */
  capturedAt: string;
}

/**
 * Detect current environment context
 * 
 * @returns Environment context with OS, Node version, youBencha version, and timestamp
 */
export function detectEnvironment(): EnvironmentContext {
  return {
    os: platform(),
    arch: arch(),
    osVersion: release(),
    nodeVersion: process.version.replace(/^v/, ''), // Remove 'v' prefix
    youbenchaVersion: getYouBenchaVersion(),
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Get youBencha version from package.json
 * 
 * @returns Version string (e.g., '0.1.0')
 */
function getYouBenchaVersion(): string {
  try {
    // Try multiple paths to find package.json
    const possiblePaths = [
      // From src/core/env.ts
      join(process.cwd(), 'package.json'),
      // From dist/core/env.js (when compiled)
      join(process.cwd(), '..', '..', 'package.json'),
    ];
    
    for (const packageJsonPath of possiblePaths) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        if (packageJson.version) {
          return packageJson.version;
        }
      } catch {
        // Try next path
        continue;
      }
    }
    
    return '0.0.0';
  } catch (error) {
    // Fallback if package.json cannot be read
    return '0.0.0';
  }
}

/**
 * Format environment context for display
 * 
 * @param env - Environment context
 * @returns Human-readable string representation
 */
export function formatEnvironment(env: EnvironmentContext): string {
  return [
    `OS: ${env.os} ${env.osVersion} (${env.arch})`,
    `Node.js: v${env.nodeVersion}`,
    `youBencha: v${env.youbenchaVersion}`,
    `Captured: ${env.capturedAt}`,
  ].join('\n');
}

/**
 * Create environment object for youBencha Log schema
 * 
 * @param workingDirectory - Current working directory path
 * @returns Environment object conforming to youBencha Log schema
 */
export function createLogEnvironment(workingDirectory: string): {
  os: string;
  node_version: string;
  youbencha_version: string;
  working_directory: string;
} {
  const env = detectEnvironment();
  
  return {
    os: `${env.os} ${env.osVersion}`,
    node_version: env.nodeVersion,
    youbencha_version: env.youbenchaVersion,
    working_directory: workingDirectory,
  };
}
