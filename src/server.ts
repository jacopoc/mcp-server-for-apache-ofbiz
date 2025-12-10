import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { randomUUID } from 'node:crypto';

import fetch from 'node-fetch';
import express from 'express';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import * as oidc_client from 'openid-client';
import {
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { loadTools } from './toolLoader.js';

// Require config and tools paths as command-line arguments
if (!process.argv[2] || !process.argv[3]) {
  console.error(
    'Error: Paths to config folder and tools folder are mandatory command-line arguments'
  );
  console.error('Usage: node server.js  <path-to-config-folder> <path-to-tools-folder>');
  process.exit(1);
}

const configPath = path.resolve(process.argv[2], 'config.json');
const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Always read the latest config from the file system
function getConfigData() {
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

export const TOOLS_FOLDER_PATH = path.resolve(process.argv[3]);
export const USER_AGENT = 'OFBiz-MCP-server';
export const BACKEND_API_BASE = configData.BACKEND_API_BASE;
const BACKEND_API_AUDIENCE = configData.BACKEND_API_AUDIENCE;
const BACKEND_API_RESOURCE = configData.BACKEND_API_RESOURCE;
const BACKEND_ACCESS_TOKEN = () => getConfigData().BACKEND_ACCESS_TOKEN;
const MCP_SERVER_BASE_URL = configData.MCP_SERVER_BASE_URL;
const MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_HOSTS =
  configData.MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_HOSTS || [];
const MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_ORIGINS =
  configData.MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_ORIGINS || [];
const AUTHZ_SERVER_BASE_URL = configData.AUTHZ_SERVER_BASE_URL;
const SCOPES_SUPPORTED = configData.SCOPES_SUPPORTED;
const MCP_SERVER_CLIENT_ID = configData.MCP_SERVER_CLIENT_ID;
const MCP_SERVER_CLIENT_SECRET = configData.MCP_SERVER_CLIENT_SECRET;
const TOKEN_EXCHANGE_SCOPE = configData.TOKEN_EXCHANGE_SCOPE || [];
// Server configuration
const SERVER_PORT = configData.SERVER_PORT;
const RATE_LIMIT_WINDOW_MS = configData.RATE_LIMIT_WINDOW_MS || 60000; // default 1 minute
const RATE_LIMIT_MAX_REQUESTS = configData.RATE_LIMIT_MAX_REQUESTS || 100; // default 100 requests
// TLS support configuration (optional)
const TLS_KEY_PATH = configData.TLS_KEY_PATH || '';
const TLS_CERT_PATH = configData.TLS_CERT_PATH || '';
const TLS_KEY_PASSPHRASE = configData.TLS_KEY_PASSPHRASE;

const enableAuth = MCP_SERVER_BASE_URL && AUTHZ_SERVER_BASE_URL;
const enableHttps = TLS_KEY_PATH && TLS_CERT_PATH;

// Function to fetch JWKS URI from OpenID Connect metadata
async function getJwksUri(issuer: string): Promise<string> {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`Failed to fetch metadata: ${res.statusText}`);
  const metadata = (await res.json()) as Record<string, unknown>;
  const jwks = metadata['jwks_uri'];
  if (typeof jwks !== 'string') {
    throw new Error("Invalid OpenID metadata: 'jwks_uri' missing or not a string");
  }
  return jwks;
}

// Create a JWKS client to retrieve the public key
const client = !enableAuth
  ? null
  : jwksClient({
      jwksUri: await getJwksUri(AUTHZ_SERVER_BASE_URL),
      cache: true, // enable local caching
      cacheMaxEntries: 5, // maximum number of keys stored
      cacheMaxAge: 10 * 60 * 1000 // 10 minutes
    });

// Function to get the public key from the JWT's kid
function getKey(header: JwtHeader, callback: SigningKeyCallback) {
  if (!client) {
    return callback(new Error('JWKS client not initialized'));
  }
  if (!header.kid) {
    return callback(new Error("Missing 'kid' in token header"));
  }
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err, undefined);
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

export interface ValidationResult {
  valid: boolean;
  clientId?: string;
  scopes?: string[];
  userId?: string;
  audience?: string | string[];
  subjectToken?: string;
  downstreamToken?: string | null;
}

export interface AuthenticatedRequest extends express.Request {
  auth?: ValidationResult;
}

async function validateAccessToken(token: string): Promise<ValidationResult> {
  try {
    // Using JWT tokens, validate locally
    const result = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      // Decode the token header to obtain the algorithm
      const decodedToken = jwt.decode(token, { complete: true }) as { header?: JwtHeader } | null;
      const alg = decodedToken?.header?.alg;
      if (!alg) return reject(new Error("Missing 'alg' in token header"));

      jwt.verify(
        token,
        getKey,
        {
          algorithms: [alg as jwt.Algorithm],
          audience: MCP_SERVER_CLIENT_ID,
          issuer: AUTHZ_SERVER_BASE_URL
        },
        (err, decoded) => {
          if (err) return reject(err);
          resolve(decoded as jwt.JwtPayload);
        }
      );
    });

    return {
      valid: true,
      clientId: result.client_id,
      scopes: result.scope?.split(' '),
      userId: result.sub,
      audience: result.aud,
      subjectToken: token,
      downstreamToken: null
    };
  } catch (error) {
    console.error('Token validation error:', error);
    return { valid: false };
  }
}

// Middleware to check for valid access token
const authenticateRequest = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Return 401 with WWW-Authenticate header pointing to metadata
    res
      .status(401)
      .set('WWW-Authenticate', `Bearer realm="mcp", as_uri="${resourceMetadataUrl}"`)
      .json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Authorization required'
        },
        id: null
      });
    return;
  }

  const token = authHeader.substring(7);

  try {
    // Validate the access token
    const validationResult = await validateAccessToken(token);

    if (!validationResult.valid) {
      res
        .status(401)
        .set(
          'WWW-Authenticate',
          `Bearer realm="mcp", error="invalid_token", as_uri="${resourceMetadataUrl}"`
        )
        .json({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message: 'Invalid or expired token'
          },
          id: null
        });
      return;
    }

    // Attach user/token info to request for use in handlers
    (req as AuthenticatedRequest).auth = validationResult;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error during authentication'
      },
      id: null
    });
  }
};

//
// MCP server acting as a OAuth client in order to perform token exchanges
//

/**
 * Get or create a cached OpenID Configuration instance.
 */
let cachedAuthServerConfig: oidc_client.Configuration | null = null;
async function getOAuthServerConfiguration(): Promise<oidc_client.Configuration> {
  if (cachedAuthServerConfig) return cachedAuthServerConfig;

  try {
    cachedAuthServerConfig = await oidc_client.discovery(
      new URL(AUTHZ_SERVER_BASE_URL),
      MCP_SERVER_CLIENT_ID,
      MCP_SERVER_CLIENT_SECRET,
      undefined,
      { execute: [oidc_client.allowInsecureRequests] }
    );
    return cachedAuthServerConfig;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Failed to initialize OpenID client:', errorMessage);
    throw new Error('Failed to initialize OAuth client for token exchange');
  }
}
/**
 * Performs an OAuth 2.0 Token Exchange (RFC 8693).
 *
 * @param subjectToken - The access token received from the client or another API
 * @returns The new access token to use for calling a downstream API
 */
async function performTokenExchange(subjectToken: string): Promise<string | null> {
  try {
    // Discover the Authorization Server's configuration
    const authServerConfig = await getOAuthServerConfiguration();

    // Execute the token exchange request
    const response = await oidc_client.genericGrantRequest(
      authServerConfig,
      'urn:ietf:params:oauth:grant-type:token-exchange',
      {
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        scope: TOKEN_EXCHANGE_SCOPE.join(' '),
        resource: BACKEND_API_RESOURCE,
        audience: BACKEND_API_AUDIENCE
      }
    );

    // Verify the response contains the expected access token
    if (!response?.access_token) {
      console.error('Token exchange succeeded but no access_token was returned:', response);
      return null;
    }
    return response.access_token;
  } catch (err: unknown) {
    // Handle specific openid-client errors
    /*
    if (err instanceof oidc_client.ClientError) {
      console.error("OAuth/OIDC error:", err.error, err.error_description);
      if (err.response) {
        console.error("Response details:", await err.response.text());
      }
    } else if (err instanceof TypeError) {
      console.error("Network or configuration error:", err.message);
    } else {
      console.error("Unexpected error:", err);
    }
    */
    console.error('Error during token exchange:', err);
    return null;
  }
}

const handleMcpRequest = async (req: express.Request, res: express.Response) => {
  // Check for existing session ID
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && getTransport(sessionId)) {
    // Reuse existing transport
    transport = getTransport(sessionId)!;
  } else if (!sessionId && isInitializeRequest(req.body)) {
    const enableDnsRebindingProtection =
      MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_HOSTS.length > 0;
    // New initialization request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the transport by session ID
        addSession(sessionId, transport);
      },
      enableDnsRebindingProtection: enableDnsRebindingProtection,
      allowedHosts: MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_HOSTS,
      allowedOrigins: MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_ORIGINS
    });

    // Clean up transport when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        deleteSession(transport.sessionId);
      }
    };
    const server = new McpServer({
      name: 'MCP Server for Apache OFBiz',
      version: '1.3.0'
    });

    // Load and register tools from external files
    async function registerTools() {
      try {
        const tools = await loadTools(TOOLS_FOLDER_PATH);

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
    authReq.auth = { valid: !enableAuth, downstreamToken: null };
  }
  if (sessionId && authReq.auth.valid) {
    let downstreamToken = getDownstreamToken(sessionId);
    if (!downstreamToken) {
      if (enableAuth && authReq.auth.valid && MCP_SERVER_CLIENT_ID && MCP_SERVER_CLIENT_SECRET) {
        downstreamToken = await performTokenExchange(authReq.auth.subjectToken!);
      }
      if (downstreamToken) {
        setDownstreamToken(sessionId, downstreamToken);
      } else {
        // No downstream token obtained from token exchange, fallback to static token
        downstreamToken = BACKEND_ACCESS_TOKEN();
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

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req: express.Request, res: express.Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !getTransport(sessionId)) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  const transport = getTransport(sessionId);
  await transport?.handleRequest(req, res);
};

// Map to store transports by session ID
const sessions = new Map<
  string,
  { transport: StreamableHTTPServerTransport; downstreamToken: string | null }
>();

// Helper functions to access the transports map
function getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
  const entry = sessions.get(sessionId);
  return entry?.transport;
}

function getDownstreamToken(sessionId: string): string | null {
  const entry = sessions.get(sessionId);
  if (!entry) return null;
  return entry.downstreamToken;
}

function addSession(sessionId: string, transport: StreamableHTTPServerTransport): void {
  sessions.set(sessionId, { transport, downstreamToken: null });
}

function deleteSession(sessionId?: string): void {
  if (!sessionId) return;
  sessions.delete(sessionId);
}

function setDownstreamToken(sessionId: string, downstreamToken: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  entry.downstreamToken = downstreamToken;
}

// Precompute resource metadata URL
const resourceMetadataUrl = enableAuth
  ? getOAuthProtectedResourceMetadataUrl(new URL(MCP_SERVER_BASE_URL))
  : '';

// ======================================================================
// Initialization of Express app
// ======================================================================

const app = express();
app.use(express.json());
// CORS configuration
app.use(
  cors({
    origin: configData.MCP_SERVER_CORS_ORIGINS,
    exposedHeaders: ['Mcp-Session-Id']
  })
);
// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

if (enableAuth) {
  // Handle OAuth Protected Resource Metadata endpoint (RFC9728)
  const oauthMetadata: OAuthMetadata = {
    issuer: new URL(AUTHZ_SERVER_BASE_URL).toString(),
    introspection_endpoint: '',
    authorization_endpoint: '',
    token_endpoint: '',
    registration_endpoint: '', // optional
    response_types_supported: ['code']
  };

  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: new URL(MCP_SERVER_BASE_URL),
      scopesSupported: SCOPES_SUPPORTED,
      resourceName: 'MCP Server for Apache OFBiz' // optional
    })
  );
  // Handle POST, GET and DELETE requests for authenticated client-to-server communication
  app.post('/mcp', authenticateRequest, handleMcpRequest);
  app.get('/mcp', authenticateRequest, handleSessionRequest);
  app.delete('/mcp', authenticateRequest, handleSessionRequest);
} else {
  // Handle POST, GET and DELETE requests for unauthenticated client-to-server communication
  app.post('/mcp', handleMcpRequest);
  app.get('/mcp', handleSessionRequest);
  app.delete('/mcp', handleSessionRequest);
}

if (enableHttps) {
  try {
    // Resolve key/cert relative to the project if paths provided in config are relative
    const base = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const keyPath = path.isAbsolute(TLS_KEY_PATH) ? TLS_KEY_PATH : path.join(base, TLS_KEY_PATH);
    const certPath = path.isAbsolute(TLS_CERT_PATH)
      ? TLS_CERT_PATH
      : path.join(base, TLS_CERT_PATH);

    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);

    const serverOptions: https.ServerOptions = {
      key,
      cert,
      passphrase: TLS_KEY_PASSPHRASE
    };

    const httpsServer = https.createServer(serverOptions, app);
    httpsServer.listen(SERVER_PORT, () => {
      console.log(
        `MCP stateful Streamable HTTPS Server listening on port ${SERVER_PORT} with ${enableAuth ? 'authentication' : 'no authentication'}.`
      );
    });
  } catch (err) {
    console.error('Failed to start HTTPS server:', err);
    process.exit(1);
  }
} else {
  app.listen(SERVER_PORT, () => {
    console.log(
      `MCP stateful Streamable HTTP Server listening on port ${SERVER_PORT} with ${enableAuth ? 'authentication' : 'no authentication'}.`
    );
  });
}
