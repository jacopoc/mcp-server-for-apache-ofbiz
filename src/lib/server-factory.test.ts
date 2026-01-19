import * as fs from 'fs';
import * as https from 'https';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type express from 'express';

import { createServer } from './server-factory.js';
import type { ServerFactoryConfig } from './server-factory.js';

// Mock dependencies
vi.mock('fs');
vi.mock('https');

describe('createServer', () => {
  let mockApp: Partial<express.Application>;
  let config: ServerFactoryConfig;
  let mockHttpServer: {
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let mockHttpsServer: {
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock HTTP server
    mockHttpServer = {
      listen: vi.fn(),
      close: vi.fn()
    };

    // Mock HTTPS server
    mockHttpsServer = {
      listen: vi.fn((port: number, callback?: () => void) => {
        if (callback) callback();
        return mockHttpsServer;
      }),
      close: vi.fn()
    };

    // Mock Express app
    mockApp = {
      listen: vi.fn((_port: number, _hostnameOrCallback?: unknown, _callback?: unknown) => {
        // Handle different overloads of listen()
        const callback =
          typeof _hostnameOrCallback === 'function' ? _hostnameOrCallback : _callback;
        if (typeof callback === 'function') callback();
        return mockHttpServer;
      }) as unknown as express.Application['listen']
    };

    // Default config
    config = {
      port: 3000,
      enableHttps: false,
      enableAuth: false,
      enableTokenExchange: false,
      configFolderPath: '/path/to/config'
    };
  });

  describe('HTTP server creation', () => {
    it('should create an HTTP server when HTTPS is disabled', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = false;

      const server = createServer(mockApp as express.Application, config);

      expect(mockApp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
      expect(server).toBe(mockHttpServer);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'MCP stateful Streamable HTTP Server listening on port 3000 with no authentication and no token exchange.'
      );

      consoleLogSpy.mockRestore();
    });

    it('should log correct message when authentication is enabled', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = false;
      config.enableAuth = true;

      createServer(mockApp as express.Application, config);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'MCP stateful Streamable HTTP Server listening on port 3000 with authentication and no token exchange.'
      );

      consoleLogSpy.mockRestore();
    });

    it('should log correct message when token exchange is enabled', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = false;
      config.enableTokenExchange = true;

      createServer(mockApp as express.Application, config);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'MCP stateful Streamable HTTP Server listening on port 3000 with no authentication and token exchange.'
      );

      consoleLogSpy.mockRestore();
    });

    it('should log correct message when both auth and token exchange are enabled', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = false;
      config.enableAuth = true;
      config.enableTokenExchange = true;

      createServer(mockApp as express.Application, config);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'MCP stateful Streamable HTTP Server listening on port 3000 with authentication and token exchange.'
      );

      consoleLogSpy.mockRestore();
    });

    it('should use the specified port', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.port = 8080;
      config.enableHttps = false;

      createServer(mockApp as express.Application, config);

      expect(mockApp.listen).toHaveBeenCalledWith(8080, expect.any(Function));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('port 8080'));

      consoleLogSpy.mockRestore();
    });
  });

  describe('HTTPS server creation', () => {
    beforeEach(() => {
      vi.mocked(https.createServer).mockReturnValue(
        mockHttpsServer as unknown as ReturnType<typeof https.createServer>
      );
      vi.mocked(fs.readFileSync).mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        if (typeof filePath === 'string') {
          if (filePath.includes('key.pem')) {
            return Buffer.from('mock-key-content');
          }
          if (filePath.includes('cert.pem')) {
            return Buffer.from('mock-cert-content');
          }
        }
        return Buffer.from('');
      });
    });

    it('should create an HTTPS server when HTTPS is enabled with TLS config', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.tlsConfig = {
        keyPath: '/absolute/path/to/key.pem',
        certPath: '/absolute/path/to/cert.pem'
      };

      const server = createServer(mockApp as express.Application, config);

      expect(fs.readFileSync).toHaveBeenCalledWith('/absolute/path/to/key.pem');
      expect(fs.readFileSync).toHaveBeenCalledWith('/absolute/path/to/cert.pem');
      expect(https.createServer).toHaveBeenCalledWith(
        {
          key: Buffer.from('mock-key-content'),
          cert: Buffer.from('mock-cert-content'),
          passphrase: undefined
        },
        mockApp
      );
      expect(server).toBe(mockHttpsServer);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'MCP stateful Streamable HTTPS Server listening on port 3000 with no authentication and no token exchange.'
      );

      consoleLogSpy.mockRestore();
    });

    it('should resolve relative key and cert paths from config folder', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.configFolderPath = '/path/to/config';
      config.tlsConfig = {
        keyPath: 'key.pem',
        certPath: 'cert.pem'
      };

      createServer(mockApp as express.Application, config);

      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/config/key.pem');
      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/config/cert.pem');

      consoleLogSpy.mockRestore();
    });

    it('should use absolute paths as-is', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.tlsConfig = {
        keyPath: '/absolute/key.pem',
        certPath: '/absolute/cert.pem'
      };

      createServer(mockApp as express.Application, config);

      expect(fs.readFileSync).toHaveBeenCalledWith('/absolute/key.pem');
      expect(fs.readFileSync).toHaveBeenCalledWith('/absolute/cert.pem');

      consoleLogSpy.mockRestore();
    });

    it('should include passphrase in server options when provided', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.tlsConfig = {
        keyPath: '/path/to/key.pem',
        certPath: '/path/to/cert.pem',
        passphrase: 'secret-passphrase'
      };

      createServer(mockApp as express.Application, config);

      expect(https.createServer).toHaveBeenCalledWith(
        {
          key: Buffer.from('mock-key-content'),
          cert: Buffer.from('mock-cert-content'),
          passphrase: 'secret-passphrase'
        },
        mockApp
      );

      consoleLogSpy.mockRestore();
    });

    it('should fall back to HTTP server when TLS config is missing for HTTPS', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.tlsConfig = undefined;

      const server = createServer(mockApp as express.Application, config);

      // Should create HTTP server as fallback since tlsConfig is undefined
      expect(mockApp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
      expect(server).toBe(mockHttpServer);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'MCP stateful Streamable HTTP Server listening on port 3000 with no authentication and no token exchange.'
      );

      consoleLogSpy.mockRestore();
    });

    it('should handle file read errors gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const readError = new Error('File not found');

      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw readError;
      });

      config.enableHttps = true;
      config.tlsConfig = {
        keyPath: '/path/to/missing/key.pem',
        certPath: '/path/to/missing/cert.pem'
      };

      expect(() => createServer(mockApp as express.Application, config)).toThrow(readError);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to start HTTPS server:', readError);

      consoleErrorSpy.mockRestore();
    });

    it('should log correct message with authentication enabled for HTTPS', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.enableAuth = true;
      config.tlsConfig = {
        keyPath: '/path/to/key.pem',
        certPath: '/path/to/cert.pem'
      };

      createServer(mockApp as express.Application, config);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'MCP stateful Streamable HTTPS Server listening on port 3000 with authentication and no token exchange.'
      );

      consoleLogSpy.mockRestore();
    });

    it('should log correct message with token exchange enabled for HTTPS', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.enableTokenExchange = true;
      config.tlsConfig = {
        keyPath: '/path/to/key.pem',
        certPath: '/path/to/cert.pem'
      };

      createServer(mockApp as express.Application, config);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'MCP stateful Streamable HTTPS Server listening on port 3000 with no authentication and token exchange.'
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe('path resolution', () => {
    beforeEach(() => {
      vi.mocked(https.createServer).mockReturnValue(
        mockHttpsServer as unknown as ReturnType<typeof https.createServer>
      );
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('mock-content'));
    });

    it('should handle Windows-style absolute paths', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.tlsConfig = {
        keyPath: 'C:\\Windows\\path\\key.pem',
        certPath: 'C:\\Windows\\path\\cert.pem'
      };

      createServer(mockApp as express.Application, config);

      // On Windows, these would be treated as absolute
      // On Unix, they'd be treated as relative
      expect(fs.readFileSync).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it('should handle relative paths with subdirectories', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.configFolderPath = '/config';
      config.tlsConfig = {
        keyPath: 'certs/server/key.pem',
        certPath: 'certs/server/cert.pem'
      };

      createServer(mockApp as express.Application, config);

      expect(fs.readFileSync).toHaveBeenCalledWith('/config/certs/server/key.pem');
      expect(fs.readFileSync).toHaveBeenCalledWith('/config/certs/server/cert.pem');

      consoleLogSpy.mockRestore();
    });

    it('should handle config folder path without trailing slash', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.configFolderPath = '/config';
      config.tlsConfig = {
        keyPath: 'key.pem',
        certPath: 'cert.pem'
      };

      createServer(mockApp as express.Application, config);

      expect(fs.readFileSync).toHaveBeenCalledWith('/config/key.pem');
      expect(fs.readFileSync).toHaveBeenCalledWith('/config/cert.pem');

      consoleLogSpy.mockRestore();
    });

    it('should handle config folder path with trailing slash', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = true;
      config.configFolderPath = '/config/';
      config.tlsConfig = {
        keyPath: 'key.pem',
        certPath: 'cert.pem'
      };

      createServer(mockApp as express.Application, config);

      // path.join handles trailing slashes correctly
      expect(fs.readFileSync).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });
  });

  describe('server lifecycle', () => {
    it('should return HTTP server instance that can be closed', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.enableHttps = false;

      const server = createServer(mockApp as express.Application, config);

      expect(server).toBe(mockHttpServer);
      expect(server.close).toBeDefined();

      consoleLogSpy.mockRestore();
    });

    it('should return HTTPS server instance that can be closed', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      vi.mocked(https.createServer).mockReturnValue(
        mockHttpsServer as unknown as ReturnType<typeof https.createServer>
      );
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('mock-content'));

      config.enableHttps = true;
      config.tlsConfig = {
        keyPath: '/path/to/key.pem',
        certPath: '/path/to/cert.pem'
      };

      const server = createServer(mockApp as express.Application, config);

      expect(server).toBe(mockHttpsServer);
      expect(server.close).toBeDefined();

      consoleLogSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('should handle empty passphrase', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      vi.mocked(https.createServer).mockReturnValue(
        mockHttpsServer as unknown as ReturnType<typeof https.createServer>
      );
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('mock-content'));

      config.enableHttps = true;
      config.tlsConfig = {
        keyPath: '/path/to/key.pem',
        certPath: '/path/to/cert.pem',
        passphrase: ''
      };

      createServer(mockApp as express.Application, config);

      expect(https.createServer).toHaveBeenCalledWith(
        expect.objectContaining({
          passphrase: ''
        }),
        mockApp
      );

      consoleLogSpy.mockRestore();
    });

    it('should handle port 0 (random port)', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.port = 0;
      config.enableHttps = false;

      createServer(mockApp as express.Application, config);

      expect(mockApp.listen).toHaveBeenCalledWith(0, expect.any(Function));

      consoleLogSpy.mockRestore();
    });

    it('should handle high port numbers', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      config.port = 65535;
      config.enableHttps = false;

      createServer(mockApp as express.Application, config);

      expect(mockApp.listen).toHaveBeenCalledWith(65535, expect.any(Function));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('port 65535'));

      consoleLogSpy.mockRestore();
    });
  });
});
