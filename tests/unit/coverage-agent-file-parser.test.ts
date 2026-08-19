import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AgentFileParseError,
  loadAgentByName,
  parseAgentFile,
} from '../../src/lib/agent-file-parser.js';

describe('agent file parser edge coverage', () => {
  let root: string;
  let agentsDirectory: string;
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'youbencha-agent-parser-'));
    agentsDirectory = path.join(root, '.claude', 'agents');
    fs.mkdirSync(agentsDirectory, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function write(name: string, frontmatter: string, body = 'Prompt'): string {
    const file = path.join(agentsDirectory, name);
    fs.writeFileSync(file, `---\n${frontmatter}\n---\n${body}`);
    return file;
  }

  it('finishes arrays before later keys and skips blank and comment lines', () => {
    const file = write(
      'array-transition.md',
      [
        '# comment before values',
        '',
        'name: array-transition',
        'description: Array transition',
        'tools:',
        '  - Read',
        '',
        '  - Edit',
        'model: inherit',
      ].join('\n')
    );
    expect(parseAgentFile(file)).toEqual({
      'array-transition': {
        description: 'Array transition',
        prompt: 'Prompt',
        tools: ['Read', 'Edit'],
        model: 'inherit',
      },
    });
  });

  it('handles empty trailing arrays and empty comma-separated lists', () => {
    const trailing = write(
      'trailing.agent.md',
      ['description: Trailing array', 'tools:'].join('\n')
    );
    expect(parseAgentFile(trailing)).toEqual({
      trailing: {
        description: 'Trailing array',
        prompt: 'Prompt',
        tools: [],
      },
    });

    const emptyList = write(
      'empty-list.md',
      ['name: empty-list', 'description: Empty list', 'tools: ", ,"'].join('\n')
    );
    expect(parseAgentFile(emptyList)['empty-list'].tools).toBeUndefined();
  });

  it('rejects frontmatter without name and description and name-only files', () => {
    const neither = write('neither.md', 'model: inherit');
    expect(() => parseAgentFile(neither)).toThrow(
      'at least "name" or "description"'
    );

    const nameOnly = write('name-only.md', 'name: name-only');
    expect(() => parseAgentFile(nameOnly)).toThrow(
      'must contain "description"'
    );
  });

  it('searches cwd without duplicating workspace paths and supports no home', () => {
    process.chdir(root);
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    write(
      'cwd-agent.md',
      ['name: cwd-agent', 'description: Cwd agent'].join('\n')
    );
    expect(loadAgentByName('cwd-agent', root)).toHaveProperty('cwd-agent');

    expect(() => loadAgentByName('missing', root)).toThrow(AgentFileParseError);
  });

  it('falls back from HOME to USERPROFILE search paths', () => {
    const profile = path.join(root, 'profile');
    const profileAgents = path.join(profile, '.claude', 'agents');
    fs.mkdirSync(profileAgents, { recursive: true });
    fs.writeFileSync(
      path.join(profileAgents, 'profile-agent.md'),
      '---\nname: profile-agent\ndescription: Profile agent\n---\nPrompt'
    );
    delete process.env.HOME;
    process.env.USERPROFILE = profile;

    expect(loadAgentByName('profile-agent')).toHaveProperty('profile-agent');
  });
});
