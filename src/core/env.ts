/**
 * Environment detector module
 * 
 * Detects OS/platform, Node.js version, youBencha version, and captures timestamps
 * for reproducible evaluation context.
 */

import * as os from 'os';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Environment information
 */
export interface EnvironmentInfo {
  os: string;
  nodeVersion: string;
  youbenchaVersion: string;
  timestamp: string;
  workingDirectory: string;
}

/**
 * System information
 */
export interface SystemInfo {
  platform: string;
  arch: string;
  cpuCount: number;
  cpuModel: string;
  totalMemoryMB: number;
  freeMemoryMB: number;
  hostname: string;
}

/**
 * User information
 */
export interface UserInfo {
  username: string;
  homedir: string;
  shell?: string;
}

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
 * Class-based API for detecting environment information
 */
export class EnvironmentDetector {
  /**
   * Get environment information
   */
  getEnvironmentInfo(workingDirectory?: string): EnvironmentInfo {
    return {
      os: this.getOperatingSystem(),
      nodeVersion: this.getNodeVersion(),
      youbenchaVersion: this.getYouBenchaVersion(),
      timestamp: new Date().toISOString(),
      workingDirectory: workingDirectory || process.cwd(),
    };
  }

  /**
   * Get operating system string
   */
  getOperatingSystem(): string {
    const platform = os.platform();
    const release = os.release();
    
    // Capitalize platform name
    let platformName: string;
    switch (platform) {
      case 'darwin':
        platformName = 'macOS';
        break;
      case 'win32':
        platformName = 'Windows';
        break;
      case 'linux':
        platformName = 'Linux';
        break;
      default:
        platformName = platform;
        break;
    }
    
    return `${platformName} ${release}`;
  }

  /**
   * Get Node.js version
   */
  getNodeVersion(): string {
    return process.version;
  }

  /**
   * Get youBencha version
   */
  getYouBenchaVersion(): string {
    return getYouBenchaVersion();
  }

  /**
   * Get system information
   */
  getSystemInfo(): SystemInfo {
    const cpus = os.cpus();
    
    return {
      platform: os.platform(),
      arch: os.arch(),
      cpuCount: cpus.length,
      cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown',
      totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemoryMB: Math.round(os.freemem() / (1024 * 1024)),
      hostname: os.hostname(),
    };
  }

  /**
   * Get user information
   */
  getUserInfo(): UserInfo {
    const userInfo = os.userInfo();
    
    return {
      username: userInfo.username,
      homedir: userInfo.homedir,
      shell: userInfo.shell || undefined,
    };
  }

  /**
   * Get environment variables (filtered)
   */
  getEnvironmentVariables(): Record<string, string> {
    const sensitivePatterns = [
      /api[_-]?key/i,
      /token/i,
      /password/i,
      /secret/i,
      /auth/i,
    ];

    const filtered: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      
      // Skip sensitive variables
      const isSensitive = sensitivePatterns.some(pattern => pattern.test(key));
      if (isSensitive) continue;

      filtered[key] = value;
    }

    return filtered;
  }

  /**
   * Get full environment (all sections combined)
   */
  getFullEnvironment(workingDirectory?: string) {
    return {
      info: this.getEnvironmentInfo(workingDirectory),
      system: this.getSystemInfo(),
      user: this.getUserInfo(),
      env: this.getEnvironmentVariables(),
    };
  }

  /**
   * Format environment for youBencha Log schema
   */
  formatEnvironmentForLog(workingDirectory?: string) {
    const info = this.getEnvironmentInfo(workingDirectory);
    
    return {
      os: info.os,
      node_version: info.nodeVersion,
      youbencha_version: info.youbenchaVersion,
      working_directory: info.workingDirectory,
    };
  }
}

/**
 * Detect current environment context
 * 
 * @returns Environment context with OS, Node version, youBencha version, and timestamp
 */
export function detectEnvironment(): EnvironmentContext {
  return {
    os: os.platform(),
    arch: os.arch(),
    osVersion: os.release(),
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
