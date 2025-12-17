import express from 'express';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';

import type { ServerConfig, DerivedConfig } from './config/types.js';
import type { SessionManager } from './mcp/session-manager.js';
import type {
  createMcpRequestHandler,
  createSessionRequestHandler
} from './mcp/request-handler.js';

export interface CreateAppConfig {
  config: ServerConfig;
  derivedConfig: DerivedConfig;
  sessionManager: SessionManager;
  mcpRequestHandler: ReturnType<typeof createMcpRequestHandler>;
  sessionRequestHandler: ReturnType<typeof createSessionRequestHandler>;
  authMiddleware?: express.RequestHandler;
}

/**
 * Creates and configures an Express application for the MCP server
 */
export function createApp(appConfig: CreateAppConfig): express.Application {
  const app = express();

  // Basic middleware
  app.use(express.json());

  // CORS configuration
  app.use(
    cors({
      origin: appConfig.config.MCP_SERVER_CORS_ORIGINS,
      exposedHeaders: ['Mcp-Session-Id']
    })
  );

  // Rate limiting to prevent abuse
  const limiter = rateLimit({
    windowMs: appConfig.derivedConfig.rateLimitWindowMs,
    max: appConfig.derivedConfig.rateLimitMaxRequests,
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use(limiter);

  // OAuth metadata endpoint (if authentication is enabled)
  if (appConfig.derivedConfig.enableAuth && appConfig.config.MCP_SERVER_BASE_URL) {
    const oauthMetadata: OAuthMetadata = {
      issuer: new URL(appConfig.config.AUTHZ_SERVER_BASE_URL!).toString(),
      introspection_endpoint: '',
      authorization_endpoint: '',
      token_endpoint: '',
      registration_endpoint: '', // optional
      response_types_supported: ['code']
    };

    app.use(
      mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: new URL(appConfig.config.MCP_SERVER_BASE_URL),
        scopesSupported: appConfig.config.SCOPES_SUPPORTED || [],
        resourceName: 'MCP Server for Apache OFBiz' // optional
      })
    );
  }

  // MCP endpoint routes
  if (appConfig.derivedConfig.enableAuth && appConfig.authMiddleware) {
    // Handle POST, GET and DELETE requests for authenticated client-to-server communication
    app.post('/mcp', appConfig.authMiddleware, appConfig.mcpRequestHandler);
    app.get('/mcp', appConfig.authMiddleware, appConfig.sessionRequestHandler);
    app.delete('/mcp', appConfig.authMiddleware, appConfig.sessionRequestHandler);
  } else {
    // Handle POST, GET and DELETE requests for unauthenticated client-to-server communication
    app.post('/mcp', appConfig.mcpRequestHandler);
    app.get('/mcp', appConfig.sessionRequestHandler);
    app.delete('/mcp', appConfig.sessionRequestHandler);
  }

  return app;
}
