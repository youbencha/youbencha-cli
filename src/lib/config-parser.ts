/**
 * Configuration Parser
 * 
 * Utility for parsing configuration files in YAML or JSON format.
 * Automatically detects format based on file extension.
 */

import { parse as parseYaml } from 'yaml';

/**
 * Parse configuration file content from either YAML or JSON format
 * 
 * @param content - File content as string
 * @param filePath - Path to the file (used to determine format from extension)
 * @returns Parsed configuration object
 * @throws Error if parsing fails
 */
export function parseConfig(content: string, filePath: string): unknown {
  const extension = filePath.toLowerCase().split('.').pop();
  
  if (extension === 'json') {
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (extension === 'yaml' || extension === 'yml') {
    try {
      return parseYaml(content);
    } catch (error) {
      throw new Error(`Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    // Default to YAML for backward compatibility
    try {
      return parseYaml(content);
    } catch (error) {
      throw new Error(`Failed to parse configuration file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Get user-friendly tips for fixing common format errors
 * 
 * @param filePath - Path to the file
 * @returns Array of helpful tips based on file format
 */
export function getFormatTips(filePath: string): string[] {
  const extension = filePath.toLowerCase().split('.').pop();
  
  if (extension === 'json') {
    return [
      '- Ensure all property names are in double quotes',
      '- Check for trailing commas (not allowed in JSON)',
      '- Verify brackets and braces are properly matched',
      '- Validate JSON syntax at https://jsonlint.com',
    ];
  } else {
    return [
      '- Check indentation (use spaces, not tabs)',
      '- Ensure keys and values are properly formatted',
      '- Validate YAML syntax at https://yaml-online-parser.appspot.com',
    ];
  }
}
