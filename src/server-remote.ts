import * as fs from "fs";
import * as path from "path";
import fetch from "node-fetch";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import jwt, { JwtHeader, SigningKeyCallback } from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import * as oidc_client from "openid-client";
import {
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { loadTools } from "./toolLoader.js";

// Load configuration
const configPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../config/config.json"
);

const configData = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Always read the latest config from the file system
function getConfigData() {
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

const MCP_SERVER_BASE_URL = configData.MCP_SERVER_BASE_URL;
const AUTHZ_SERVER_BASE_URL = configData.AUTHZ_SERVER_BASE_URL;
const SCOPES_SUPPORTED = configData.SCOPES_SUPPORTED;
const MCP_SERVER_CLIENT_ID = configData.MCP_SERVER_CLIENT_ID;
const MCP_SERVER_CLIENT_SECRET = configData.MCP_SERVER_CLIENT_SECRET;
export const BACKEND_API_BASE = configData.BACKEND_API_BASE;
export const BACKEND_AUTH_TOKEN = () => getConfigData().BACKEND_AUTH_TOKEN;
export const USER_AGENT = "OFBiz-MCP-server";

// Server configuration
const SERVER_PORT = configData.SERVER_PORT;
/*
const USE_HTTPS = configData.USE_HTTPS || false;
const SSL_KEY_PATH = configData.SSL_KEY_PATH;
const SSL_CERT_PATH = configData.SSL_CERT_PATH;
*/

const enableAuth = (MCP_SERVER_BASE_URL && AUTHZ_SERVER_BASE_URL);

// Function to fetch JWKS URI from OpenID Connect metadata
async function getJwksUri(issuer: string): Promise<string> {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`Failed to fetch metadata: ${res.statusText}`);
  const metadata = await res.json() as Record<string, unknown>;
  const jwks = metadata["jwks_uri"];
  if (typeof jwks !== "string") {
    throw new Error("Invalid OpenID metadata: 'jwks_uri' missing or not a string");
  }
  return jwks;
}

// Create a JWKS client to retrieve the public key
const client = !enableAuth ? null : jwksClient({
  jwksUri: await getJwksUri(AUTHZ_SERVER_BASE_URL),
  cache: true,                 // enable local caching
  cacheMaxEntries: 5,          // maximum number of keys stored
  cacheMaxAge: 10 * 60 * 1000, // 10 minutes
});

// Function to get the public key from the JWT's kid
function getKey(header: JwtHeader, callback: SigningKeyCallback) {
  if (!client) {
    return callback(new Error("JWKS client not initialized"));
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

async function validateAccessToken(token: string): Promise<{
  valid: boolean;
  clientId?: string;
  scopes?: string[];
  userId?: string;
  audience?: string;
  subjectToken?: string;
  downstreamToken?: string | null;
}> {
  try {
    // Using JWT tokens, validate locally    
    const result = await new Promise<any>((resolve, reject) => {
      jwt.verify(
        token,
        getKey,
        {
          algorithms: ["RS256"], // FIXME: adjust based on token's algorithm
          audience: MCP_SERVER_BASE_URL,
          issuer: AUTHZ_SERVER_BASE_URL,
        },
        (err, decoded) => {
          if (err) return reject(err);
          resolve(decoded);
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
const authenticateRequest = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Return 401 with WWW-Authenticate header pointing to metadata
    res.status(401)
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
      res.status(401)
        .set('WWW-Authenticate', `Bearer realm="mcp", error="invalid_token", as_uri="${resourceMetadataUrl}"`)
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
    (req as any).auth = validationResult;
    next();
  } catch (error) {
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
  } catch (err: any) {
    console.error("Failed to initialize OpenID client:", err.message || err);
    throw new Error("Failed to initialize OAuth client for token exchange");
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
      "urn:ietf:params:oauth:grant-type:token-exchange",
      {
        subject_token: subjectToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        scope: "ofbiz:use-api",
        resource: BACKEND_API_BASE,
        audience: BACKEND_API_BASE
      });

    // Verify the response contains the expected access token
    if (!response?.access_token) {
      console.error("Token exchange succeeded but no access_token was returned:", response);
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
    console.error("Error during token exchange:", err);
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
    // New initialization request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        // Store the transport by session ID
        addSession(sessionId, transport);
      },
      // FIXME:
      // DNS rebinding protection is disabled by default for backwards compatibility. If you are running this server
      // locally, make sure to set:
      // enableDnsRebindingProtection: true,
      // allowedHosts: ['127.0.0.1'],
    });

    // Clean up transport when closed
    transport.onclose = () => {
      if (transport.sessionId) {
        deleteSession(transport.sessionId);
      }
    };
    const server = new McpServer({
      name: "Apache OFBiz MCP Server (Streamable HTTP)",
      version: "0.1.0"
    });

    // Load and register tools from external files
    async function registerTools() {
      try {
        const tools = await loadTools();

        for (const tool of tools) {
          server.registerTool(
            tool.name,
            tool.metadata,
            tool.handler
          );
          console.error(`Registered tool: ${tool.name}`);
        }
      } catch (error) {
        console.error("Error loading tools:", error);
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
        message: 'Bad Request: No valid session ID provided',
      },
      id: null,
    });
    return;
  }

  // Prepare downstream token
  // Get or perform token exchange if authentication is enabled
  if (!(req as any).auth) {
    (req as any).auth = { valid: false, downstreamToken: null };
  }
  if (sessionId) {
    let downstreamToken = getDownstreamToken(sessionId);
    if (!downstreamToken) {
      if ((req as any).auth.valid && MCP_SERVER_CLIENT_ID && MCP_SERVER_CLIENT_SECRET) {
        downstreamToken = await performTokenExchange((req as any).auth.subjectToken);
      }
      if (downstreamToken) {
        setDownstreamToken(sessionId, downstreamToken);
      } else {
        // No downstream token obtained from token exchange, fallback to static token
        downstreamToken = BACKEND_AUTH_TOKEN();
      }
    }
    if (downstreamToken) {
      (req as any).auth.downstreamToken = downstreamToken;
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
const sessions = new Map<string, {transport: StreamableHTTPServerTransport, downstreamToken: string | null}>();

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
const resourceMetadataUrl = (enableAuth ? getOAuthProtectedResourceMetadataUrl(new URL(MCP_SERVER_BASE_URL)) : "");

// ======================================================================
// Initialization of Express app
// ======================================================================

const app = express();
app.use(express.json());
// CORS configuration
app.use(
  cors({
    origin: configData.MCP_SERVER_CORS_ORIGINS || ['*'],
    exposedHeaders: ['Mcp-Session-Id']
  })
);

if (enableAuth) {
  // Handle OAuth Protected Resource Metadata endpoint (RFC9728)
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata: {
        issuer: new URL(AUTHZ_SERVER_BASE_URL).toString(),
        introspection_endpoint: "",
        authorization_endpoint: "",
        token_endpoint: "",
        registration_endpoint: "", // optional
        response_types_supported: ["code"]
      },
      resourceServerUrl: new URL(MCP_SERVER_BASE_URL),
      scopesSupported: SCOPES_SUPPORTED,
      resourceName: "Apache OFBiz MCP Server", // optional
    }),
  );
  // Handle POST requests for authenticated client-to-server communication
  app.post('/mcp', authenticateRequest, handleMcpRequest);
} else {
  // Handle POST requests for unauthenticated client-to-server communication
  app.post('/mcp', handleMcpRequest);
}
// Handle GET requests for server-to-client notifications via SSE
app.get('/mcp', handleSessionRequest);

// Handle DELETE requests for session termination
app.delete('/mcp', handleSessionRequest);

app.listen(SERVER_PORT, () => {
  console.log(`MCP stateful Streamable HTTP Server listening on port ${SERVER_PORT} with ${enableAuth ? 'authentication' : 'no authentication'}.`);
});
