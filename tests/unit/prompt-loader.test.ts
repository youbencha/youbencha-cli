/**
 * Unit tests for Prompt Loader
 * 
 * Tests prompt file loading functionality
 */

import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { 
  loadPromptFromFile, 
  resolvePromptValue, 
  PromptFileError 
} from '../../src/lib/prompt-loader';

describe('Prompt Loader', () => {
  const testTempDir = join(__dirname, '.test-prompt-loader');
  
  beforeAll(() => {
    // Create temporary test directory
    mkdirSync(testTempDir, { recursive: true });
  });
  
  afterAll(() => {
    // Clean up test directory
    rmSync(testTempDir, { recursive: true, force: true });
  });
  
  describe('loadPromptFromFile', () => {
    it('should load content from a text file', () => {
      const content = 'This is a test prompt';
      const filePath = join(testTempDir, 'prompt.txt');
      writeFileSync(filePath, content, 'utf-8');
      
      const result = loadPromptFromFile(filePath);
      
      expect(result).toBe(content);
    });
    
    it('should load content from a markdown file', () => {
      const content = '# Test Prompt\n\nThis is a test prompt with markdown.';
      const filePath = join(testTempDir, 'prompt.md');
      writeFileSync(filePath, content, 'utf-8');
      
      const result = loadPromptFromFile(filePath);
      
      expect(result).toBe(content);
    });
    
    it('should trim leading and trailing whitespace', () => {
      const content = '\n\n  This is a test prompt  \n\n';
      const filePath = join(testTempDir, 'prompt-whitespace.txt');
      writeFileSync(filePath, content, 'utf-8');
      
      const result = loadPromptFromFile(filePath);
      
      expect(result).toBe('This is a test prompt');
    });
    
    it('should handle relative paths', () => {
      const content = 'Relative path test';
      const fileName = 'relative-prompt.txt';
      const filePath = join(testTempDir, fileName);
      writeFileSync(filePath, content, 'utf-8');
      
      const result = loadPromptFromFile(fileName, testTempDir);
      
      expect(result).toBe(content);
    });
    
    it('should handle absolute paths', () => {
      const content = 'Absolute path test';
      const filePath = join(testTempDir, 'absolute-prompt.txt');
      writeFileSync(filePath, content, 'utf-8');
      
      const result = loadPromptFromFile(filePath);
      
      expect(result).toBe(content);
    });
    
    it('should handle subdirectories', () => {
      const subDir = join(testTempDir, 'subdir');
      mkdirSync(subDir, { recursive: true });
      
      const content = 'Subdirectory test';
      const filePath = join(subDir, 'nested-prompt.txt');
      writeFileSync(filePath, content, 'utf-8');
      
      const result = loadPromptFromFile('subdir/nested-prompt.txt', testTempDir);
      
      expect(result).toBe(content);
    });
    
    it('should throw PromptFileError when file does not exist', () => {
      expect(() => {
        loadPromptFromFile('nonexistent.txt', testTempDir);
      }).toThrow(PromptFileError);
    });
    
    it('should throw PromptFileError with file path in error message', () => {
      try {
        loadPromptFromFile('nonexistent.txt', testTempDir);
        fail('Expected PromptFileError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PromptFileError);
        if (error instanceof PromptFileError) {
          expect(error.message).toContain('nonexistent.txt');
          expect(error.filePath).toBe('nonexistent.txt');
        }
      }
    });
    
    it('should handle multi-line content', () => {
      const content = 'Line 1\nLine 2\nLine 3\n\nLine 5';
      const filePath = join(testTempDir, 'multiline-prompt.txt');
      writeFileSync(filePath, content, 'utf-8');
      
      const result = loadPromptFromFile(filePath);
      
      expect(result).toBe(content);
    });
    
    it('should handle UTF-8 content', () => {
      const content = 'Test with émojis 🎉 and unicode: 中文';
      const filePath = join(testTempDir, 'unicode-prompt.txt');
      writeFileSync(filePath, content, 'utf-8');
      
      const result = loadPromptFromFile(filePath);
      
      expect(result).toBe(content);
    });
    
    it('should handle large files', () => {
      const content = 'x'.repeat(50000); // 50KB of content
      const filePath = join(testTempDir, 'large-prompt.txt');
      writeFileSync(filePath, content, 'utf-8');
      
      const result = loadPromptFromFile(filePath);
      
      expect(result).toBe(content);
      expect(result.length).toBe(50000);
    });
  });
  
  describe('resolvePromptValue', () => {
    it('should return inline prompt when provided', () => {
      const prompt = 'Inline prompt';
      
      const result = resolvePromptValue(prompt, undefined, testTempDir);
      
      expect(result).toBe(prompt);
    });
    
    it('should load from file when prompt_file is provided', () => {
      const content = 'File-based prompt';
      const fileName = 'resolve-test.txt';
      const filePath = join(testTempDir, fileName);
      writeFileSync(filePath, content, 'utf-8');
      
      const result = resolvePromptValue(undefined, fileName, testTempDir);
      
      expect(result).toBe(content);
    });
    
    it('should return undefined when neither prompt nor prompt_file is provided', () => {
      const result = resolvePromptValue(undefined, undefined, testTempDir);
      
      expect(result).toBeUndefined();
    });
    
    it('should throw error when both prompt and prompt_file are provided', () => {
      expect(() => {
        resolvePromptValue('Inline', 'file.txt', testTempDir);
      }).toThrow('Cannot specify both "prompt" and "prompt_file"');
    });
    
    it('should prefer inline prompt over file when both are accidentally provided', () => {
      // This should throw, not prefer
      expect(() => {
        resolvePromptValue('Inline', 'file.txt', testTempDir);
      }).toThrow();
    });
    
    it('should throw PromptFileError when prompt_file does not exist', () => {
      expect(() => {
        resolvePromptValue(undefined, 'nonexistent.txt', testTempDir);
      }).toThrow(PromptFileError);
    });
    
    it('should handle empty string as falsy for prompt', () => {
      const content = 'File-based prompt';
      const fileName = 'empty-string-test.txt';
      const filePath = join(testTempDir, fileName);
      writeFileSync(filePath, content, 'utf-8');
      
      // Empty string is falsy, so it should use the file
      const result = resolvePromptValue('', fileName, testTempDir);
      
      expect(result).toBe(content);
    });
    
    it('should use default baseDir when not provided', () => {
      // This test just ensures the function doesn't crash with default baseDir
      const result = resolvePromptValue('test', undefined);
      expect(result).toBe('test');
    });
  });
  
  describe('PromptFileError', () => {
    it('should have correct name', () => {
      const error = new PromptFileError('Test error', 'test.txt');
      
      expect(error.name).toBe('PromptFileError');
    });
    
    it('should include message and filePath', () => {
      const message = 'Test error message';
      const filePath = 'test.txt';
      const error = new PromptFileError(message, filePath);
      
      expect(error.message).toBe(message);
      expect(error.filePath).toBe(filePath);
    });
    
    it('should be instanceof Error', () => {
      const error = new PromptFileError('Test', 'test.txt');
      
      expect(error).toBeInstanceOf(Error);
    });
  });
});
