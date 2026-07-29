import {
  configure,
  createLogger,
  debug,
  error,
  getConfig,
  info,
  LogLevel,
  reset,
  warn,
} from '../../src/lib/logger.js';

describe('logger coverage', () => {
  let debugSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    reset();
    debugSpy = jest.spyOn(console, 'debug').mockImplementation();
    infoSpy = jest.spyOn(console, 'info').mockImplementation();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    reset();
    jest.restoreAllMocks();
  });

  it('filters every global log level and forwards arguments', () => {
    debug('hidden');
    info('info', { value: 1 });
    warn('warn', 2);
    error('error', true);

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('[youBencha] [INFO] info', {
      value: 1,
    });
    expect(warnSpy).toHaveBeenCalledWith('[youBencha] [WARN] warn', 2);
    expect(errorSpy).toHaveBeenCalledWith('[youBencha] [ERROR] error', true);

    configure({ level: LogLevel.ERROR });
    info('filtered');
    warn('filtered');
    error('visible');
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenLastCalledWith('[youBencha] [ERROR] visible');

    configure({ level: LogLevel.DEBUG });
    debug('visible');
    expect(debugSpy).toHaveBeenCalledWith('[youBencha] [DEBUG] visible');
  });

  it('formats timestamps and supports an omitted prefix', () => {
    jest
      .spyOn(Date.prototype, 'toISOString')
      .mockReturnValue('2026-07-29T12:00:00.000Z');
    configure({
      level: LogLevel.DEBUG,
      timestamps: true,
      prefix: undefined,
    });

    info('timestamped');
    expect(infoSpy).toHaveBeenCalledWith(
      '[2026-07-29T12:00:00.000Z] [INFO] timestamped'
    );
    expect(getConfig()).toEqual({
      level: LogLevel.DEBUG,
      timestamps: true,
      prefix: undefined,
    });

    const copy = getConfig();
    copy.level = LogLevel.ERROR;
    expect(getConfig().level).toBe(LogLevel.DEBUG);
  });

  it('creates scoped loggers that honor every enabled and disabled level', () => {
    const scoped = createLogger('[scope]');
    scoped.debug('hidden');
    scoped.info('info', 1);
    scoped.warn('warn', 2);
    scoped.error('error', 3);
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('[youBencha] [INFO] [scope] info', 1);
    expect(warnSpy).toHaveBeenCalledWith('[youBencha] [WARN] [scope] warn', 2);
    expect(errorSpy).toHaveBeenCalledWith(
      '[youBencha] [ERROR] [scope] error',
      3
    );

    configure({ level: LogLevel.DEBUG });
    scoped.debug('debug');
    expect(debugSpy).toHaveBeenCalledWith('[youBencha] [DEBUG] [scope] debug');

    configure({ level: LogLevel.ERROR });
    scoped.info('hidden');
    scoped.warn('hidden');
    scoped.error('visible');
    expect(errorSpy).toHaveBeenLastCalledWith(
      '[youBencha] [ERROR] [scope] visible'
    );
  });
});
