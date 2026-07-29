import * as fs from 'fs';
import {
  AgentFileParseError,
  parseAgentFile,
} from '../../src/lib/agent-file-parser.js';

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn(),
}));

describe('agent file parser read error coverage', () => {
  it('wraps Error and non-Error read failures', () => {
    jest.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw new Error('read failed');
    });
    expect(() => parseAgentFile('agent.md')).toThrow('read failed');

    jest.mocked(fs.readFileSync).mockImplementationOnce(() => {
      throw 'string failure';
    });
    try {
      parseAgentFile('agent.md');
      throw new Error('expected parser failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentFileParseError);
      expect((error as Error).message).toContain('string failure');
    }
  });
});
