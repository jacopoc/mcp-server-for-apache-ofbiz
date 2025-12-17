/**
 * Configuration types for the MCP server
 */

export interface ServerConfig {
  // Backend API configuration
  BACKEND_API_BASE: string;
  BACKEND_USER_AGENT?: string;
  BACKEND_API_AUDIENCE?: string;
  BACKEND_API_RESOURCE?: string;
  BACKEND_ACCESS_TOKEN?: string;

  // MCP Server configuration
  MCP_SERVER_BASE_URL?: string;
  MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_HOSTS?: string[];
  MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_ORIGINS?: string[];
  MCP_SERVER_CORS_ORIGINS?: string | string[];

  // OAuth/Authorization Server configuration
  AUTHZ_SERVER_BASE_URL?: string;
  SCOPES_SUPPORTED?: string[];
  MCP_SERVER_CLIENT_ID?: string;
  MCP_SERVER_CLIENT_SECRET?: string;
  TOKEN_EXCHANGE_SCOPE?: string[];

  // Server configuration
  SERVER_PORT: number;
  RATE_LIMIT_WINDOW_MS?: number;
  RATE_LIMIT_MAX_REQUESTS?: number;

  // TLS configuration
  TLS_KEY_PATH?: string;
  TLS_CERT_PATH?: string;
  TLS_KEY_PASSPHRASE?: string;
}

export interface RuntimeConfig {
  config: ServerConfig;
  configPath: string;
  toolsFolderPath: string;
}

export interface DerivedConfig {
  enableAuth: boolean;
  enableHttps: boolean;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  dnsRebindingProtectionAllowedHosts: string[];
  dnsRebindingProtectionAllowedOrigins: string[];
  tokenExchangeScope: string[];
}

export interface ToolDefinition {
  name: string;
  metadata: {
    title: string;
    description: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outputSchema: Record<string, any>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (params: any, request: any) => Promise<any>;
}
