/**
 * Unit Tests: Environment Detector
 * 
 * Tests for OS detection, Node version detection, and environment metadata capture.
 */

import * as os from 'os';
import {
  EnvironmentDetector,
  EnvironmentInfo,
  SystemInfo,
} from '../../src/core/env';
import { version as packageVersion } from '../../package.json';

// Mock os module
jest.mock('os');

describe('EnvironmentDetector', () => {
  let mockOs: jest.Mocked<typeof os>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockOs = os as jest.Mocked<typeof os>;
    
    // Default mock implementations
    mockOs.platform.mockReturnValue('linux');
    mockOs.release.mockReturnValue('5.15.0-generic');
    mockOs.arch.mockReturnValue('x64');
    mockOs.cpus.mockReturnValue([
      { model: 'Intel Core i7', speed: 2400 } as os.CpuInfo,
      { model: 'Intel Core i7', speed: 2400 } as os.CpuInfo,
    ]);
    mockOs.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024); // 16 GB
    mockOs.freemem.mockReturnValue(8 * 1024 * 1024 * 1024); // 8 GB
    mockOs.hostname.mockReturnValue('test-machine');
    mockOs.userInfo.mockReturnValue({
      username: 'testuser',
      uid: 1000,
      gid: 1000,
      shell: '/bin/bash',
      homedir: '/home/testuser',
    });
  });
  
  describe('getEnvironmentInfo', () => {
    it('should detect environment information', () => {
      const detector = new EnvironmentDetector();
      const info = detector.getEnvironmentInfo();
      
      expect(info).toMatchObject({
        os: expect.any(String),
        nodeVersion: expect.any(String),
        youbenchaVersion: expect.any(String),
        timestamp: expect.any(String),
      });
    });
    
    it('should include working directory', () => {
      const detector = new EnvironmentDetector();
      const workingDir = '/test/workspace';
      const info = detector.getEnvironmentInfo(workingDir);
      
      expect(info.workingDirectory).toBe(workingDir);
    });
    
    it('should use current working directory if not provided', () => {
      const detector = new EnvironmentDetector();
      const info = detector.getEnvironmentInfo();
      
      expect(info.workingDirectory).toBe(process.cwd());
    });
    
    it('should include timestamp in ISO 8601 format', () => {
      const detector = new EnvironmentDetector();
      const info = detector.getEnvironmentInfo();
      
      expect(info.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(info.timestamp).toISOString()).toBe(info.timestamp);
    });
  });
  
  describe('getOperatingSystem', () => {
    it('should detect Linux', () => {
      mockOs.platform.mockReturnValue('linux');
      mockOs.release.mockReturnValue('5.15.0-generic');
      
      const detector = new EnvironmentDetector();
      const osInfo = detector.getOperatingSystem();
      
      expect(osInfo).toBe('Linux 5.15.0-generic');
    });
    
    it('should detect Windows', () => {
      mockOs.platform.mockReturnValue('win32');
      mockOs.release.mockReturnValue('10.0.19044');
      
      const detector = new EnvironmentDetector();
      const osInfo = detector.getOperatingSystem();
      
      expect(osInfo).toBe('Windows 10.0.19044');
    });
    
    it('should detect macOS', () => {
      mockOs.platform.mockReturnValue('darwin');
      mockOs.release.mockReturnValue('21.6.0');
      
      const detector = new EnvironmentDetector();
      const osInfo = detector.getOperatingSystem();
      
      expect(osInfo).toBe('macOS 21.6.0');
    });
    
    it('should handle unknown platforms', () => {
      mockOs.platform.mockReturnValue('unknown' as NodeJS.Platform);
      mockOs.release.mockReturnValue('1.0.0');
      
      const detector = new EnvironmentDetector();
      const osInfo = detector.getOperatingSystem();
      
      expect(osInfo).toBe('unknown 1.0.0');
    });
    
    it('should capitalize platform name', () => {
      mockOs.platform.mockReturnValue('linux');
      
      const detector = new EnvironmentDetector();
      const osInfo = detector.getOperatingSystem();
      
      expect(osInfo).toMatch(/^Linux/);
    });
  });
  
  describe('getNodeVersion', () => {
    it('should return Node.js version', () => {
      const detector = new EnvironmentDetector();
      const version = detector.getNodeVersion();
      
      expect(version).toBe(process.version);
      expect(version).toMatch(/^v\d+\.\d+\.\d+/);
    });
    
    it('should return version without modifications', () => {
      const originalVersion = process.version;
      
      const detector = new EnvironmentDetector();
      const version = detector.getNodeVersion();
      
      expect(version).toBe(originalVersion);
    });
  });
  
  describe('getYouBenchaVersion', () => {
    it('should return youBencha version from package.json', () => {
      const detector = new EnvironmentDetector();
      const version = detector.getYouBenchaVersion();
      
      expect(version).toBe(packageVersion);
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
  
  describe('getSystemInfo', () => {
    it('should collect system information', () => {
      const detector = new EnvironmentDetector();
      const systemInfo = detector.getSystemInfo();
      
      expect(systemInfo).toMatchObject({
        platform: expect.any(String),
        arch: expect.any(String),
        cpuCount: expect.any(Number),
        cpuModel: expect.any(String),
        totalMemoryMB: expect.any(Number),
        freeMemoryMB: expect.any(Number),
        hostname: expect.any(String),
      });
    });
    
    it('should detect platform correctly', () => {
      mockOs.platform.mockReturnValue('linux');
      
      const detector = new EnvironmentDetector();
      const systemInfo = detector.getSystemInfo();
      
      expect(systemInfo.platform).toBe('linux');
    });
    
    it('should detect architecture correctly', () => {
      mockOs.arch.mockReturnValue('x64');
      
      const detector = new EnvironmentDetector();
      const systemInfo = detector.getSystemInfo();
      
      expect(systemInfo.arch).toBe('x64');
    });
    
    it('should count CPUs correctly', () => {
      mockOs.cpus.mockReturnValue([
        { model: 'CPU 1' } as os.CpuInfo,
        { model: 'CPU 2' } as os.CpuInfo,
        { model: 'CPU 3' } as os.CpuInfo,
        { model: 'CPU 4' } as os.CpuInfo,
      ]);
      
      const detector = new EnvironmentDetector();
      const systemInfo = detector.getSystemInfo();
      
      expect(systemInfo.cpuCount).toBe(4);
    });
    
    it('should detect CPU model from first CPU', () => {
      mockOs.cpus.mockReturnValue([
        { model: 'Intel Core i7-9750H' } as os.CpuInfo,
        { model: 'Intel Core i7-9750H' } as os.CpuInfo,
      ]);
      
      const detector = new EnvironmentDetector();
      const systemInfo = detector.getSystemInfo();
      
      expect(systemInfo.cpuModel).toBe('Intel Core i7-9750H');
    });
    
    it('should convert memory to MB', () => {
      mockOs.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024); // 16 GB
      mockOs.freemem.mockReturnValue(8 * 1024 * 1024 * 1024); // 8 GB
      
      const detector = new EnvironmentDetector();
      const systemInfo = detector.getSystemInfo();
      
      expect(systemInfo.totalMemoryMB).toBe(16384);
      expect(systemInfo.freeMemoryMB).toBe(8192);
    });
    
    it('should round memory values', () => {
      mockOs.totalmem.mockReturnValue(15.5 * 1024 * 1024 * 1024); // 15.5 GB
      
      const detector = new EnvironmentDetector();
      const systemInfo = detector.getSystemInfo();
      
      expect(systemInfo.totalMemoryMB).toBe(Math.round(15.5 * 1024));
    });
    
    it('should include hostname', () => {
      mockOs.hostname.mockReturnValue('test-machine-42');
      
      const detector = new EnvironmentDetector();
      const systemInfo = detector.getSystemInfo();
      
      expect(systemInfo.hostname).toBe('test-machine-42');
    });
  });
  
  describe('getUserInfo', () => {
    it('should get user information', () => {
      const detector = new EnvironmentDetector();
      const userInfo = detector.getUserInfo();
      
      expect(userInfo).toMatchObject({
        username: expect.any(String),
      });
    });
    
    it('should detect username', () => {
      mockOs.userInfo.mockReturnValue({
        username: 'johndoe',
        uid: 1000,
        gid: 1000,
        shell: '/bin/bash',
        homedir: '/home/johndoe',
      });
      
      const detector = new EnvironmentDetector();
      const userInfo = detector.getUserInfo();
      
      expect(userInfo.username).toBe('johndoe');
    });
    
    it('should include home directory', () => {
      mockOs.userInfo.mockReturnValue({
        username: 'testuser',
        uid: 1000,
        gid: 1000,
        shell: '/bin/bash',
        homedir: '/home/testuser',
      });
      
      const detector = new EnvironmentDetector();
      const userInfo = detector.getUserInfo();
      
      expect(userInfo.homedir).toBe('/home/testuser');
    });
    
    it('should include shell on Unix systems', () => {
      mockOs.platform.mockReturnValue('linux');
      mockOs.userInfo.mockReturnValue({
        username: 'testuser',
        uid: 1000,
        gid: 1000,
        shell: '/bin/zsh',
        homedir: '/home/testuser',
      });
      
      const detector = new EnvironmentDetector();
      const userInfo = detector.getUserInfo();
      
      expect(userInfo.shell).toBe('/bin/zsh');
    });
  });
  
  describe('getEnvironmentVariables', () => {
    it('should filter environment variables', () => {
      const originalEnv = process.env;
      process.env = {
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        NODE_ENV: 'test',
        PATH: '/usr/bin:/bin',
        SECRET_KEY: 'should-not-appear',
      };
      
      const detector = new EnvironmentDetector();
      const envVars = detector.getEnvironmentVariables();
      
      expect(envVars.CI).toBe('true');
      expect(envVars.GITHUB_ACTIONS).toBe('true');
      expect(envVars.NODE_ENV).toBe('test');
      expect(envVars.SECRET_KEY).toBeUndefined();
      
      process.env = originalEnv;
    });
    
    it('should include CI environment variables', () => {
      const originalEnv = process.env;
      process.env = {
        CI: 'true',
        GITHUB_ACTIONS: 'true',
        GITLAB_CI: 'true',
        TRAVIS: 'true',
      };
      
      const detector = new EnvironmentDetector();
      const envVars = detector.getEnvironmentVariables();
      
      expect(envVars.CI).toBe('true');
      expect(envVars.GITHUB_ACTIONS).toBe('true');
      expect(envVars.GITLAB_CI).toBe('true');
      expect(envVars.TRAVIS).toBe('true');
      
      process.env = originalEnv;
    });
    
    it('should exclude sensitive variables', () => {
      const originalEnv = process.env;
      process.env = {
        API_KEY: 'secret',
        TOKEN: 'secret',
        PASSWORD: 'secret',
        SECRET: 'secret',
        NODE_ENV: 'test',
      };
      
      const detector = new EnvironmentDetector();
      const envVars = detector.getEnvironmentVariables();
      
      expect(envVars.API_KEY).toBeUndefined();
      expect(envVars.TOKEN).toBeUndefined();
      expect(envVars.PASSWORD).toBeUndefined();
      expect(envVars.SECRET).toBeUndefined();
      expect(envVars.NODE_ENV).toBe('test');
      
      process.env = originalEnv;
    });
  });
  
  describe('getFullEnvironment', () => {
    it('should combine all environment information', () => {
      const detector = new EnvironmentDetector();
      const fullEnv = detector.getFullEnvironment('/test/workspace');
      
      expect(fullEnv).toMatchObject({
        info: expect.objectContaining({
          os: expect.any(String),
          nodeVersion: expect.any(String),
          youbenchaVersion: expect.any(String),
          timestamp: expect.any(String),
          workingDirectory: '/test/workspace',
        }),
        system: expect.objectContaining({
          platform: expect.any(String),
          arch: expect.any(String),
          cpuCount: expect.any(Number),
        }),
        user: expect.objectContaining({
          username: expect.any(String),
        }),
        env: expect.any(Object),
      });
    });
    
    it('should include all sections', () => {
      const detector = new EnvironmentDetector();
      const fullEnv = detector.getFullEnvironment();
      
      expect(fullEnv).toHaveProperty('info');
      expect(fullEnv).toHaveProperty('system');
      expect(fullEnv).toHaveProperty('user');
      expect(fullEnv).toHaveProperty('env');
    });
  });
  
  describe('formatEnvironmentForLog', () => {
    it('should format environment for youBencha Log', () => {
      const detector = new EnvironmentDetector();
      const formatted = detector.formatEnvironmentForLog('/test/workspace');
      
      expect(formatted).toMatchObject({
        os: expect.any(String),
        node_version: expect.any(String),
        youbencha_version: expect.any(String),
        working_directory: '/test/workspace',
      });
    });
    
    it('should use snake_case for field names', () => {
      const detector = new EnvironmentDetector();
      const formatted = detector.formatEnvironmentForLog();
      
      expect(formatted).toHaveProperty('os');
      expect(formatted).toHaveProperty('node_version');
      expect(formatted).toHaveProperty('youbencha_version');
      expect(formatted).toHaveProperty('working_directory');
      expect(formatted).not.toHaveProperty('nodeVersion');
      expect(formatted).not.toHaveProperty('youbenchaVersion');
    });
  });
  
  describe('edge cases', () => {
    it('should handle missing CPU information', () => {
      mockOs.cpus.mockReturnValue([]);
      
      const detector = new EnvironmentDetector();
      const systemInfo = detector.getSystemInfo();
      
      expect(systemInfo.cpuCount).toBe(0);
      expect(systemInfo.cpuModel).toBe('Unknown');
    });
    
    it('should handle zero memory', () => {
      mockOs.totalmem.mockReturnValue(0);
      mockOs.freemem.mockReturnValue(0);
      
      const detector = new EnvironmentDetector();
      const systemInfo = detector.getSystemInfo();
      
      expect(systemInfo.totalMemoryMB).toBe(0);
      expect(systemInfo.freeMemoryMB).toBe(0);
    });
    
    it('should handle empty environment variables', () => {
      const originalEnv = process.env;
      process.env = {};
      
      const detector = new EnvironmentDetector();
      const envVars = detector.getEnvironmentVariables();
      
      expect(envVars).toEqual({});
      
      process.env = originalEnv;
    });
  });
});
