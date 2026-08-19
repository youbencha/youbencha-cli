import { parseConfig } from '../../src/lib/config-parser.js';

describe('small loader edge coverage', () => {
  it('reports invalid default-format YAML', () => {
    expect(() => parseConfig('key: [unterminated', 'config.unknown')).toThrow(
      'Failed to parse configuration file'
    );
  });
});
