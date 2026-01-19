import { describe, it, expect, vi, beforeEach } from 'vitest';
import type express from 'express';

import type { ServerConfig, DerivedConfig } from './config/types.js';
import type { SessionManager } from './mcp/session-manager.js';
import type {
  createMcpRequestHandler,
  createSessionRequestHandler
} from './mcp/request-handler.js';
import { createApp } from './app.js';
import type { CreateAppConfig } from './app.js';

// Mock dependencies
vi.mock('express', () => {
  const mockApp = {
    use: vi.fn().mockReturnThis(),
    post: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis()
  };

  const expressMock = Object.assign(
    vi.fn(() => mockApp),
    {
      json: vi.fn(() => 'json-middleware')
    }
  );

  return { default: expressMock };
});

vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => 'rate-limiter-middleware')
}));

vi.mock('cors', () => ({
  default: vi.fn(() => 'cors-middleware')
}));

vi.mock('@modelcontextprotocol/sdk/server/auth/router.js', () => ({
  mcpAuthMetadataRouter: vi.fn(() => 'auth-metadata-router')
}));

describe('createApp', () => {
  let mockConfig: ServerConfig;
  let mockDerivedConfig: DerivedConfig;
  let mockSessionManager: Partial<SessionManager>;
  let mockMcpRequestHandler: ReturnType<typeof createMcpRequestHandler>;
  let mockSessionRequestHandler: ReturnType<typeof createSessionRequestHandler>;
  let mockAuthMiddleware: express.RequestHandler;
  let appConfig: CreateAppConfig;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockConfig = {
      BACKEND_API_BASE: 'https://api.example.com',
      SERVER_PORT: 3000,
      MCP_SERVER_CORS_ORIGINS: ['https://example.com'],
      AUTHZ_SERVER_BASE_URL: 'https://auth.example.com',
      MCP_SERVER_BASE_URL: 'https://mcp.example.com',
      SCOPES_SUPPORTED: ['read', 'write']
    };

    mockDerivedConfig = {
      enableAuth: false,
      enableTokenExchange: false,
      enableHttps: false,
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 100,
      dnsRebindingProtectionAllowedHosts: [],
      dnsRebindingProtectionAllowedOrigins: [],
      tokenExchangeScope: []
    };

    mockSessionManager = {
      getTransport: vi.fn(),
      addSession: vi.fn(),
      deleteSession: vi.fn(),
      getDownstreamToken: vi.fn(),
      setDownstreamToken: vi.fn(),
      getSessionCount: vi.fn().mockReturnValue(0),
      hasSession: vi.fn(),
      clear: vi.fn()
    };

    mockMcpRequestHandler = vi.fn() as ReturnType<typeof createMcpRequestHandler>;
    mockSessionRequestHandler = vi.fn() as ReturnType<typeof createSessionRequestHandler>;
    mockAuthMiddleware = vi.fn() as express.RequestHandler;

    appConfig = {
      config: mockConfig,
      derivedConfig: mockDerivedConfig,
      sessionManager: mockSessionManager as SessionManager,
      mcpRequestHandler: mockMcpRequestHandler,
      sessionRequestHandler: mockSessionRequestHandler
    };
  });

  describe('basic middleware configuration', () => {
    it('should create an Express application', async () => {
      const expressMod = await import('express');
      const app = createApp(appConfig);

      expect(expressMod.default).toHaveBeenCalled();
      expect(app).toBeDefined();
    });

    it('should configure JSON body parser middleware', async () => {
      const expressMod = await import('express');
      const app = createApp(appConfig);

      expect(expressMod.default.json).toHaveBeenCalled();
      expect(app.use).toHaveBeenCalledWith('json-middleware');
    });

    it('should configure CORS middleware with correct options', async () => {
      const corsMod = await import('cors');
      const app = createApp(appConfig);

      expect(corsMod.default).toHaveBeenCalledWith({
        origin: ['https://example.com'],
        exposedHeaders: ['Mcp-Session-Id']
      });
      expect(app.use).toHaveBeenCalledWith('cors-middleware');
    });

    it('should configure rate limiting middleware', async () => {
      const rateLimitMod = await import('express-rate-limit');
      const app = createApp(appConfig);

      expect(rateLimitMod.default).toHaveBeenCalledWith({
        windowMs: 60000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false
      });
      expect(app.use).toHaveBeenCalledWith('rate-limiter-middleware');
    });

    it('should use custom rate limit configuration', async () => {
      const rateLimitMod = await import('express-rate-limit');

      appConfig.derivedConfig.rateLimitWindowMs = 120000;
      appConfig.derivedConfig.rateLimitMaxRequests = 200;

      createApp(appConfig);

      expect(rateLimitMod.default).toHaveBeenCalledWith({
        windowMs: 120000,
        max: 200,
        standardHeaders: true,
        legacyHeaders: false
      });
    });
  });

  describe('OAuth metadata configuration', () => {
    it('should configure OAuth metadata router when auth is enabled', async () => {
      const authRouterMod = await import('@modelcontextprotocol/sdk/server/auth/router.js');

      appConfig.derivedConfig.enableAuth = true;
      appConfig.config.MCP_SERVER_BASE_URL = 'https://mcp.example.com';
      appConfig.config.AUTHZ_SERVER_BASE_URL = 'https://auth.example.com';
      appConfig.config.SCOPES_SUPPORTED = ['read', 'write'];

      const app = createApp(appConfig);

      expect(authRouterMod.mcpAuthMetadataRouter).toHaveBeenCalledWith({
        oauthMetadata: {
          issuer: 'https://auth.example.com/',
          introspection_endpoint: '',
          authorization_endpoint: '',
          token_endpoint: '',
          registration_endpoint: '',
          response_types_supported: ['code']
        },
        resourceServerUrl: new URL('https://mcp.example.com'),
        scopesSupported: ['read', 'write'],
        resourceName: 'MCP Server for Apache OFBiz'
      });
      expect(app.use).toHaveBeenCalledWith('auth-metadata-router');
    });

    it('should not configure OAuth metadata when auth is disabled', async () => {
      const authRouterMod = await import('@modelcontextprotocol/sdk/server/auth/router.js');

      appConfig.derivedConfig.enableAuth = false;

      createApp(appConfig);

      expect(authRouterMod.mcpAuthMetadataRouter).not.toHaveBeenCalled();
    });

    it('should not configure OAuth metadata when MCP_SERVER_BASE_URL is missing', async () => {
      const authRouterMod = await import('@modelcontextprotocol/sdk/server/auth/router.js');

      appConfig.derivedConfig.enableAuth = true;
      appConfig.config.MCP_SERVER_BASE_URL = undefined;

      createApp(appConfig);

      expect(authRouterMod.mcpAuthMetadataRouter).not.toHaveBeenCalled();
    });

    it('should use empty array for scopes when SCOPES_SUPPORTED is undefined', async () => {
      const authRouterMod = await import('@modelcontextprotocol/sdk/server/auth/router.js');

      appConfig.derivedConfig.enableAuth = true;
      appConfig.config.MCP_SERVER_BASE_URL = 'https://mcp.example.com';
      appConfig.config.SCOPES_SUPPORTED = undefined;

      createApp(appConfig);

      expect(authRouterMod.mcpAuthMetadataRouter).toHaveBeenCalledWith(
        expect.objectContaining({
          scopesSupported: []
        })
      );
    });
  });

  describe('MCP endpoint routes with authentication', () => {
    it('should configure authenticated routes when auth is enabled', () => {
      appConfig.derivedConfig.enableAuth = true;
      appConfig.authMiddleware = mockAuthMiddleware;

      const app = createApp(appConfig);

      expect(app.post).toHaveBeenCalledWith('/mcp', mockAuthMiddleware, mockMcpRequestHandler);
      expect(app.get).toHaveBeenCalledWith('/mcp', mockAuthMiddleware, mockSessionRequestHandler);
      expect(app.delete).toHaveBeenCalledWith(
        '/mcp',
        mockAuthMiddleware,
        mockSessionRequestHandler
      );
    });

    it('should not use auth middleware when enableAuth is true but authMiddleware is not provided', () => {
      appConfig.derivedConfig.enableAuth = true;
      appConfig.authMiddleware = undefined;

      const app = createApp(appConfig);

      // Should fall back to unauthenticated routes
      expect(app.post).toHaveBeenCalledWith('/mcp', mockMcpRequestHandler);
      expect(app.get).toHaveBeenCalledWith('/mcp', mockSessionRequestHandler);
      expect(app.delete).toHaveBeenCalledWith('/mcp', mockSessionRequestHandler);
    });
  });

  describe('MCP endpoint routes without authentication', () => {
    it('should configure unauthenticated routes when auth is disabled', () => {
      appConfig.derivedConfig.enableAuth = false;

      const app = createApp(appConfig);

      expect(app.post).toHaveBeenCalledWith('/mcp', mockMcpRequestHandler);
      expect(app.get).toHaveBeenCalledWith('/mcp', mockSessionRequestHandler);
      expect(app.delete).toHaveBeenCalledWith('/mcp', mockSessionRequestHandler);
    });

    it('should not pass auth middleware to routes when auth is disabled', () => {
      appConfig.derivedConfig.enableAuth = false;
      appConfig.authMiddleware = mockAuthMiddleware;

      const app = createApp(appConfig);

      // Auth middleware should not be used
      expect(app.post).not.toHaveBeenCalledWith('/mcp', mockAuthMiddleware, expect.anything());
      expect(app.get).not.toHaveBeenCalledWith('/mcp', mockAuthMiddleware, expect.anything());
      expect(app.delete).not.toHaveBeenCalledWith('/mcp', mockAuthMiddleware, expect.anything());

      // Should use unauthenticated routes
      expect(app.post).toHaveBeenCalledWith('/mcp', mockMcpRequestHandler);
      expect(app.get).toHaveBeenCalledWith('/mcp', mockSessionRequestHandler);
      expect(app.delete).toHaveBeenCalledWith('/mcp', mockSessionRequestHandler);
    });
  });

  describe('middleware order', () => {
    it('should configure middleware in the correct order', () => {
      const app = createApp(appConfig);
      const useCalls = (app.use as ReturnType<typeof vi.fn>).mock.calls;

      // Order should be: json, cors, rate limiter, (optional auth metadata), routes
      expect(useCalls[0][0]).toBe('json-middleware');
      expect(useCalls[1][0]).toBe('cors-middleware');
      expect(useCalls[2][0]).toBe('rate-limiter-middleware');
    });

    it('should add auth metadata router before routes when auth is enabled', () => {
      appConfig.derivedConfig.enableAuth = true;
      appConfig.config.MCP_SERVER_BASE_URL = 'https://mcp.example.com';

      const app = createApp(appConfig);
      const useCalls = (app.use as ReturnType<typeof vi.fn>).mock.calls;

      // Should have 4 use calls: json, cors, rate limiter, auth metadata
      expect(useCalls).toHaveLength(4);
      expect(useCalls[0][0]).toBe('json-middleware');
      expect(useCalls[1][0]).toBe('cors-middleware');
      expect(useCalls[2][0]).toBe('rate-limiter-middleware');
      expect(useCalls[3][0]).toBe('auth-metadata-router');
    });
  });

  describe('CORS configuration variations', () => {
    it('should handle string CORS origin', async () => {
      const corsMod = await import('cors');

      appConfig.config.MCP_SERVER_CORS_ORIGINS = 'https://single-origin.com';

      createApp(appConfig);

      expect(corsMod.default).toHaveBeenCalledWith({
        origin: 'https://single-origin.com',
        exposedHeaders: ['Mcp-Session-Id']
      });
    });

    it('should handle array CORS origins', async () => {
      const corsMod = await import('cors');

      appConfig.config.MCP_SERVER_CORS_ORIGINS = ['https://origin1.com', 'https://origin2.com'];

      createApp(appConfig);

      expect(corsMod.default).toHaveBeenCalledWith({
        origin: ['https://origin1.com', 'https://origin2.com'],
        exposedHeaders: ['Mcp-Session-Id']
      });
    });

    it('should handle undefined CORS origins', async () => {
      const corsMod = await import('cors');

      appConfig.config.MCP_SERVER_CORS_ORIGINS = undefined;

      createApp(appConfig);

      expect(corsMod.default).toHaveBeenCalledWith({
        origin: undefined,
        exposedHeaders: ['Mcp-Session-Id']
      });
    });
  });

  describe('complete app configuration', () => {
    it('should return a fully configured Express app', () => {
      appConfig.derivedConfig.enableAuth = true;
      appConfig.authMiddleware = mockAuthMiddleware;
      appConfig.config.MCP_SERVER_BASE_URL = 'https://mcp.example.com';

      const app = createApp(appConfig);

      // Verify all middleware was added
      expect(app.use).toHaveBeenCalledTimes(4); // json, cors, rate limiter, auth metadata

      // Verify all routes were added
      expect(app.post).toHaveBeenCalledTimes(1);
      expect(app.get).toHaveBeenCalledTimes(1);
      expect(app.delete).toHaveBeenCalledTimes(1);
    });

    it('should return app without auth metadata when auth is disabled', () => {
      appConfig.derivedConfig.enableAuth = false;

      const app = createApp(appConfig);

      // Verify middleware was added (no auth metadata)
      expect(app.use).toHaveBeenCalledTimes(3); // json, cors, rate limiter

      // Verify all routes were added
      expect(app.post).toHaveBeenCalledTimes(1);
      expect(app.get).toHaveBeenCalledTimes(1);
      expect(app.delete).toHaveBeenCalledTimes(1);
    });
  });
});
