import * as fs from 'fs/promises';
import { installAgentFiles } from '../../src/lib/agent-files.js';

jest.mock('fs/promises', () => ({
  access: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
}));

describe('agent file installation error coverage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(fs.access)
      .mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'ENOENT' })
      );
    jest.mocked(fs.mkdir).mockResolvedValue(undefined);
  });

  it.each([
    ['EACCES', 'Permission denied'],
    ['ENOSPC', 'Disk full'],
    ['EROFS', 'Read-only filesystem'],
  ])('maps %s filesystem errors', async (code, expected) => {
    jest
      .mocked(fs.writeFile)
      .mockRejectedValue(Object.assign(new Error('raw error'), { code }));
    const result = await installAgentFiles({ targetDir: '/target' });
    expect(result.summary.errors).toBe(2);
    expect(result.success).toBe(false);
    expect(result.files[0].error).toContain(expected);
  });

  it('uses Error messages and an unknown fallback', async () => {
    jest
      .mocked(fs.writeFile)
      .mockRejectedValueOnce(new Error('ordinary failure'))
      .mockRejectedValueOnce('non-error rejection');
    const result = await installAgentFiles({ targetDir: '/target' });
    expect(result.files.map((file) => file.error)).toEqual([
      'ordinary failure',
      'Unknown error occurred',
    ]);
  });
});
