/**
 * Unit tests for Shell Utilities
 * 
 * Tests cross-platform shell escaping and path validation.
 */

import {
  escapeShellArg,
  stripAnsiCodes,
  isPathSafe,
  detectShell,
} from '../../src/lib/shell-utils.js';

describe('shell-utils', () => {
  describe('escapeShellArg', () => {
    describe('for PowerShell', () => {
      it('should escape single quotes by doubling them', () => {
        const input = "can't stop";
        const escaped = escapeShellArg(input, 'powershell');
        expect(escaped).toBe("'can''t stop'");
      });

      it('should wrap plain strings in single quotes', () => {
        const input = 'hello world';
        const escaped = escapeShellArg(input, 'powershell');
        expect(escaped).toBe("'hello world'");
      });

      it('should handle empty strings', () => {
        const input = '';
        const escaped = escapeShellArg(input, 'powershell');
        expect(escaped).toBe("''");
      });

      it('should handle strings with multiple single quotes', () => {
        const input = "it's a 'test' string";
        const escaped = escapeShellArg(input, 'powershell');
        expect(escaped).toBe("'it''s a ''test'' string'");
      });

      it('should handle strings with special characters', () => {
        const input = 'hello $world `test';
        const escaped = escapeShellArg(input, 'powershell');
        // Single quotes prevent variable expansion in PowerShell
        expect(escaped).toBe("'hello $world `test'");
      });

      it('should handle newlines and tabs', () => {
        const input = 'line1\nline2\ttab';
        const escaped = escapeShellArg(input, 'powershell');
        expect(escaped).toBe("'line1\nline2\ttab'");
      });
    });

    describe('for bash', () => {
      it('should escape single quotes with the quote-escape-quote pattern', () => {
        const input = "can't stop";
        const escaped = escapeShellArg(input, 'bash');
        expect(escaped).toBe("'can'\\''t stop'");
      });

      it('should wrap plain strings in single quotes', () => {
        const input = 'hello world';
        const escaped = escapeShellArg(input, 'bash');
        expect(escaped).toBe("'hello world'");
      });

      it('should handle empty strings', () => {
        const input = '';
        const escaped = escapeShellArg(input, 'bash');
        expect(escaped).toBe("''");
      });

      it('should handle strings with multiple single quotes', () => {
        const input = "it's a 'test' string";
        const escaped = escapeShellArg(input, 'bash');
        expect(escaped).toBe("'it'\\''s a '\\''test'\\'' string'");
      });

      it('should handle strings with special characters', () => {
        const input = 'hello $world `test';
        const escaped = escapeShellArg(input, 'bash');
        // Single quotes prevent variable expansion in bash
        expect(escaped).toBe("'hello $world `test'");
      });

      it('should handle backslashes', () => {
        const input = 'path\\to\\file';
        const escaped = escapeShellArg(input, 'bash');
        expect(escaped).toBe("'path\\to\\file'");
      });
    });

    it('should use platform-appropriate escaping when no shell specified', () => {
      const input = 'test';
      const escaped = escapeShellArg(input);
      // Should be wrapped in single quotes regardless of platform
      expect(escaped).toMatch(/^'.*'$/);
    });
  });

  describe('stripAnsiCodes', () => {
    it('should remove basic color codes', () => {
      const input = '\x1B[31mred text\x1B[0m';
      expect(stripAnsiCodes(input)).toBe('red text');
    });

    it('should remove multiple color codes', () => {
      const input = '\x1B[31m\x1B[1mbold red\x1B[0m normal';
      expect(stripAnsiCodes(input)).toBe('bold red normal');
    });

    it('should handle cursor movement codes', () => {
      const input = '\x1B[2Jhello\x1B[H';
      expect(stripAnsiCodes(input)).toBe('hello');
    });

    it('should handle text without ANSI codes', () => {
      const input = 'plain text without codes';
      expect(stripAnsiCodes(input)).toBe('plain text without codes');
    });

    it('should handle empty strings', () => {
      expect(stripAnsiCodes('')).toBe('');
    });

    it('should handle complex sequences', () => {
      const input = '\x1B[38;5;82mgreen\x1B[0m \x1B[48;2;255;0;0mred bg\x1B[0m';
      expect(stripAnsiCodes(input)).toBe('green red bg');
    });
  });

  describe('isPathSafe', () => {
    it('should allow relative paths', () => {
      expect(isPathSafe('./prompts/task.md')).toBe(true);
      expect(isPathSafe('prompts/task.md')).toBe(true);
    });

    it('should reject absolute Unix paths', () => {
      expect(isPathSafe('/etc/passwd')).toBe(false);
      expect(isPathSafe('/home/user/file')).toBe(false);
    });

    it('should reject absolute Windows paths', () => {
      expect(isPathSafe('C:\\Windows\\System32')).toBe(false);
      expect(isPathSafe('D:/files/test')).toBe(false);
    });

    it('should reject path traversal attempts', () => {
      expect(isPathSafe('../secret.txt')).toBe(false);
      expect(isPathSafe('dir/../../../etc/passwd')).toBe(false);
      expect(isPathSafe('..\\..\\Windows\\System32')).toBe(false);
    });

    it('should reject UNC paths', () => {
      expect(isPathSafe('\\\\server\\share')).toBe(false);
    });

    it('should allow nested relative paths', () => {
      expect(isPathSafe('deeply/nested/path/to/file.txt')).toBe(true);
    });

    it('should allow paths with dots in filenames', () => {
      expect(isPathSafe('file.test.md')).toBe(true);
      expect(isPathSafe('./config.local.json')).toBe(true);
    });

    it('should allow current directory references', () => {
      expect(isPathSafe('./file.txt')).toBe(true);
    });
  });

  describe('detectShell', () => {
    it('should return a valid shell type', () => {
      const shell = detectShell();
      expect(['powershell', 'bash']).toContain(shell);
    });

    it('should return consistent results', () => {
      const shell1 = detectShell();
      const shell2 = detectShell();
      expect(shell1).toBe(shell2);
    });
  });
});
