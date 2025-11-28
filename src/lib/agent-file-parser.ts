/**
 * Agent File Parser
 * 
 * Parses Claude Code agent definition files (.md with YAML frontmatter)
 * into the JSON format expected by the --agents CLI flag.
 * 
 * Agent files follow this format:
 * ---
 * name: agent-name
 * description: Description of the agent
 * tools: tool1, tool2, tool3  # Optional, comma-separated
 * model: sonnet  # Optional
 * permissionMode: default  # Optional
 * skills: skill1, skill2  # Optional, comma-separated
 * ---
 * 
 * System prompt content goes here...
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Agent definition as expected by the --agents CLI flag
 */
export interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

/**
 * Parsed agent file frontmatter
 */
interface AgentFrontmatter {
  name: string;
  description: string;
  tools?: string | string[];
  model?: string;
  permissionMode?: string;
  skills?: string | string[];
}

/**
 * Error thrown when agent file parsing fails
 */
export class AgentFileParseError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AgentFileParseError';
  }
}

/**
 * Parse a comma-separated string into an array of trimmed strings
 * Also handles arrays (for when tools are already in array format in the YAML)
 */
function parseCommaSeparatedList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(item => item.length > 0);
  }
  
  if (typeof value !== 'string') {
    return undefined;
  }
  
  const items = value.split(',').map(item => item.trim()).filter(item => item.length > 0);
  return items.length > 0 ? items : undefined;
}

/**
 * Parse YAML frontmatter from a markdown file
 * Simple parser that handles the subset of YAML used in agent files
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  // Check for frontmatter delimiters
  const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterPattern);
  
  if (!match) {
    throw new Error('File does not contain valid YAML frontmatter. Expected format: ---\\n(yaml content)\\n---\\n(body)');
  }
  
  const yamlContent = match[1];
  const body = match[2].trim();
  
  // Parse YAML content (simple key: value parser)
  const frontmatter: Record<string, unknown> = {};
  const lines = yamlContent.split(/\r?\n/);
  
  let currentKey: string | null = null;
  let currentArrayItems: string[] = [];
  let isInArray = false;
  
  for (const rawLine of lines) {
    // Skip empty lines within arrays
    if (isInArray && rawLine.trim() === '') {
      continue;
    }
    
    // Check for array item (starts with whitespace + -)
    const arrayItemMatch = rawLine.match(/^\s+-\s*(.+)$/);
    if (arrayItemMatch && isInArray && currentKey) {
      currentArrayItems.push(arrayItemMatch[1].trim());
      continue;
    }
    
    // If we were building an array and hit a non-array line, save it
    if (isInArray && currentKey && !arrayItemMatch) {
      frontmatter[currentKey] = currentArrayItems;
      currentArrayItems = [];
      isInArray = false;
      currentKey = null;
    }
    
    // Skip empty lines
    if (rawLine.trim() === '') {
      continue;
    }
    
    // Skip comments
    if (rawLine.trim().startsWith('#')) {
      continue;
    }
    
    // Parse key: value
    const keyValueMatch = rawLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (keyValueMatch) {
      const key = keyValueMatch[1];
      let value = keyValueMatch[2].trim();
      
      // Remove inline comments
      const commentIndex = value.indexOf('#');
      if (commentIndex > 0) {
        value = value.substring(0, commentIndex).trim();
      }
      
      // Check if this starts an array (empty value followed by array items)
      if (value === '') {
        // Check if next non-empty line is an array item
        currentKey = key;
        isInArray = true;
        currentArrayItems = [];
        continue;
      }
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      frontmatter[key] = value;
    }
  }
  
  // Handle trailing array
  if (isInArray && currentKey) {
    frontmatter[currentKey] = currentArrayItems;
  }
  
  return { frontmatter, body };
}

/**
 * Validate and extract agent frontmatter
 */
function validateFrontmatter(frontmatter: Record<string, unknown>, filePath: string): AgentFrontmatter {
  // Validate required fields
  if (!frontmatter.name && !frontmatter.description) {
    throw new AgentFileParseError(
      'Agent file must contain at least "name" or "description" in frontmatter',
      filePath
    );
  }
  
  // description is required for the --agents JSON format
  if (!frontmatter.description) {
    throw new AgentFileParseError(
      'Agent file must contain "description" in frontmatter (required by --agents CLI flag)',
      filePath
    );
  }
  
  if (typeof frontmatter.description !== 'string') {
    throw new AgentFileParseError(
      '"description" must be a string',
      filePath
    );
  }
  
  // Validate name if present
  if (frontmatter.name !== undefined && typeof frontmatter.name !== 'string') {
    throw new AgentFileParseError(
      '"name" must be a string',
      filePath
    );
  }
  
  // Validate model if present
  if (frontmatter.model !== undefined && typeof frontmatter.model !== 'string') {
    throw new AgentFileParseError(
      '"model" must be a string (e.g., "sonnet", "opus", "haiku", or "inherit")',
      filePath
    );
  }
  
  // Validate tools if present
  if (frontmatter.tools !== undefined) {
    if (typeof frontmatter.tools !== 'string' && !Array.isArray(frontmatter.tools)) {
      throw new AgentFileParseError(
        '"tools" must be a comma-separated string or array (e.g., "Read, Edit, Bash" or [Read, Edit, Bash])',
        filePath
      );
    }
  }
  
  return frontmatter as unknown as AgentFrontmatter;
}

/**
 * Parse an agent file and return the JSON definition expected by --agents
 * 
 * @param filePath - Path to the agent file (.md with YAML frontmatter)
 * @returns Object with agent name as key and definition as value
 * @throws AgentFileParseError if the file format is invalid
 */
export function parseAgentFile(filePath: string): Record<string, AgentDefinition> {
  if (!existsSync(filePath)) {
    throw new AgentFileParseError(
      `Agent file not found: ${filePath}`,
      filePath
    );
  }
  
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new AgentFileParseError(
      `Failed to read agent file: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
      error
    );
  }
  
  // Parse frontmatter and body
  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try {
    parsed = parseFrontmatter(content);
  } catch (error) {
    throw new AgentFileParseError(
      `Failed to parse frontmatter: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
      error
    );
  }
  
  // Validate frontmatter
  const frontmatter = validateFrontmatter(parsed.frontmatter, filePath);
  
  // The body is the system prompt
  const systemPrompt = parsed.body;
  if (!systemPrompt) {
    throw new AgentFileParseError(
      'Agent file must contain a system prompt after the frontmatter',
      filePath
    );
  }
  
  // Build the agent definition
  const definition: AgentDefinition = {
    description: frontmatter.description,
    prompt: systemPrompt,
  };
  
  // Add optional fields
  const tools = parseCommaSeparatedList(frontmatter.tools);
  if (tools) {
    definition.tools = tools;
  }
  
  if (frontmatter.model) {
    definition.model = frontmatter.model;
  }
  
  // Use the name from frontmatter, or derive from filename
  const agentName = frontmatter.name || filePath.split(/[/\\]/).pop()?.replace(/\.(agent\.)?md$/, '') || 'unknown';
  
  return {
    [agentName]: definition,
  };
}

/**
 * Load an agent by name from the standard agent directories
 * 
 * Search order (highest priority first):
 * 1. workspaceDir/.claude/agents/
 * 2. cwd/.claude/agents/
 * 3. ~/.claude/agents/
 * 
 * @param agentName - Name of the agent (without .md extension)
 * @param workspaceDir - Optional workspace directory to search first
 * @returns Object with agent name as key and definition as value
 * @throws AgentFileParseError if the agent file is not found or invalid
 */
export function loadAgentByName(
  agentName: string,
  workspaceDir?: string
): Record<string, AgentDefinition> {
  const searchPaths: string[] = [];
  
  // Add workspace directory paths first (highest priority)
  if (workspaceDir) {
    searchPaths.push(
      join(workspaceDir, '.claude', 'agents', `${agentName}.md`),
      join(workspaceDir, '.claude', 'agents', `${agentName}.agent.md`)
    );
  }
  
  // Add current working directory paths
  const cwd = process.cwd();
  if (!workspaceDir || workspaceDir !== cwd) {
    searchPaths.push(
      join(cwd, '.claude', 'agents', `${agentName}.md`),
      join(cwd, '.claude', 'agents', `${agentName}.agent.md`)
    );
  }
  
  // Add user home directory paths (lowest priority)
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    searchPaths.push(
      join(homeDir, '.claude', 'agents', `${agentName}.md`),
      join(homeDir, '.claude', 'agents', `${agentName}.agent.md`)
    );
  }
  
  // Try each path
  for (const filePath of searchPaths) {
    if (existsSync(filePath)) {
      return parseAgentFile(filePath);
    }
  }
  
  // Agent not found
  throw new AgentFileParseError(
    `Agent "${agentName}" not found. Searched in:\n${searchPaths.map(p => `  - ${p}`).join('\n')}`,
    agentName
  );
}

/**
 * Convert an agent definition object to the JSON string expected by --agents
 * 
 * @param agentDefinition - Object with agent name as key and definition as value
 * @returns JSON string for the --agents CLI flag
 */
export function agentDefinitionToJson(agentDefinition: Record<string, AgentDefinition>): string {
  return JSON.stringify(agentDefinition);
}
