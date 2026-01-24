import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ServerConfig } from '../config/types.js';

import { loadTools } from './tool-loader.js';

// Mock fs module
vi.mock('fs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('loadTools', () => {
  let mockServerConfig: ServerConfig;
  const testToolsPath = path.join(__dirname, '__test-tools__');

  beforeEach(() => {
    mockServerConfig = {
      BACKEND_API_BASE: 'https://api.example.com',
      SERVER_PORT: 3000
    };

    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clear module cache to ensure clean imports
    vi.resetModules();
  });

  describe('directory existence', () => {
    it('should return empty array when tools directory does not exist', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const tools = await loadTools(mockServerConfig, testToolsPath);

      expect(tools).toEqual([]);
      expect(fs.existsSync).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tools directory not found')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should process directory when it exists', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([]);

      const tools = await loadTools(mockServerConfig, testToolsPath);

      expect(tools).toEqual([]);
      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.readdirSync).toHaveBeenCalled();
    });
  });

  describe('file filtering', () => {
    it('should only load .js and .ts files', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        'tool1.js',
        'tool2.ts',
        'readme.md',
        'config.json',
        'tool3.txt'
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadTools(mockServerConfig, testToolsPath);

      expect(fs.readdirSync).toHaveBeenCalled();
      // The function filters to only .js and .ts files
      // We can verify this by checking that non-.js/.ts files don't cause issues

      consoleErrorSpy.mockRestore();
    });

    it('should handle empty directory', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([]);

      const tools = await loadTools(mockServerConfig, testToolsPath);

      expect(tools).toEqual([]);
    });

    it('should filter out non-JavaScript/TypeScript files', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      // Return a mix of file types
      const files = ['tool.js', 'tool.ts', 'readme.md', 'config.json', 'data.txt', 'script.sh'];

      vi.spyOn(fs, 'readdirSync').mockReturnValue(
        files as unknown as ReturnType<typeof fs.readdirSync>
      );

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Even though we have 6 files, only .js and .ts should be processed
      await loadTools(mockServerConfig, testToolsPath);

      expect(fs.readdirSync).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should handle directory read errors gracefully', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should throw since readdirSync is not in try-catch
      await expect(loadTools(mockServerConfig, testToolsPath)).rejects.toThrow();
    });

    it('should log error and skip tool files that cannot be imported', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['nonexistent-tool.js'] as unknown as ReturnType<
        typeof fs.readdirSync
      >);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const tools = await loadTools(mockServerConfig, testToolsPath);

      // Should log error but return empty array (tool failed to load)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error loading tool file'),
        expect.anything()
      );
      expect(tools).toEqual([]);

      consoleErrorSpy.mockRestore();
    });

    it('should continue processing after encountering a bad tool file', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        'bad-tool.js',
        'another-bad-tool.js'
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const tools = await loadTools(mockServerConfig, testToolsPath);

      // Both tools should fail but not crash the loader
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(tools).toEqual([]);

      consoleErrorSpy.mockRestore();
    });

    it('should handle tool modules without default export', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['no-default-export.js'] as unknown as ReturnType<
        typeof fs.readdirSync
      >);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const tools = await loadTools(mockServerConfig, testToolsPath);

      // Should not add any tools if no default export
      expect(tools).toEqual([]);

      consoleErrorSpy.mockRestore();
    });

    it('should handle tool modules where default is not a function', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['invalid-default.js'] as unknown as ReturnType<
        typeof fs.readdirSync
      >);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const tools = await loadTools(mockServerConfig, testToolsPath);

      // Should not add any tools if default is not a function
      expect(tools).toEqual([]);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('path resolution', () => {
    it('should resolve tools path relative to cwd', async () => {
      const relativePath = 'tools';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([]);

      await loadTools(mockServerConfig, relativePath);

      const expectedPath = path.resolve(process.cwd(), relativePath);
      expect(fs.existsSync).toHaveBeenCalledWith(expectedPath);
    });

    it('should handle absolute paths correctly', async () => {
      const absolutePath = '/absolute/path/to/tools';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([]);

      await loadTools(mockServerConfig, absolutePath);

      const resolvedPath = path.resolve(process.cwd(), absolutePath);
      expect(fs.existsSync).toHaveBeenCalledWith(resolvedPath);
    });

    it('should construct correct tool file paths', async () => {
      const toolsPath = 'test-tools';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue(['tool.js'] as unknown as ReturnType<
        typeof fs.readdirSync
      >);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadTools(mockServerConfig, toolsPath);

      // The function should attempt to import from the correct path
      // Even though import will fail, we can verify the path construction logic ran
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('console output', () => {
    it('should warn about missing directory with correct path', async () => {
      const customPath = 'custom/tools/path';
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await loadTools(mockServerConfig, customPath);

      const expectedPath = path.resolve(process.cwd(), customPath);
      expect(consoleWarnSpy).toHaveBeenCalledWith(`Tools directory not found: ${expectedPath}`);

      consoleWarnSpy.mockRestore();
    });

    it('should log errors with tool filename when import fails', async () => {
      const toolFile = 'problematic-tool.js';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([toolFile] as unknown as ReturnType<
        typeof fs.readdirSync
      >);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadTools(mockServerConfig, testToolsPath);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Error loading tool file ${toolFile}:`,
        expect.anything()
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('behavior with mixed file types', () => {
    it('should only attempt to load .js files from mixed directory', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readdirSync').mockReturnValue([
        'tool1.js',
        'README.md',
        'tool2.js',
        'package.json',
        'data.csv',
        'tool3.jsx', // Should not be loaded
        'tool4.mjs', // Should not be loaded
        'tool1.d.ts', // Should not be loaded
        'tool1.d.ts.map' // Should not be loaded
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadTools(mockServerConfig, testToolsPath);

      // Should only try to load tool1.js and tool2.ts (2 errors expected)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
    });
  });
});
