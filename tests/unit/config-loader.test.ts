/**
 * Configuration Loader Tests
 * 
 * Unit tests for configuration loading, merging, and variable substitution.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  substituteVariables,
  substituteVariablesInObject,
} from '../../src/lib/config-loader.js';

describe('Configuration Loader', () => {
  describe('Variable Substitution', () => {
    it('should substitute single variable', () => {
      const result = substituteVariables('Hello ${name}', { name: 'World' });
      expect(result).toBe('Hello World');
    });

    it('should substitute multiple variables', () => {
      const result = substituteVariables('${greeting} ${name}!', {
        greeting: 'Hello',
        name: 'World',
      });
      expect(result).toBe('Hello World!');
    });

    it('should keep unmatched variables unchanged', () => {
      const result = substituteVariables('Hello ${name} and ${unknown}', {
        name: 'World',
      });
      expect(result).toBe('Hello World and ${unknown}');
    });

    it('should handle empty variable map', () => {
      const result = substituteVariables('Hello ${name}', {});
      expect(result).toBe('Hello ${name}');
    });

    it('should handle string without variables', () => {
      const result = substituteVariables('Hello World', { name: 'Test' });
      expect(result).toBe('Hello World');
    });
  });

  describe('Object Variable Substitution', () => {
    it('should substitute variables in nested object', () => {
      const obj = {
        name: '${project}',
        nested: {
          value: 'Repo: ${repo}',
        },
        array: ['${item1}', '${item2}'],
      };

      const result = substituteVariablesInObject(obj, {
        project: 'youbencha',
        repo: 'youbencha-cli',
        item1: 'first',
        item2: 'second',
      });

      expect(result).toEqual({
        name: 'youbencha',
        nested: {
          value: 'Repo: youbencha-cli',
        },
        array: ['first', 'second'],
      });
    });

    it('should handle objects with non-string values', () => {
      const obj = {
        name: '${project}',
        count: 42,
        enabled: true,
        nullable: null,
      };

      const result = substituteVariablesInObject(obj, {
        project: 'youbencha',
      });

      expect(result).toEqual({
        name: 'youbencha',
        count: 42,
        enabled: true,
        nullable: null,
      });
    });

    it('should preserve object structure', () => {
      const obj = {
        a: {
          b: {
            c: '${value}',
          },
        },
      };

      const result = substituteVariablesInObject(obj, { value: 'deep' });
      expect(result).toEqual({
        a: {
          b: {
            c: 'deep',
          },
        },
      });
    });
  });
});
