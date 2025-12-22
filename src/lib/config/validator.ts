import type { ServerConfig } from './types.js';

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validates the server configuration
 */
export function validateConfig(config: ServerConfig): void {
  // Required fields
  if (!config.BACKEND_API_BASE) {
    throw new ConfigValidationError('BACKEND_API_BASE is required in configuration');
  }

  if (config.SERVER_PORT === undefined || config.SERVER_PORT === null) {
    throw new ConfigValidationError('SERVER_PORT is required in configuration');
  }

  // Validate port number
  if (config.SERVER_PORT < 1 || config.SERVER_PORT > 65535) {
    throw new ConfigValidationError('SERVER_PORT must be between 1 and 65535');
  }

  // Validate auth configuration consistency
  const hasAuthConfig = config.MCP_SERVER_BASE_URL || config.AUTHZ_SERVER_BASE_URL;
  if (hasAuthConfig) {
    if (!config.MCP_SERVER_BASE_URL) {
      throw new ConfigValidationError(
        'MCP_SERVER_BASE_URL is required when authentication is enabled'
      );
    }
    if (!config.AUTHZ_SERVER_BASE_URL) {
      throw new ConfigValidationError(
        'AUTHZ_SERVER_BASE_URL is required when authentication is enabled'
      );
    }
  }

  // Validate TLS configuration consistency
  const hasTlsConfig = config.TLS_KEY_PATH || config.TLS_CERT_PATH;
  if (hasTlsConfig) {
    if (!config.TLS_KEY_PATH) {
      throw new ConfigValidationError('TLS_KEY_PATH is required when TLS is enabled');
    }
    if (!config.TLS_CERT_PATH) {
      throw new ConfigValidationError('TLS_CERT_PATH is required when TLS is enabled');
    }
  }
}
