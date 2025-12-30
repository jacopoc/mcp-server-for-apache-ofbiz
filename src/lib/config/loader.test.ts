import * as fs from 'fs';
import * as path from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadConfigFromFile, createConfigReader, deriveConfig } from './loader.js';
import type { ServerConfig } from './types.js';

describe('Config Loader', () => {
  const testConfigPath = path.join(process.cwd(), 'test-config.json');
  const testConfig: ServerConfig = {
    BACKEND_API_BASE: 'https://api.example.com',
    SERVER_PORT: 3000,
    MCP_SERVER_BASE_URL: 'https://mcp.example.com',
    AUTHZ_SERVER_BASE_URL: 'https://auth.example.com',
    MCP_SERVER_CLIENT_ID: 'test-client',
    MCP_SERVER_CLIENT_SECRET: 'test-secret',
    SCOPES_SUPPORTED: ['read', 'write']
  };

  beforeEach(() => {
    fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));
  });

  afterEach(() => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe('loadConfigFromFile', () => {
    it('should load config from a valid JSON file', () => {
      const config = loadConfigFromFile(testConfigPath);
      expect(config).toEqual(testConfig);
    });

    it('should throw error for non-existent file', () => {
      expect(() => loadConfigFromFile('non-existent.json')).toThrow();
    });

    it('should throw error for invalid JSON', () => {
      fs.writeFileSync(testConfigPath, 'invalid json');
      expect(() => loadConfigFromFile(testConfigPath)).toThrow();
    });
  });

  describe('createConfigReader', () => {
    it('should create a function that reads latest config', () => {
      const reader = createConfigReader(testConfigPath);
      const config1 = reader();
      expect(config1.SERVER_PORT).toBe(3000);

      // Update the config file
      const updatedConfig = { ...testConfig, SERVER_PORT: 4000 };
      fs.writeFileSync(testConfigPath, JSON.stringify(updatedConfig, null, 2));

      const config2 = reader();
      expect(config2.SERVER_PORT).toBe(4000);
    });
  });

  describe('deriveConfig', () => {
    it('should enable auth when both URLs are present', () => {
      const derived = deriveConfig(testConfig);
      expect(derived.enableAuth).toBe(true);
    });

    it('should disable auth when URLs are missing', () => {
      const configWithoutAuth: ServerConfig = {
        BACKEND_API_BASE: 'https://api.example.com',
        SERVER_PORT: 3000
      };
      const derived = deriveConfig(configWithoutAuth);
      expect(derived.enableAuth).toBe(false);
    });

    it('should enable HTTPS when TLS paths are present', () => {
      const configWithTls: ServerConfig = {
        ...testConfig,
        TLS_KEY_PATH: '/path/to/key.pem',
        TLS_CERT_PATH: '/path/to/cert.pem'
      };
      const derived = deriveConfig(configWithTls);
      expect(derived.enableHttps).toBe(true);
    });

    it('should use default rate limit values', () => {
      const derived = deriveConfig(testConfig);
      expect(derived.rateLimitWindowMs).toBe(60000);
      expect(derived.rateLimitMaxRequests).toBe(100);
    });

    it('should use custom rate limit values when provided', () => {
      const configWithRateLimit: ServerConfig = {
        ...testConfig,
        RATE_LIMIT_WINDOW_MS: 120000,
        RATE_LIMIT_MAX_REQUESTS: 200
      };
      const derived = deriveConfig(configWithRateLimit);
      expect(derived.rateLimitWindowMs).toBe(120000);
      expect(derived.rateLimitMaxRequests).toBe(200);
    });

    it('should handle empty token exchange scope', () => {
      const derived = deriveConfig(testConfig);
      expect(derived.tokenExchangeScope).toEqual([]);
    });

    it('should use provided token exchange scope', () => {
      const configWithScope: ServerConfig = {
        ...testConfig,
        TOKEN_EXCHANGE_SCOPE: ['api:read', 'api:write']
      };
      const derived = deriveConfig(configWithScope);
      expect(derived.tokenExchangeScope).toEqual(['api:read', 'api:write']);
    });
  });
});
