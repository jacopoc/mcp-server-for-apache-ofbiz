import * as fs from 'fs';
import * as path from 'path';

import type { ServerConfig, RuntimeConfig, DerivedConfig } from './types.js';

/**
 * Loads configuration from a JSON file
 */
export function loadConfigFromFile(configPath: string): ServerConfig {
  const absolutePath = path.resolve(configPath);
  const configData = fs.readFileSync(absolutePath, 'utf-8');
  return JSON.parse(configData) as ServerConfig;
}

/**
 * Creates a function that always reads the latest config from the file system
 */
export function createConfigReader(configPath: string): () => ServerConfig {
  const absolutePath = path.resolve(configPath);
  return () => {
    const configData = fs.readFileSync(absolutePath, 'utf-8');
    return JSON.parse(configData) as ServerConfig;
  };
}

/**
 * Derives computed configuration values from the base configuration
 */
export function deriveConfig(config: ServerConfig): DerivedConfig {
  const enableAuth = !!(config.MCP_SERVER_BASE_URL && config.AUTHZ_SERVER_BASE_URL);
  const enableTokenExchange = !!(config.MCP_SERVER_CLIENT_ID && config.MCP_SERVER_CLIENT_SECRET);
  const enableHttps = !!(config.TLS_KEY_PATH && config.TLS_CERT_PATH);

  return {
    enableAuth,
    enableTokenExchange,
    enableHttps,
    rateLimitWindowMs: config.RATE_LIMIT_WINDOW_MS || 60000, // default 1 minute
    rateLimitMaxRequests: config.RATE_LIMIT_MAX_REQUESTS || 100, // default 100 requests
    dnsRebindingProtectionAllowedHosts:
      config.MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_HOSTS || [],
    dnsRebindingProtectionAllowedOrigins:
      config.MCP_SERVER_DNS_REBINDING_PROTECTION_ALLOWED_ORIGINS || [],
    tokenExchangeScope: config.TOKEN_EXCHANGE_SCOPE || []
  };
}

/**
 * Loads and validates runtime configuration from command-line arguments
 */
export function loadRuntimeConfig(
  configFolderPath: string,
  toolsFolderPath: string
): RuntimeConfig {
  const configPath = path.resolve(configFolderPath, 'config.json');
  const config = loadConfigFromFile(configPath);

  return {
    config,
    configPath,
    toolsFolderPath: path.resolve(toolsFolderPath)
  };
}
