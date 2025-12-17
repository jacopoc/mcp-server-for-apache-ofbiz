import { randomUUID } from 'node:crypto';

import type express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import type { AuthenticatedRequest } from '../auth/middleware.js';
import type { TokenExchangeConfig } from '../auth/oauth.js';
import type { ServerConfig } from '../config/types.js';

import type { loadTools } from './tool-loader.js';
import type { SessionManager } from './session-manager.js';

export interface McpRequestHandlerConfig {
  sessionManager: SessionManager;
  loadTools: typeof loadTools;
  serverConfig: ServerConfig;
  toolsFolderPath: string;
  dnsRebindingProtectionAllowedHosts: string[];
  dnsRebindingProtectionAllowedOrigins: string[];
  enableAuth: boolean;
  performTokenExchange?: (
    subjectToken: string,
    config: TokenExchangeConfig
  ) => Promise<string | null>;
  tokenExchangeConfig?: TokenExchangeConfig;
  getBackendAccessToken: () => string | undefined;
}

/**
 * Creates a handler for MCP POST requests
 */
export function createMcpRequestHandler(config: McpRequestHandlerConfig) {
  return async (req: express.Request, res: express.Response) => {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && config.sessionManager.getTransport(sessionId)) {
      // Reuse existing transport
      transport = config.sessionManager.getTransport(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const enableDnsRebindingProtection = config.dnsRebindingProtectionAllowedHosts.length > 0;
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID
          config.sessionManager.addSession(sessionId, transport);
        },
        enableDnsRebindingProtection: enableDnsRebindingProtection,
        allowedHosts: config.dnsRebindingProtectionAllowedHosts,
        allowedOrigins: config.dnsRebindingProtectionAllowedOrigins
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          config.sessionManager.deleteSession(transport.sessionId);
        }
      };
      const server = new McpServer({
        name: 'MCP Server for Apache OFBiz',
        version: '1.3.0'
      });

      // Load and register tools from external files
      async function registerTools() {
        try {
          const tools = await config.loadTools(config.serverConfig, config.toolsFolderPath);

          for (const tool of tools) {
            server.registerTool(tool.name, tool.metadata, tool.handler);
            console.error(`Registered tool: ${tool.name}`);
          }
        } catch (error) {
          console.error('Error loading tools:', error);
          throw error;
        }
      }

      // Set up server resources, tools, and prompts
      await registerTools();

      // Connect to the MCP server
      await server.connect(transport);
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided'
        },
        id: null
      });
      return;
    }

    // Prepare downstream token
    // Get or perform token exchange if authentication is enabled
    const authReq = req as AuthenticatedRequest;
    if (!authReq.auth) {
      authReq.auth = { valid: !config.enableAuth, downstreamToken: null };
    }
    if (sessionId && authReq.auth.valid) {
      let downstreamToken = config.sessionManager.getDownstreamToken(sessionId);
      if (!downstreamToken) {
        if (
          config.enableAuth &&
          authReq.auth.valid &&
          config.performTokenExchange &&
          config.tokenExchangeConfig &&
          authReq.auth.subjectToken
        ) {
          downstreamToken = await config.performTokenExchange(
            authReq.auth.subjectToken,
            config.tokenExchangeConfig
          );
        }
        if (downstreamToken) {
          config.sessionManager.setDownstreamToken(sessionId, downstreamToken);
        } else {
          // No downstream token obtained from token exchange, fallback to static token
          const staticToken = config.getBackendAccessToken();
          if (staticToken) {
            downstreamToken = staticToken;
          }
        }
      }
      if (downstreamToken) {
        authReq.auth.downstreamToken = downstreamToken;
      }
    }

    // Handle the request
    console.log(`Processing request for session ${sessionId}`);
    await transport.handleRequest(req, res, req.body);
    console.log(`Completed request for session ${sessionId}`);
  };
}

/**
 * Creates a handler for GET and DELETE session requests
 */
export function createSessionRequestHandler(sessionManager: SessionManager) {
  return async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessionManager.getTransport(sessionId)) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    const transport = sessionManager.getTransport(sessionId);
    await transport?.handleRequest(req, res);
  };
}
