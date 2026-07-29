import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import {
  DiffAnalyzer,
  type DiffAnalysis,
} from '../../src/core/diff-analyzer.js';
import {
  EnvironmentDetector,
  createLogEnvironment,
  detectEnvironment,
  formatEnvironment,
} from '../../src/core/env.js';
import {
  ensureArtifactsDirectory,
  getArtifactManifest,
  getRelativeArtifactPath,
  saveArtifact,
} from '../../src/core/storage.js';
import {
  WorkspaceError,
  WorkspaceErrorCode,
  WorkspaceManager,
  type Workspace,
  type WorkspaceConfig,
} from '../../src/core/workspace.js';

jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return { ...actual, userInfo: jest.fn(actual.userInfo) };
});

jest.mock('fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    readFile: jest.fn(actual.readFile),
    rm: jest.fn(actual.rm),
    unlink: jest.fn(actual.unlink),
  };
});

jest.mock('simple-git', () => ({
  simpleGit: jest.fn(),
}));

interface DiffAnalyzerInternals {
  validateDirectory(directory: string): Promise<void>;
  computeLineChanges(
    source: string,
    output: string,
    files: string[]
  ): Promise<{ added: number; removed: number }>;
  calculateDensity(
    source: string,
    output: string,
    analysis: DiffAnalysis
  ): Promise<{ files_changed_ratio: number; lines_changed_ratio: number }>;
}

interface WorkspaceManagerInternals {
  validateConfig(config: WorkspaceConfig): void;
  createLockfile(lockPath: string, repository: string): Promise<void>;
  cloneRepository(
    repository: string,
    target: string,
    branch?: string,
    commit?: string,
    timeout?: number
  ): Promise<string>;
}

const asDiffInternals = (analyzer: DiffAnalyzer): DiffAnalyzerInternals =>
  analyzer as unknown as DiffAnalyzerInternals;

const asWorkspaceInternals = (
  manager: WorkspaceManager
): WorkspaceManagerInternals => manager as unknown as WorkspaceManagerInternals;

describe('core utility coverage edges', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'youbencha-core-coverage-')
    );
  });

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('formats detected environments and handles version lookup fallbacks', () => {
    const environment = detectEnvironment();
    expect(formatEnvironment(environment)).toContain(
      `Node.js: v${environment.nodeVersion}`
    );
    expect(createLogEnvironment(temporaryDirectory)).toMatchObject({
      working_directory: temporaryDirectory,
      node_version: environment.nodeVersion,
    });

    const detector = new EnvironmentDetector();
    const originalDirectory = process.cwd();
    const nested = path.join(temporaryDirectory, 'one', 'two');
    return fs.mkdir(nested, { recursive: true }).then(() => {
      process.chdir(nested);
      try {
        expect(detector.getYouBenchaVersion()).toBe('0.0.0');
      } finally {
        process.chdir(originalDirectory);
      }
    });
  });

  test('handles shell-less users and undefined environment entries', () => {
    const detector = new EnvironmentDetector();
    const userInfo = os.userInfo as jest.MockedFunction<typeof os.userInfo>;
    userInfo.mockReturnValueOnce({
      username: 'tester',
      uid: -1,
      gid: -1,
      homedir: temporaryDirectory,
      shell: '',
    });
    expect(detector.getUserInfo().shell).toBeUndefined();

    const originalEnvironment = process.env;
    const replacement = Object.create(null) as NodeJS.ProcessEnv;
    Object.defineProperty(replacement, 'UNDEFINED_ENTRY', {
      configurable: true,
      enumerable: true,
      value: undefined,
    });
    replacement.VISIBLE = 'yes';
    process.env = replacement;
    try {
      expect(detector.getEnvironmentVariables()).toEqual({ VISIBLE: 'yes' });
    } finally {
      process.env = originalEnvironment;
    }
  });

  test('rejects unsafe artifact names and reports relative artifacts', async () => {
    const artifacts = path.join(temporaryDirectory, 'artifacts');
    await expect(saveArtifact('x', '', artifacts)).rejects.toThrow(
      'non-empty string'
    );
    await expect(
      saveArtifact('x', undefined as unknown as string, artifacts)
    ).rejects.toThrow('non-empty string');
    for (const filename of [
      '../escape',
      '/absolute',
      '\\absolute',
      'C:\\absolute',
    ]) {
      await expect(saveArtifact('x', filename, artifacts)).rejects.toThrow(
        'Invalid artifact filename'
      );
    }

    await ensureArtifactsDirectory(artifacts);
    await ensureArtifactsDirectory(artifacts);
    const artifact = await saveArtifact(
      'content',
      'nested/file.txt',
      artifacts
    );
    expect(getRelativeArtifactPath(artifact, artifacts)).toBe(
      path.join('nested', 'file.txt')
    );
    expect(
      await getArtifactManifest(path.join(temporaryDirectory, 'missing'))
    ).toEqual([]);
  });

  test('covers diff validation, unreadable candidates, and empty density', async () => {
    const analyzer = new DiffAnalyzer();
    const internals = asDiffInternals(analyzer);
    const plainFile = path.join(temporaryDirectory, 'plain.txt');
    await fs.writeFile(plainFile, 'plain');
    await expect(internals.validateDirectory(plainFile)).rejects.toThrow(
      'Path is not a directory'
    );
    await expect(
      internals.validateDirectory(path.join(temporaryDirectory, 'missing'))
    ).rejects.toThrow('Directory not found');

    const source = path.join(temporaryDirectory, 'source');
    const output = path.join(temporaryDirectory, 'output');
    await fs.mkdir(source);
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, 'added.txt'), 'one\ntwo');
    expect(
      await internals.computeLineChanges(source, output, [
        'missing.txt',
        'added.txt',
      ])
    ).toEqual({ added: 2, removed: 0 });

    const emptyAnalysis = await analyzer.analyzeFolders(source, output);
    expect(
      await internals.calculateDensity(source, output, {
        ...emptyAnalysis,
        files: { added: [], modified: [], deleted: [] },
        lines: { added: 0, removed: 0, total_changed: 0 },
      })
    ).toEqual({ files_changed_ratio: 0, lines_changed_ratio: 0 });

    const readFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
    readFile.mockRejectedValueOnce(new Error('unreadable'));
    await expect(
      internals.calculateDensity(source, output, emptyAnalysis)
    ).resolves.toEqual(expect.objectContaining({ lines_changed_ratio: 0 }));
  });

  test('validates workspace configuration edge cases and lock collisions', async () => {
    const manager = new WorkspaceManager('relative-root');
    const internals = asWorkspaceInternals(manager);
    for (const config of [
      { repo: undefined },
      { repo: 42 },
      { repo: ' ' },
      { repo: 'https://example.com/repo.git', runId: '../unsafe' },
      { repo: 'https://example.com/repo.git', timeout: -1 },
      { repo: 'https://example.com/repo.git', timeout: 1.5 },
    ]) {
      expect(() =>
        internals.validateConfig(config as unknown as WorkspaceConfig)
      ).toThrow(WorkspaceError);
    }
    expect(() =>
      internals.validateConfig({
        repo: 'https://example.com/repo.git',
        timeout: 0,
      })
    ).not.toThrow();

    const lockPath = path.join(temporaryDirectory, '.lock');
    await internals.createLockfile(lockPath, 'https://example.com/repo.git');
    await expect(
      internals.createLockfile(lockPath, 'https://example.com/repo.git')
    ).rejects.toMatchObject({ code: WorkspaceErrorCode.WORKSPACE_LOCKED });
    await expect(
      internals.createLockfile(
        path.join(temporaryDirectory, 'missing', '.lock'),
        'https://example.com/repo.git'
      )
    ).rejects.toBeDefined();
  });

  test('preserves checkout-specific workspace errors with the default timeout', async () => {
    const manager = new WorkspaceManager();
    const git = simpleGit as jest.MockedFunction<typeof simpleGit>;
    git
      .mockReturnValueOnce({
        clone: jest.fn().mockResolvedValue(undefined),
      } as unknown as ReturnType<typeof simpleGit>)
      .mockReturnValueOnce({
        fetch: jest.fn().mockRejectedValue(new Error('fetch failed')),
        checkout: jest.fn(),
      } as unknown as ReturnType<typeof simpleGit>);

    await expect(
      asWorkspaceInternals(manager).cloneRepository(
        'https://example.com/repo.git',
        path.join(temporaryDirectory, 'target'),
        undefined,
        'missing-commit'
      )
    ).rejects.toMatchObject({ code: WorkspaceErrorCode.CHECKOUT_FAILED });
  });

  test('makes cleanup best effort when both removals fail', async () => {
    const manager = new WorkspaceManager();
    const workspace = {
      runId: 'run',
      paths: {
        root: temporaryDirectory,
        runDir: path.join(temporaryDirectory, 'run'),
        modifiedDir: path.join(temporaryDirectory, 'run', 'source-modified'),
        artifactsDir: path.join(temporaryDirectory, 'run', 'artifacts'),
        evaluatorArtifactsDir: path.join(
          temporaryDirectory,
          'run',
          'artifacts',
          'evaluators'
        ),
        lockFile: path.join(temporaryDirectory, 'run', '.lock'),
      },
    } as Workspace;
    const unlink = fs.unlink as jest.MockedFunction<typeof fs.unlink>;
    const remove = fs.rm as jest.MockedFunction<typeof fs.rm>;
    unlink.mockRejectedValueOnce(new Error('unlink failed'));
    remove.mockRejectedValueOnce(new Error('remove failed'));

    await expect(manager.cleanup(workspace)).resolves.toBeUndefined();
  });
});
