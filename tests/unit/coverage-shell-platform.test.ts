describe('shell platform coverage', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    jest.resetModules();
  });

  it.each([
    ['win32', "'a''b'", 'powershell'],
    ['linux', "'a'\\''b'", 'bash'],
  ])(
    'uses the %s default shell',
    async (platform, expectedEscape, expectedShell) => {
      Object.defineProperty(process, 'platform', { value: platform });
      jest.resetModules();
      const { detectShell, escapeShellArg } = await import(
        '../../src/lib/shell-utils.js'
      );
      expect(escapeShellArg("a'b")).toBe(expectedEscape);
      expect(detectShell()).toBe(expectedShell);
    }
  );
});
