/**
 * Evaluator Loader
 * 
 * Utility for loading evaluator definitions from external YAML files.
 * Enables reusable evaluator configurations across multiple test cases.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { evaluatorDefinitionSchema, type EvaluatorDefinition } from '../schemas/evaluator-definition.schema.js';
import { type EvaluatorConfig } from '../schemas/testcase.schema.js';

/**
 * Resolved inline evaluator configuration (after file references have been loaded)
 */
export interface ResolvedEvaluatorConfig {
  name: string;
  config?: Record<string, any>;
}

/**
 * Load an evaluator definition from a YAML file
 * 
 * @param filePath - Path to the evaluator definition YAML file (relative or absolute)
 * @param baseDir - Base directory for resolving relative paths (typically the test case config file directory)
 * @returns Parsed and validated evaluator definition
 * @throws Error if file cannot be read or parsed
 */
export function loadEvaluatorDefinition(filePath: string, baseDir: string): EvaluatorDefinition {
  // Resolve the file path relative to the base directory
  const resolvedPath = resolve(baseDir, filePath);
  
  try {
    // Read the YAML file
    const fileContent = readFileSync(resolvedPath, 'utf-8');
    
    // Parse YAML
    const parsed = parseYaml(fileContent);
    
    // Validate against schema
    const validationResult = evaluatorDefinitionSchema.safeParse(parsed);
    
    if (!validationResult.success) {
      const errors = validationResult.error.errors
        .map(e => `${e.path.join('.')}: ${e.message}`)
        .join(', ');
      throw new Error(`Invalid evaluator definition in ${filePath}: ${errors}`);
    }
    
    return validationResult.data;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load evaluator definition from ${filePath}: ${error.message}`);
    }
    throw new Error(`Failed to load evaluator definition from ${filePath}: ${String(error)}`);
  }
}

/**
 * Resolve evaluator configurations by loading external file references
 * 
 * Takes an array of evaluator configs (which may include file references)
 * and resolves all file references to inline configurations.
 * 
 * @param evaluatorConfigs - Array of evaluator configurations (inline or file references)
 * @param baseDir - Base directory for resolving relative file paths
 * @returns Array of resolved evaluator configurations (all inline)
 */
export function resolveEvaluatorConfigs(
  evaluatorConfigs: EvaluatorConfig[],
  baseDir: string
): ResolvedEvaluatorConfig[] {
  return evaluatorConfigs.map(config => {
    // Check if this is a file reference
    if ('file' in config) {
      // Load the evaluator definition from file
      const definition = loadEvaluatorDefinition(config.file, baseDir);
      
      // Return as inline configuration
      return {
        name: definition.name,
        config: definition.config,
      };
    }
    
    // Already inline configuration, return as-is
    return {
      name: config.name,
      config: config.config,
    };
  });
}

/**
 * Check if an evaluator config is a file reference
 * 
 * @param config - Evaluator configuration to check
 * @returns True if the config is a file reference, false if inline
 */
export function isFileReference(config: EvaluatorConfig): config is { file: string } {
  return 'file' in config;
}
