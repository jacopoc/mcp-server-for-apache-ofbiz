import { describe, it, expect, vi, beforeEach } from 'vitest';
import type express from 'express';

import type { ToolDefinition, ServerConfig } from '../config/types.js';
import type { AuthenticatedRequest } from '../auth/middleware.js';

import { createMcpRequestHandler, createSessionRequestHandler } from './request-handler.js';
import type { McpRequestHandlerConfig } from './request-handler.js';
import type { SessionManager } from './session-manager.js';

// Mock instance tracking - must be let variables at module scope
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastMcpServerInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastTransportInstance: any = null;

// Mock the MCP SDK modules
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    McpServer: class MockMcpServer {
      registerTool = vi.fn();
      connect = vi.fn().mockResolvedValue(undefined);

      constructor(_config: { name: string; version: string }) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        lastMcpServerInstance = this;
      }
    }
  };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => {
  return {
    StreamableHTTPServerTransport: class MockStreamableHTTPServerTransport {
      sessionId: string | null = null;
      onclose: (() => void) | null = null;
      handleRequest = vi.fn().mockResolvedValue(undefined);
      private sessionIdGenerator: (() => string) | undefined;
      constructorOptions?: {
        sessionIdGenerator?: () => string;
        onsessioninitialized?: (sessionId: string) => void;
        enableDnsRebindingProtection?: boolean;
        allowedHosts?: string[];
        allowedOrigins?: string[];
      };

      constructor(options?: {
        sessionIdGenerator?: () => string;
        onsessioninitialized?: (sessionId: string) => void;
        enableDnsRebindingProtection?: boolean;
        allowedHosts?: string[];
        allowedOrigins?: string[];
      }) {
        this.sessionIdGenerator = options?.sessionIdGenerator;
        this.constructorOptions = options;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        lastTransportInstance = this;

        // Simulate session initialization
        if (options?.onsessioninitialized) {
          const sessionId = this.sessionIdGenerator?.() || 'mock-session-id';
          this.sessionId = sessionId;
          setTimeout(() => options.onsessioninitialized!(sessionId), 0);
        }
      }
    }
  };
});

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  isInitializeRequest: vi.fn()
}));

describe('createMcpRequestHandler', () => {
  let mockReq: Partial<express.Request>;
  let mockRes: Partial<express.Response>;
  let mockSessionManager: Partial<SessionManager>;
  let mockLoadTools: (config: ServerConfig, toolsPath: string) => Promise<ToolDefinition[]>;
  let mockPerformTokenExchange: (subjectToken: string, config: unknown) => Promise<string | null>;
  let mockGetBackendAccessToken: () => string | undefined;
  let config: McpRequestHandlerConfig;

  const mockServerConfig: ServerConfig = {
    BACKEND_API_BASE: 'https://api.example.com',
    SERVER_PORT: 3000
  };

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    lastMcpServerInstance = null;
    lastTransportInstance = null;

    mockReq = {
      headers: {},
      body: {}
    };

    const jsonMock = vi.fn().mockReturnThis();
    const statusMock = vi.fn().mockReturnThis();
    const sendMock = vi.fn().mockReturnThis();

    mockRes = {
      status: statusMock,
      json: jsonMock,
      send: sendMock
    };

    mockSessionManager = {
      getTransport: vi.fn().mockReturnValue(undefined),
      addSession: vi.fn(),
      deleteSession: vi.fn(),
      getDownstreamToken: vi.fn().mockReturnValue(null),
      setDownstreamToken: vi.fn(),
      getSessionCount: vi.fn().mockReturnValue(0),
      hasSession: vi.fn().mockReturnValue(false),
      clear: vi.fn()
    };

    mockLoadTools = vi.fn().mockResolvedValue([]);
    mockPerformTokenExchange = vi.fn().mockResolvedValue(null);
    mockGetBackendAccessToken = vi.fn().mockReturnValue(undefined);

    config = {
      sessionManager: mockSessionManager as SessionManager,
      loadTools: mockLoadTools,
      serverConfig: mockServerConfig,
      toolsFolderPath: '/path/to/tools',
      dnsRebindingProtectionAllowedHosts: [],
      dnsRebindingProtectionAllowedOrigins: [],
      enableAuth: false,
      performTokenExchange: mockPerformTokenExchange,
      tokenExchangeConfig: undefined,
      getBackendAccessToken: mockGetBackendAccessToken
    };
  });

  describe('session validation', () => {
    it('should return 400 when no session ID and request is not initialize', async () => {
      const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');
      vi.mocked(isInitializeRequest).mockReturnValue(false);

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided'
        },
        id: null
      });
    });

    it('should reuse existing transport when valid session ID is provided', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
        sessionId: 'existing-session-id'
      };

      mockReq.headers = { 'mcp-session-id': 'existing-session-id' };
      (mockSessionManager.getTransport as ReturnType<typeof vi.fn>).mockReturnValue(
        mockTransport as unknown as ReturnType<SessionManager['getTransport']>
      );

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      expect(mockSessionManager.getTransport).toHaveBeenCalledWith('existing-session-id');
      expect(mockTransport.handleRequest).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });
  });

  describe('initialize request handling', () => {
    it('should create new transport for initialize request without session ID', async () => {
      const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');

      vi.mocked(isInitializeRequest).mockReturnValue(true);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      // Wait for async session initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(lastTransportInstance).not.toBeNull();
      expect(lastMcpServerInstance).not.toBeNull();
      expect(mockLoadTools).toHaveBeenCalledWith(mockServerConfig, '/path/to/tools');

      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should register tools during initialization', async () => {
      const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');

      vi.mocked(isInitializeRequest).mockReturnValue(true);

      const mockTools: ToolDefinition[] = [
        {
          name: 'test-tool-1',
          metadata: {
            title: 'Test Tool 1',
            description: 'A test tool',
            inputSchema: {},
            outputSchema: {}
          },
          handler: vi.fn()
        },
        {
          name: 'test-tool-2',
          metadata: {
            title: 'Test Tool 2',
            description: 'Another test tool',
            inputSchema: {},
            outputSchema: {}
          },
          handler: vi.fn()
        }
      ];

      vi.mocked(mockLoadTools).mockResolvedValue(mockTools);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(lastMcpServerInstance).not.toBeNull();
      expect(lastMcpServerInstance!.registerTool).toHaveBeenCalledWith(
        'test-tool-1',
        mockTools[0].metadata,
        mockTools[0].handler
      );
      expect(lastMcpServerInstance!.registerTool).toHaveBeenCalledWith(
        'test-tool-2',
        mockTools[1].metadata,
        mockTools[1].handler
      );

      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should handle tool loading errors', async () => {
      const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');
      vi.mocked(isInitializeRequest).mockReturnValue(true);

      const loadError = new Error('Failed to load tools');
      vi.mocked(mockLoadTools).mockRejectedValue(loadError);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);

      await expect(
        handler(mockReq as express.Request, mockRes as express.Response)
      ).rejects.toThrow('Failed to load tools');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading tools:', loadError);

      consoleErrorSpy.mockRestore();
    });

    it('should enable DNS rebinding protection when allowed hosts are provided', async () => {
      const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');

      vi.mocked(isInitializeRequest).mockReturnValue(true);

      config.dnsRebindingProtectionAllowedHosts = ['localhost', 'example.com'];
      config.dnsRebindingProtectionAllowedOrigins = ['https://example.com'];

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(lastTransportInstance).not.toBeNull();
      expect(lastTransportInstance!.constructorOptions?.enableDnsRebindingProtection).toBe(true);
      expect(lastTransportInstance!.constructorOptions?.allowedHosts).toEqual([
        'localhost',
        'example.com'
      ]);
      expect(lastTransportInstance!.constructorOptions?.allowedOrigins).toEqual([
        'https://example.com'
      ]);

      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should disable DNS rebinding protection when no allowed hosts', async () => {
      const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');

      vi.mocked(isInitializeRequest).mockReturnValue(true);

      config.dnsRebindingProtectionAllowedHosts = [];

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(lastTransportInstance).not.toBeNull();
      expect(lastTransportInstance!.constructorOptions?.enableDnsRebindingProtection).toBe(false);

      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
  });

  describe('session management', () => {
    it('should add session to session manager on initialization', async () => {
      const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');
      vi.mocked(isInitializeRequest).mockReturnValue(true);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      // Wait for session initialization callback
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockSessionManager.addSession).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it('should delete session when transport closes', async () => {
      const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');

      vi.mocked(isInitializeRequest).mockReturnValue(true);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Get the transport instance and trigger onclose
      expect(lastTransportInstance).not.toBeNull();
      if (lastTransportInstance!.onclose) {
        lastTransportInstance!.onclose();
      }

      expect(mockSessionManager.deleteSession).toHaveBeenCalledWith(
        lastTransportInstance!.sessionId
      );

      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
  });

  describe('token exchange', () => {
    it('should perform token exchange when auth is enabled and configured', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
        sessionId: 'test-session-id'
      };

      mockReq.headers = { 'mcp-session-id': 'test-session-id' };
      (mockReq as AuthenticatedRequest).auth = {
        valid: true,
        userId: 'user-123',
        scopes: ['read', 'write'],
        subjectToken: 'subject-token-123'
      };

      (mockSessionManager.getTransport as ReturnType<typeof vi.fn>).mockReturnValue(
        mockTransport as unknown as ReturnType<SessionManager['getTransport']>
      );
      vi.mocked(mockPerformTokenExchange).mockResolvedValue('downstream-token-123');

      config.enableAuth = true;
      config.tokenExchangeConfig = {
        authzServerBaseUrl: 'https://auth.example.com',
        mcpServerClientId: 'mcp-client-id',
        mcpServerClientSecret: 'mcp-client-secret',
        tokenExchangeScope: ['backend-scope'],
        backendApiResource: 'https://backend.example.com'
      };

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      expect(mockPerformTokenExchange).toHaveBeenCalledWith(
        'subject-token-123',
        config.tokenExchangeConfig
      );
      expect(mockSessionManager.setDownstreamToken).toHaveBeenCalledWith(
        'test-session-id',
        'downstream-token-123'
      );
      expect((mockReq as AuthenticatedRequest).auth?.downstreamToken).toBe('downstream-token-123');

      consoleLogSpy.mockRestore();
    });

    it('should use cached downstream token if available', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
        sessionId: 'test-session-id'
      };

      mockReq.headers = { 'mcp-session-id': 'test-session-id' };
      (mockReq as AuthenticatedRequest).auth = {
        valid: true,
        userId: 'user-123',
        scopes: ['read']
      };

      (mockSessionManager.getTransport as ReturnType<typeof vi.fn>).mockReturnValue(
        mockTransport as unknown as ReturnType<SessionManager['getTransport']>
      );
      (mockSessionManager.getDownstreamToken as ReturnType<typeof vi.fn>).mockReturnValue(
        'cached-token-456'
      );

      config.enableAuth = true;

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      expect(mockPerformTokenExchange).not.toHaveBeenCalled();
      expect((mockReq as AuthenticatedRequest).auth?.downstreamToken).toBe('cached-token-456');

      consoleLogSpy.mockRestore();
    });

    it('should fallback to static token when token exchange fails', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
        sessionId: 'test-session-id'
      };

      mockReq.headers = { 'mcp-session-id': 'test-session-id' };
      (mockReq as AuthenticatedRequest).auth = {
        valid: true,
        userId: 'user-123',
        scopes: ['read'],
        subjectToken: 'subject-token-123'
      };

      (mockSessionManager.getTransport as ReturnType<typeof vi.fn>).mockReturnValue(
        mockTransport as unknown as ReturnType<SessionManager['getTransport']>
      );
      vi.mocked(mockPerformTokenExchange).mockResolvedValue(null);
      vi.mocked(mockGetBackendAccessToken).mockReturnValue('static-token-789');

      config.enableAuth = true;
      config.tokenExchangeConfig = {
        authzServerBaseUrl: 'https://auth.example.com',
        mcpServerClientId: 'mcp-client-id',
        mcpServerClientSecret: 'mcp-client-secret',
        tokenExchangeScope: ['backend-scope'],
        backendApiResource: 'https://backend.example.com'
      };

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      expect(mockPerformTokenExchange).toHaveBeenCalled();
      expect(mockGetBackendAccessToken).toHaveBeenCalled();
      expect((mockReq as AuthenticatedRequest).auth?.downstreamToken).toBe('static-token-789');

      consoleLogSpy.mockRestore();
    });

    it('should initialize auth object when not present and auth disabled', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined),
        sessionId: 'test-session-id'
      };

      mockReq.headers = { 'mcp-session-id': 'test-session-id' };
      (mockSessionManager.getTransport as ReturnType<typeof vi.fn>).mockReturnValue(
        mockTransport as unknown as ReturnType<SessionManager['getTransport']>
      );

      config.enableAuth = false;

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const handler = createMcpRequestHandler(config);
      await handler(mockReq as express.Request, mockRes as express.Response);

      expect((mockReq as AuthenticatedRequest).auth).toEqual({
        valid: true,
        downstreamToken: null
      });

      consoleLogSpy.mockRestore();
    });
  });
});

describe('createSessionRequestHandler', () => {
  let mockReq: Partial<express.Request>;
  let mockRes: Partial<express.Response>;
  let mockSessionManager: Partial<SessionManager>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      headers: {}
    };

    const sendMock = vi.fn().mockReturnThis();
    const statusMock = vi.fn().mockReturnThis();

    mockRes = {
      status: statusMock,
      send: sendMock
    };

    mockSessionManager = {
      getTransport: vi.fn().mockReturnValue(undefined),
      addSession: vi.fn(),
      deleteSession: vi.fn(),
      getDownstreamToken: vi.fn().mockReturnValue(null),
      setDownstreamToken: vi.fn(),
      getSessionCount: vi.fn().mockReturnValue(0),
      hasSession: vi.fn().mockReturnValue(false),
      clear: vi.fn()
    };
  });

  describe('session validation', () => {
    it('should return 400 when session ID is missing', async () => {
      const handler = createSessionRequestHandler(mockSessionManager as SessionManager);
      await handler(mockReq as express.Request, mockRes as express.Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith('Invalid or missing session ID');
    });

    it('should return 400 when session ID is invalid', async () => {
      mockReq.headers = { 'mcp-session-id': 'invalid-session-id' };
      (mockSessionManager.getTransport as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

      const handler = createSessionRequestHandler(mockSessionManager as SessionManager);
      await handler(mockReq as express.Request, mockRes as express.Response);

      expect(mockSessionManager.getTransport).toHaveBeenCalledWith('invalid-session-id');
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith('Invalid or missing session ID');
    });

    it('should delegate to transport when session ID is valid', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockResolvedValue(undefined)
      };

      mockReq.headers = { 'mcp-session-id': 'valid-session-id' };
      (mockSessionManager.getTransport as ReturnType<typeof vi.fn>).mockReturnValue(
        mockTransport as unknown as ReturnType<SessionManager['getTransport']>
      );

      const handler = createSessionRequestHandler(mockSessionManager as SessionManager);
      await handler(mockReq as express.Request, mockRes as express.Response);

      expect(mockSessionManager.getTransport).toHaveBeenCalledWith('valid-session-id');
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(mockReq, mockRes);
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });
});
