/**
 * Unit tests for Configuration Parser
 * 
 * Tests YAML and JSON parsing functionality
 */

import { parseConfig, getFormatTips } from '../../src/lib/config-parser';

describe('Configuration Parser', () => {
  describe('parseConfig', () => {
    describe('JSON format', () => {
      it('should parse valid JSON content', () => {
        const content = JSON.stringify({
          name: 'test',
          repo: 'https://github.com/test/repo',
          agent: { type: 'copilot-cli' },
          evaluators: [{ name: 'git-diff' }],
        });
        
        const result = parseConfig(content, 'config.json');
        
        expect(result).toEqual({
          name: 'test',
          repo: 'https://github.com/test/repo',
          agent: { type: 'copilot-cli' },
          evaluators: [{ name: 'git-diff' }],
        });
      });

      it('should handle JSON with nested objects', () => {
        const content = JSON.stringify({
          name: 'test',
          agent: {
            type: 'copilot-cli',
            config: {
              prompt: 'test prompt',
              model: 'claude-sonnet-4.5',
            },
          },
          evaluators: [
            {
              name: 'agentic-judge',
              config: {
                assertions: {
                  test1: 'assertion 1',
                  test2: 'assertion 2',
                },
              },
            },
          ],
        });
        
        const result = parseConfig(content, 'config.json');
        
        expect(result.agent.config.prompt).toBe('test prompt');
        expect(result.evaluators[0].config.assertions.test1).toBe('assertion 1');
      });

      it('should throw error for invalid JSON', () => {
        const content = '{ invalid json }';
        
        expect(() => parseConfig(content, 'config.json')).toThrow('Failed to parse JSON');
      });

      it('should throw error for JSON with trailing comma', () => {
        const content = '{ "name": "test", }';
        
        expect(() => parseConfig(content, 'config.json')).toThrow('Failed to parse JSON');
      });

      it('should handle .json extension case-insensitively', () => {
        const content = '{"name": "test"}';
        
        expect(() => parseConfig(content, 'CONFIG.JSON')).not.toThrow();
        expect(() => parseConfig(content, 'config.Json')).not.toThrow();
      });
    });

    describe('YAML format', () => {
      it('should parse valid YAML content with .yaml extension', () => {
        const content = `
name: test
repo: https://github.com/test/repo
agent:
  type: copilot-cli
evaluators:
  - name: git-diff
`;
        
        const result = parseConfig(content, 'config.yaml');
        
        expect(result.name).toBe('test');
        expect(result.repo).toBe('https://github.com/test/repo');
        expect(result.agent.type).toBe('copilot-cli');
        expect(result.evaluators[0].name).toBe('git-diff');
      });

      it('should parse valid YAML content with .yml extension', () => {
        const content = `
name: test
evaluators:
  - name: git-diff
`;
        
        const result = parseConfig(content, 'config.yml');
        
        expect(result.name).toBe('test');
        expect(result.evaluators[0].name).toBe('git-diff');
      });

      it('should handle YAML with nested structures', () => {
        const content = `
name: test
agent:
  config:
    prompt: test prompt
    model: claude-sonnet-4.5
evaluators:
  - name: agentic-judge
    config:
      assertions:
        test1: assertion 1
        test2: assertion 2
`;
        
        const result = parseConfig(content, 'config.yaml');
        
        expect(result.agent.config.prompt).toBe('test prompt');
        expect(result.evaluators[0].config.assertions.test1).toBe('assertion 1');
      });

      it('should throw error for invalid YAML', () => {
        const content = `
name: test
  invalid: indentation
agent: value
`;
        
        expect(() => parseConfig(content, 'config.yaml')).toThrow('Failed to parse YAML');
      });

      it('should handle .yml and .yaml extensions case-insensitively', () => {
        const content = 'name: test';
        
        expect(() => parseConfig(content, 'CONFIG.YAML')).not.toThrow();
        expect(() => parseConfig(content, 'config.Yml')).not.toThrow();
      });
    });

    describe('Default format handling', () => {
      it('should default to YAML for unknown extensions', () => {
        const content = 'name: test';
        
        const result = parseConfig(content, 'config.txt');
        
        expect(result.name).toBe('test');
      });

      it('should default to YAML for files without extension', () => {
        const content = 'name: test';
        
        const result = parseConfig(content, 'config');
        
        expect(result.name).toBe('test');
      });
    });

    describe('File path handling', () => {
      it('should handle file paths with directories', () => {
        const content = '{"name": "test"}';
        
        const result = parseConfig(content, '/path/to/config.json');
        
        expect(result.name).toBe('test');
      });

      it('should handle relative paths', () => {
        const content = 'name: test';
        
        const result = parseConfig(content, './configs/suite.yaml');
        
        expect(result.name).toBe('test');
      });
    });
  });

  describe('getFormatTips', () => {
    it('should return JSON tips for .json files', () => {
      const tips = getFormatTips('config.json');
      
      expect(tips).toHaveLength(4);
      expect(tips.some(tip => tip.includes('double quotes'))).toBe(true);
      expect(tips.some(tip => tip.includes('trailing commas'))).toBe(true);
      expect(tips.some(tip => tip.includes('jsonlint.com'))).toBe(true);
    });

    it('should return YAML tips for .yaml files', () => {
      const tips = getFormatTips('config.yaml');
      
      expect(tips).toHaveLength(3);
      expect(tips.some(tip => tip.includes('indentation'))).toBe(true);
      expect(tips.some(tip => tip.includes('yaml-online-parser'))).toBe(true);
    });

    it('should return YAML tips for .yml files', () => {
      const tips = getFormatTips('config.yml');
      
      expect(tips).toHaveLength(3);
      expect(tips.some(tip => tip.includes('indentation'))).toBe(true);
    });

    it('should return YAML tips for unknown extensions', () => {
      const tips = getFormatTips('config.txt');
      
      expect(tips).toHaveLength(3);
      expect(tips.some(tip => tip.includes('indentation'))).toBe(true);
    });

    it('should handle case-insensitive extensions', () => {
      const jsonTips = getFormatTips('CONFIG.JSON');
      const yamlTips = getFormatTips('CONFIG.YAML');
      
      expect(jsonTips.some(tip => tip.includes('jsonlint.com'))).toBe(true);
      expect(yamlTips.some(tip => tip.includes('yaml-online-parser'))).toBe(true);
    });
  });
});
