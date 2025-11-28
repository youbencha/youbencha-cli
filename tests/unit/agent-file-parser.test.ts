/**
 * Agent File Parser Tests
 * 
 * Tests for parsing Claude Code agent definition files (.md with YAML frontmatter)
 * into the JSON format expected by the --agents CLI flag.
 */

import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import {
  parseAgentFile,
  loadAgentByName,
  agentDefinitionToJson,
  AgentFileParseError,
} from '../../src/lib/agent-file-parser.js';

describe('agent-file-parser', () => {
  const testDir = join(process.cwd(), '.test-agents');
  const agentsDir = join(testDir, '.claude', 'agents');

  beforeAll(() => {
    // Create test directories
    mkdirSync(agentsDir, { recursive: true });
  });

  afterAll(() => {
    // Clean up test directories
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('parseAgentFile', () => {
    it('should parse a valid agent file with all fields', () => {
      const filePath = join(agentsDir, 'complete-agent.md');
      const content = `---
name: complete-agent
description: A complete test agent with all fields
tools: Read, Edit, Bash
model: sonnet
---

You are a test agent. Follow all instructions carefully.

This is the system prompt that guides the agent's behavior.`;

      writeFileSync(filePath, content, 'utf-8');

      const result = parseAgentFile(filePath);

      expect(result).toHaveProperty('complete-agent');
      expect(result['complete-agent']).toEqual({
        description: 'A complete test agent with all fields',
        prompt: expect.stringContaining('You are a test agent'),
        tools: ['Read', 'Edit', 'Bash'],
        model: 'sonnet',
      });
    });

    it('should parse a minimal agent file with only required fields', () => {
      const filePath = join(agentsDir, 'minimal-agent.md');
      const content = `---
name: minimal-agent
description: A minimal test agent
---

Minimal system prompt.`;

      writeFileSync(filePath, content, 'utf-8');

      const result = parseAgentFile(filePath);

      expect(result).toHaveProperty('minimal-agent');
      expect(result['minimal-agent']).toEqual({
        description: 'A minimal test agent',
        prompt: 'Minimal system prompt.',
      });
    });

    it('should parse tools as array format', () => {
      const filePath = join(agentsDir, 'array-tools-agent.md');
      const content = `---
name: array-tools-agent
description: Agent with array tools format
tools:
  - Read
  - Edit
  - Bash
  - Grep
---

System prompt content.`;

      writeFileSync(filePath, content, 'utf-8');

      const result = parseAgentFile(filePath);

      expect(result['array-tools-agent'].tools).toEqual(['Read', 'Edit', 'Bash', 'Grep']);
    });

    it('should handle inline comments in YAML', () => {
      const filePath = join(agentsDir, 'comment-agent.md');
      const content = `---
name: comment-agent
description: Agent with comments # This is an inline comment
tools: Read, Edit  # These are the allowed tools
model: opus  # Using opus model
---

System prompt.`;

      writeFileSync(filePath, content, 'utf-8');

      const result = parseAgentFile(filePath);

      expect(result['comment-agent']).toEqual({
        description: 'Agent with comments',
        prompt: 'System prompt.',
        tools: ['Read', 'Edit'],
        model: 'opus',
      });
    });

    it('should throw error for missing frontmatter', () => {
      const filePath = join(agentsDir, 'no-frontmatter.md');
      const content = `This file has no frontmatter.

Just regular markdown content.`;

      writeFileSync(filePath, content, 'utf-8');

      expect(() => parseAgentFile(filePath)).toThrow(AgentFileParseError);
      expect(() => parseAgentFile(filePath)).toThrow(/does not contain valid YAML frontmatter/);
    });

    it('should throw error for missing description', () => {
      const filePath = join(agentsDir, 'no-description.md');
      const content = `---
name: no-description-agent
tools: Read, Edit
---

System prompt.`;

      writeFileSync(filePath, content, 'utf-8');

      expect(() => parseAgentFile(filePath)).toThrow(AgentFileParseError);
      expect(() => parseAgentFile(filePath)).toThrow(/must contain "description"/);
    });

    it('should throw error for missing system prompt', () => {
      const filePath = join(agentsDir, 'no-prompt.md');
      const content = `---
name: no-prompt-agent
description: Agent with no system prompt
---
`;

      writeFileSync(filePath, content, 'utf-8');

      expect(() => parseAgentFile(filePath)).toThrow(AgentFileParseError);
      expect(() => parseAgentFile(filePath)).toThrow(/must contain a system prompt/);
    });

    it('should throw error for non-existent file', () => {
      const filePath = join(agentsDir, 'non-existent.md');

      expect(() => parseAgentFile(filePath)).toThrow(AgentFileParseError);
      expect(() => parseAgentFile(filePath)).toThrow(/not found/);
    });

    it('should derive name from filename if not in frontmatter', () => {
      const filePath = join(agentsDir, 'derived-name.agent.md');
      const content = `---
description: Agent without explicit name
---

System prompt.`;

      writeFileSync(filePath, content, 'utf-8');

      const result = parseAgentFile(filePath);

      // Should use filename without .agent.md extension
      expect(result).toHaveProperty('derived-name');
    });

    it('should handle multi-line system prompts with markdown', () => {
      const filePath = join(agentsDir, 'multiline-agent.md');
      const content = `---
name: multiline-agent
description: Agent with complex system prompt
---

# System Prompt

You are a specialized agent.

## Guidelines

1. Follow these rules
2. Be helpful
3. Be accurate

\`\`\`json
{
  "example": "code block"
}
\`\`\`

End of prompt.`;

      writeFileSync(filePath, content, 'utf-8');

      const result = parseAgentFile(filePath);

      expect(result['multiline-agent'].prompt).toContain('# System Prompt');
      expect(result['multiline-agent'].prompt).toContain('## Guidelines');
      expect(result['multiline-agent'].prompt).toContain('"example": "code block"');
      expect(result['multiline-agent'].prompt).toContain('End of prompt.');
    });

    it('should handle quoted values in YAML', () => {
      const filePath = join(agentsDir, 'quoted-agent.md');
      const content = `---
name: "quoted-agent"
description: "Agent with: special characters"
model: 'sonnet'
---

System prompt.`;

      writeFileSync(filePath, content, 'utf-8');

      const result = parseAgentFile(filePath);

      expect(result['quoted-agent']).toEqual({
        description: 'Agent with: special characters',
        prompt: 'System prompt.',
        model: 'sonnet',
      });
    });
  });

  describe('loadAgentByName', () => {
    beforeAll(() => {
      // Create a test agent
      const content = `---
name: test-lookup-agent
description: Agent for testing loadAgentByName
---

Lookup test prompt.`;

      writeFileSync(join(agentsDir, 'test-lookup-agent.md'), content, 'utf-8');
    });

    it('should load agent from workspace directory', () => {
      const result = loadAgentByName('test-lookup-agent', testDir);

      expect(result).toHaveProperty('test-lookup-agent');
      expect(result['test-lookup-agent'].description).toBe('Agent for testing loadAgentByName');
    });

    it('should throw error for non-existent agent', () => {
      expect(() => loadAgentByName('non-existent-agent', testDir)).toThrow(AgentFileParseError);
      expect(() => loadAgentByName('non-existent-agent', testDir)).toThrow(/not found/);
    });

    it('should also try .agent.md extension', () => {
      // Create agent with .agent.md extension
      const content = `---
name: extension-test
description: Testing .agent.md extension
---

Extension test prompt.`;

      writeFileSync(join(agentsDir, 'extension-test.agent.md'), content, 'utf-8');

      const result = loadAgentByName('extension-test', testDir);

      expect(result).toHaveProperty('extension-test');
    });
  });

  describe('agentDefinitionToJson', () => {
    it('should convert agent definition to JSON string', () => {
      const definition = {
        'test-agent': {
          description: 'Test description',
          prompt: 'Test prompt',
          tools: ['Read', 'Edit'],
          model: 'sonnet',
        },
      };

      const json = agentDefinitionToJson(definition);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(definition);
    });

    it('should produce valid JSON for Claude CLI', () => {
      const definition = {
        'code-reviewer': {
          description: 'Expert code reviewer. Use proactively after code changes.',
          prompt: 'You are a senior code reviewer. Focus on code quality, security, and best practices.',
          tools: ['Read', 'Grep', 'Glob', 'Bash'],
          model: 'sonnet',
        },
      };

      const json = agentDefinitionToJson(definition);

      // Should be valid JSON
      expect(() => JSON.parse(json)).not.toThrow();

      // Should match the expected format from documentation
      const parsed = JSON.parse(json);
      expect(parsed['code-reviewer']).toHaveProperty('description');
      expect(parsed['code-reviewer']).toHaveProperty('prompt');
      expect(parsed['code-reviewer']).toHaveProperty('tools');
      expect(parsed['code-reviewer']).toHaveProperty('model');
    });
  });

  describe('real agent file compatibility', () => {
    it('should parse agentic-judge agent format', () => {
      // This tests the actual format used in the project
      const filePath = join(agentsDir, 'agentic-judge.md');
      const content = `---
name: agentic-judge
description: An agent that evaluates code changes based on provided criteria and outputs a structured JSON evaluation.
tools:
  - edit
  - runNotebooks
  - search
---

# CRITICAL: DO NOT ASK QUESTIONS

The user's message contains evaluation criteria.

## Example Output

\`\`\`json
{
  "status": "passed",
  "metrics": {},
  "message": "All criteria met"
}
\`\`\``;

      writeFileSync(filePath, content, 'utf-8');

      const result = parseAgentFile(filePath);

      expect(result['agentic-judge']).toBeDefined();
      expect(result['agentic-judge'].description).toContain('evaluates code changes');
      expect(result['agentic-judge'].tools).toEqual(['edit', 'runNotebooks', 'search']);
      expect(result['agentic-judge'].prompt).toContain('CRITICAL: DO NOT ASK QUESTIONS');
    });
  });
});
