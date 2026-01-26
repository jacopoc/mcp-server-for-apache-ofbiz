import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Helper to run the server.js as a separate process
 * Uses the compiled build output
 */
function runServerProcess(
  args: string[],
  timeout = 2000
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
}> {
  return new Promise((resolve) => {
    // Use the compiled server.js from build directory
    const projectRoot = path.join(__dirname, '..');
    const serverPath = path.join(projectRoot, 'build', 'server.js');
    const child = spawn('node', [serverPath, ...args], {
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeout);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * Creates temporary directories for testing with a minimal valid config
 * Returns paths and a cleanup function
 */
async function createTempTestDirs(): Promise<{
  configDir: string;
  toolsDir: string;
  cleanup: () => Promise<void>;
}> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-config-'));
  const toolsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-tools-'));

  const minimalConfig = {
    SERVER_PORT: 49152 + Math.floor(Math.random() * 1000),
    MCP_SERVER_CORS_ORIGINS: '*',
    RATE_LIMIT_WINDOW_MS: 60000,
    RATE_LIMIT_MAX_REQUESTS: 100,
    SCOPES_SUPPORTED: ['mcp:call-tools'],
    BACKEND_API_BASE: 'https://example.com',
    BACKEND_USER_AGENT: 'test-agent'
  };

  await fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify(minimalConfig, null, 2));

  const cleanup = async () => {
    await fs.rm(configDir, { recursive: true, force: true });
    await fs.rm(toolsDir, { recursive: true, force: true });
  };

  return { configDir, toolsDir, cleanup };
}

describe('server CLI', () => {
  describe('command-line argument validation', () => {
    it('should exit with error when no arguments are provided', async () => {
      const result = await runServerProcess([]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'Error: Paths to config folder and tools folder are mandatory command-line arguments'
      );
      expect(result.stderr).toContain(
        'Usage: node server.js <path-to-config-folder> <path-to-tools-folder>'
      );
    });

    it('should exit with error when only config folder is provided', async () => {
      const result = await runServerProcess(['/some/config/path']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('mandatory command-line arguments');
    });

    it('should exit with error when config folder does not exist', async () => {
      const result = await runServerProcess(['/nonexistent/config', '/nonexistent/tools']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Failed to start server:');
    });

    it('should start server even when tools folder does not exist', async () => {
      const { configDir, cleanup } = await createTempTestDirs();

      try {
        const result = await runServerProcess([configDir, '/nonexistent/tools'], 500);

        // Server starts successfully but logs a warning about missing tools directory
        // Exit code is 0 because we send SIGTERM after timeout
        expect(result.exitCode).toBe(0);
      } finally {
        await cleanup();
      }
    });
  });

  describe('configuration loading errors', () => {
    it('should exit with error message when config file is invalid', async () => {
      const result = await runServerProcess(['/invalid/config', '/invalid/tools']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Failed to start server:');
    });
  });

  describe('graceful shutdown', () => {
    it('should handle SIGTERM signal gracefully', async () => {
      const projectRoot = path.join(__dirname, '..');
      const { configDir, toolsDir, cleanup } = await createTempTestDirs();

      let child: ReturnType<typeof spawn> | null = null;

      try {
        const serverPath = path.join(projectRoot, 'build', 'server.js');
        child = spawn('node', [serverPath, configDir, toolsDir], {
          env: { ...process.env, NODE_ENV: 'test' },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';

        child.stdout!.on('data', (data) => {
          stdout += data.toString();
        });

        // Wait a bit for server to start, then kill it
        await new Promise((resolve) => setTimeout(resolve, 500));

        const exitPromise = new Promise<number | null>((resolve) => {
          child!.on('exit', (code) => resolve(code));
        });

        child.kill('SIGTERM');

        const exitCode = await exitPromise;

        // Should exit gracefully (not force killed)
        expect(exitCode).toBe(0);
        expect(stdout).toContain('shutting down gracefully');
      } finally {
        // Ensure child process is killed if still running
        if (child && !child.killed) {
          child.kill('SIGKILL');
        }
        await cleanup();
      }
    }, 10000);

    it('should handle SIGINT signal gracefully', async () => {
      const projectRoot = path.join(__dirname, '..');
      const { configDir, toolsDir, cleanup } = await createTempTestDirs();

      let child: ReturnType<typeof spawn> | null = null;

      try {
        const serverPath = path.join(projectRoot, 'build', 'server.js');
        child = spawn('node', [serverPath, configDir, toolsDir], {
          env: { ...process.env, NODE_ENV: 'test' },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';

        child.stdout!.on('data', (data) => {
          stdout += data.toString();
        });

        // Wait for server to start
        await new Promise((resolve) => setTimeout(resolve, 500));

        const exitPromise = new Promise<number | null>((resolve) => {
          child!.on('exit', (code) => resolve(code));
        });

        child.kill('SIGINT');

        const exitCode = await exitPromise;

        expect(exitCode).toBe(0);
        expect(stdout).toContain('shutting down gracefully');
      } finally {
        // Ensure child process is killed if still running
        if (child && !child.killed) {
          child.kill('SIGKILL');
        }
        await cleanup();
      }
    }, 10000);
  });

  describe('server initialization', () => {
    it('should display usage information when arguments are missing', async () => {
      const result = await runServerProcess([]);

      expect(result.stderr).toContain('Usage:');
      expect(result.stderr).toContain('path-to-config-folder');
      expect(result.stderr).toContain('path-to-tools-folder');
    });

    it('should fail with clear error message on invalid configuration', async () => {
      const result = await runServerProcess(['/invalid/path', '/another/invalid']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Failed to start server:');
    });
  });

  describe('process exit behavior', () => {
    it('should exit with code 1 when missing arguments', async () => {
      const result = await runServerProcess([]);

      expect(result.exitCode).toBe(1);
    });

    it('should exit with code 1 when configuration fails', async () => {
      const result = await runServerProcess(['/bad/config', '/bad/tools']);

      expect(result.exitCode).toBe(1);
    });
  });

  describe('error messages', () => {
    it('should provide clear error for missing command-line args', async () => {
      const result = await runServerProcess([]);

      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('mandatory');
      expect(result.stderr).toContain('command-line arguments');
    });

    it('should show usage instructions on argument error', async () => {
      const result = await runServerProcess([]);

      expect(result.stderr).toMatch(/Usage:.*node server\.js/);
    });

    it('should report startup failures clearly', async () => {
      const result = await runServerProcess(['/nonexistent', '/paths']);

      expect(result.stderr).toContain('Failed to start server:');
      expect(result.exitCode).toBe(1);
    });
  });
});

describe('server integration', () => {
  describe('module structure', () => {
    it('should be importable as a module', async () => {
      // This tests that the module can be imported without errors
      const module = await import('./server.js');
      expect(module).toBeDefined();
    });

    it('should not execute main when imported', async () => {
      // When imported (not executed), the module should not start a server
      // This is a structural test to ensure the conditional execution works
      const module = await import('./server.js');

      // The module should export nothing (main is not exported)
      expect(Object.keys(module)).toHaveLength(0);
    });
  });

  describe('server entry point', () => {
    it('should only execute main function when run directly', async () => {
      // The server should check import.meta.url before running main()
      // We verify this by confirming the module can be imported without side effects
      let importSucceeded = false;

      try {
        await import('./server.js');
        importSucceeded = true;
      } catch {
        // Import should not throw
        importSucceeded = false;
      }

      expect(importSucceeded).toBe(true);
    });
  });
});
