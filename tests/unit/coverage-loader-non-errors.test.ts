import * as fs from 'fs';
import {
  loadEvaluatorDefinition,
  validateEvaluatorNames,
} from '../../src/lib/evaluator-loader.js';
import { loadPromptFromFile } from '../../src/lib/prompt-loader.js';

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}));

describe('loader non-Error coverage', () => {
  it('formats Error and non-Error prompt read failures', () => {
    jest.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw new Error('error read failure');
    });
    expect(() => loadPromptFromFile('prompt.md', '.')).toThrow(
      'error read failure'
    );
    jest.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw 'non-error read failure';
    });
    expect(() => loadPromptFromFile('prompt.md', '.')).toThrow(
      'non-error read failure'
    );
  });

  it('formats Error and non-Error evaluator definition read failures', () => {
    jest.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw new Error('error read failure');
    });
    expect(() => loadEvaluatorDefinition('evaluator.yaml', '.')).toThrow(
      'error read failure'
    );
    jest.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw 'non-error read failure';
    });
    expect(() => loadEvaluatorDefinition('evaluator.yaml', '.')).toThrow(
      'non-error read failure'
    );
  });

  it('pluralizes multiple unknown evaluator names', () => {
    expect(() =>
      validateEvaluatorNames([
        { name: 'unknown-one' },
        { name: 'unknown-two' },
        { name: 'unknown-one' },
      ])
    ).toThrow('Unknown evaluators: unknown-one, unknown-two');
  });
});
