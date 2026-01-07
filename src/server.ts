#!/usr/bin/env node

import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';

import { loadRuntimeConfig, deriveConfig, createConfigReader } from './lib/config/loader.js';
import { validateConfig } from './lib/config/validator.js';
import { createJwksClient, createKeyGetter, validateAccessToken } from './lib/auth/jwt.js';
import { performTokenExchange } from './lib/auth/oauth.js';
import { createAuthMiddleware } from './lib/auth/middleware.js';
import { SessionManager } from './lib/mcp/session-manager.js';
import { loadTools } from './lib/mcp/tool-loader.js';
import { createMcpRequestHandler, createSessionRequestHandler } from './lib/mcp/request-handler.js';
import { createApp } from './lib/app.js';
import { createServer } from './lib/server-factory.js';

/**
 * Main entry point for the MCP server CLI
 */
async function main() {
  // Parse command-line arguments
  if (!process.argv[2] || !process.argv[3]) {
    console.error(
      'Error: Paths to config folder and tools folder are mandatory command-line arguments'
    );
    console.error('Usage: node server.js <path-to-config-folder> <path-to-tools-folder>');
    process.exit(1);
  }

  try {
    // Load configuration
    const runtimeConfig = loadRuntimeConfig(process.argv[2], process.argv[3]);
    validateConfig(runtimeConfig.config);
    const derivedConfig = deriveConfig(runtimeConfig.config);

    // Create config reader for dynamic config updates
    const getConfigData = createConfigReader(runtimeConfig.configPath);
    const getBackendAccessToken = () => getConfigData().BACKEND_ACCESS_TOKEN;

    // Initialize authentication components if enabled
    let jwksClient;
    let authMiddleware;
    let resourceMetadataUrl = '';

    if (derivedConfig.enableAuth) {
      // Create JWKS client
      jwksClient = await createJwksClient(runtimeConfig.config.AUTHZ_SERVER_BASE_URL!);
      const getKey = createKeyGetter(jwksClient);

      // Create validation function
      const validateToken = async (token: string) => {
        return validateAccessToken(token, getKey, {
          authzServerBaseUrl: runtimeConfig.config.AUTHZ_SERVER_BASE_URL!,
          mcpServerClientId: runtimeConfig.config.MCP_SERVER_CLIENT_ID!
        });
      };

      // Compute resource metadata URL
      resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(
        new URL(runtimeConfig.config.MCP_SERVER_BASE_URL!)
      );

      // Create authentication middleware
      authMiddleware = createAuthMiddleware({
        validateAccessToken: validateToken,
        resourceMetadataUrl
      });
    }

    // Create session manager
    const sessionManager = new SessionManager();

    // Create MCP request handlers
    const mcpRequestHandler = createMcpRequestHandler({
      sessionManager,
      loadTools,
      serverConfig: runtimeConfig.config,
      toolsFolderPath: runtimeConfig.toolsFolderPath,
      dnsRebindingProtectionAllowedHosts: derivedConfig.dnsRebindingProtectionAllowedHosts,
      dnsRebindingProtectionAllowedOrigins: derivedConfig.dnsRebindingProtectionAllowedOrigins,
      enableAuth: derivedConfig.enableAuth,
      performTokenExchange:
        derivedConfig.enableAuth && derivedConfig.enableTokenExchange
          ? performTokenExchange
          : undefined,
      tokenExchangeConfig: derivedConfig.enableAuth
        ? {
            authzServerBaseUrl: runtimeConfig.config.AUTHZ_SERVER_BASE_URL!,
            mcpServerClientId: runtimeConfig.config.MCP_SERVER_CLIENT_ID!,
            mcpServerClientSecret: runtimeConfig.config.MCP_SERVER_CLIENT_SECRET!,
            tokenExchangeScope: derivedConfig.tokenExchangeScope,
            backendApiResource: runtimeConfig.config.BACKEND_API_RESOURCE,
            backendApiAudience: runtimeConfig.config.BACKEND_API_AUDIENCE
          }
        : undefined,
      getBackendAccessToken
    });

    const sessionRequestHandler = createSessionRequestHandler(sessionManager);

    // Create Express app
    const app = createApp({
      config: runtimeConfig.config,
      derivedConfig,
      sessionManager,
      mcpRequestHandler,
      sessionRequestHandler,
      authMiddleware
    });

    // Create and start server
    const server = createServer(app, {
      port: runtimeConfig.config.SERVER_PORT,
      enableHttps: derivedConfig.enableHttps,
      tlsConfig: derivedConfig.enableHttps
        ? {
            keyPath: runtimeConfig.config.TLS_KEY_PATH!,
            certPath: runtimeConfig.config.TLS_CERT_PATH!,
            passphrase: runtimeConfig.config.TLS_KEY_PASSPHRASE
          }
        : undefined,
      enableAuth: derivedConfig.enableAuth,
      enableTokenExchange: derivedConfig.enableTokenExchange,
      configFolderPath: process.argv[2]
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down gracefully...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down gracefully...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Run main function if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
